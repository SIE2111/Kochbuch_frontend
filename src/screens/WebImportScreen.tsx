import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaLibraryAccess } from '../utils/mediaPermissions';
import CategoryPicker from '../components/CategoryPicker';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { askWhatNext } from '../utils/afterRecipeSaved';
import { getEffectiveTimerSeconds } from '../components/SingleRecipeCookView';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'WebImport'>;

interface IngredientDraft {
  name: string;
  amount: string;
  unit: string;
}

interface StepDraft {
  text: string;
}

interface ImportedRecipe {
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  ingredients: { name: string; amount: number | null; unit: string | null }[];
  steps: { order: number; text: string }[];
  tags: string[] | null;
  origin_url: string;
  cover_image_url: string | null;
  cover_image_warning: string | null;
  folder_suggestion: string | null;
}

export default function WebImportScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [url, setUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [originUrl, setOriginUrl] = useState<string | null>(null);

  // Vom WebBrowseScreen uebernommener Link - kommt als Navigations-Param
  // zurueck, wenn der Nutzer dort "Diesen Link uebernehmen" tippt.
  useEffect(() => {
    if (route.params?.pickedUrl) {
      setUrl(route.params.pickedUrl);
    }
  }, [route.params?.pickedUrl]);

  // Nach dem Import editierbar, genau wie bei "Selbst erstellen" - das
  // Backend legt bewusst noch KEIN Rezept an, das passiert erst hier beim
  // "Speichern" (siehe routers/web_import.py).
  const [title, setTitle] = useState('');
  const [servings, setServings] = useState('');
  const [portionenUnklar, setPortionenUnklar] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [aiGeneratedImageUrl, setAiGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>('/folders/').then(setFolders).catch(() => {
      // Ordner sind hier nur "nice to have" - schlaegt das Laden fehl,
      // bleibt die Auswahl einfach leer, das Speichern funktioniert trotzdem
    });
  }, []);

  const handlePickFromGallery = async () => {
    if (!(await ensureMediaLibraryAccess())) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
      aspect: [4, 3],
    });
    if (!result.canceled && result.assets[0]) {
      setAiGeneratedImageUrl(null);
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
      setAiGeneratedImageUrl(null);
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
        folder_name: folders.find((f) => f.id === selectedFolderId)?.name,
      });
      setLocalImageUri(null);
      setAiGeneratedImageUrl(result.url);
      if (result.storage_warning) Alert.alert(t('erfassen.hinweis'), result.storage_warning);
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

  const handleImport = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      Alert.alert(t('erfassen.linkFehlt'), t('erfassen.bitteLink'));
      return;
    }
    setIsImporting(true);
    try {
      const result = await api.post<ImportedRecipe>('/web-import/import-recipe', { url: trimmedUrl });
      setTitle(result.title);
      // Portionen wurden bisher vollstaendig verworfen - das Rezept kam
      // ohne sie in die Sammlung, und das Umrechnen der Mengen ging
      // damit gar nicht.
      // 0 = Rezept ohne Portionen (z. B. Torte, Auflaufform).
      if (result.servings != null && result.servings >= 0) {
        setServings(String(result.servings));
        setPortionenUnklar(false);
      } else {
        setServings('');
        setPortionenUnklar(true);
      }
      setSelectedTags(result.tags ?? []);
      setIngredients(
        result.ingredients.map((ing) => ({
          name: ing.name,
          amount: ing.amount != null ? String(ing.amount) : '',
          unit: ing.unit ?? '',
        })),
      );
      setSteps(result.steps.sort((a, b) => a.order - b.order).map((s) => ({ text: s.text })));
      setOriginUrl(result.origin_url);
      if (result.folder_suggestion) {
        const matchingFolder = folders.find((f) => f.name === result.folder_suggestion);
        if (matchingFolder) setSelectedFolderId(matchingFolder.id);
      }
      if (result.cover_image_url) {
        setAiGeneratedImageUrl(result.cover_image_url);
      }
      if (result.cover_image_warning) {
        Alert.alert(t('erfassen.hinweis'), result.cover_image_warning);
      }
    } catch (err) {
      // Backend liefert bereits gut lesbare Fehlertexte (z.B. "Auf dieser
      // Seite wurde kein Rezept erkannt.", Timeout, fehlender API-Key) -
      // die werden hier 1:1 durchgereicht, kein eigener generischer Text.
      Alert.alert(t('erfassen.importFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsImporting(false);
    }
  };

  const updateIngredient = (index: number, field: keyof IngredientDraft, value: string) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing)));
  };

  const updateStep = (index: number, value: string) => {
    setSteps((prev) => prev.map((step, i) => (i === index ? { text: value } : step)));
  };

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
    const cleanIngredients = ingredients
      .filter((ing) => ing.name.trim())
      .map((ing) => ({
        name: ing.name.trim(),
        amount: ing.amount ? Number(ing.amount) : null,
        unit: ing.unit.trim() || null,
      }));
    const cleanSteps = steps
      .filter((s) => s.text.trim())
      .map((s, i) => ({ order: i + 1, text: s.text.trim() }));

    if (cleanSteps.length === 0) {
      Alert.alert(t('erfassen.zubereitungFehlt'), t('erfassen.bitteEinSchritt'));
      return;
    }

    setIsSaving(true);
    try {
      let coverImageUrl: string | null = aiGeneratedImageUrl;
      if (localImageUri) {
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
          Alert.alert(
            t('erfassen.bildUploadFehlgeschlagen'),
            `Das Rezept wird ohne Titelbild gespeichert. Fehler: ${uploadErr instanceof ApiError ? uploadErr.detail : t('erfassen.unbekannt')}`,
          );
        }
      }

      const tags = selectedTags;

      const saved = await api.post<{ id: string; title: string }>('/recipes/', {
        title: title.trim(),
        ingredients: cleanIngredients,
        steps: cleanSteps,
        cover_image_url: coverImageUrl,
        servings: servings ? Number(servings) : null,
        source_type: 'web_import',
        tags: tags.length > 0 ? tags : undefined,
        folder_id: selectedFolderId,
      });
      askWhatNext(navigation, { id: saved.id, title: saved.title }, cookOnly, {
        zutaten: cleanIngredients.length,
        schritte: cleanSteps.length,
        timer: cleanSteps.filter((s) => getEffectiveTimerSeconds(s) !== null).length,
      });
    } catch (err) {
      Alert.alert(t('erfassen.speichernFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsSaving(false);
    }
  };

  // Schritt 1: nur der Link, solange noch nichts importiert wurde
  if (!originUrl) {
    return (
      <View style={[styles.introContainer, { backgroundColor: colors.bg }]}>
        <Text style={[styles.introTitle, { color: colors.text }]}>{t('erfassen.webTitel')}</Text>
        <Text style={[styles.introText, { color: colors.muted }]}>
          Link zu einem Rezept auf einer beliebigen Webseite einfügen. Die Zubereitung wird dabei{' '}
          <Text style={{ fontWeight: '700' }}>komplett neu in eigenen Worten formuliert</Text> (Urheberrecht) - nicht
          einfach kopiert.
        </Text>
        <View style={styles.urlRow}>
          <TextInput
            style={[styles.urlInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, flex: 1 }]}
            placeholder="https://…"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            value={url}
            onChangeText={setUrl}
          />
          <Pressable
            onPress={() => navigation.navigate('RezeptSuche', { initialQuery: url && !/^https?:/i.test(url) ? url : undefined })}
            style={[styles.searchButton, { backgroundColor: colors.card, borderRadius: radius.md }]}
          >
            <Text style={{ fontSize: 18 }}>🔍</Text>
          </Pressable>
        </View>
        <Text style={[styles.orHint, { color: colors.muted }]}>
          Kein Link zur Hand? Über die Lupe direkt in der App danach suchen.
        </Text>

        <Pressable
          onPress={handleImport}
          disabled={isImporting}
          style={[styles.importButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: isImporting ? 0.7 : 1 }]}
        >
          {isImporting ? <ActivityIndicator color="#fff" /> : <Text style={styles.importButtonText}>{t('erfassen.webImportieren')}</Text>}
        </Pressable>
      </View>
    );
  }

  // Schritt 2: importiertes Ergebnis bearbeiten und speichern
  return (
    <ScrollView
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentContainerStyle={[styles.container, inhaltsBreite]}>
      <Text style={[styles.sourceHint, { color: colors.muted }]} numberOfLines={1}>
        Quelle: {originUrl}
      </Text>

      <Pressable onPress={handleAddImagePress} disabled={isGeneratingImage} style={[styles.imagePicker, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        {isGeneratingImage ? (
          <>
            <ActivityIndicator color={colors.muted} />
            <Text style={[styles.imagePickerText, { color: colors.muted, marginTop: 8 }]}>{t('erfassen.brutzelMalt')}</Text>
          </>
        ) : localImageUri || aiGeneratedImageUrl ? (
          <Image source={{ uri: localImageUri ?? aiGeneratedImageUrl! }} style={[styles.imagePreview, { borderRadius: radius.md }]} />
        ) : (
          <Text style={[styles.imagePickerText, { color: colors.muted }]}>📷 Titelbild hinzufügen (optional)</Text>
        )}
      </Pressable>

      <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.rezeptname')}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
        value={title}
        onChangeText={setTitle}
      />

      <Text style={[styles.label, { color: colors.muted, marginTop: 16 }]}>{t('erfassen.portionen')}</Text>
      <TextInput
        style={[styles.input, {
          width: 90, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md,
          borderWidth: portionenUnklar && !servings.trim() ? 1.5 : 0, borderColor: '#B45309',
        }]}
        keyboardType="numeric"
        value={servings}
        onChangeText={setServings}
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
        <View key={i} style={styles.ingredientRow}>
          <TextInput
            style={[styles.input, styles.ingredientName, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            placeholder={t('erfassen.zutatPlatzhalter')}
            placeholderTextColor={colors.muted}
            value={ing.name}
            onChangeText={(v) => updateIngredient(i, 'name', v)}
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
            multiline
            value={step.text}
            onChangeText={(v) => updateStep(i, v)}
          />
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
  introContainer: { flex: 1, padding: 22, justifyContent: 'center' },
  introTitle: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  introText: { fontSize: 13, lineHeight: 19, marginBottom: 22 },
  urlRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  urlInput: { height: 46, paddingHorizontal: 14, fontSize: 13.5 },
  searchButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center' },
  orHint: { fontSize: 10.5, marginBottom: 14, fontStyle: 'italic' },
  importButton: { height: 48, alignItems: 'center', justifyContent: 'center' },
  importButtonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
  container: { padding: 18, paddingBottom: 60 },
  sourceHint: { fontSize: 10.5, marginBottom: 14 },
  imagePicker: { height: 130, alignItems: 'center', justifyContent: 'center', marginBottom: 16, overflow: 'hidden' },
  imagePickerText: { fontSize: 12.5, fontWeight: '500' },
  imagePreview: { width: '100%', height: '100%' },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6 },
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
