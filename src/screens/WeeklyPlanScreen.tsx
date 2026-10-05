import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, Modal, TextInput, Image } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'WeeklyPlan'>;

type MealSlot = 'fruehstueck' | 'mittag' | 'abend';
// Schluessel statt Texte: Die Tabellen werden einmal beim Laden der
// Datei ausgewertet, ein Text darin bliebe fuer immer in der Sprache des
// ersten Starts.
// Sentinel statt eines echten Tag-Namens - kann nie mit einem
// tatsaechlichen Rezept-Tag kollidieren.
const FAVORITEN_FILTER = '__favoriten__';

const MEAL_SLOTS: { key: MealSlot; title: string }[] = [
  { key: 'fruehstueck', title: 'wochenplan.fruehstueck' },
  { key: 'mittag', title: 'wochenplan.mittag' },
  { key: 'abend', title: 'wochenplan.abend' },
];
const WEEKDAY_KEYS = [
  'wochenplan.montag', 'wochenplan.dienstag', 'wochenplan.mittwoch', 'wochenplan.donnerstag',
  'wochenplan.freitag', 'wochenplan.samstag', 'wochenplan.sonntag',
];

interface PlanEntry {
  id: string;
  plan_date: string; // YYYY-MM-DD
  meal_slot: MealSlot;
  recipe_id: string;
  recipe_title: string;
  recipe_cover_image_url: string | null;
  servings: number | null;
  position: number; // 0 = Hauptgericht, 1-2 = Beilage
}

interface RecipeSummary {
  id: string;
  title: string;
  cover_image_url: string | null;
  tags: string[] | null;
  is_favorite: boolean;
  folder_id?: string | null;
}

// Immer dasselbe Gold, unabhaengig von der gewaehlten Akzentfarbe
// (23.09.2026) - derselbe Ton wie die Standard-Akzentfarbe "gelb" im
// Theme (#EAB308), damit der Zauberstab bei jeder Farbwahl gleich aussieht.
const ZAUBERSTAB_GOLD = '#EAB308';

function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatShort(d: Date): string {
  // Von Hand statt toLocaleDateString('de-AT'): Die Datumsformatierung
  // ueber Intl haengt auf Android davon ab, ob die JS-Engine mit vollem
  // ICU gebaut wurde. Fehlt es, faellt sie stillschweigend auf ein
  // amerikanisches Format zurueck - aus 24.12. wird 12/24. Zwei
  // Zeilen selbst gerechnet sind hier verlaesslicher als eine Bibliothek,
  // deren Verhalten je nach Geraet anders ist.
  const tag = String(d.getDate()).padStart(2, '0');
  const monat = String(d.getMonth() + 1).padStart(2, '0');
  return `${tag}.${monat}.`;
}

