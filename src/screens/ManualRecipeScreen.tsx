import React, { useEffect, useRef, useState } from 'react';
import { mitStufenHinweis } from '../utils/stufenHinweis';
import { RecipeStep } from '../utils/stepLevels';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ensureMediaLibraryAccess } from '../utils/mediaPermissions';
import CategoryPicker from '../components/CategoryPicker';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

import { mengeAlsZahl } from '../utils/zutaten';
type Props = NativeStackScreenProps<MainStackParamList, 'ManualRecipe'>;

interface IngredientDraft {
  name: string;
  amount: string;
  unit: string;
}

interface StepDraft {
  text: string;
  // Was ausser dem Text am Schritt haengt. Wurde beim Bearbeiten frueher
  // nicht mitgefuehrt - jedes Speichern loeschte Timer, Technik-Video und
  // Notizen aller Schritte, auch wenn man nur den Ordner aenderte.
  timer_seconds?: number | null;
  technique_tag?: string | null;
  user_note?: string | null;
}

export default function ManualRecipeScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const editingRecipeId = route.params?.recipeId ?? null;
  const [isLoadingExisting, setIsLoadingExisting] = useState(!!editingRecipeId);
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([{ name: '', amount: '', unit: '' }]);
  const [steps, setSteps] = useState<StepDraft[]>([{ text: '' }]);
  // Das Rezept, wie es geladen wurde - fuer den Vergleich beim Speichern.
  const geladenRef = useRef<{
    steps: RecipeStep[];
    steps_anfaenger?: RecipeStep[] | null;
    steps_profi?: RecipeStep[] | null;
    steps_fortgeschritten?: RecipeStep[] | null;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  // Bereits gespeichertes Titelbild (Edit-Modus) - wird nur dann neu
  // hochgeladen, wenn der Nutzer ein NEUES Bild waehlt (localImageUri
  // gesetzt); bleibt sonst unveraendert bestehen.
  const [existingCoverUrl, setExistingCoverUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Zutaten-Autovervollstaendigung: greift auf die bereits vorhandene
  // Werteliste im Backend zu (/ingredients/, existierte schon lange, war
  // aber nirgends angebunden) - beim Tippen erscheinen passende Vorschlaege
  // inkl. Standard-Einheit, ein Tippen auf die Zutat legt bei Bedarf einen
  // neuen Eintrag in der Werteliste an (fuer kuenftige Vorschlaege).
  const [focusedIngredientIndex, setFocusedIngredientIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; default_unit: string | null }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ungespeicherte-Aenderungen-Erkennung, NUR im Bearbeiten-Modus relevant -
  // hasLoadedRef verhindert, dass das Befuellen der Felder beim ersten
  // Laden des bestehenden Rezepts selbst schon als "Aenderung" gilt.
  const hasLoadedRef = useRef(false);
  const justSavedRef = useRef(false);
  const isDirtyRef = useRef(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/folders/').then(setFolders).catch(() => {
      // Ordner sind hier nur "nice to have" - schlaegt das Laden fehl,
      // bleibt die Auswahl einfach leer, das Speichern selbst funktioniert
      // trotzdem (folder_id ist optional)
    });
  }, []);

  useEffect(() => {
    // Portionen-Vorlage nur beim NEU-Erstellen vorausfuellen - im Edit-
    // Modus laedt der andere useEffect (editingRecipeId) den echten,
    // bereits gespeicherten Wert, der soll nicht ueberschrieben werden.
    if (editingRecipeId) return;
    api.get<{ default_servings: number }>('/preferences/').then((prefs) => {
      setServings(String(prefs.default_servings));
    }).catch(() => {
      // Vorlage konnte nicht geladen werden - Feld bleibt einfach leer,
      // Nutzer kann es manuell eintragen
    });
  }, [editingRecipeId]);

  useEffect(() => {
    if (!editingRecipeId) return;
    api
      .get<{
        title: string;
        servings: number | null;
        folder_id: string | null;
        tags: string[] | null;
        ingredients: { name: string; amount: number | null; unit: string | null }[];
        steps: RecipeStep[];
        steps_anfaenger?: RecipeStep[] | null;
        steps_profi?: RecipeStep[] | null;
        steps_fortgeschritten?: RecipeStep[] | null;
        cover_image_url: string | null;
      }>(`/recipes/${editingRecipeId}`)
      .then((existing) => {
        geladenRef.current = existing;
        setTitle(existing.title);
        setServings(existing.servings != null ? String(existing.servings) : '');
        setSelectedFolderId(existing.folder_id);
        setSelectedTags(existing.tags ?? []);
        // ?? [] an beiden Stellen: Kommt ein Rezept ohne Zutaten oder
        // Schritte zurueck, waere .length auf undefined ein Absturz beim
        // blossen Oeffnen des Bearbeiten-Bildschirms - und der Nutzer
        // kaeme an sein Rezept gar nicht mehr heran.
        setIngredients(
          (existing.ingredients ?? []).length > 0
            ? (existing.ingredients ?? []).map((ing) => ({
                name: ing.name,
                amount: ing.amount != null ? String(ing.amount) : '',
                unit: ing.unit ?? '',
              }))
            : [{ name: '', amount: '', unit: '' }],
        );
        setSteps(
          (existing.steps ?? []).length > 0
            ? [...(existing.steps ?? [])].sort((a, b) => a.order - b.order).map((s) => ({
                text: s.text,
                timer_seconds: s.timer_seconds ?? null,
                technique_tag: s.technique_tag ?? null,
                user_note: s.user_note ?? null,
              }))
            : [{ text: '' }],
        );
        setExistingCoverUrl(existing.cover_image_url);
        // Leicht verzoegert setzen, damit der Watcher-Effekt unten (der auf
        // alle Formularfelder reagiert) das Befuellen selbst nicht schon als
        // Aenderung durch den Nutzer wertet.
        setTimeout(() => {
          hasLoadedRef.current = true;
        }, 0);
      })
      .catch((err) => {
        Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('erfassen.rezeptNichtGeladen'));
        navigation.goBack();
      })
      .finally(() => setIsLoadingExisting(false));
  }, [editingRecipeId]);

  // Beobachtet alle Formularfelder - sobald hasLoadedRef gesetzt ist (Laden
  // abgeschlossen), markiert jede weitere Aenderung das Formular als "dirty".
  // existingCoverUrl mit aufgenommen - fehlte vorher, dadurch wurde ein per
  // KI generiertes/neu aufgenommenes Bild (setzt existingCoverUrl direkt,
  // ohne ueber localImageUri zu gehen) faelschlich NICHT als Aenderung erkannt.
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    isDirtyRef.current = true;
  }, [title, servings, selectedTags, ingredients, steps, localImageUri, existingCoverUrl, selectedFolderId]);

  const handleBackPress = () => {
    if (isDirtyRef.current && !justSavedRef.current) {
      Alert.alert(
        'Änderungen verwerfen?',
        t('erfassen.ungespeicherteAenderungen'),
        [
          { text: t('erfassen.weiterBearbeiten'), style: 'cancel' },
          { text: t('erfassen.verwerfen'), style: 'destructive', onPress: () => navigation.goBack() },
        ],
      );
    } else {
      navigation.goBack();
    }
  };

  // Eigener Zurueck-Button im Header statt beforeRemove-Interception: die
  // beforeRemove+preventDefault()-Variante kam bei der iOS-Wisch-Geste und
  // dem Header-Zurueck-Pfeil zu spaet (Navigation lief schon, Meldung
  // erschien erst danach auf dem bereits gewechselten Screen) und loeste
  // dabei React-Navigation-interne Warnungen aus. Ein eigener Button, der
  // VOR jeder Navigation prueft, ist zuverlässiger. Wisch-Geste bewusst
  // deaktiviert (gestureEnabled: false), damit sie die Pruefung nicht mehr
  // umgehen kann.
  useEffect(() => {
    if (!editingRecipeId) return;
    navigation.setOptions({
      gestureEnabled: false,
      headerLeft: () => (
        <Pressable onPress={handleBackPress} hitSlop={10} style={{ paddingHorizontal: 4 }}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={gradient[0]} />
        </Pressable>
      ),
    });
  }, [navigation, editingRecipeId, gradient]);

  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  const handlePickFromGallery = async () => {
    if (!(await ensureMediaLibraryAccess())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setLocalImageUri(result.assets[0].uri);
    }
  };

  const handleTakePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('erfassen.zugriffVerweigert'), t('erfassen.ohneKamera'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: true, aspect: [4, 3] });
    if (!result.canceled && result.assets[0]) {
      setLocalImageUri(result.assets[0].uri);
    }
  };

  const handleGenerateAiImage = async () => {
    if (!title.trim()) {
      Alert.alert(t('erfassen.rezeptnameFehlt'), t('erfassen.bitteNameFuerBild'));
      return;
    }
    setIsGeneratingImage(true);
    try {
      const result = await api.post<{ url: string; storage_warning?: string | null }>('/ai/generate-recipe-image', {
        title: title.trim(),
        context: selectedTags.length > 0 ? selectedTags.join(', ') : undefined,
        folder_name: folders.find((f) => f.id === selectedFolderId)?.name,
      });
      // Wie ein bereits gespeichertes Bild behandeln (existingCoverUrl) -
      // beim Speichern wird es dann NICHT erneut hochgeladen, ist ja schon
      // im richtigen Speicherort gelandet.
      setLocalImageUri(null);
      setExistingCoverUrl(result.url);
      if (result.storage_warning) {
        Alert.alert(t('erfassen.hinweis'), result.storage_warning);
      }
    } catch (err) {
      Alert.alert(t('erfassen.bildgenerierungFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleAddImagePress = () => {
    Alert.alert(t('erfassen.titelbildHinzufuegen'), undefined, [
      { text: t('erfassen.ausGalerie'), onPress: handlePickFromGallery },
      { text: t('erfassen.fotoAufnehmen'), onPress: handleTakePhoto },
      { text: 'KI-Bild generieren', onPress: handleGenerateAiImage },
      { text: t('allgemein.abbrechen'), style: 'cancel' },
    ]);
  };

  const updateIngredient = (index: number, field: keyof IngredientDraft, value: string) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing)));
  };

  const handleIngredientNameChange = (index: number, value: string) => {
    updateIngredient(index, 'name', value);
    setFocusedIngredientIndex(index);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = value.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(() => {
      api
        .get<{ id: string; name: string; default_unit: string | null }[]>(`/ingredients/?q=${encodeURIComponent(trimmed)}`)
        .then(setSuggestions)
        .catch(() => setSuggestions([]));
    }, 300);
  };

  const handleSelectSuggestion = (index: number, suggestion: { name: string; default_unit: string | null }) => {
    setIngredients((prev) =>
      prev.map((ing, i) =>
        i === index ? { ...ing, name: suggestion.name, unit: ing.unit || suggestion.default_unit || '' } : ing,
      ),
    );
    setSuggestions([]);
    setFocusedIngredientIndex(null);
  };

  const updateStep = (index: number, value: string) => {
    setSteps((prev) => prev.map((step, i) => (i === index ? { ...step, text: value } : step)));
  };

  const handleSave = async (stufenBestaetigt = false) => {
    if (!title.trim()) {
      Alert.alert(t('erfassen.titelFehlt'), t('erfassen.bitteName'));
      return;
    }
    const cleanIngredients = ingredients
      .filter((ing) => ing.name.trim())
      .map((ing) => ({
        name: ing.name.trim(),
        amount: mengeAlsZahl(ing.amount),
        unit: ing.unit.trim() || null,
      }));
    const cleanSteps = steps
      .filter((s) => s.text.trim())
      .map((s, i) => ({
        order: i + 1,
        text: s.text.trim(),
        timer_seconds: s.timer_seconds ?? null,
        technique_tag: s.technique_tag ?? null,
        user_note: s.user_note ?? null,
      }));

    if (cleanSteps.length === 0) {
      Alert.alert(t('erfassen.zubereitungFehlt'), t('erfassen.bitteEinSchritt'));
      return;
    }

    // Aendern sich die Schritte und haengen Notizen an den Stufenfassungen,
    // erst nachfragen - das Backend verwirft die Fassungen beim Speichern.
    if (editingRecipeId && !stufenBestaetigt) {
      const geladen = geladenRef.current;
      mitStufenHinweis(geladen, geladen?.steps ?? [], cleanSteps, t, () => handleSave(true));
      return;
    }

    setIsSaving(true);
    try {
      // Titelbild: nur neu hochladen, wenn der Nutzer tatsaechlich ein neues
      // Bild ausgewaehlt hat. Im Edit-Modus ohne neue Auswahl bleibt das
      // bereits gespeicherte Bild einfach bestehen (existingCoverUrl).
      let coverImageUrl: string | null = existingCoverUrl;
      if (localImageUri) {
        setIsUploadingImage(true);
        const fileName = localImageUri.split('/').pop() ?? 'foto.jpg';
        const extension = fileName.split('.').pop()?.toLowerCase();
        const mimeType = extension === 'png' ? 'image/png' : 'image/jpeg';
        try {
          const uploadResult = await api.uploadImage('/images/upload', localImageUri, fileName, mimeType, {
            folder_name: folders.find((f) => f.id === selectedFolderId)?.name ?? '',
            recipe_title: title.trim(),
          });
          coverImageUrl = uploadResult.url;
          if (uploadResult.storage_warning) {
            // Fallback-Logik im Backend (storage-architektur-standard.md):
            // Drittanbieter-Upload ist fehlgeschlagen, Bild liegt stattdessen
            // in der Cloud - Nutzer soll das sichtbar erfahren, nicht unbemerkt
            // woanders landen als gewaehlt.
            Alert.alert(t('erfassen.hinweis'), uploadResult.storage_warning);
          }
        } catch (uploadErr) {
          // Bild-Upload-Fehler soll das Speichern des Rezepts selbst nicht
          // verhindern - vorheriges/kein Bild bleibt dann einfach bestehen
          Alert.alert(
            t('erfassen.bildUploadFehlgeschlagen'),
            `Das Rezept wird ohne das neue Bild gespeichert. Fehler: ${uploadErr instanceof ApiError ? uploadErr.detail : t('erfassen.unbekannt')}`,
          );
        } finally {
          setIsUploadingImage(false);
        }
      }

      const tags = selectedTags;

      const payload = {
        title: title.trim(),
        servings: servings ? Number(servings) : null,
        ingredients: cleanIngredients,
        steps: cleanSteps,
        cover_image_url: coverImageUrl,
        folder_id: selectedFolderId,
        tags: tags.length > 0 ? tags : null,
      };

      // Erreicht der gewaehlte Speicherort die Datei nicht, antwortet das
      // Backend mit 502 und nimmt die Anlage zurueck - der Fehler landet
      // damit im catch weiter unten. Ausgewichen wird nicht: Wer sein
      // Rezept auf dem eigenen NAS haben will, will es nicht ersatzweise
      // woanders, und erst recht nicht in dem Glauben, es sei gesichert.
      if (editingRecipeId) {
        await api.patch(`/recipes/${editingRecipeId}`, payload);
      } else {
        // source_type nur beim ERSTELLEN mitschicken - beim Bearbeiten
        // bleibt die urspruengliche Herkunft unangetastet.
        await api.post('/recipes/', { ...payload, source_type: 'manual' });
      }

      // Best-effort: alle verwendeten Zutatennamen in die Werteliste
      // eintragen, damit sie kuenftig als Vorschlag erscheinen (Backend
      // erkennt bereits vorhandene Namen selbst und legt keine Duplikate an -
      // siehe routers/ingredients.py). Fehler hier werden bewusst
      // verschluckt, das Rezept ist ja schon erfolgreich gespeichert.
      cleanIngredients.forEach((ing) => {
        api.post('/ingredients/', { name: ing.name, default_unit: ing.unit || null }).catch(() => {});
      });

      if (editingRecipeId) {
        justSavedRef.current = true;
        navigation.goBack();
      } else {
        navigation.navigate('MainTabs');
      }
    } catch (err) {
      Alert.alert(t('erfassen.speichernFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingExisting) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    // automaticallyAdjustKeyboardInsets statt KeyboardAvoidingView: Bei
    // einer langen Liste verschiebt KeyboardAvoidingView nur die ganze
    // Ansicht, scrollt aber NICHT zum fokussierten Feld - das Feld blieb
    // dadurch weiter unter der Tastatur, sobald die Liste laenger war als
    // der sichtbare Ausschnitt. Dieser Weg scrollt tatsaechlich zum Feld,
    // in das gerade getippt wird (iOS 0.71+, hier vorhanden).
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentContainerStyle={[styles.container, inhaltsBreite]}>
      <Pressable onPress={handleAddImagePress} disabled={isGeneratingImage} style={[styles.imagePicker, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        {isGeneratingImage ? (
          <>
            <ActivityIndicator color={colors.muted} />
            <Text style={[styles.imagePickerText, { color: colors.muted, marginTop: 8 }]}>{t('erfassen.brutzelMalt')}</Text>
          </>
        ) : localImageUri || existingCoverUrl ? (
          <Image source={{ uri: localImageUri ?? existingCoverUrl! }} style={[styles.imagePreview, { borderRadius: radius.md }]} />
        ) : (
          <Text style={[styles.imagePickerText, { color: colors.muted }]}>📷 Titelbild hinzufügen</Text>
        )}
      </Pressable>

      <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.rezeptname')}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
        placeholder={t('erfassen.namePlatzhalter')}
        placeholderTextColor={colors.muted}
        value={title}
        onChangeText={setTitle}
      />

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.portionen')}</Text>
      <TextInput
        style={[styles.input, styles.servingsInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
        placeholder={t('erfassen.portionenPlatzhalter')}
        placeholderTextColor={colors.muted}
        keyboardType="numeric"
        value={servings}
        onChangeText={setServings}
      />
      <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginTop: 6 }}>
        {t('erfassen.portionenNullHinweis')}
      </Text>

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.kategorien')}</Text>
      <CategoryPicker selected={selectedTags} onChange={setSelectedTags} />

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
                  style={[
                    styles.folderChip,
                    { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm },
                  ]}
                >
                  <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>
                    {folder.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('erfassen.zutaten')}</Text>
      {ingredients.map((ing, i) => (
        <View key={i}>
          <View style={styles.ingredientRow}>
            <TextInput
              style={[styles.input, styles.ingredientName, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('erfassen.zutatPlatzhalter')}
              placeholderTextColor={colors.muted}
              value={ing.name}
              onChangeText={(v) => handleIngredientNameChange(i, v)}
              onFocus={() => setFocusedIngredientIndex(i)}
            />
            <TextInput
              style={[styles.input, styles.ingredientAmount, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('erfassen.mengePlatzhalter')}
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              value={ing.amount}
              onChangeText={(v) => updateIngredient(i, 'amount', v)}
            />
            <TextInput
              style={[styles.input, styles.ingredientUnit, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('erfassen.einheitPlatzhalter')}
              placeholderTextColor={colors.muted}
              value={ing.unit}
              onChangeText={(v) => updateIngredient(i, 'unit', v)}
            />
            <Pressable
              onPress={() => setIngredients((prev) => prev.filter((_, idx) => idx !== i))}
              disabled={ingredients.length === 1}
              hitSlop={8}
              style={{ opacity: ingredients.length === 1 ? 0.3 : 1, marginLeft: 6 }}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={20} color="#DC2626" />
            </Pressable>
          </View>
          {focusedIngredientIndex === i && suggestions.length > 0 && (
            <View style={[styles.suggestionsBox, { backgroundColor: colors.card, borderRadius: radius.sm }]}>
              {suggestions.map((s) => (
                <Pressable key={s.id} onPress={() => handleSelectSuggestion(i, s)} style={styles.suggestionRow}>
                  <Text style={{ color: colors.text, fontSize: 12.5 }}>{s.name}</Text>
                  {s.default_unit && <Text style={{ color: colors.muted, fontSize: 11 }}>{s.default_unit}</Text>}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ))}
      <Pressable onPress={() => setIngredients((prev) => [...prev, { name: '', amount: '', unit: '' }])}>
        <Text style={[styles.addLink, { color: gradient[0] }]}>+ Zutat hinzufügen</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('erfassen.zubereitung')}</Text>
      {steps.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <Text style={[styles.stepNumber, { color: colors.muted }]}>{i + 1}.</Text>
          <TextInput
            style={[styles.input, styles.stepInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            placeholder={t('erfassen.schrittPlatzhalter')}
            placeholderTextColor={colors.muted}
            multiline
            value={step.text}
            onChangeText={(v) => updateStep(i, v)}
          />
          <Pressable
            onPress={() => setSteps((prev) => prev.filter((_, idx) => idx !== i))}
            disabled={steps.length === 1}
            hitSlop={8}
            style={{ opacity: steps.length === 1 ? 0.3 : 1, marginLeft: 6, alignSelf: 'flex-start', marginTop: 12 }}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={20} color="#DC2626" />
          </Pressable>
        </View>
      ))}
      <Pressable onPress={() => setSteps((prev) => [...prev, { text: '' }])}>
        <Text style={[styles.addLink, { color: gradient[0] }]}>+ Schritt hinzufügen</Text>
      </Pressable>

      {/* Waehrend ein Bild erzeugt wird, darf nicht gespeichert werden -
          sonst wird das alte Bild uebernommen und die Arbeit war umsonst. */}
      {isGeneratingImage && (
        <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center', marginTop: 12 }}>
          {t('erfassen.bildLaeuftNoch')}
        </Text>
      )}
      <Pressable onPress={() => handleSave()} disabled={isSaving || isGeneratingImage} style={[styles.saveButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: isGeneratingImage ? 0.5 : 1 }]}>
        {isSaving ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator color="#fff" />
            {isUploadingImage && <Text style={styles.saveButtonText}>{t('erfassen.bildWirdHochgeladen')}</Text>}
          </View>
        ) : (
          <Text style={styles.saveButtonText}>{editingRecipeId ? 'Änderungen speichern' : t('erfassen.rezeptSpeichern')}</Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 60 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imagePicker: { height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: 18, overflow: 'hidden' },
  imagePickerText: { fontSize: 13, fontWeight: '500' },
  imagePreview: { width: '100%', height: '100%' },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6 },
  servingsInput: { width: 90 },
  suggestionsBox: { marginTop: -3, marginBottom: 9, paddingVertical: 4 },
  suggestionRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 9 },
  folderChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  folderChip: { paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 44, paddingHorizontal: 12, fontSize: 13.5 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  ingredientRow: { flexDirection: 'row', gap: 6, marginBottom: 7 },
  ingredientName: { flex: 2 },
  ingredientAmount: { flex: 1 },
  ingredientUnit: { flex: 1 },
  addLink: { fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  stepRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  stepNumber: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  stepInput: { flex: 1, minHeight: 44, paddingVertical: 12 },
  saveButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
});
