import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable, Image, Alert, Modal, TextInput, Keyboard, Share } from 'react-native';
import * as Sharing from 'expo-sharing';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import WeinEmpfehlungCard from '../components/WeinEmpfehlungCard';
import { kochplanMerken } from '../utils/kochplan';
import NutritionCard from '../components/NutritionCard';
import TranslationBanner from '../components/TranslationBanner';
import PublishToPoolButton from '../components/PublishToPoolButton';
import ShareRecipeButton from '../components/ShareRecipeButton';
import { api, ApiError } from '../api/client';
import { mitStufenHinweis } from '../utils/stufenHinweis';
import BrutzelAvatar from '../components/BrutzelAvatar';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout, MAX_INHALTSBREITE } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'RecipeDetail'> & {
  // Nur gesetzt, wenn der Bildschirm NICHT als eigener Stack-Screen laeuft,
  // sondern rechts neben einer Liste eingebettet ist (iPad quer). Ersetzt
  // dann den nativen "Zurueck"-Header (den es eingebettet gar nicht gibt)
  // durch eine eigene Kopfzeile mit "Schliessen".
  onClose?: () => void;
};

interface Ingredient {
  name: string;
  amount: number | null;
  unit: string | null;
}

interface Step {
  order: number;
  text: string;
  timer_seconds?: number | null;
}

interface RecipeDetail {
  id: string;
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  ingredients: Ingredient[];
  steps: Step[];
  steps_anfaenger?: Step[] | null;
  steps_profi?: Step[] | null;
  steps_fortgeschritten?: Step[] | null;
  personal_note: string | null;
  cover_image_url: string | null;
  source_type: string;
  is_favorite: boolean;
  equipment: string[] | null;
  locale: string | null;
  available_translations: string[];
  calories_kcal: number | null;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  // 'private' | 'shared_household' | 'public_pool' - fuer den Anfangszustand
  // des Pool-Knopfs (siehe PublishToPoolButton initialPublished).
  visibility: string;
  // Nur gesetzt, wenn das Rezept einem ANDEREN Haushaltsmitglied gehört -
  // steuert, ob der Löschen-Knopf angezeigt wird (nur die Person, die es
  // angelegt hat, darf löschen, siehe Auftrag Punkt 6).
  owner_display_name: string | null;
  shared_with_household?: boolean;
  household_active?: boolean | null;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: '✍️ Selbst erstellt',
  web_import: '🌐 Aus dem Web importiert',
  ai_generated: '🤖 KI-generiert',
  photo_scan: '📷 Per Foto erfasst',
  starter_pack: '⭐ Starter-Paket',
  pool_fork: '👥 Aus dem Community-Pool',
};

interface SideSuggestion {
  id: string;
  title: string;
  reason: string;
}

interface RecipeSummary {
  id: string;
  title: string;
}

const MAX_SELECTABLE_SIDES = 2;