// Montag der Woche zu einem gegebenen Referenzdatum + Wochen-Offset
function getMondayOfWeek(reference: Date, weekOffset: number): Date {
  const d = new Date(reference);
  d.setDate(d.getDate() + weekOffset * 7);
  const day = d.getDay(); // 0=Sonntag, 1=Montag, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function WeeklyPlanScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { istTablet, inhaltsBreiteZweispaltig } = useLayout();
  const { t } = useUebersetzung();
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries, setEntries] = useState<PlanEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddingToList, setIsAddingToList] = useState(false);
  // 'woche' oder ein dateKey (welcher Tag gerade einen Vorschlag anfordert)
  // - so laesst sich pro Knopf ein eigener Ladezustand anzeigen, ohne
  // fuer jeden der sieben Tage einen eigenen State anzulegen.
  const [vorschlagLaeuft, setVorschlagLaeuft] = useState<string | null>(null);

  const [pickerTarget, setPickerTarget] = useState<{ dateKey: string; slot: MealSlot; position?: number } | null>(null);
  const [allRecipes, setAllRecipes] = useState<RecipeSummary[]>([]);
  const [recipeSearch, setRecipeSearch] = useState('');
  // Kategorie-Filter NUR innerhalb dieses Auswahl-Dialogs - eigener,
  // lokaler Zustand statt Navigations-Parameter wie im normalen
  // Rezepte-Tab, weil der Dialog ja ueber dem Wochenplan schwebt und
  // nicht selbst eine Route ist. Wird beim Schliessen zurueckgesetzt.
  const [pickerKategorie, setPickerKategorie] = useState<string | null>(null);
  // Ordner (Gruppen) wie im Rezepte-Tab (05.10.2026): zusaetzlich zu den Schlagwoertern waehlbar. Gilt nur in diesem Dialog.
  const [pickerOrdner, setPickerOrdner] = useState<string | null>(null);
  const [ordnerListe, setOrdnerListe] = useState<{ id: string; name: string }[]>([]);
  const [defaultServings, setDefaultServings] = useState(4);
  const [servingsInput, setServingsInput] = useState('4');
  const [categoryOrder, setCategoryOrder] = useState<string[] | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);

  useEffect(() => {
    api
      .get<{ default_servings: number; category_order?: string[]; hidden_categories?: string[] }>('/preferences/')
      .then((prefs) => {
        setDefaultServings(prefs.default_servings);
        setCategoryOrder(prefs.category_order ?? []);
        setHiddenCategories(prefs.hidden_categories ?? []);
      })
      .catch(() => {
        // Vorgabe konnte nicht geladen werden - bleibt beim Fallback 4,
        // kein Grund den Wochenplan zu blockieren
      });
  }, []);

  const monday = getMondayOfWeek(new Date(), weekOffset);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    return d;
  });
  const startKey = toDateKey(weekDays[0]);
  const endKey = toDateKey(weekDays[6]);

  const loadWeek = useCallback(() => {
    setIsLoading(true);
    api
      .get<PlanEntry[]>(`/weekly-plan/?start_date=${startKey}&end_date=${endKey}`)
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.detail : t('wochenplan.nichtGeladen')))
      .finally(() => setIsLoading(false));
  }, [startKey, endKey]);

  useEffect(() => {
    loadWeek();
  }, [loadWeek]);

  // Welche Mahlzeiten ihre Beilagen-Zeilen zeigen. Eingeklappt sieht man
  // nur das Hauptgericht - bei sieben Tagen mal drei Mahlzeiten mal drei
  // Zeilen waeren es sonst 63 Zeilen auf einem Handy-Bildschirm, und die
  // allermeisten davon leer.
  const [expandedSlots, setExpandedSlots] = useState<Record<string, boolean>>({});
  const slotKey = (dateKey: string, slot: MealSlot) => `${dateKey}|${slot}`;

  const openPicker = (dateKey: string, slot: MealSlot, position?: number) => {
    setPickerTarget({ dateKey, slot, position });
    setRecipeSearch('');
    setServingsInput(String(defaultServings));
    if (allRecipes.length === 0) {
      api.get<RecipeSummary[]>('/recipes/').then(setAllRecipes).catch(() => {});
    }
    api.get<{ id: string; name: string }[]>('/folders/').then(setOrdnerListe).catch(() => {});
  };

  const assignRecipe = async (recipeId: string) => {
    if (!pickerTarget) return;
    const servings = servingsInput.trim() ? Number(servingsInput.trim()) : null;
    try {
      await api.post('/weekly-plan/', {
        plan_date: pickerTarget.dateKey,
        meal_slot: pickerTarget.slot,
        recipe_id: recipeId,
        servings,
        // Ohne Position sucht das Backend den naechsten freien Platz.
        position: pickerTarget.position ?? null,
      });
      setPickerTarget(null);
      loadWeek();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('wochenplan.nichtZugewiesen'));
    }
  };

  const removeEntry = (entryId: string) => {
    Alert.alert(t('wochenplan.entfernenFrage'), t('wochenplan.entfernenText'), [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      {
        text: t('allgemein.entfernen'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/weekly-plan/${entryId}`);
            loadWeek();
          } catch (err) {
            Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('wochenplan.nichtEntfernt'));
          }
        },
      },
    ]);
  };

  // Alles auf einmal entfernen (23.09.2026) - z.B. um einen Essensvorschlag
  // komplett zu verwerfen, statt jeden Platz einzeln per X. Betrifft ALLE
  // Eintraege der sichtbaren Woche (Haupt- UND Beilagen), nicht nur die,
  // die gerade per Vorschlag entstanden sind - "der ganzen Woche
  // gesamten Vorschlag stornieren" unterscheidet nicht nach Herkunft.
  const leereWoche = () => {
    if (entries.length === 0) return;
    Alert.alert(t('wochenplan.wocheLeerenFrage'), t('wochenplan.wocheLeerenText'), [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      {
        text: t('wochenplan.wocheLeeren'),
        style: 'destructive',
        onPress: async () => {
          try {
            await Promise.all(entries.map((e) => api.delete(`/weekly-plan/${e.id}`)));
            loadWeek();
          } catch (err) {
            Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('wochenplan.nichtEntfernt'));
          }
        },
      },
    ]);
  };

  const handleAddWeekToShoppingList = () => {
    if (entries.length === 0) {
      Alert.alert(t('wochenplan.nochLeer'), t('wochenplan.keinRezeptGeplant'));
      return;
    }
    Alert.alert(
      t('wochenplan.zurListeFrage'),
      t('wochenplan.zurListeText'),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('wochenplan.hinzufuegen'),
          onPress: async () => {
            setIsAddingToList(true);
            try {
              const result = await api.post<{ recipes_count: number }>('/weekly-plan/add-to-shopping-list', {
                start_date: startKey,
                end_date: endKey,
              });
              Alert.alert(t('wochenplan.erledigt'), t('wochenplan.erledigtText', { anzahl: result.recipes_count }));
            } catch (err) {
              Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('wochenplan.nichtHinzugefuegt'));
            } finally {
              setIsAddingToList(false);
            }
          },
        },
      ],
    );
  };

  // Alle Eintraege eines Slots, nach Position sortiert: Hauptgericht
  // zuerst, Beilagen darunter.
  const entriesFor = (dateKey: string, slot: MealSlot) =>
    entries
      .filter((e) => e.plan_date === dateKey && e.meal_slot === slot)
      .sort((a, b) => a.position - b.position);

  // Fuellt nur LEERE Hauptgericht-Plaetze - das macht der Server ohnehin
  // schon so (siehe /ai/suggest-week-plan), diese Funktion ruft ihn nur
  // fuer den richtigen Zeitraum auf.
  const holeVorschlag = async (kennung: string, von: string, bis: string, mahlzeiten: string[], kategorie: string | null) => {
    setVorschlagLaeuft(kennung);
    try {
      const res = await api.post<{ filled: unknown[]; empty_slots_found: number }>(
        '/ai/suggest-week-plan',
        { start_date: von, end_date: bis, mahlzeiten, kategorie },
      );
      if (res.empty_slots_found === 0) {
        Alert.alert(t('wochenplan.vorschlagTitel'), t('wochenplan.bereitsVollText'));
        return;
      }
      if (res.filled.length === 0) {
        Alert.alert(t('wochenplan.vorschlagTitel'), t('wochenplan.keinVorschlagText'));
        return;
      }
      await loadWeek();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('wochenplan.vorschlagFehlgeschlagen'));
    } finally {
      setVorschlagLaeuft(null);
    }
  };

  // Dialog VOR der Generierung (23.09.2026): frueher wurden immer alle
  // drei Mahlzeiten gefuellt, ohne zu fragen. "kennung" traegt weiter,
  // ob es der Wochen- oder ein Tages-Knopf war (fuer den Ladezustand am
  // jeweiligen Knopf), "von"/"bis" den Zeitraum.
  const [vorschlagDialog, setVorschlagDialog] = useState<{ kennung: string; von: string; bis: string } | null>(null);
  // Leer statt "alle drei vormarkiert" (23.09.2026) - bei mehreren
  // Optionen soll aktiv ausgewaehlt werden, nicht abgewaehlt. Nur bei
  // GENAU EINER Option (hier: nie der Fall, es gibt immer drei
  // Mahlzeiten zur Wahl) waere eine Vormarkierung die Ausnahme.
  const [dialogMahlzeiten, setDialogMahlzeiten] = useState<Set<string>>(new Set());
  const [dialogKategorie, setDialogKategorie] = useState<string | null>(null);
  const dialogKategorien = Array.from(new Set(allRecipes.flatMap((r) => r.tags ?? []))).sort((a, b) =>
    a.localeCompare(b, 'de'),
  );

  const oeffneVorschlagDialog = (kennung: string, von: string, bis: string) => {
    setDialogMahlzeiten(new Set());
    setDialogKategorie(null);
    setVorschlagDialog({ kennung, von, bis });
  };

  const bestaetigeVorschlagDialog = () => {
    if (!vorschlagDialog) return;
    if (dialogMahlzeiten.size === 0) {
      Alert.alert(t('wochenplan.keineMahlzeitMarkiert'), t('wochenplan.keineMahlzeitMarkiertText'));
      return;
    }
    const { kennung, von, bis } = vorschlagDialog;
    setVorschlagDialog(null);
    holeVorschlag(kennung, von, bis, Array.from(dialogMahlzeiten), dialogKategorie);
  };

  // Dieselbe Reihenfolge wie im Dashboard (23.09.2026, vorher rein
  // alphabetisch): erst die vom Nutzer selbst festgelegte Reihenfolge
  // (ManageCategoriesScreen), dann der Rest nach Haeufigkeit - und wie
  // dort eine feste "Favoriten"-Kachel vorneweg, kein echter Tag.
  const pickerKategorien = (() => {
    const counts = new Map<string, number>();
    allRecipes.forEach((r) => (r.tags ?? []).forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
    const versteckt = new Set(hiddenCategories);
    const eingeordnet = new Set(categoryOrder ?? []);
    const festeReihenfolge = (categoryOrder ?? []).filter((tag) => counts.has(tag) && !versteckt.has(tag));
    const restKandidaten = Array.from(counts.keys()).filter((tag) => !eingeordnet.has(tag) && !versteckt.has(tag));
    const nachHaeufigkeit = restKandidaten.sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b, 'de');
    });
    return [...festeReihenfolge, ...nachHaeufigkeit];
  })();
  const filteredRecipes = allRecipes
    .filter((r) => !pickerOrdner || r.folder_id === pickerOrdner)
    .filter((r) => !recipeSearch.trim() || r.title.toLowerCase().includes(recipeSearch.trim().toLowerCase()))
    .filter((r) => {
      if (!pickerKategorie) return true;
      if (pickerKategorie === FAVORITEN_FILTER) return r.is_favorite;
      return r.tags?.includes(pickerKategorie);
    });

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.weekNav}>
        <Pressable onPress={() => setWeekOffset((w) => w - 1)} hitSlop={10}>
          <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text} />
        </Pressable>
        <Text style={[styles.weekLabel, { color: colors.text }]}>
          {weekOffset === 0 ? t('wochenplan.dieseWoche') : formatShort(weekDays[0]) + ' – ' + formatShort(weekDays[6])}
        </Text>
        <Pressable onPress={() => setWeekOffset((w) => w + 1)} hitSlop={10}>
          <MaterialCommunityIcons name="chevron-right" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={() => oeffneVorschlagDialog('woche', startKey, endKey)}
          disabled={vorschlagLaeuft !== null}
          style={[
            styles.addAllButton,
            { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, opacity: vorschlagLaeuft !== null ? 0.7 : 1 },
          ]}
        >
          {vorschlagLaeuft === 'woche' ? (
            <ActivityIndicator color={ZAUBERSTAB_GOLD} size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="auto-fix" size={16} color={ZAUBERSTAB_GOLD} />
              <Text style={[styles.addAllButtonText, { color: ZAUBERSTAB_GOLD }]}>{t('wochenplan.wocheVorschlagen')}</Text>
            </>
          )}
        </Pressable>
        <Pressable
          onPress={handleAddWeekToShoppingList}
          disabled={isAddingToList}
          style={[styles.addAllButton, { flex: 1, backgroundColor: gradient[0], borderRadius: radius.md, opacity: isAddingToList ? 0.7 : 1 }]}
        >
          {isAddingToList ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="cart-plus" size={16} color="#fff" />
              <Text style={styles.addAllButtonText}>{t('wochenplan.zutatenDerWoche')}</Text>
            </>
          )}
        </Pressable>
        {/* Kompakt statt flex:1 wie die anderen beiden - eine seltene,
            zerstoerende Aktion muss nicht gleich viel Platz beanspruchen
            wie die beiden Hauptknoepfe (23.09.2026). */}
        <Pressable
          onPress={leereWoche}
          disabled={entries.length === 0}
          accessibilityLabel={t('wochenplan.wocheLeeren')}
          style={[
            styles.addAllButton,
            { width: 44, backgroundColor: colors.card, borderRadius: radius.md, opacity: entries.length === 0 ? 0.4 : 1 },
          ]}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C0392B" />
        </Pressable>
      </View>

      {error && <Text style={{ color: '#DC2626', fontSize: 12, marginTop: 10 }}>{error}</Text>}

      {isLoading ? (
        <ActivityIndicator color={colors.text} style={{ marginTop: 30 }} />
      ) : (
        <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" contentContainerStyle={[{ paddingBottom: 40, paddingTop: 4 }, inhaltsBreiteZweispaltig]}>
          {/* Auf dem Tablet zwei Tage nebeneinander statt sieben
              untereinander: Ein Wochenplan will als Woche gelesen werden,
              nicht als Liste. Umbruch statt fester Spalten, damit das
              Querformat automatisch mehr Platz nutzt. */}
          <View style={istTablet ? styles.tageRaster : undefined}>
          {weekDays.map((day, i) => {
            const dateKey = toDateKey(day);
            const isToday = toDateKey(new Date()) === dateKey;
            return (
              <View key={dateKey} style={[styles.daySection, istTablet && styles.tagInSpalte]}>
                <View style={styles.dayLabelRow}>
                  <Text style={[styles.dayLabel, { color: isToday ? gradient[0] : colors.text }]}>
                    {t(WEEKDAY_KEYS[i])}, {formatShort(day)}
                  </Text>
                  <Pressable
                    onPress={() => oeffneVorschlagDialog(dateKey, dateKey, dateKey)}
                    disabled={vorschlagLaeuft !== null}
                    hitSlop={8}
                    style={{ opacity: vorschlagLaeuft !== null ? 0.5 : 1 }}
                  >
                    {vorschlagLaeuft === dateKey ? (
                      <ActivityIndicator color={ZAUBERSTAB_GOLD} size="small" />
                    ) : (
                      <MaterialCommunityIcons name="auto-fix" size={17} color={ZAUBERSTAB_GOLD} />
                    )}
                  </Pressable>
                </View>
                {MEAL_SLOTS.map((slot) => {
                  const slotEntries = entriesFor(dateKey, slot.key);
                  const haupt = slotEntries.find((e) => e.position === 0);
                  const beilagen = slotEntries.filter((e) => e.position > 0);
                  const key = slotKey(dateKey, slot.key);
                  // Automatisch offen, sobald Beilagen da sind - sonst
                  // waeren sie unsichtbar und man wuerde sie erneut
                  // hinzufuegen.
                  const offen = expandedSlots[key] ?? beilagen.length > 0;

                  return (
                    <View key={slot.key} style={{ marginBottom: 6 }}>
                      <Pressable
                        onPress={() =>
                          haupt
                            ? navigation.navigate('RecipeDetail', { recipeId: haupt.recipe_id, title: haupt.recipe_title })
                            : openPicker(dateKey, slot.key, 0)
                        }
                        onLongPress={() => openPicker(dateKey, slot.key, 0)}
                        style={[styles.slotRow, { backgroundColor: colors.card, borderRadius: radius.sm, marginBottom: 0 }]}
                      >
                        <Text style={[styles.slotLabel, { color: colors.muted }]}>{t(slot.title)}</Text>
                        {haupt ? (
                          <View style={styles.slotFilled}>
                            <Text style={[styles.slotRecipeTitle, { color: colors.text }]} numberOfLines={1}>
                              {haupt.recipe_title}
                              {haupt.servings ? ` · ${haupt.servings} Port.` : ''}
                            </Text>
                            {/* Eigener Pressable statt Teil der Zeile: Antippen des
                                Rezepts soll zur Rezeptansicht fuehren (23.09.2026,
                                vorher entfernte ein Tipp den Eintrag sofort wieder -
                                man musste das Rezept fuer den Koch-Modus jedes Mal
                                neu suchen). Entfernen jetzt gezielt ueber das X,
                                Rezept wechseln weiterhin per langem Druck. */}
                            <Pressable onPress={() => removeEntry(haupt.id)} hitSlop={8}>
                              <MaterialCommunityIcons name="close-circle-outline" size={16} color={colors.muted} />
                            </Pressable>
                          </View>
                        ) : (
                          <Text style={[styles.slotEmpty, { color: gradient[0] }]}>+ Rezept wählen</Text>
                        )}
                      </Pressable>

                      {/* Beilagen nur, wenn es ein Hauptgericht gibt -
                          eine Beilage ohne Gericht ergibt keinen Sinn und
                          wuerde die Ansicht mit leeren Zeilen fluten. */}
                      {haupt && (
                        <>
                          {offen &&
                            beilagen.map((b) => (
                              <Pressable
                                key={b.id}
                                onPress={() => removeEntry(b.id)}
                                style={[styles.sideRow, { backgroundColor: colors.card, borderRadius: radius.sm }]}
                              >
                                <Text style={[styles.sideBullet, { color: colors.muted }]}>↳</Text>
                                <Text style={[styles.slotRecipeTitle, { color: colors.text, flex: 1 }]} numberOfLines={1}>
                                  {b.recipe_title}
                                </Text>
                                <MaterialCommunityIcons name="close-circle-outline" size={15} color={colors.muted} />
                              </Pressable>
                            ))}

                          <Pressable
                            onPress={() => {
                              if (!offen) {
                                setExpandedSlots((prev) => ({ ...prev, [key]: true }));
                                return;
                              }
                              if (beilagen.length >= 2) {
                                Alert.alert(t('wochenplan.voll'), t('wochenplan.maxZweiBeilagen'));
                                return;
                              }
                              openPicker(dateKey, slot.key);
                            }}
                            style={styles.sideToggle}
                          >
                            <Text style={{ color: gradient[0], fontSize: 11.5, fontWeight: '600' }}>
                              {!offen
                                ? '+ Beilage'
                                : beilagen.length >= 2
                                  ? t('wochenplan.beilagenVoll')
                                  : `+ Beilage (${beilagen.length} von 2)`}
                            </Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          })}
          </View>
        </ScrollView>
      )}

      <Modal visible={pickerTarget !== null} animationType="slide" onRequestClose={() => setPickerTarget(null)}>
        <View style={[styles.pickerContainer, { backgroundColor: colors.bg }]}>
          <View style={styles.pickerHeader}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>{t('wochenplan.rezeptWaehlen')}</Text>
            <Pressable
              onPress={() => {
                setPickerTarget(null);
                setPickerKategorie(null);
                setPickerOrdner(null);
                setPickerOrdner(null);
              }}
              hitSlop={10}
            >
              <MaterialCommunityIcons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.servingsRow}>
            <Text style={{ color: colors.muted, fontSize: 12.5 }}>{t('wochenplan.portionen')}</Text>
            <TextInput
              value={servingsInput}
              onChangeText={setServingsInput}
              keyboardType="numeric"
              style={[styles.servingsInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.sm }]}
            />
          </View>
          <TextInput
            style={[styles.pickerSearch, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            placeholder={t('wochenplan.suchen')}
            placeholderTextColor={colors.muted}
            value={recipeSearch}
            onChangeText={setRecipeSearch}
          />
          {ordnerListe.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 8, alignItems: 'center' }}
              style={styles.pickerKategorienBar}
            >
              <Pressable
                onPress={() => setPickerOrdner(null)}
                style={[styles.pickerChip, { backgroundColor: !pickerOrdner ? gradient[0] : colors.card, borderRadius: radius.sm }]}
              >
                <Text style={{ color: !pickerOrdner ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                  {t('rezepte.alle')} ({allRecipes.length})
                </Text>
              </Pressable>
              {ordnerListe.map((ordner) => {
                const aktiv = pickerOrdner === ordner.id;
                const anzahl = allRecipes.filter((r) => r.folder_id === ordner.id).length;
                return (
                  <Pressable
                    key={ordner.id}
                    onPress={() => setPickerOrdner(aktiv ? null : ordner.id)}
                    style={[styles.pickerChip, { backgroundColor: aktiv ? gradient[0] : colors.card, borderRadius: radius.sm }]}
                  >
                    <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                      {ordner.name} ({anzahl})
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, alignItems: 'center' }}
            style={styles.pickerKategorienBar}
          >
            <Pressable
              onPress={() => setPickerKategorie(pickerKategorie === FAVORITEN_FILTER ? null : FAVORITEN_FILTER)}
              style={[
                styles.pickerChip,
                { backgroundColor: pickerKategorie === FAVORITEN_FILTER ? gradient[0] : colors.card, borderRadius: radius.sm },
              ]}
            >
              <MaterialCommunityIcons
                name="heart"
                size={13}
                color={pickerKategorie === FAVORITEN_FILTER ? '#fff' : gradient[0]}
                style={{ marginRight: 5 }}
              />
              <Text style={{ color: pickerKategorie === FAVORITEN_FILTER ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                {t('dashboard.favoriten')}
              </Text>
            </Pressable>
            {pickerKategorien.map((kat) => {
              const aktiv = pickerKategorie === kat;
              return (
                <Pressable
                  key={kat}
                  onPress={() => setPickerKategorie(aktiv ? null : kat)}
                  style={[styles.pickerChip, { backgroundColor: aktiv ? gradient[0] : colors.card, borderRadius: radius.sm }]}
                >
                  <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>{kat}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <ScrollView>
            {filteredRecipes.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => assignRecipe(r.id)}
                style={[styles.pickerRow, { backgroundColor: colors.card, borderRadius: radius.sm }]}
              >
                {r.cover_image_url ? (
                  <Image source={{ uri: r.cover_image_url }} style={[styles.pickerThumb, { borderRadius: radius.sm }]} />
                ) : (
                  <View style={[styles.pickerThumb, styles.pickerThumbPlatzhalter, { borderRadius: radius.sm, backgroundColor: colors.bg }]}>
                    <MaterialCommunityIcons name="silverware-fork-knife" size={16} color={colors.muted} />
                  </View>
                )}
                <Text style={{ color: colors.text, fontSize: 13.5, flex: 1 }}>{r.title}</Text>
              </Pressable>
            ))}
            {filteredRecipes.length === 0 && (
              <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center', marginTop: 30 }}>
                Keine Rezepte gefunden.
              </Text>
            )}
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={!!vorschlagDialog} transparent animationType="fade" onRequestClose={() => setVorschlagDialog(null)}>
        <View style={styles.modalUeberlagerung}>
          <View style={[styles.dialogKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.pickerTitle, { color: colors.text }]}>{t('wochenplan.vorschlagTitel')}</Text>
              <Pressable onPress={() => setVorschlagDialog(null)} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={24} color={colors.text} />
              </Pressable>
            </View>

            <Text style={[styles.dialogLabel, { color: colors.muted }]}>{t('wochenplan.fuerWelcheMahlzeiten')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {MEAL_SLOTS.map((slot) => {
                const aktiv = dialogMahlzeiten.has(slot.key);
                return (
                  <Pressable
                    key={slot.key}
                    onPress={() =>
                      setDialogMahlzeiten((prev) => {
                        const naechste = new Set(prev);
                        if (naechste.has(slot.key)) naechste.delete(slot.key);
                        else naechste.add(slot.key);
                        return naechste;
                      })
                    }
                    style={[
                      styles.mahlzeitChip,
                      { backgroundColor: aktiv ? gradient[0] : colors.bg, borderRadius: radius.sm },
                    ]}
                  >
                    <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                      {t(slot.title)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {dialogKategorien.length > 0 && (
              <>
                <Text style={[styles.dialogLabel, { color: colors.muted }]}>{t('wochenplan.kategorieOptional')}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ gap: 8, alignItems: 'center' }}
                  style={styles.pickerKategorienBar}
                >
                  <Pressable
                    onPress={() => setDialogKategorie(null)}
                    style={[styles.pickerChip, { backgroundColor: !dialogKategorie ? gradient[0] : colors.bg, borderRadius: radius.sm }]}
                  >
                    <Text style={{ color: !dialogKategorie ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                      {t('wochenplan.alleKategorien')}
                    </Text>
                  </Pressable>
                  {dialogKategorien.map((kat) => {
                    const aktiv = dialogKategorie === kat;
                    return (
                      <Pressable
                        key={kat}
                        onPress={() => setDialogKategorie(aktiv ? null : kat)}
                        style={[styles.pickerChip, { backgroundColor: aktiv ? gradient[0] : colors.bg, borderRadius: radius.sm }]}
                      >
                        <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>{kat}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </>
            )}

            <Pressable
              onPress={bestaetigeVorschlagDialog}
              style={[
                styles.dialogBestaetigen,
                { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: dialogMahlzeiten.size === 0 ? 0.5 : 1 },
              ]}
            >
              <MaterialCommunityIcons name="auto-fix" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700' }}>{t('wochenplan.vorschlagenKnopf')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 12 },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  weekLabel: { fontSize: 15, fontWeight: '700' },
  // marginBottom, damit die erste Zeile des Montags nicht direkt unter
  // dem Knopf klebt und angeschnitten wirkt.
  addAllButton: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingVertical: 8, paddingHorizontal: 6, marginBottom: 12 },
  addAllButtonText: { color: '#fff', fontWeight: '700', fontSize: 12.5, flexShrink: 1, textAlign: 'center' },
  tageRaster: { flexDirection: 'row', flexWrap: 'wrap', gap: 18 },
  // Knapp unter der Haelfte, damit der Abstand dazwischen Platz hat.
  tagInSpalte: { width: '47%' },
  daySection: { marginBottom: 18 },
  dayLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dayLabel: { fontSize: 13.5, fontWeight: '700' },
  slotRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 11, marginBottom: 6 },
  // flexShrink 0 ist hier der entscheidende Teil, nicht die Breite: In
  // einer Flex-Zeile darf ein Element standardmaessig unter seine
  // angegebene Breite schrumpfen, wenn rechts daneben Platz gebraucht
  // wird. React Native bricht dann INNERHALB des Wortes um - aus
  // "Fruehstueck" wurde "Fruehstuec / k". Feste Breite statt flex, damit
  // die drei Labels buendig untereinander stehen; "Mittag" und "Abend"
  // sind kuerzer und ruecken sonst unterschiedlich weit ein.
  slotLabel: { fontSize: 11, fontWeight: '600', width: 82, flexShrink: 0 },
  slotFilled: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  slotRecipeTitle: { fontSize: 13, fontWeight: '600', flex: 1 },
  slotEmpty: { fontSize: 12, fontWeight: '600' },
  // Beilagen ruecken ein und sind etwas flacher als das Hauptgericht -
  // so ist die Zugehoerigkeit auf einen Blick erkennbar, ohne dass es
  // eine Ueberschrift dafuer braucht.
  sideRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 22, marginTop: 4, paddingHorizontal: 12, paddingVertical: 8 },
  sideBullet: { fontSize: 12 },
  sideToggle: { marginLeft: 22, marginTop: 5, paddingVertical: 4 },
  pickerContainer: { flex: 1, paddingHorizontal: 18, paddingTop: 60 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  pickerTitle: { fontSize: 17, fontWeight: '700' },
  pickerSearch: { height: 44, paddingHorizontal: 14, fontSize: 13.5, marginBottom: 14 },
  servingsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  servingsInput: { width: 60, height: 38, paddingHorizontal: 10, fontSize: 13.5, textAlign: 'center' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginBottom: 7 },
  pickerThumb: { width: 42, height: 42 },
  pickerThumbPlatzhalter: { alignItems: 'center', justifyContent: 'center' },
  pickerChip: { height: 38, paddingHorizontal: 13, justifyContent: 'center', alignItems: 'center' },
  // height + flexShrink: 0 sind der entscheidende Teil (23.09.2026) - ohne
  // beides quetscht das umgebende Layout diese Zeile auf fast nichts
  // zusammen, genau der Fehler, der im normalen Rezepte-Tab (categoryBar)
  // schon einmal aufgetreten und dort so geloest worden war.
  pickerKategorienBar: { height: 50, marginBottom: 10, flexGrow: 0, flexShrink: 0 },
  modalUeberlagerung: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  dialogKarte: { padding: 20 },
  dialogLabel: { fontSize: 11.5, fontWeight: '600', marginBottom: 8, marginTop: 2 },
  mahlzeitChip: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center' },
  dialogBestaetigen: { flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', height: 46, marginTop: 6 },
});
