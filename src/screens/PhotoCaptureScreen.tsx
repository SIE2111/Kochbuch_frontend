import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Image, Modal, BackHandler } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import BrutzelAvatar from '../components/BrutzelAvatar';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaLibraryAccess } from '../utils/mediaPermissions';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import CategoryPicker from '../components/CategoryPicker';
import ImageCropper from '../components/ImageCropper';
import { zutatZerlegen } from '../utils/zutaten';
import { titelbildAblegen } from '../utils/titelbild';
import { askWhatNext } from '../utils/afterRecipeSaved';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PhotoCapture'>;

interface ScannedIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
}

interface ScannedStep {
  order: number;
  text: string;
}

interface ScanPhotoResponse {
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  ingredients: ScannedIngredient[];
  steps: ScannedStep[];
  low_confidence_note: string | null;
  notes?: string | null;
  tags?: string[] | null;
  folder_suggestion?: string | null;
}

export default function PhotoCaptureScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();

  // Mehrere Fotos statt einem: Ein gedrucktes Rezept geht oft ueber zwei
  // Buchseiten, und in einer Zeitschrift steht die Zutatenliste in einer
  // anderen Spalte als die Zubereitung. Mit nur einem Bild fehlte dann die
  // Haelfte.
  const [imageUris, setImageUris] = useState<string[]>([]);
  const imageUri = imageUris[0] ?? null;
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanPhotoResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [ingredientLines, setIngredientLines] = useState<string[]>([]);
  const [stepLines, setStepLines] = useState<string[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  // Anmerkungen aus der Vorlage: Wahlmoeglichkeiten ("wahlweise Pute"),
  // Backangaben, Bemerkungen der schreibenden Person. Die passen in keine
  // der beiden Listen und gingen beim Uebertragen bisher verloren.
  const [notiz, setNotiz] = useState('');
  // Stand auf der Vorlage keine Portionenzahl? Dann darf nicht still die
  // Voreinstellung aus dem Profil einspringen - alle Mengen haengen
  // daran, und eine falsche Zahl faellt erst beim Kochen auf.
  const [portionenUnklar, setPortionenUnklar] = useState(false);
  // Entscheidet, ob das Titelbild hochgeladen oder nur am Geraet abgelegt wird.
  const [storageMode, setStorageMode] = useState<string | null>(null);
  // Frisch aufgenommenes Foto, das noch durch den Zuschnitt geht.
  const [zuschnittUri, setZuschnittUri] = useState<string | null>(null);
  const [aiGeneratedImageUrl, setAiGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/folders/').then(setFolders).catch(() => {
      // Ordner sind hier nur "nice to have" - schlaegt das Laden fehl,
      // bleibt die Auswahl einfach leer, das Speichern selbst funktioniert trotzdem
    });
    api.get<{ default_servings: number; storage_mode: string | null }>('/preferences/').then((prefs) => {
      setServings(String(prefs.default_servings));
      setStorageMode(prefs.storage_mode ?? null);
    }).catch(() => {
      // Vorlage konnte nicht geladen werden - Feld bleibt einfach leer
    });
  }, []);

  /**
   * Ein abfotografiertes Rezept hat kein Bild vom Gericht - nur die Seite
   * aus dem Buch. Die taugt als Vorlage, aber nicht als Titelbild in der
   * Rezeptliste. Deshalb hier dasselbe Angebot wie bei der KI-Erfassung.
   */
  const erzeugeBild = async () => {
    if (!title.trim()) {
      Alert.alert(t('erfassen.rezeptnameFehlt'), t('erfassen.bitteNameFuerBild'));
      return;
    }
    setIsGeneratingImage(true);
    try {
      const res = await api.post<{ url: string; storage_warning?: string | null }>(
        '/ai/generate-recipe-image',
        { title: title.trim(), folder_name: folders.find((f) => f.id === selectedFolderId)?.name },
      );
      setAiGeneratedImageUrl(res.url);
      if (res.storage_warning) Alert.alert(t('erfassen.hinweis'), res.storage_warning);
    } catch (err) {
      Alert.alert(
        t('erfassen.bildgenerierungFehlgeschlagen'),
        err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'),
      );
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const runScan = async (uris: string[]) => {
    if (uris.length === 0) return;
    setIsScanning(true);
    setScanError(null);
    try {
      // Alle Fotos GEMEINSAM in einem Aufruf - nur so erkennt die KI, dass
      // Zutaten vom einen und Schritte vom anderen Bild zusammengehoeren.
      // Nacheinander ausgewertet kaemen mehrere halbe Rezepte heraus.
      const scanResult = await api.uploadImagesAsJson<ScanPhotoResponse>(
        '/ai/scan-photos',
        uris.map((u) => ({ uri: u, type: 'image/jpeg' })),
      );
      const typedResult = scanResult as unknown as ScanPhotoResponse;
      setResult(typedResult);
      setTitle(typedResult.title);
      setIngredientLines(
        typedResult.ingredients.map((ing) => `${ing.amount ?? ''} ${ing.unit ?? ''} ${ing.name}`.trim()),
      );
      setStepLines(typedResult.steps.map((s) => s.text));

      // Ordner und Kategorien gleich mit vorauswaehlen. Ein Kuchen gehoert
      // zu "Backen & Desserts" und ist "Suess" - das muss niemand von Hand
      // nachtragen, wenn es auf dem Foto steht.
      if (typedResult.folder_suggestion) {
        const treffer = folders.find(
          (f) => f.name.toLowerCase() === typedResult.folder_suggestion!.toLowerCase(),
        );
        if (treffer) setSelectedFolderId(treffer.id);
      }
      if (typedResult.tags?.length) setTags(typedResult.tags);
      if (typedResult.notes?.trim()) setNotiz(typedResult.notes.trim());

      // Portionen aus der Vorlage uebernehmen - bisher blieb die
      // Voreinstellung aus dem Profil stehen, auch wenn auf dem Blatt
      // "fuer 1 Portion" stand.
      // 0 = Rezept ohne Portionen (z. B. Torte, Auflaufform): Die Mengen
      // gelten fuer das ganze Rezept und werden nicht umgerechnet.
      if (typedResult.servings != null && typedResult.servings >= 0) {
        setServings(String(typedResult.servings));
        setPortionenUnklar(false);
      } else {
        setServings('');
        setPortionenUnklar(true);
      }
    } catch (err) {
      // Statt eines generischen Platzhaltertexts die tatsaechliche Ursache
      // zeigen - auch bei Netzwerk-/Timeout-Fehlern (kein ApiError), die
      // bisher stillschweigend verschluckt wurden und das Debuggen
      // unmoeglich gemacht haben.
      const message =
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? `${err.name}: ${err.message}`
            : t('erfassen.fotoFehler');
      setScanError(message);
    } finally {
      setIsScanning(false);
    }
  };

  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('erfassen.zugriffVerweigert'), t('erfassen.ohneKamera'));
      return;
    }
    // KEIN allowsEditing hier. Der Zuschnitt-Rahmen erzwingt auf iOS ein
    // Quadrat - ein hochformatiges Blatt passt nicht hinein, unten fehlen
    // dann die letzten Zeilen. Ein abgeschnittener Schritt faellt beim
    // Erfassen nicht auf, er fehlt einfach.
    //
    // Der Rahmen war gegen Nachbarspalten in Zeitschriften gedacht. Das
    // wiegt weniger: Die Auswertung kommt mit etwas Tisch am Rand
    // zurecht, mit einem fehlenden Drittel der Seite nicht.
    const pickerResult = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (!pickerResult.canceled && pickerResult.assets[0]) {
      setZuschnittUri(pickerResult.assets[0].uri);
    }
  };

  const handlePickFromLibrary = async () => {
    if (!(await ensureMediaLibraryAccess())) return;
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Ebenfalls ohne Zuschnitt: siehe Begruendung bei der Aufnahme.
      quality: 0.9,
    });
    if (!pickerResult.canceled && pickerResult.assets[0]) {
      const uri = pickerResult.assets[0].uri;
      // Vorher sprang die App bei einem Fehler hier still zurueck, ohne
      // Hinweis - z.B. wenn das Foto nur als iCloud-Cloud-Vorschau existiert
      // (noch nicht lokal heruntergeladen, etwa weil die Synchronisierung
      // pausiert ist) und sich daher nicht in voller Aufloesung laden
      // laesst. Jetzt zumindest eine Meldung, statt kommentarlos nichts zu
      // tun.
      Image.getSize(
        uri,
        () => setZuschnittUri(uri),
        () => {
          Alert.alert(
            'Foto konnte nicht geladen werden',
            'Dieses Foto ließ sich nicht öffnen - möglicherweise ist es nur in der iCloud gespeichert und noch nicht auf dieses Gerät heruntergeladen. Prüfe, ob die iCloud-Fotos-Synchronisierung aktiv ist (z.B. bei niedrigem Akkustand pausiert sie), oder wähle ein anderes Foto.',
          );
        },
      );
    }
  };

  // Abbruch-Schutz (Wunsch 04.10.2026): Zurück mit Fotos oder ausgewertetem
  // Rezept verwarf vorher alles ohne Rückfrage. Eigener Zurück-Knopf statt
  // beforeRemove (siehe ManualRecipeScreen), Wischgeste aus, Android-Zurück
  // ebenfalls abgefangen. Die Frage stellt Brutzel, kein System-Dialog.
  const [zurueckFrage, setZurueckFrage] = useState(false);
  const gespeichertRef = useRef(false);
  const ungespeichert = !gespeichertRef.current && (imageUris.length > 0 || !!result);
  const ungespeichertRef = useRef(ungespeichert);
  ungespeichertRef.current = ungespeichert;
  const zurueck = () => {
    if (ungespeichertRef.current) setZurueckFrage(true);
    else navigation.goBack();
  };
  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: false,
      headerLeft: () => (
        <Pressable onPress={zurueck} hitSlop={10} style={{ paddingHorizontal: 4 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={gradient[0]} />
        </Pressable>
      ),
    });
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!ungespeichertRef.current) return false;
      setZurueckFrage(true);
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, gradient]);

  const handleSave = async (cookOnly = false) => {
    if (!title.trim()) {
      Alert.alert(t('erfassen.titelFehlt'), t('erfassen.bitteName'));
      return;
    }
    const portionenZahl = Number(servings);
    if (!servings.trim() || !Number.isInteger(portionenZahl) || portionenZahl < 0) {
      Alert.alert(t('erfassen.portionenFehlen'), t('erfassen.portionenFehlenText'));
      return;
    }
    setIsSaving(true);
    try {
      // Zeile in Menge, Einheit und Name zerlegen. Bisher landete die
      // ganze Zeile im Namen - mit der Folge, dass im Rezept-PDF in jeder
      // Portionsspalte "nach Bedarf" stand, die Einkaufsliste Posten ohne
      // Menge bekam und das Umrechnen auf andere Portionen nichts tat.
      const ingredients = ingredientLines
        .filter((line) => line.trim())
        .map((line) => zutatZerlegen(line));
      const steps = stepLines
        .filter((line) => line.trim())
        .map((line, i) => ({ order: i + 1, text: line.trim() }));

      // Das aufgenommene/ausgewaehlte Foto (imageUri, siehe oben) als
      // Titelbild mit hochladen - bisher wurde es nur zur Kontrolle
      // angezeigt, aber beim Speichern nie tatsaechlich verwendet.
      // Das erzeugte Bild hat Vorrang vor der abfotografierten Seite -
      // wer es angefordert hat, will es auch sehen.
      let coverImageUrl: string | null = aiGeneratedImageUrl;
      if (!coverImageUrl && imageUri) {
        try {
          // Bei "nur lokal" bleibt das Bild am Geraet, sonst geht es wie
          // bisher zum Server bzw. in die verbundene Cloud.
          const uploadResult = await titelbildAblegen(imageUri, storageMode);
          coverImageUrl = uploadResult.url;
          if (uploadResult.warnung) {
            // Fallback-Logik im Backend (storage-architektur-standard.md):
            // Drittanbieter-Upload ist fehlgeschlagen, Bild liegt stattdessen
            // in der Cloud - Nutzer soll das sichtbar erfahren, nicht unbemerkt
            // woanders landen als gewaehlt.
            Alert.alert(t('erfassen.hinweis'), uploadResult.warnung);
          }
        } catch (uploadErr) {
          // Bild-Upload-Fehler soll das Speichern des Rezepts selbst nicht
          // verhindern - Rezept wird dann eben ohne Titelbild angelegt
          Alert.alert(
            t('erfassen.bildUploadFehlgeschlagen'),
            `Das Rezept wird ohne Titelbild gespeichert. Fehler: ${uploadErr instanceof ApiError ? uploadErr.detail : t('erfassen.unbekannt')}`,
          );
        }
      }

      const saved = await api.post<{ id: string; title: string }>('/recipes/', { title: title.trim(), servings: servings ? Number(servings) : null, ingredients, steps, cover_image_url: coverImageUrl, folder_id: selectedFolderId, tags, personal_note: notiz.trim() || null, source_type: 'photo_scan' });
      gespeichertRef.current = true;
      ungespeichertRef.current = false;
      askWhatNext(navigation, { id: saved.id, title: saved.title }, cookOnly);
    } catch (err) {
      Alert.alert(t('erfassen.speichernFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsSaving(false);
    }
  };

  // Der Zuschnitt liegt VOR allen Rueckgabezweigen. Vorher stand er im
  // Ergebniszweig - der wird erst gezeichnet, wenn ein Rezept ausgewertet
  // ist. Beim ersten Foto war er also gar nicht vorhanden, das Bild
  // verschwand still.
  const zuschnittFenster = (
    <ImageCropper
      uri={zuschnittUri}
      onAbbruch={() => setZuschnittUri(null)}
      onFertig={(uri) => {
        setImageUris((prev) => [...prev, uri]);
        setZuschnittUri(null);
      }}
    />
  );

  const zurueckDialog = (
    <Modal visible={zurueckFrage} transparent animationType="fade" onRequestClose={() => setZurueckFrage(false)}>
      <View style={styles.frageHintergrund}>
        <View style={[styles.frageKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <View style={styles.frageKopf}>
            <BrutzelAvatar size={48} />
            <Text style={[styles.frageText, { color: colors.text }]}>
              {result ? t('erfassen.brutzelZurueckRezept') : t('erfassen.brutzelZurueckFotos', { anzahl: imageUris.length })}
            </Text>
          </View>
          {result && (
            <Pressable
              onPress={() => { setZurueckFrage(false); handleSave(false); }}
              disabled={isSaving || isGeneratingImage}
              style={[styles.saveButton, { backgroundColor: gradient[0], borderRadius: radius.md, marginTop: 14 }]}
            >
              <Text style={styles.primaryButtonText}>{t('erfassen.rezeptSpeichern')}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => { setZurueckFrage(false); ungespeichertRef.current = false; navigation.goBack(); }}
            style={[styles.secondaryButton, { borderColor: '#c0392b', borderRadius: radius.md, marginTop: 10 }]}
          >
            <Text style={{ color: '#c0392b', fontWeight: '700' }}>{t('erfassen.verwerfen')}</Text>
          </Pressable>
          <Pressable onPress={() => setZurueckFrage(false)} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 6 }}>
            <Text style={{ color: colors.text, opacity: 0.75 }}>{t('erfassen.weiterBearbeiten')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  if (isScanning) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        {zuschnittFenster}{zurueckDialog}
        <Image source={{ uri: imageUri }} style={styles.scanningPreview} />
        <ActivityIndicator color={colors.text} style={{ marginTop: 20 }} />
        <Text style={{ color: colors.muted, fontSize: 12, marginTop: 10 }}>{t('erfassen.wirdErfasst')}</Text>
      </View>
    );
  }

  if (scanError) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, padding: 24 }]}>
        {zuschnittFenster}{zurueckDialog}
        <Text style={{ color: '#DC2626', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{scanError}</Text>
        <Pressable
          onPress={() => setScanError(null)}
          style={[styles.primaryButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}
        >
          {/* Die Fotos bleiben erhalten - nach einem Netzwerkfehler noch
            einmal alles abfotografieren waere aergerlich. */}
        <Text style={styles.primaryButtonText}>{t('erfassen.zurueckZuFotos')}</Text>
        </Pressable>
      </View>
    );
  }


  // Solange nicht ausgewertet wurde: Fotos sammeln. Erst der Knopf startet
  // die Erfassung - frueher lief sie sofort nach dem ersten Foto los, ein
  // zweites Bild war damit gar nicht vorgesehen.
  if (!result) {
    return (
      <ScrollView
        style={{ backgroundColor: colors.bg }}
        contentContainerStyle={{ padding: 24, alignItems: 'center' }}
      >
        {zuschnittFenster}{zurueckDialog}
        <Text style={[styles.introText, { color: colors.text }]}>
          Fotografiere eine Kochbuchseite, einen handschriftlichen Zettel oder ein Zutaten-Etikett.
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginBottom: 18 }}>
          Geht das Rezept über zwei Seiten oder stehen Zutaten und Zubereitung getrennt?
          Nimm mehrere Fotos auf – sie werden zu einem Rezept zusammengefügt.
        </Text>

        {imageUris.length > 0 && (
          <View style={styles.thumbRow}>
            {imageUris.map((uri, i) => (
              <View key={uri + i} style={styles.thumbWrap}>
                <Image source={{ uri }} style={[styles.thumb, { borderRadius: radius.sm }]} />
                <Pressable
                  onPress={() => setImageUris((prev) => prev.filter((_, idx) => idx !== i))}
                  hitSlop={8}
                  style={styles.thumbRemove}
                >
                  <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>×</Text>
                </Pressable>
                <Text style={{ color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 3 }}>
                  {i + 1}
                </Text>
              </View>
            ))}
          </View>
        )}

        <Pressable onPress={handleTakePhoto} style={[styles.primaryButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={styles.primaryButtonText}>
            {imageUris.length === 0 ? '📷 Foto aufnehmen' : '📷 Weiteres Foto'}
          </Text>
        </Pressable>
        <Pressable onPress={handlePickFromLibrary} style={[styles.secondaryButton, { borderColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={[styles.secondaryButtonText, { color: gradient[0] }]}>{t('erfassen.ausGalerie')}</Text>
        </Pressable>

        {imageUris.length > 0 && (
          <Pressable
            onPress={() => runScan(imageUris)}
            style={[styles.primaryButton, { backgroundColor: gradient[0], borderRadius: radius.md, marginTop: 18 }]}
          >
            <Text style={styles.primaryButtonText}>
              {imageUris.length === 1 ? t('erfassen.rezeptErfassen') : `Aus ${imageUris.length} Fotos erfassen`}
            </Text>
          </Pressable>
        )}
      </ScrollView>
    );
  }

  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentContainerStyle={[styles.container, inhaltsBreite]}>
      {zuschnittFenster}{zurueckDialog}
      <Image source={{ uri: imageUri }} style={[styles.reviewThumbnail, { borderRadius: radius.md }]} />

      {result?.low_confidence_note && (
        <View style={[styles.warningCard, { borderRadius: radius.md }]}>
          <Text style={styles.warningText}>⚠️ {result.low_confidence_note}</Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.rezeptname')}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
        value={title}
        onChangeText={setTitle}
      />

      {/* Bei einem abfotografierten Rezept ist das Titelbild die Seite aus
          dem Buch. Als Vorlage richtig, in der Rezeptliste unbrauchbar -
          deshalb hier das Angebot, stattdessen ein Bild erzeugen zu lassen. */}
      <View style={[styles.imageOfferCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        {aiGeneratedImageUrl ? (
          <Image source={{ uri: aiGeneratedImageUrl }} style={[styles.offerPreview, { borderRadius: radius.sm }]} />
        ) : null}
        <Text style={[styles.offerTitle, { color: colors.text }]}>
          {aiGeneratedImageUrl ? t('erfassen.bildErzeugen') : t('erfassen.bildFrage')}
        </Text>
        {!aiGeneratedImageUrl && (
          <Text style={[styles.offerText, { color: colors.muted }]}>{t('erfassen.bildHinweis')}</Text>
        )}
        <View style={styles.offerRow}>
          <Pressable
            onPress={erzeugeBild}
            disabled={isGeneratingImage}
            style={[styles.offerButton, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
          >
            {isGeneratingImage ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.offerButtonText}>{t('erfassen.bildErzeugen')}</Text>
            )}
          </Pressable>
          {aiGeneratedImageUrl && (
            <Pressable onPress={() => setAiGeneratedImageUrl(null)} style={styles.offerSecondary}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>{t('erfassen.bildBehalten')}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.portionen')}</Text>
      <TextInput
        style={[styles.input, {
          width: 90, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md,
          borderWidth: portionenUnklar && !servings.trim() ? 1.5 : 0,
          borderColor: '#B45309',
        }]}
        keyboardType="numeric"
        value={servings}
        onChangeText={(v) => { setServings(v); }}
      />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 }}>
        {t('erfassen.portionenNullHinweis')}
      </Text>
      {portionenUnklar && !servings.trim() && (
        <View style={{ marginTop: 6 }}>
          <Text style={{ color: '#B45309', fontSize: 12.5, fontWeight: '600' }}>
            {t('erfassen.portionenUnklar')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 2 }}>
            {t('erfassen.portionenBitteEintragen')}
          </Text>
        </View>
      )}

      {folders.length > 0 && (
        <>
          <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.ordnerOptional')}</Text>
          <View style={styles.folderChipsRow}>
            {folders.map((folder) => {
              const isSelected = selectedFolderId === folder.id;
              return (
                <Pressable
                  key={folder.id}
                  onPress={() => setSelectedFolderId(isSelected ? null : folder.id)}
                  style={[styles.folderChip, { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm }]}
                >
                  <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>{folder.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.notiz')}</Text>
      <TextInput
        style={[styles.input, {
          backgroundColor: colors.card, color: colors.text, borderRadius: radius.md,
          height: 88, paddingTop: 12, textAlignVertical: 'top',
        }]}
        multiline
        placeholder={t('erfassen.notizPlatzhalter')}
        placeholderTextColor={colors.muted}
        value={notiz}
        onChangeText={setNotiz}
      />
      {!!result?.notes && (
        <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 4 }}>
          {t('erfassen.notizAusVorlage')}
        </Text>
      )}

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.kategorien')}</Text>
      <CategoryPicker selected={tags} onChange={setTags} />

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('erfassen.zutatenPruefen')}</Text>
      {ingredientLines.map((line, i) => (
        <TextInput
          key={i}
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginBottom: 7 }]}
          value={line}
          onChangeText={(v) => setIngredientLines((prev) => prev.map((l, idx) => (idx === i ? v : l)))}
        />
      ))}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('erfassen.zubereitungPruefen')}</Text>
      {stepLines.map((line, i) => (
        <TextInput
          key={i}
          style={[styles.input, styles.stepInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginBottom: 7 }]}
          value={line}
          multiline
          onChangeText={(v) => setStepLines((prev) => prev.map((l, idx) => (idx === i ? v : l)))}
        />
      ))}

      {/* Waehrend ein Bild erzeugt wird, darf nicht gespeichert werden -
          sonst wird das alte Bild uebernommen und die Arbeit war umsonst. */}
      {isGeneratingImage && (
        <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center', marginTop: 12 }}>
          {t('erfassen.bildLaeuftNoch')}
        </Text>
      )}
      <Pressable onPress={() => handleSave(false)} disabled={isSaving || isGeneratingImage} style={[styles.saveButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: isGeneratingImage ? 0.5 : 1 }]}>
        {isSaving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveButtonText}>{t('erfassen.rezeptSpeichern')}</Text>}
      </Pressable>

      {/* Zweiter Weg: Manches kocht man einmal und will es nicht im
          Kochbuch stehen haben. Das Rezept wird trotzdem kurz angelegt -
          Timer, Schritt-Tipps und Hauben-Stufen haengen alle an einer
          Rezept-ID - und nach dem Kochen wieder entfernt. */}
      <Pressable onPress={() => handleSave(true)} disabled={isSaving || isGeneratingImage} style={{ marginTop: 12, paddingVertical: 8, opacity: isGeneratingImage ? 0.5 : 1 }}>
        <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center' }}>
          Nur <Text style={{ color: gradient[0], fontWeight: '600' }}>jetzt kochen</Text>, nicht im Kochbuch behalten
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  imageOfferCard: { padding: 14, marginTop: 16 },
  offerPreview: { width: '100%', height: 150, marginBottom: 10 },
  offerTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  offerText: { fontSize: 12.5, lineHeight: 18, marginBottom: 10 },
  offerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  offerButton: { minHeight: 44, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  offerButtonText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  offerSecondary: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  container: { padding: 18, paddingBottom: 60 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumbRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 18 },
  thumbWrap: { width: 78 },
  thumb: { width: 78, height: 78 },
  thumbRemove: {
    position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11,
    backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center',
  },
  introText: { fontSize: 14, textAlign: 'center', lineHeight: 21, marginBottom: 28 },
  primaryButton: { height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, marginBottom: 12, width: '100%' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  secondaryButton: { height: 46, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', width: '100%' },
  secondaryButtonText: { fontWeight: '700', fontSize: 13.5 },
  scanningPreview: { width: 200, height: 150, borderRadius: 12, opacity: 0.6 },
  reviewThumbnail: { width: '100%', height: 160, marginBottom: 14 },
  warningCard: { backgroundColor: '#FEF3C7', padding: 12, marginBottom: 16 },
  warningText: { fontSize: 12, color: '#92400E', lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6 },
  folderChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  folderChip: { paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, fontSize: 13.5 },
  stepInput: { minHeight: 50 },
  frageHintergrund: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  frageKarte: { padding: 18 },
  frageKopf: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  frageText: { flex: 1, fontSize: 15, lineHeight: 21 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  saveButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
});