export default function RecipeDetailScreen({ route, navigation, onClose }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreiteZweispaltig, istTablet } = useLayout();
  const { t, sprache } = useUebersetzung();
  const { recipeId } = route.params;
  // Eingebettet (iPad quer, siehe RecipesScreen) hat keinen nativen
  // Header, also auch kein "Zurueck" darin - schliessen() geht dann ueber
  // die vom Elternscreen uebergebene Funktion statt navigation.goBack().
  const eingebettet = !!onClose;
  const schliessen = onClose ?? (() => navigation.goBack());
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [largeText, setLargeText] = useState(false);

  useEffect(() => {
    api.get<{ large_text: boolean }>('/preferences/').then((prefs) => setLargeText(prefs.large_text)).catch(() => {
      // Praeferenz konnte nicht geladen werden - Standard-Schriftgroesse bleibt
    });
  }, []);

  useEffect(() => {
    const load = () => {
      api
        .get<RecipeDetail>(`/recipes/${recipeId}`)
        .then(setRecipe)
        .catch((err) => setError(err instanceof ApiError ? err.detail : t('detail.nichtGeladen')));
    };
    load();
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [recipeId, navigation]);

  // Utensilien lazy nachladen, falls das Rezept noch keine hat (z.B. vor
  // Einfuehrung dieser Funktion erfasst) - genau wie steps_anfaenger/
  // steps_profi wird das einmalig generiert und am Rezept gecacht, danach
  // liefert das Backend bei jedem weiteren Aufruf sofort die gecachte
  // Fassung. Kein sichtbarer Ladezustand noetig, die Karte erscheint
  // einfach, sobald die Antwort da ist.
  useEffect(() => {
    if (!recipe || recipe.equipment) return;
    api
      .post<{ equipment: string[] }>(`/ai/infer-equipment/${recipe.id}`, {})
      .then((result) => setRecipe((prev) => (prev ? { ...prev, equipment: result.equipment } : prev)))
      .catch(() => {
        // Utensilien sind rein informativ - schlaegt die Ableitung fehl,
        // bleibt die Karte einfach weg, kein Alert noetig
      });
  }, [recipe?.id, recipe?.equipment]);



  const [sideSuggestions, setSideSuggestions] = useState<SideSuggestion[]>([]);
  const [manualSides, setManualSides] = useState<SideSuggestion[]>([]);
  const [selectedSideIds, setSelectedSideIds] = useState<string[]>([]);
  const [isSidesLoading, setIsSidesLoading] = useState(true);
  const [sidesError, setSidesError] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [allRecipes, setAllRecipes] = useState<RecipeSummary[]>([]);
  const [recipeSearch, setRecipeSearch] = useState('');

  useEffect(() => {
    // Beilagen-Vorschlaege direkt hier auf dem Rezept-Detail laden (nicht
    // erst auf einem eigenen Screen nach "Zubereitung starten") - echte
    // KI-Zuordnung aus den eigenen gespeicherten Rezepten, mit Begruendung.
    setIsSidesLoading(true);
    api
      .post<{ suggestions: SideSuggestion[] }>(`/ai/suggest-sides-for-recipe/${recipeId}`)
      .then((res) => setSideSuggestions(res.suggestions))
      .catch((err) => setSidesError(err instanceof ApiError ? err.detail : t('detail.vorschlaegeNichtGeladen')))
      .finally(() => setIsSidesLoading(false));
  }, [recipeId]);

  const allSideCandidates = [...manualSides, ...sideSuggestions.filter((s) => !manualSides.some((m) => m.id === s.id))];

  const toggleSideSelect = (id: string) => {
    setSelectedSideIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_SELECTABLE_SIDES) return prev;
      return [...prev, id];
    });
  };

  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);

  const loadPickerRecipes = async () => {
    setPickerLoading(true);
    setPickerError(null);
    try {
      setAllRecipes(await api.get<RecipeSummary[]>('/recipes/'));
    } catch (err) {
      // Vorher stand hier ein leeres catch. Schlug das Laden fehl, blieb
      // die Liste leer - ohne Ladeanzeige, ohne Meldung. Der Bildschirm
      // sah dann exakt so aus wie 'nichts gefunden', obwohl gar nicht
      // gesucht werden konnte.
      setPickerError(err instanceof ApiError ? err.detail : t('rezepte.nichtGeladen'));
    } finally {
      setPickerLoading(false);
    }
  };

  const openSidePicker = () => {
    setIsPickerOpen(true);
    setRecipeSearch('');
    // Auch dann neu laden, wenn ein frueherer Versuch fehlgeschlagen ist -
    // sonst bliebe der Picker bis zum Neustart der App leer.
    if (allRecipes.length === 0) {
      loadPickerRecipes();
    }
  };

  const addManualSide = (r: RecipeSummary) => {
    if (r.id === recipeId) return;
    if (!manualSides.some((m) => m.id === r.id) && !sideSuggestions.some((s) => s.id === r.id)) {
      setManualSides((prev) => [...prev, { id: r.id, title: r.title, reason: t('detail.selbstAusgewaehlt') }]);
    }
    toggleSideSelect(r.id);
    setIsPickerOpen(false);
  };

  // Brutzel prueft das Rezept auf Verbesserungsvorschlaege (nutzt den schon
  // laenger bestehenden, aber bisher nie an die App angebundenen Endpunkt
  // POST /ai/review-recipe/{id}). Ausgewaehlte Vorschlaege werden beim
  // Uebernehmen an personal_note angehaengt - landen damit dauerhaft im
  // Kochbuch UND sind beim naechsten Kochen sichtbar (personal_note wird
  // im Rezept-Detail angezeigt), nicht nur einmalig hier zu sehen.
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewSuggestions, setReviewSuggestions] = useState<{ title: string; detail: string }[] | null>(null);
  const [reviewWebVerified, setReviewWebVerified] = useState(false);
  const [selectedSuggestionIndices, setSelectedSuggestionIndices] = useState<number[]>([]);
  const [isApplyingSuggestions, setIsApplyingSuggestions] = useState(false);

  const handleReviewRecipe = async () => {
    setIsReviewing(true);
    setReviewSuggestions(null);
    setSelectedSuggestionIndices([]);
    try {
      const result = await api.post<{ web_verified: boolean; suggestions: { title: string; detail: string }[] }>(
        `/ai/review-recipe/${recipeId}`,
      );
      setReviewSuggestions(result.suggestions);
      setReviewWebVerified(result.web_verified);
    } catch (err) {
      Alert.alert(t('detail.pruefungFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsReviewing(false);
    }
  };

  // Vorschlaege wirklich ins Rezept einarbeiten (statt sie nur als Notiz
  // darunterzuschreiben): Das Backend liefert das ueberarbeitete Rezept
  // zurueck, OHNE es zu speichern - hier zeigen wir es zuerst an, der
  // Nutzer entscheidet.
  const [isEinarbeiten, setIsEinarbeiten] = useState(false);
  const [entwurf, setEntwurf] = useState<
    { ingredients: Ingredient[]; steps: Step[]; changes: string[] } | null
  >(null);

  const handleEinarbeiten = async () => {
    if (!reviewSuggestions || selectedSuggestionIndices.length === 0) return;
    setIsEinarbeiten(true);
    try {
      const res = await api.post<{ ingredients: Ingredient[]; steps: Step[]; changes: string[] }>(
        `/ai/apply-suggestions/${recipeId}`,
        { suggestions: selectedSuggestionIndices.map((i) => reviewSuggestions[i]) },
      );
      setEntwurf(res);
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.einarbeitenFehler'));
    } finally {
      setIsEinarbeiten(false);
    }
  };

  const handleEntwurfSpeichern = () => {
    if (!entwurf || !recipe) return;
    // Wie bei jeder Schrittaenderung: erst warnen, wenn an den
    // Stufenfassungen Notizen haengen - die gehen dabei verloren.
    mitStufenHinweis(recipe, recipe.steps, entwurf.steps, t, async () => {
      setIsApplyingSuggestions(true);
      try {
        const updated = await api.patch<RecipeDetail>(`/recipes/${recipeId}`, {
          ingredients: entwurf.ingredients,
          steps: entwurf.steps,
        });
        setRecipe((prev) => ({
          ...updated,
          owner_display_name: prev?.owner_display_name ?? updated.owner_display_name,
          household_active: prev?.household_active ?? updated.household_active,
        }));
        setEntwurf(null);
        setReviewSuggestions(null);
        setSelectedSuggestionIndices([]);
      } catch (err) {
        Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtUebernommen'));
      } finally {
        setIsApplyingSuggestions(false);
      }
    });
  };

  const toggleSuggestionSelect = (index: number) => {
    setSelectedSuggestionIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );
  };

  const handleApplySuggestions = async () => {
    if (!recipe || !reviewSuggestions || selectedSuggestionIndices.length === 0) return;
    const chosenText = selectedSuggestionIndices
      .map((i) => `${reviewSuggestions[i].title}: ${reviewSuggestions[i].detail}`)
      .join('\n');
    const newNote = recipe.personal_note ? `${recipe.personal_note}\n${chosenText}` : chosenText;
    setIsApplyingSuggestions(true);
    try {
      const updated = await api.patch<RecipeDetail>(`/recipes/${recipeId}`, { personal_note: newNote });
      setRecipe(updated);
      setReviewSuggestions(null);
      setSelectedSuggestionIndices([]);
      setSessionOnlyNote(null); // dauerhaft uebernommen -> ersetzt eine evtl. vorher gewaehlte Nur-diesmal-Notiz
      Alert.alert(t('detail.uebernommen'), t('detail.uebernommenText'));
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtUebernommen'));
    } finally {
      setIsApplyingSuggestions(false);
    }
  };

  // "Nur fuer diesen Kochvorgang": KEIN Speichern im Rezept - die gewaehlten
  // Vorschlaege werden stattdessen beim Kochstart als sessionNote an den
  // Koch-Modus mitgegeben (siehe navigation.navigate('CookMode', ...) unten)
  // und dort nur einmalig angezeigt, das gespeicherte Rezept bleibt unberuehrt.
  const [sessionOnlyNote, setSessionOnlyNote] = useState<string | null>(null);
  const handleApplySuggestionsForThisCookOnly = () => {
    if (!reviewSuggestions || selectedSuggestionIndices.length === 0) return;
    const chosenText = selectedSuggestionIndices
      .map((i) => `${reviewSuggestions[i].title}: ${reviewSuggestions[i].detail}`)
      .join('\n');
    setSessionOnlyNote(chosenText);
    setReviewSuggestions(null);
    setSelectedSuggestionIndices([]);
    Alert.alert(t('detail.vorgemerkt'), t('detail.vorgemerktText'));
  };

  // Zutaten/Schritte VOR dem Kochstart bearbeiten - gleiche Abfrage wie im
  // Koch-Modus selbst (SingleRecipeCookView). "Nur diesmal" speichert
  // NICHTS im Rezept, sondern merkt die Aenderung lokal vor und gibt sie
  // beim Kochstart als sessionOverrides an CookMode mit (nur fuers
  // Hauptgericht, recipeIds[0] - siehe CookModeScreen.tsx).
  const [sessionIngredientsOverride, setSessionIngredientsOverride] = useState<Ingredient[] | null>(null);
  const [sessionStepsOverride, setSessionStepsOverride] = useState<Step[] | null>(null);
  const [isEditingStepIndex, setIsEditingStepIndex] = useState<number | null>(null);
  const [stepTextDraft, setStepTextDraft] = useState('');
  const [isSavingStepText, setIsSavingStepText] = useState(false);
  const [editingIngredientIndex, setEditingIngredientIndex] = useState<number | null>(null);
  const [ingredientDraft, setIngredientDraft] = useState({ name: '', amount: '', unit: '' });
  const [isSavingIngredient, setIsSavingIngredient] = useState(false);

  // --- Uebersetzung ---------------------------------------------------
  // Das Original bleibt immer erhalten; die Uebersetzung wird nur
  // darueber gelegt. Deshalb zwei Zustaende statt eines: was vorliegt,
  // und was gerade gezeigt wird.
  const quellsprache = (recipe?.locale || 'de').slice(0, 2);
  const brauchtUebersetzung = !!recipe && quellsprache !== sprache;
  const [uebersetzung, setUebersetzung] = useState<
    { title: string; ingredients: Ingredient[]; steps: Step[] } | null
  >(null);
  const [zeigeUebersetzung, setZeigeUebersetzung] = useState(true);
  const [uebersetztGerade, setUebersetztGerade] = useState(false);
  const [uebersetzungsfehler, setUebersetzungsfehler] = useState<string | null>(null);

  const holeUebersetzung = useCallback(async () => {
    if (!recipe) return;
    setUebersetztGerade(true);
    setUebersetzungsfehler(null);
    try {
      const res = await api.post<{ title: string; ingredients: Ingredient[]; steps: Step[] }>(
        `/ai/translate/${recipe.id}?locale=${sprache}`,
        {},
      );
      setUebersetzung(res);
      setZeigeUebersetzung(true);
    } catch (err) {
      setUebersetzungsfehler(err instanceof ApiError ? err.detail : t('uebersetzung.fehlgeschlagen'));
    } finally {
      setUebersetztGerade(false);
    }
  }, [recipe?.id, sprache]);

  // Liegt sie schon vor, kostet das Holen keinen KI-Aufruf - dann ohne
  // Nachfrage laden, sonst muesste man jedes Mal neu bestaetigen.
  useEffect(() => {
    if (brauchtUebersetzung && recipe?.available_translations?.includes(sprache) && !uebersetzung) {
      holeUebersetzung();
    }
  }, [brauchtUebersetzung, recipe?.id, sprache]);

  const zeigtUebersetzung = !!uebersetzung && zeigeUebersetzung;

  const currentIngredients = sessionIngredientsOverride
    ?? (zeigtUebersetzung ? uebersetzung!.ingredients : recipe?.ingredients)
    ?? [];

  const currentSteps = sessionStepsOverride
    ?? (zeigtUebersetzung ? uebersetzung!.steps : recipe?.steps)
    ?? [];

  const saveRecipeChangeWithScope = (
    updatedFields: { ingredients?: Ingredient[]; steps?: Step[] },
    applyLocally: () => void,
    applySessionOnly: () => void,
    setSaving: (v: boolean) => void,
    onDone: () => void,
  ) => {
    Keyboard.dismiss();
    Alert.alert(
      t('detail.aenderungSpeichern'),
      t('detail.aenderungFrage'),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        { text: t('detail.nurDiesmal'), onPress: () => { applySessionOnly(); onDone(); } },
        {
          text: t('detail.dauerhaftImRezept'),
          onPress: () => mitStufenHinweis(recipe, recipe?.steps ?? [], updatedFields.steps, t, async () => {
            setSaving(true);
            try {
              const updated = await api.patch<RecipeDetail>(`/recipes/${recipeId}`, updatedFields);
              // Ersteller-Name und Haushalt-Status liefert nur der Einzelabruf,
              // die Antwort aufs Speichern nicht - sonst verschwaende nach dem
              // Speichern das Haushalt-Symbol, und die Loeschfrage hielte ein
              // fremdes Rezept fuer ein eigenes.
              setRecipe((prev) => ({
                ...updated,
                owner_display_name: prev?.owner_display_name ?? updated.owner_display_name,
                household_active: prev?.household_active ?? updated.household_active,
              }));
              applyLocally();
              onDone();
            } catch (err) {
              Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtGespeichert'));
            } finally {
              setSaving(false);
            }
          }),
        },
      ],
    );
  };

  const handleOpenStepEdit = (index: number) => {
    setStepTextDraft(currentSteps[index].text);
    setIsEditingStepIndex(index);
  };

  const handleSaveStepEdit = () => {
    if (isEditingStepIndex === null || !stepTextDraft.trim()) return;
    const updated = currentSteps.map((s, i) => (i === isEditingStepIndex ? { ...s, text: stepTextDraft.trim() } : s));
    saveRecipeChangeWithScope(
      { steps: updated },
      () => {},
      () => setSessionStepsOverride(updated),
      setIsSavingStepText,
      () => setIsEditingStepIndex(null),
    );
  };

  const handleDeleteStep = () => {
    if (isEditingStepIndex === null) return;
    if (currentSteps.length <= 1) {
      Alert.alert(t('detail.nichtMoeglich'), t('detail.mindestensEinSchritt'));
      return;
    }
    const updated = currentSteps.filter((_, i) => i !== isEditingStepIndex);
    saveRecipeChangeWithScope(
      { steps: updated },
      () => {},
      () => setSessionStepsOverride(updated),
      setIsSavingStepText,
      () => setIsEditingStepIndex(null),
    );
  };

  const handleOpenIngredientEdit = (index: number) => {
    const ing = currentIngredients[index];
    setIngredientDraft({ name: ing.name, amount: ing.amount != null ? String(ing.amount) : '', unit: ing.unit ?? '' });
    setEditingIngredientIndex(index);
  };

  const handleSaveIngredientEdit = () => {
    if (editingIngredientIndex === null || !ingredientDraft.name.trim()) return;
    const updated = currentIngredients.map((ing, i) =>
      i === editingIngredientIndex
        ? {
            name: ingredientDraft.name.trim(),
            amount: ingredientDraft.amount.trim() ? Number(ingredientDraft.amount.trim()) : null,
            unit: ingredientDraft.unit.trim() || null,
          }
        : ing,
    );
    saveRecipeChangeWithScope(
      { ingredients: updated },
      () => {},
      () => setSessionIngredientsOverride(updated),
      setIsSavingIngredient,
      () => setEditingIngredientIndex(null),
    );
  };

  const handleDeleteIngredient = () => {
    if (editingIngredientIndex === null) return;
    const updated = currentIngredients.filter((_, i) => i !== editingIngredientIndex);
    saveRecipeChangeWithScope(
      { ingredients: updated },
      () => {},
      () => setSessionIngredientsOverride(updated),
      setIsSavingIngredient,
      () => setEditingIngredientIndex(null),
    );
  };

  const filteredPickerRecipes = (recipeSearch.trim()
    ? allRecipes.filter((r) => r.title.toLowerCase().includes(recipeSearch.trim().toLowerCase()))
    : allRecipes
  ).filter((r) => r.id !== recipeId);

  const [isAddingToList, setIsAddingToList] = useState(false);
  const handleAddToShoppingList = async () => {
    setIsAddingToList(true);
    try {
      // Die gerade angezeigte Portionenzahl mitschicken, nicht die im
      // Rezept gespeicherte - sonst landen auf der Liste Mengen fuer 4,
      // waehrend am Bildschirm 8 stand. Nur fuer das Hauptgericht: Die
      // Beilagen behalten ihre eigene Menge, dafuer gibt es hier keinen
      // eigenen Regler.
      await api.post('/shopping-list/add-recipes', {
        recipe_ids: [recipeId, ...selectedSideIds],
        servings_by_recipe_id: angezeigtePortionen ? { [recipeId]: angezeigtePortionen } : undefined,
      });
      // Für "Jetzt kochen" nach dem Einkauf (Kochplan-Karte in Einkaufsliste
      // und Startseite) - gleiche Gruppe und Portionen wie auf der Liste.
      if (recipe) {
        await kochplanMerken({
          id: recipeId,
          titel: recipe.title,
          recipeIds: [recipeId, ...selectedSideIds],
          beilagen: selectedSideIds.map((sid) => allSideCandidates.find((c) => c.id === sid)?.title).filter((x): x is string => !!x),
          portionen: angezeigtePortionen ?? undefined,
        }).catch(() => {});
      }
      Alert.alert(t('detail.erledigt'), t('kochplan.hinweisNachUebernahme'));
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.zutatenNichtHinzugefuegt'));
    } finally {
      setIsAddingToList(false);
    }
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);
  /**
   * Rezept als lesbare Nachricht ins Teilen-Blatt des Geraets geben -
   * WhatsApp, Messenger, Signal, Mail, was installiert ist.
   *
   * Der Weg per E-Mail (ShareRecipeButton) verschickt einen DATENSATZ,
   * den der Empfaenger mit einem Tipp uebernimmt. Das geht nur ueber die
   * Adresse, weil sie das Einzige ist, woran sich ein spaeteres Konto
   * erkennen laesst. Ueber Messenger ist beides nicht moeglich - dort
   * geht nur Text. Der dafuer sofort und ohne Konto beim Empfaenger.
   *
   * Geteilt wird, was gerade angezeigt wird: Liegt eine Uebersetzung vor
   * und ist sie sichtbar, geht sie hinaus, nicht das Original.
   */
  const handleShareAsText = async () => {
    if (!recipe) return;
    const zeilen: string[] = [];
    zeilen.push(zeigtUebersetzung ? uebersetzung!.title : recipe.title);
    if (angezeigtePortionen) zeilen.push(t('detail.fuerPortionen', { anzahl: angezeigtePortionen }));
    zeilen.push('');
    zeilen.push(`${t('detail.zutaten')}:`);
    currentIngredients.forEach((ing) => {
      const menge = [ing.amount, ing.unit].filter(Boolean).join(' ');
      zeilen.push(`- ${menge ? menge + ' ' : ''}${ing.name}`);
    });
    zeilen.push('');
    zeilen.push(`${t('detail.zubereitung')}:`);
    currentSteps.forEach((st, i) => zeilen.push(`${i + 1}. ${st.text}`));
    if (recipe.personal_note?.trim()) {
      zeilen.push('');
      zeilen.push(recipe.personal_note.trim());
    }
    zeilen.push('');
    // Vorschau-Link dazu: der Text allein liest sich in WhatsApp & Co.
    // als Wall of Text ohne Bild. Der Link fuehrt auf eine oeffentliche
    // Seite mit Foto, Zutaten und Schritten (siehe
    // homearchive.at/meinkochbuch/rezept/{id}, backend/routers/
    // public_recipes.py) - wer die App schon hat, kann von dort auch
    // direkt weiter zur App, wer nicht, landet auf der Produktseite.
    // Kein automatisches Uebernehmen ins eigene Kochbuch ueber diesen
    // Weg - dafuer gibt es den Teilen-per-E-Mail-Knopf oben (ShareRecipeButton).
    zeilen.push(`https://homearchive.at/meinkochbuch/rezept/${recipe.id}`);
    zeilen.push('');
    zeilen.push(t('detail.geteiltMit'));

    try {
      await Share.share({ message: zeilen.join('\n') });
    } catch {
      // Teilen abgebrochen - kein Hinweis noetig.
    }
  };

  const handlePrintRecipe = async () => {
    setIsExportingPdf(true);
    try {
      const localUri = await api.downloadFile(`/recipes/${recipeId}/pdf`, `rezept-${recipeId}.pdf`);
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(t('einkauf.nichtVerfuegbar'), t('detail.teilenNichtUnterstuetzt'));
        return;
      }
      await Sharing.shareAsync(localUri, { mimeType: 'application/pdf', dialogTitle: recipe?.title ?? 'Rezept' });
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.pdfFehlgeschlagen'));
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Portionen sind eine Anzeige fuer diesen Besuch, kein Rezeptwert mehr.
  // Vorgabe ist die Zahl aus dem Profil; das Rezept behaelt seine eigene.
  // Frueher schrieb der Regler per PATCH ins Rezept - was nichts bewirkte,
  // weil die Zutatenmengen davon unberuehrt blieben. Umgerechnet wird im
  // Koch-Modus, und der richtet sich nach genau dieser Zahl.
  const [portionen, setPortionen] = useState<number | null>(null);
  useEffect(() => {
    api
      .get<{ default_servings: number }>('/preferences/')
      .then((prefs) => setPortionen(prefs.default_servings))
      .catch(() => {
        // Profil nicht erreichbar: Der Rezeptwert ist die naechstbeste
        // Auskunft, besser als ein leeres Feld.
      });
  }, []);

  // Portionen = 0 heisst: Rezept ohne Portionen (z. B. Torte, Auflauf).
  // Dann gibt es keinen Regler, die Mengen gelten fuer das ganze Rezept.
  const ohnePortionen = recipe?.servings === 0;
  const angezeigtePortionen = ohnePortionen ? null : (portionen ?? recipe?.servings ?? null);

  // Anzeige-Mengen fuer die aktuelle Portionenzahl. currentIngredients
  // selbst bleibt die gespeicherte Fassung - Bearbeiten und Speichern
  // greifen weiterhin auf die ECHTEN Mengen zu, nicht auf die skalierten
  // (siehe handleOpenIngredientEdit: dort wird bewusst currentIngredients
  // genommen, nicht anzeigeIngredients).
  const portionenFaktor =
    recipe?.servings && angezeigtePortionen ? angezeigtePortionen / recipe.servings : 1;
  const anzeigeIngredients = portionenFaktor === 1
    ? currentIngredients
    : currentIngredients.map((ing) => {
        if (ing.amount == null) return ing;
        const wert = ing.amount * portionenFaktor;
        const gerundet = Math.round(wert * 10) / 10;
        return { ...ing, amount: Number.isInteger(gerundet) ? gerundet : gerundet };
      });

  const handleChangeServings = (delta: number) => {
    setPortionen((prev) => Math.max(1, (prev ?? recipe?.servings ?? 1) + delta));
  };

  const [isSavingFavorite, setIsSavingFavorite] = useState(false);
  const handleToggleFavorite = async () => {
    if (!recipe || isSavingFavorite) return;
    const previous = recipe;
    const newValue = !recipe.is_favorite;
    setRecipe({ ...recipe, is_favorite: newValue });
    setIsSavingFavorite(true);
    try {
      await api.patch(`/recipes/${recipeId}`, { is_favorite: newValue });
    } catch (err) {
      setRecipe(previous);
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtGespeichert'));
    } finally {
      setIsSavingFavorite(false);
    }
  };

  // Haushalt-Kennzeichen: Nur geteilte Rezepte sehen die anderen im
  // Haushalt. Wer ein fremdes Rezept nicht bei sich haben will, nimmt es
  // hier heraus, statt es fuer alle zu loeschen - der Ersteller behaelt es.
  const [isSavingHaushalt, setIsSavingHaushalt] = useState(false);
  const speichereHaushalt = async (neu: boolean, danach?: () => void) => {
    if (!recipe) return;
    const previous = recipe;
    setRecipe({ ...recipe, shared_with_household: neu });
    setIsSavingHaushalt(true);
    try {
      await api.patch(`/recipes/${recipeId}`, { shared_with_household: neu });
      danach?.();
    } catch (err) {
      setRecipe(previous);
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtGespeichert'));
    } finally {
      setIsSavingHaushalt(false);
    }
  };
  const handleToggleHaushalt = () => {
    if (!recipe || isSavingHaushalt) return;
    const geteilt = recipe.shared_with_household !== false;
    if (!geteilt) {
      speichereHaushalt(true);
      return;
    }
    if (recipe.owner_display_name) {
      // Fremdes Rezept: Danach ist es fuer mich unsichtbar, also zurueck.
      Alert.alert(
        t('detail.haushaltFremdTitel'),
        t('detail.haushaltFremdText', { name: recipe.owner_display_name }),
        [
          { text: t('allgemein.abbrechen'), style: 'cancel' },
          {
            text: t('detail.haushaltFremdKnopf'),
            style: 'destructive',
            onPress: () => speichereHaushalt(false, () => schliessen()),
          },
        ],
      );
      return;
    }
    Alert.alert(t('detail.haushaltNurIchTitel'), t('detail.haushaltNurIchText'), [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      { text: t('detail.haushaltNurIchKnopf'), onPress: () => speichereHaushalt(false) },
    ]);
  };
  const zeigeHaushaltSymbol = !!recipe?.household_active && recipe?.source_type !== 'starter_pack';

  const handleDelete = () => {
    if (!recipe) return;
    Alert.alert(
      t('detail.rezeptLoeschen'),
      t('detail.loeschenText', { titel: recipe.title }),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('allgemein.loeschen'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/recipes/${recipeId}`);
              schliessen();
            } catch (err) {
              Alert.alert(t('profil.loeschenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
            }
          },
        },
      ],
    );
  };

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text>
      </View>
    );
  }

  if (!recipe) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const blockHero = (
    <>
      {recipe.cover_image_url && (
        <Image source={{ uri: recipe.cover_image_url }} style={[styles.heroImage, { borderRadius: radius.md }]} />
      )}
    </>
  );
  const blockTitel = (
    <>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.text, flex: 1 }]}>
          {zeigtUebersetzung ? uebersetzung!.title : recipe.title}
        </Text>
        {/* Veroeffentlichen sitzt bewusst direkt neben dem Favoriten-Herz:
            beides sind Entscheidungen ueber DIESES Rezept, und wer es
            gerade gekocht hat, entscheidet hier, ob es andere sehen
            sollen. */}
        <ShareRecipeButton recipeId={recipe.id} recipeTitle={recipe.title} size={23} style={{ paddingLeft: 8 }} />
        {zeigeHaushaltSymbol && (
          <Pressable
            onPress={handleToggleHaushalt}
            disabled={isSavingHaushalt}
            hitSlop={10}
            style={{ paddingLeft: 8 }}
            accessibilityLabel={
              recipe.shared_with_household !== false ? t('detail.haushaltGeteilt') : t('detail.haushaltNurDu')
            }
          >
            <MaterialCommunityIcons
              name={recipe.shared_with_household !== false ? 'home-account' : 'home-off-outline'}
              size={25}
              color={recipe.shared_with_household !== false ? gradient[0] : colors.muted}
            />
          </Pressable>
        )}
        <PublishToPoolButton recipeId={recipe.id} recipeTitle={recipe.title} size={24} style={{ paddingLeft: 8 }} initialPublished={recipe.visibility === 'public_pool'} />
        <Pressable onPress={handleToggleFavorite} disabled={isSavingFavorite} hitSlop={10} style={{ paddingLeft: 8 }}>
          <MaterialCommunityIcons
            name={recipe.is_favorite ? 'heart' : 'heart-outline'}
            size={26}
            color={recipe.is_favorite ? gradient[0] : colors.muted}
          />
        </Pressable>
      </View>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: colors.muted }]}>
          {recipe.prep_time_minutes ? `${recipe.prep_time_minutes} min` : ''}
        </Text>
        <View style={{ flexDirection: 'row', gap: 18 }}>
          <Pressable onPress={() => navigation.navigate('ManualRecipe', { recipeId: recipe.id })} hitSlop={8}>
            <MaterialCommunityIcons name="pencil-outline" size={22} color="#16A34A" />
          </Pressable>
          {/* Loeschen nur beim eigenen Rezept. Ein fremdes nimmt man ueber
              das Haus-Symbol aus dem Haushalt, der Ersteller behaelt es. */}
          {!recipe.owner_display_name && (
            <Pressable onPress={handleDelete} hitSlop={8}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#DC2626" />
            </Pressable>
          )}
        </View>
      </View>

      <Text style={[styles.sourceHint, { color: colors.muted }]}>
        {SOURCE_LABELS[recipe.source_type] ?? recipe.source_type}
        {recipe.owner_display_name ? ` · ${t('rezepte.vonMitglied', { name: recipe.owner_display_name })}` : ''}
      </Text>
    </>
  );
  const blockPortionen = (
    <>
      {ohnePortionen ? (
        <View style={[styles.servingsCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.servingsLabel, { color: colors.muted, marginBottom: 4 }]}>{t('detail.ganzesRezept')}</Text>
          <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>{t('detail.ganzesRezeptText')}</Text>
        </View>
      ) : (
      <View style={[styles.servingsCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <Text style={[styles.servingsLabel, { color: colors.muted }]}>{t('detail.portionen')}</Text>
        <View style={styles.servingsControlRow}>
          <Pressable
            onPress={() => handleChangeServings(-1)}
            disabled={(angezeigtePortionen ?? 1) <= 1}
            style={[styles.servingsButton, { backgroundColor: colors.bg, borderRadius: radius.sm, opacity: (angezeigtePortionen ?? 1) <= 1 ? 0.4 : 1 }]}
          >
            <MaterialCommunityIcons name="minus" size={22} color={colors.text} />
          </Pressable>
          <Text style={[styles.servingsValue, { color: colors.text }]}>{angezeigtePortionen ?? '–'}</Text>
          <Pressable
            onPress={() => handleChangeServings(1)}
            style={[styles.servingsButton, { backgroundColor: colors.bg, borderRadius: radius.sm }]}
          >
            <MaterialCommunityIcons name="plus" size={22} color={colors.text} />
          </Pressable>
        </View>
      </View>
      )}
    </>
  );
  const blockAusruestung = (
    <>
      {recipe.equipment && recipe.equipment.length > 0 && (
        <View style={[styles.equipmentCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <MaterialCommunityIcons name="pot-steam-outline" size={18} color={colors.muted} style={{ marginRight: 8 }} />
          <Text style={[styles.equipmentText, { color: colors.text }]}>
            <Text style={{ fontWeight: '700' }}>{t('detail.duBenoetigst')}</Text>
            {recipe.equipment.join(', ')}
          </Text>
        </View>
      )}
    </>
  );
  const blockAktionen = (
    <>
      <Pressable
        onPress={() => {
          // Merken, welche Beilagen tatsaechlich mitgekocht werden - beim
          // START, nicht beim Auswaehlen: Ausgewaehlt wird viel, gekocht
          // wird das, was wirklich zusammengehoert. Beim naechsten Mal
          // stehen diese Beilagen ganz oben, noch vor den KI-Vorschlaegen.
          // Fehler hier duerfen das Kochen nicht aufhalten.
          if (selectedSideIds.length > 0) {
            api.post(`/ai/remember-sides/${recipeId}`, { side_recipe_ids: selectedSideIds }).catch(() => {});
          }
          navigation.navigate('CookMode', {
            recipeIds: [recipeId, ...selectedSideIds],
            sessionNote: sessionOnlyNote ?? undefined,
            // Dieselbe Zahl, die hier auf dem Bildschirm stand - sonst
            // laedt der Koch-Modus unabhaengig den Profilwert und zeigt
            // etwas anderes als das, was man gerade eingestellt hatte.
            sessionServings: angezeigtePortionen ?? undefined,
            sessionOverrides:
              sessionIngredientsOverride || sessionStepsOverride
                ? { ingredients: sessionIngredientsOverride ?? undefined, steps: sessionStepsOverride ?? undefined }
                : undefined,
          });
        }}
        style={[styles.cookButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}
      >
        <Text style={styles.cookButtonText}>{t('detail.zubereitungStarten')}</Text>
      </Pressable>

      <Pressable
        onPress={handleAddToShoppingList}
        disabled={isAddingToList}
        style={[styles.shoppingListButton, { backgroundColor: colors.card, borderRadius: radius.md, opacity: isAddingToList ? 0.7 : 1 }]}
      >
        {isAddingToList ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <>
            <MaterialCommunityIcons name="cart-plus" size={16} color={colors.text} />
            <Text style={[styles.shoppingListButtonText, { color: colors.text }]}>{t('detail.zutatenZurListe')}</Text>
          </>
        )}
      </Pressable>

      <Pressable
        onPress={handlePrintRecipe}
        disabled={isExportingPdf}
        style={[styles.shoppingListButton, { backgroundColor: colors.card, borderRadius: radius.md, opacity: isExportingPdf ? 0.7 : 1 }]}
      >
        {isExportingPdf ? (
          <ActivityIndicator color={colors.text} size="small" />
        ) : (
          <>
            <MaterialCommunityIcons name="printer-outline" size={16} color={colors.text} />
            <Text style={[styles.shoppingListButtonText, { color: colors.text }]}>{t('detail.drucken')}</Text>
          </>
        )}
      </Pressable>

      <Pressable
        onPress={handleShareAsText}
        style={[styles.shoppingListButton, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="share-variant-outline" size={16} color={colors.text} />
        <Text style={[styles.shoppingListButtonText, { color: colors.text }]}>{t('detail.alsNachricht')}</Text>
      </Pressable>
    </>
  );
  const blockBeilagen = (
    <>
      <View style={[styles.sidesCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <View style={styles.sidesHeader}>
          <BrutzelAvatar size={52} />
          <Text style={[styles.sidesTitle, { color: colors.text }]}>{t('detail.beilageFrage')}</Text>
        </View>

        {isSidesLoading ? (
          <View style={{ paddingVertical: 10, alignItems: 'center' }}>
            <ActivityIndicator color={colors.muted} size="small" />
            <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 6 }}>{t('detail.brutzelUeberlegt')}</Text>
          </View>
        ) : (
          <>
            {sidesError && (
              <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 8 }}>
                {t('detail.keineKiVorschlaege', { fehler: sidesError })}
              </Text>
            )}
            {!sidesError && allSideCandidates.length === 0 && (
              <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 8 }}>
                {t('detail.keineBeilageGefunden')}
              </Text>
            )}
            {allSideCandidates.map((s) => {
              const isSelected = selectedSideIds.includes(s.id);
              return (
                <Pressable
                  key={s.id}
                  onPress={() => toggleSideSelect(s.id)}
                  style={[
                    styles.sideRow,
                    { backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: isSelected ? 1.5 : 0, borderColor: gradient[0] },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sideTitle, { color: colors.text }]}>{s.title}</Text>
                    <Text style={[styles.sideReason, { color: colors.muted }]}>{s.reason}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                    size={20}
                    color={isSelected ? gradient[0] : colors.muted}
                  />
                </Pressable>
              );
            })}
            <Pressable onPress={openSidePicker} style={styles.searchLink}>
              <MaterialCommunityIcons name="magnify" size={14} color={gradient[0]} />
              <Text style={[styles.searchLinkText, { color: gradient[0] }]}>{t('detail.anderesRezeptSuchen')}</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={[styles.sidesCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <View style={styles.sidesHeader}>
          <BrutzelAvatar size={52} />
          <Text style={[styles.sidesTitle, { color: colors.text }]}>{t('detail.verbesserungenFrage')}</Text>
        </View>

        {!reviewSuggestions && !isReviewing && (
          <Pressable onPress={handleReviewRecipe} style={[styles.reviewButton, { backgroundColor: gradient[0], borderRadius: radius.sm }]}>
            <Text style={styles.reviewButtonText}>{t('detail.brutzelPrueft')}</Text>
          </Pressable>
        )}

        {isReviewing && (
          <View style={{ paddingVertical: 10, alignItems: 'center' }}>
            <ActivityIndicator color={colors.muted} size="small" />
            <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 6 }}>{t('detail.brutzelPrueftLaeuft')}</Text>
          </View>
        )}

        {reviewSuggestions && reviewSuggestions.length === 0 && (
          <Text style={{ color: colors.muted, fontSize: 11.5 }}>
            {t('detail.nichtsZuErgaenzen')}
          </Text>
        )}

        {reviewSuggestions && reviewSuggestions.length > 0 && (
          <>
            <Text style={{ color: colors.muted, fontSize: 10.5, marginBottom: 8 }}>
              {reviewWebVerified ? t('detail.mitWebsuche') : t('detail.ohneWebsuche')}
            </Text>
            {reviewSuggestions.map((s, i) => {
              const isSelected = selectedSuggestionIndices.includes(i);
              return (
                <Pressable
                  key={i}
                  onPress={() => toggleSuggestionSelect(i)}
                  style={[
                    styles.sideRow,
                    { backgroundColor: colors.bg, borderRadius: radius.sm, borderWidth: isSelected ? 1.5 : 0, borderColor: gradient[0] },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.sideTitle, { color: colors.text }]}>{s.title}</Text>
                    <Text style={[styles.sideReason, { color: colors.muted }]}>{s.detail}</Text>
                  </View>
                  <MaterialCommunityIcons
                    name={isSelected ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                    size={20}
                    color={isSelected ? gradient[0] : colors.muted}
                  />
                </Pressable>
              );
            })}
            <Pressable
              onPress={handleEinarbeiten}
              disabled={selectedSuggestionIndices.length === 0 || isEinarbeiten}
              style={[
                styles.reviewButton,
                { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: selectedSuggestionIndices.length === 0 ? 0.5 : 1, marginTop: 4 },
              ]}
            >
              {isEinarbeiten ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.reviewButtonText}>{t('detail.einarbeiten')}</Text>
              )}
            </Pressable>
            {isEinarbeiten && (
              <Text style={{ color: colors.muted, fontSize: 11, textAlign: 'center', marginTop: 6 }}>
                {t('detail.einarbeitenLaeuft')}
              </Text>
            )}
            <Pressable
              onPress={handleApplySuggestions}
              disabled={selectedSuggestionIndices.length === 0 || isApplyingSuggestions}
              style={[
                styles.secondaryReviewButton,
                { borderColor: gradient[0], borderRadius: radius.sm, opacity: selectedSuggestionIndices.length === 0 ? 0.5 : 1 },
              ]}
            >
              {isApplyingSuggestions && !entwurf ? (
                <ActivityIndicator color={gradient[0]} size="small" />
              ) : (
                <Text style={[styles.secondaryReviewButtonText, { color: gradient[0] }]}>
                  {selectedSuggestionIndices.length > 0
                    ? t('detail.alsNotizMerken', { anzahl: selectedSuggestionIndices.length })
                    : t('detail.auswaehlenZumUebernehmen')}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={handleApplySuggestionsForThisCookOnly}
              disabled={selectedSuggestionIndices.length === 0}
              style={[styles.secondaryReviewButton, { borderColor: gradient[0], borderRadius: radius.sm, opacity: selectedSuggestionIndices.length === 0 ? 0.5 : 1 }]}
            >
              <Text style={[styles.secondaryReviewButtonText, { color: gradient[0] }]}>{t('detail.nurDiesenKochvorgang')}</Text>
            </Pressable>
          </>
        )}
      </View>
    </>
  );
  const blockUebersetzung = (
    <>
      {brauchtUebersetzung && (
        <TranslationBanner
          quellsprache={quellsprache}
          zeigtUebersetzung={zeigtUebersetzung}
          vorhanden={!!uebersetzung}
          laeuft={uebersetztGerade}
          fehler={uebersetzungsfehler}
          onUebersetzen={holeUebersetzung}
          onUmschalten={() => setZeigeUebersetzung((v) => !v)}
        />
      )}
    </>
  );
  const blockNaehrwerte = (
    <>
      <NutritionCard
        recipeId={recipeId}
        gespeichert={{
          calories_kcal: recipe.calories_kcal,
          protein_g: recipe.protein_g,
          fat_g: recipe.fat_g,
          carbs_g: recipe.carbs_g,
        }}
      />

      <WeinEmpfehlungCard
        recipe={{ id: recipe.id, title: recipe.title, ingredients: recipe.ingredients }}
        refreshKey={route.params.weinAktualisiert}
      />
    </>
  );
  const blockZutaten = (
    <>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('detail.zutaten')}</Text>
      {/* anzeigeIngredients fuer den Text, currentIngredients fuers
          Bearbeiten (per Index i, siehe handleOpenIngredientEdit) - sonst
          wuerde ein Tippen auf die skalierte Menge die skalierte als neuen
          Rezeptwert speichern. */}
      {anzeigeIngredients.map((ing, i) => (
        <Pressable
          key={i}
          onPress={() => !zeigtUebersetzung && handleOpenIngredientEdit(i)}
          disabled={zeigtUebersetzung}
          style={styles.ingredientRow}
        >
          <Text style={[styles.ingredient, { color: colors.text, fontSize: largeText ? 16.5 : 13.5, flex: 1 }]}>
            {ing.amount ? `${ing.amount} ${ing.unit ?? ''} ` : ''}
            {ing.name}
          </Text>
          {/* Bearbeiten gilt immer dem ORIGINAL. Waehrend die Uebersetzung
              angezeigt wird, waere der Stift eine Falle: Man aenderte
              deutschen Text, waehrend englischer dasteht. */}
          {!zeigtUebersetzung && (
            <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.muted} />
          )}
        </Pressable>
      ))}
    </>
  );
  const blockSchritte = (
    <>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('detail.zubereitung')}</Text>
      {currentSteps.map((step, i) => (
        <View key={step.order} style={[styles.stepCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={[styles.stepNumber, { color: colors.muted }]}>{t('detail.schritt', { nummer: step.order })}</Text>
            <Pressable
              onPress={() => handleOpenStepEdit(i)}
              hitSlop={8}
              disabled={zeigtUebersetzung}
              style={{ opacity: zeigtUebersetzung ? 0 : 1 }}
            >
              <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.muted} />
            </Pressable>
          </View>
          <Text style={[styles.stepText, { color: colors.text, fontSize: largeText ? 17 : 14, lineHeight: largeText ? 25 : 21 }]}>{step.text}</Text>
        </View>
      ))}
    </>
  );
  const blockNotiz = (
    <>
      {recipe.personal_note && (
        <View style={[styles.noteCard, { borderRadius: radius.md }]}>
          <Text style={styles.noteLabel}>{t('detail.deineNotiz')}</Text>
          <Text style={[styles.noteText, { color: colors.text }]}>{recipe.personal_note}</Text>
        </View>
      )}
    </>
  );

  return (
    <>
    {eingebettet && (
      <View style={[styles.eingebetterHeader, { backgroundColor: colors.bg, borderBottomColor: colors.cardBorder }]}>
        <Text style={[styles.eingebetterTitel, { color: colors.text }]} numberOfLines={1}>
          {recipe.title}
        </Text>
        <Pressable onPress={schliessen} hitSlop={10} style={styles.eingebetterSchliessen}>
          <MaterialCommunityIcons name="close" size={18} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 13.5, fontWeight: '600' }}>{t('allgemein.schliessen')}</Text>
        </Pressable>
      </View>
    )}
    {istTablet ? (
      // Tablet: zwei unabhaengig scrollende Spalten, links 40 % (Foto,
      // Portionen, Zutaten), rechts 60 % (Titel, Zubereitung, Aktionen).
      // flexBasis:0 ist noetig, weil ScrollView sonst flexGrow:1 mitbringt
      // und die Spalten nicht im Verhaeltnis 4:6 aufteilt.
      <View style={[styles.tabletReihe, { backgroundColor: colors.bg }]}>
        <ScrollView style={styles.tabletLinks} contentContainerStyle={styles.tabletSpalteInhalt}>
          {blockHero}
          {blockPortionen}
          {blockAusruestung}
          {blockZutaten}
        </ScrollView>
        <ScrollView
          style={[styles.tabletRechts, { borderLeftColor: colors.cardBorder }]}
          contentContainerStyle={styles.tabletSpalteInhalt}
        >
          <View style={styles.tabletLesespalte}>
            {blockTitel}
            {blockUebersetzung}
            {blockSchritte}
            {blockNotiz}
            {blockAktionen}
            {blockBeilagen}
            {blockNaehrwerte}
          </View>
        </ScrollView>
      </View>
    ) : (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.container, inhaltsBreiteZweispaltig]}>
      {blockHero}
      {blockTitel}
      {blockPortionen}
      {blockAusruestung}
      {blockAktionen}
      {blockBeilagen}
      {blockUebersetzung}
      {blockNaehrwerte}
      {blockZutaten}
      {blockSchritte}
      {blockNotiz}
    </ScrollView>
    )}

    {/* Vorschau des ueberarbeiteten Rezepts - gespeichert wird erst auf
        ausdruecklichen Knopfdruck, siehe handleEntwurfSpeichern. */}
    <Modal visible={!!entwurf} animationType="slide" onRequestClose={() => setEntwurf(null)}>
      <View style={[styles.pickerContainer, { backgroundColor: colors.bg }]}>
        <View style={styles.pickerHeader}>
          <Text style={[styles.pickerTitle, { color: colors.text }]}>{t('detail.einarbeitenTitel')}</Text>
          <Pressable onPress={() => setEntwurf(null)} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 14 }}>{t('detail.einarbeitenHinweis')}</Text>

          {!!entwurf?.changes.length && (
            <View style={[styles.noteCard, { borderRadius: radius.sm, marginBottom: 16, marginTop: 0 }]}>
              <Text style={styles.noteLabel}>{t('detail.einarbeitenGeaendert')}</Text>
              {entwurf.changes.map((c, i) => (
                <Text key={i} style={[styles.noteText, { color: colors.text }]}>{'\u2022 ' + c}</Text>
              ))}
            </View>
          )}

          <Text style={[styles.sidesTitle, { color: colors.text, marginBottom: 6 }]}>{t('detail.einarbeitenZutaten')}</Text>
          {entwurf?.ingredients.map((z, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 14, marginBottom: 3 }}>
              {z.amount ? `${z.amount} ${z.unit ?? ''} ` : ''}{z.name}
            </Text>
          ))}

          <Text style={[styles.sidesTitle, { color: colors.text, marginTop: 18, marginBottom: 6 }]}>{t('detail.einarbeitenSchritte')}</Text>
          {entwurf?.steps.map((st, i) => (
            <Text key={i} style={{ color: colors.text, fontSize: 14, lineHeight: 21, marginBottom: 8 }}>
              {`${st.order}. ${st.text}`}
            </Text>
          ))}

          <Pressable
            onPress={handleEntwurfSpeichern}
            disabled={isApplyingSuggestions}
            style={[styles.reviewButton, { backgroundColor: gradient[0], borderRadius: radius.sm, marginTop: 20 }]}
          >
            {isApplyingSuggestions ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.reviewButtonText}>{t('detail.einarbeitenSpeichern')}</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => setEntwurf(null)}
            style={[styles.secondaryReviewButton, { borderColor: gradient[0], borderRadius: radius.sm }]}
          >
            <Text style={[styles.secondaryReviewButtonText, { color: gradient[0] }]}>{t('detail.einarbeitenVerwerfen')}</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>

    <Modal visible={isPickerOpen} animationType="slide" onRequestClose={() => setIsPickerOpen(false)}>
      <View style={[styles.pickerContainer, { backgroundColor: colors.bg }]}>
        <View style={styles.pickerHeader}>
          <Text style={[styles.pickerTitle, { color: colors.text }]}>{t('detail.alsBeilageWaehlen')}</Text>
          <Pressable onPress={() => setIsPickerOpen(false)} hitSlop={10}>
            <MaterialCommunityIcons name="close" size={24} color={colors.text} />
          </Pressable>
        </View>
        <TextInput
          style={[styles.pickerSearch, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('wochenplan.suchen')}
          placeholderTextColor={colors.muted}
          value={recipeSearch}
          onChangeText={setRecipeSearch}
        />
        {pickerLoading ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : pickerError ? (
          <View style={{ paddingVertical: 30, alignItems: 'center', gap: 14 }}>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center' }}>{pickerError}</Text>
            <Pressable
              onPress={loadPickerRecipes}
              style={[styles.pickerRow, { backgroundColor: colors.card, borderRadius: radius.sm }]}
            >
              <Text style={{ color: gradient[0], fontSize: 13.5, fontWeight: '600' }}>{t('allgemein.erneutVersuchen')}</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            {filteredPickerRecipes.length === 0 ? (
              <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 30, lineHeight: 19 }}>
                {recipeSearch.trim()
                  ? `Kein Rezept mit „${recipeSearch.trim()}" im Titel.`
                  : t('detail.keineWeiterenRezepte')}
              </Text>
            ) : (
              filteredPickerRecipes.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => addManualSide(r)}
                  style={[styles.pickerRow, { backgroundColor: colors.card, borderRadius: radius.sm }]}
                >
                  <Text style={{ color: colors.text, fontSize: 13.5 }}>{r.title}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>

    <Modal visible={isEditingStepIndex !== null} transparent animationType="fade" onRequestClose={() => setIsEditingStepIndex(null)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{t('detail.kochschrittBearbeiten')}</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            value={stepTextDraft}
            onChangeText={setStepTextDraft}
            multiline
            autoFocus
          />
          <View style={[styles.modalButtonRow, { justifyContent: 'space-between' }]}>
            <Pressable onPress={handleDeleteStep} hitSlop={8}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#DC2626" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <Pressable onPress={() => { Keyboard.dismiss(); setIsEditingStepIndex(null); }} style={styles.modalCancelButton}>
                <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveStepEdit}
                disabled={isSavingStepText}
                style={[styles.modalSaveButton, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: isSavingStepText ? 0.7 : 1 }]}
              >
                {isSavingStepText ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>{t('allgemein.speichern')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>

    <Modal visible={editingIngredientIndex !== null} transparent animationType="fade" onRequestClose={() => setEditingIngredientIndex(null)}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
          <Text style={[styles.modalTitle, { color: colors.text }]}>{t('detail.zutatBearbeiten')}</Text>
          <TextInput
            style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginBottom: 8 }]}
            placeholder={t('kochen.name')}
            placeholderTextColor={colors.muted}
            value={ingredientDraft.name}
            onChangeText={(v) => setIngredientDraft((prev) => ({ ...prev, name: v }))}
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.modalInput, { flex: 1, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('kochen.menge')}
              placeholderTextColor={colors.muted}
              keyboardType="numeric"
              value={ingredientDraft.amount}
              onChangeText={(v) => setIngredientDraft((prev) => ({ ...prev, amount: v }))}
            />
            <TextInput
              style={[styles.modalInput, { flex: 1, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('kochen.einheit')}
              placeholderTextColor={colors.muted}
              value={ingredientDraft.unit}
              onChangeText={(v) => setIngredientDraft((prev) => ({ ...prev, unit: v }))}
            />
          </View>
          <View style={[styles.modalButtonRow, { justifyContent: 'space-between' }]}>
            <Pressable onPress={handleDeleteIngredient} hitSlop={8}>
              <MaterialCommunityIcons name="trash-can-outline" size={22} color="#DC2626" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 16, alignItems: 'center' }}>
              <Pressable onPress={() => { Keyboard.dismiss(); setEditingIngredientIndex(null); }} style={styles.modalCancelButton}>
                <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveIngredientEdit}
                disabled={isSavingIngredient}
                style={[styles.modalSaveButton, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: isSavingIngredient ? 0.7 : 1 }]}
              >
                {isSavingIngredient ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>{t('allgemein.speichern')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  eingebetterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: 1 },
  eingebetterTitel: { fontSize: 15.5, fontWeight: '700', flex: 1, marginRight: 12 },
  eingebetterSchliessen: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  modalCard: { padding: 20 },
  modalTitle: { fontSize: 15, fontWeight: '700', marginBottom: 12 },
  modalInput: { minHeight: 44, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center', marginTop: 14 },
  modalCancelButton: { paddingVertical: 8 },
  modalCancelText: { fontSize: 13, fontWeight: '600' },
  modalSaveButton: { paddingHorizontal: 20, paddingVertical: 10 },
  modalSaveText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  container: { padding: 18, paddingBottom: 60 },
  heroImage: { width: '100%', height: 180, marginBottom: 14 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, marginBottom: 20 },
  meta: { fontSize: 12 },
  tabletReihe: { flex: 1, flexDirection: 'row' },
  tabletLinks: { flex: 4, flexBasis: 0 },
  tabletRechts: { flex: 6, flexBasis: 0, borderLeftWidth: StyleSheet.hairlineWidth },
  tabletSpalteInhalt: { padding: 22, paddingBottom: 60 },
  tabletLesespalte: { width: '100%', maxWidth: MAX_INHALTSBREITE },
  sourceHint: { fontSize: 10.5, marginTop: -12, marginBottom: 18 },
  servingsCard: { alignItems: 'center', padding: 16, marginBottom: 14 },
  servingsLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  servingsControlRow: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  servingsButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  servingsValue: { fontSize: 34, fontWeight: '800', minWidth: 50, textAlign: 'center' },
  equipmentCard: { flexDirection: 'row', alignItems: 'flex-start', padding: 12, marginBottom: 12 },
  equipmentText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
  cookButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  sidesCard: { padding: 14, marginBottom: 14 },
  reviewButton: { height: 42, alignItems: 'center', justifyContent: 'center' },
  reviewButtonText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  secondaryReviewButton: { height: 40, alignItems: 'center', justifyContent: 'center', marginTop: 8, borderWidth: 1.5 },
  secondaryReviewButtonText: { fontWeight: '700', fontSize: 12 },
  sidesHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sidesTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, marginBottom: 8 },
  sideTitle: { fontSize: 12.5, fontWeight: '600' },
  sideReason: { fontSize: 10.5, marginTop: 2 },
  searchLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  searchLinkText: { fontSize: 12, fontWeight: '700' },
  pickerContainer: { flex: 1, paddingHorizontal: 18, paddingTop: 60 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 17, fontWeight: '700' },
  pickerSearch: { height: 44, paddingHorizontal: 14, fontSize: 13.5, marginBottom: 14 },
  pickerRow: { padding: 13, marginBottom: 7 },
  shoppingListButton: { flexDirection: 'row', gap: 7, height: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  shoppingListButtonText: { fontSize: 12.5, fontWeight: '700' },
  cookButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 10 },
  ingredient: { fontSize: 13.5, lineHeight: 22 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 2 },
  stepCard: { padding: 14, marginBottom: 10 },
  stepNumber: { fontSize: 10, fontWeight: '600', marginBottom: 4 },
  stepText: { fontSize: 14, lineHeight: 21 },
  noteCard: { backgroundColor: '#FEF3C7', padding: 12, marginTop: 8 },
  noteLabel: { fontSize: 11, fontWeight: '600', color: '#92400E', marginBottom: 3 },
  noteText: { fontSize: 12.5, fontStyle: 'italic' },
});
