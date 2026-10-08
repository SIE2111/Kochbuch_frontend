import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Alert, ActivityIndicator, Image } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ensureMediaLibraryAccess } from '../utils/mediaPermissions';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { askWhatNext } from '../utils/afterRecipeSaved';
import { getEffectiveTimerSeconds } from '../components/SingleRecipeCookView';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'AIGenerate'>;

interface IngredientDraft {
  name: string;
  amount: string;
  unit: string;
}

interface StepDraft {
  text: string;
}

interface GeneratedIngredient {
  name: string;
  amount: number | null;
  unit: string | null;
}

interface SideSuggestion {
  category: string;
  idea: string;
  pantry_based_on: string[];
}

interface GeneratedRecipe {
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  ingredients_main: GeneratedIngredient[];
  ingredients_pantry: GeneratedIngredient[];
  steps: { order: number; text: string }[];
  tags: string[] | null;
  side_suggestions: SideSuggestion[] | null;
  follow_up_question: string | null;
  allergen_warning: string | null;
  cover_image_url: string | null;
  folder_suggestion: string | null;
}

export default function AIGenerateScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();

  // Vorgaben-Formular
  const [ingredientsText, setIngredientsText] = useState('');
  const [diet, setDiet] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [servings, setServings] = useState('');
  // Vorausgefüllt beim Sprung aus Mein Weinkeller ("Im Kochbuch öffnen")
  const [freeText, setFreeText] = useState(route?.params?.wunsch ?? '');
  // useState übernimmt den Startwert nur beim ersten Öffnen. War der Bildschirm
  // schon offen (im Hintergrund), kommt der neue Vorschlag aus dem Weinkeller
  // nur als geänderter Parameter an - dann hier nachziehen.
  const wunschParam = route?.params?.wunsch;
  useEffect(() => { if (wunschParam) setFreeText(wunschParam); }, [wunschParam]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Ergebnis, editierbar vor dem Speichern (gleiches Muster wie beim
  // Web-Import - die KI legt noch KEIN Rezept an, erst "Speichern" tut das)
  const [result, setResult] = useState<GeneratedRecipe | null>(null);
  const [title, setTitle] = useState('');
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([]);
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [localImageUri, setLocalImageUri] = useState<string | null>(null);
  const [aiGeneratedImageUrl, setAiGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Portionen aus den Voreinstellungen (Profil) vorbelegen
  useEffect(() => {
    api.get<{ default_servings: number }>('/preferences/')
      .then((prefs) => { if (prefs?.default_servings) setServings((aktuell) => aktuell || String(prefs.default_servings)); })
      .catch(() => {});
  }, []);

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

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const available_ingredients = ingredientsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const generated = await api.post<GeneratedRecipe>('/ai/generate-recipe', {
        available_ingredients: available_ingredients.length > 0 ? available_ingredients : undefined,
        diet: diet.trim() || undefined,
        max_minutes: maxMinutes ? Number(maxMinutes) : undefined,
        servings: servings ? Number(servings) : undefined,
        free_text: freeText.trim() || undefined,
      });

      setResult(generated);
      setTitle(generated.title);
      // Vorrats- und Hauptzutaten zusammen in eine editierbare Liste -
      // das Rezept-Schema selbst kennt diese Unterscheidung nicht, die
      // ist nur ein Hilfsmittel der KI-Antwort.
      const combined = [...(generated.ingredients_main ?? []), ...(generated.ingredients_pantry ?? [])];
      setIngredients(
        combined.map((ing) => ({
          name: ing.name,
          amount: ing.amount != null ? String(ing.amount) : '',
          unit: ing.unit ?? '',
        })),
      );
      setSteps((generated.steps ?? []).sort((a, b) => a.order - b.order).map((s) => ({ text: s.text })));
      // Das Backend generiert jetzt automatisch ein passendes Titelbild
      // mit (siehe POST /ai/generate-recipe) - direkt uebernehmen, kein
      // manuelles Antippen mehr noetig, wenn schon eines mitkam.
      if (generated.cover_image_url) {
        setAiGeneratedImageUrl(generated.cover_image_url);
      }
      if (generated.folder_suggestion) {
        const matchingFolder = folders.find((f) => f.name === generated.folder_suggestion);
        if (matchingFolder) setSelectedFolderId(matchingFolder.id);
      }
    } catch (err) {
      Alert.alert(t('erfassen.generierenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsGenerating(false);
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

      const saved = await api.post<{ id: string; title: string }>('/recipes/', {
        title: title.trim(),
        ingredients: cleanIngredients,
        steps: cleanSteps,
        tags: result?.tags ?? undefined,
        cover_image_url: coverImageUrl,
        source_type: 'ai_generated',
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

  // Schritt 1: Vorgaben-Formular, solange noch nichts generiert wurde
  if (!result) {
    return (
      <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.introContainer, inhaltsBreite]}>
        <Text style={[styles.introTitle, { color: colors.text }]}>KI-Rezept nach Vorgaben</Text>
        <Text style={[styles.introText, { color: colors.muted }]}>
          Alle Felder sind optional – je mehr du ausfüllst, desto passender wird der Vorschlag.
        </Text>

        <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.kiZutaten')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('erfassen.kiZutatenPlatzhalter')}
          placeholderTextColor={colors.muted}
          value={ingredientsText}
          onChangeText={setIngredientsText}
        />

        <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.kiDiaet')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('erfassen.kiDiaetPlatzhalter')}
          placeholderTextColor={colors.muted}
          value={diet}
          onChangeText={setDiet}
        />

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.kiMinuten')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('erfassen.kiMinutenPlatzhalter')}
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              value={maxMinutes}
              onChangeText={setMaxMinutes}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.portionen')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('erfassen.portionenPlatzhalter')}
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              value={servings}
              onChangeText={setServings}
            />
          </View>
        </View>

        <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.kiWuensche')}</Text>
        <TextInput
          style={[styles.input, styles.multilineInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('erfassen.kiWuenschePlatzhalter')}
          placeholderTextColor={colors.muted}
          multiline
          value={freeText}
          onChangeText={setFreeText}
        />

        <Pressable
          onPress={() => handleGenerate()}
          disabled={isGenerating}
          style={[styles.generateButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: isGenerating ? 0.7 : 1 }]}
        >
          {isGenerating ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateButtonText}>{t('erfassen.kiGenerieren')}</Text>}
        </Pressable>
      </ScrollView>
    );
  }

  // Schritt 2: generiertes Ergebnis bearbeiten und speichern
  return (
    // automaticallyAdjustKeyboardInsets statt KeyboardAvoidingView: siehe
    // ManualRecipeScreen fuer den Grund - bei einer langen Liste scrollt
    // KeyboardAvoidingView nicht zum fokussierten Feld, dieser Weg schon.
    <ScrollView
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={[styles.container, inhaltsBreite]}>
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

      {result.allergen_warning && (
        <View style={[styles.warningBanner, { borderRadius: radius.sm }]}>
          <Text style={styles.warningText}>⚠️ {result.allergen_warning}</Text>
        </View>
      )}

      <Text style={[styles.label, { color: colors.muted }]}>{t('erfassen.rezeptname')}</Text>
      <TextInput
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
        value={title}
        onChangeText={setTitle}
      />

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

      {result.side_suggestions && result.side_suggestions.length > 0 && (
        <View style={[styles.sideSuggestionsBox, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.sideSuggestionsTitle, { color: colors.text }]}>💡 Beilagen-Ideen (nicht Teil des Rezepts)</Text>
          {result.side_suggestions.map((s, i) => (
            <Text key={i} style={[styles.sideSuggestionItem, { color: colors.muted }]}>
              • {s.category}: {s.idea}
            </Text>
          ))}
          {result.follow_up_question && (
            <Text style={[styles.followUpQuestion, { color: colors.muted }]}>{result.follow_up_question}</Text>
          )}
        </View>
      )}

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
  introContainer: { padding: 22, paddingBottom: 60 },
  introTitle: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  introText: { fontSize: 12.5, lineHeight: 18, marginBottom: 20 },
  row: { flexDirection: 'row', gap: 10 },
  generateButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  generateButtonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
  container: { padding: 18, paddingBottom: 60 },
  warningBanner: { backgroundColor: '#FEF3C7', padding: 12, marginBottom: 16 },
  imagePicker: { height: 130, alignItems: 'center', justifyContent: 'center', marginBottom: 16, overflow: 'hidden' },
  imagePickerText: { fontSize: 12.5, fontWeight: '500' },
  imagePreview: { width: '100%', height: '100%' },
  warningText: { color: '#92400E', fontSize: 12, lineHeight: 17 },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6, marginTop: 12 },
  folderChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  folderChip: { paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 44, paddingHorizontal: 12, fontSize: 13.5 },
  multilineInput: { height: 70, paddingTop: 12, textAlignVertical: 'top' },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 10 },
  ingredientRow: { flexDirection: 'row', gap: 6, marginBottom: 7 },
  ingredientName: { flex: 2 },
  ingredientAmount: { flex: 1 },
  ingredientUnit: { flex: 1 },
  addLink: { fontSize: 12, fontWeight: '600', marginTop: 2, marginBottom: 4 },
  stepRow: { flexDirection: 'row', gap: 8, marginBottom: 8, alignItems: 'flex-start' },
  stepNumber: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  stepInput: { flex: 1, minHeight: 44, paddingVertical: 12 },
  sideSuggestionsBox: { padding: 14, marginTop: 20 },
  sideSuggestionsTitle: { fontSize: 12.5, fontWeight: '700', marginBottom: 8 },
  sideSuggestionItem: { fontSize: 11.5, lineHeight: 17, marginBottom: 3 },
  followUpQuestion: { fontSize: 11.5, lineHeight: 17, marginTop: 6, fontStyle: 'italic' },
  saveButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  saveButtonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
});
