import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Modal, TextInput, Linking, Alert, ScrollView, Keyboard } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Speech from 'expo-speech';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLayout } from '../utils/layout';
import { SPEECH_LANGUAGE, BRUTZEL_PITCH, BRUTZEL_RATE, loadBrutzelVoice, vorleserStimme } from '../utils/speech';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import TranslationBanner from './TranslationBanner';
import { api, ApiError } from '../api/client';
import { mitStufenHinweis } from '../utils/stufenHinweis';
import { zutatenImSchritt } from '../utils/schrittZutaten';
import { schritteInhaltGeaendert, pickStepsForLevel, feldFuerStufe, FORTGESCHRITTEN_MIN_SCHRITTE, HaubenLevel, RecipeStep, StufenFeld } from '../utils/stepLevels';
import { scheduleTimerNotification, cancelTimerNotification, setupNotificationChannel } from '../utils/notifications';
import BrutzelAvatar from './BrutzelAvatar';

interface Ingredient {
  name: string;
  amount: number | null;
  unit: string | null;
}

interface RecipeForCooking {
  id: string;
  title: string;
  servings: number | null;
  ingredients: Ingredient[];
  steps: RecipeStep[];
  steps_anfaenger?: RecipeStep[] | null;
  steps_profi?: RecipeStep[] | null;
  steps_fortgeschritten?: RecipeStep[] | null;
  locale?: string | null;
  available_translations?: string[];
}

const HAT_COUNT_TO_LEVEL: Record<number, HaubenLevel> = { 1: 'anfaenger', 2: 'fortgeschritten', 3: 'profi' };

// Nur der erste Buchstabe gross, nicht jedes Wort (z.B. "zwiebel_schneiden"
// -> "Zwiebel schneiden", nicht "Zwiebel Schneiden") - vorher erledigte das
// textTransform: 'capitalize' in CSS, das aber JEDES Wort grossschreibt.
function capitalizeFirst(text: string): string {
  return text.length ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Fallback fuer Schritte OHNE fest hinterlegtes timer_seconds (betrifft
// alle KI-generierten/importierten/manuell getippten Rezepte - nur die
// 51 Starter-Rezepte haben das Feld von Hand gesetzt). Erkennt Zeitangaben
// direkt im Schritt-Text ("20 Minuten", "2 Stunden", "25-30 Min.") und
// leitet daraus einen Timer ab - aber erst AB 2 MINUTEN, wie gewuenscht,
// damit nicht jede beilaeufige Erwaehnung ("kurz anbraten, 1 Minute") einen
// Timer aufploppen laesst.
function parseDurationSecondsFromText(text: string): number | null {
  const rangeMatch = text.match(/(\d+)\s*[-–]\s*(\d+)\s*(Minuten|Min\.?|Stunden|Std\.?)/i);
  const singleMatch = !rangeMatch ? text.match(/(\d+)\s*(Minuten|Min\.?|Stunden|Std\.?)/i) : null;
  const match = rangeMatch ?? singleMatch;
  if (!match) return null;

  const isHours = /Stunden|Std/i.test(match[match.length - 1]);
  let value: number;
  if (rangeMatch) {
    // Bei einer Spanne (z.B. "25-30 Minuten") den Mittelwert nehmen -
    // repraesentativer als nur die untere oder obere Grenze.
    value = (Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2;
  } else {
    value = Number(match[1]);
  }
  const seconds = isHours ? value * 3600 : value * 60;
  return seconds >= 120 ? Math.round(seconds) : null;
}

export function getEffectiveTimerSeconds(step: { timer_seconds?: number | null; text: string }): number | null {
  return step.timer_seconds ?? parseDurationSecondsFromText(step.text);
}

// Ersatztipps, wenn die KI keine liefert (abgeschaltet oder nicht
// erreichbar). Die Texte stehen in den Sprachdateien unter
// kochen.tipp bzw. kochen.tippAllgemein - hier nur noch die
// Schluessel, sonst waeren sie fuer immer deutsch.
const BRUTZEL_TIP_KEYS: string[] = [
  'mehlieren',
  'zwiebel_schneiden',
  'koecheln_lassen',
  'apfel_schaelen',
  'filetieren',
  'germteig_gehen_lassen',
  'knoblauch_schaelen',
  'palatschinken_wenden',
  'risotto_ruehren',
  'ruehrteig_unterheben',
  'schnitzel_klopfen',
  'schwarte_einschneiden',
  'teig_kneten',
  'eiweiss_schlagen',
  'strudelteig_ausziehen',
];

const GENERIC_TIP_COUNT = 5;
// Eigener, kleiner Pool NUR fuer den letzten Schritt ohne eigenen KI-Tipp
// und ohne Technik-Tag: die 5 allgemeinen Tipps oben drehen sich um
// Vorbereitung und aktives Kochen (Pfanne vorheizen, Schneidebrett
// wischen, ...) - keiner passt zu einem Servier-/Abschlussschritt. Ohne
// diese Sonderbehandlung landete der letzte Schritt haargenau auf
// demselben Tipp wie der erste (Index % 5 ist bei 5 Schritten Abstand
// identisch), sichtbar z.B. bei jedem 6-Schritte-Rezept: "Mise en
// Place" bei Schritt 1 UND Schritt 6.
const GENERIC_CLOSING_TIP_COUNT = 3;

interface TechniqueVideoInfo {
  keyword: string;
  title: string;
  youtube_video_id: string | null;
  available: boolean;
}

interface Props {
  recipeId: string;
  isActive: boolean; // steuert Sichtbarkeit, OHNE die Komponente zu unmounten -
  // laufende Timer der inaktiven Tabs sollen weiterlaufen (siehe Konzept:
  // "Timer laeuft im Hintergrund, waehrend am anderen Rezept gearbeitet wird")
  onTitleLoaded?: (title: string) => void;
  // completed=true: alle Schritte tatsaechlich durchlaufen (Feier + "als
  // zubereitet markieren" sollen ausgeloest werden). completed=false: am
  // ersten Schritt "Zurueck" gedrueckt, d.h. der Kochvorgang wird
  // abgebrochen/verlassen - dann NICHT als zubereitet markieren und keine
  // Guten-Appetit-Feier zeigen (war zuvor ein Bug: beides rief denselben
  // Callback ohne Unterscheidung auf).
  onFinished: (completed: boolean) => void; // vom Elternteil gesteuert statt navigation.goBack(),
  // da mehrere Tabs sich nicht jeweils eigenstaendig "zurueck" navigieren sollen
  // "Nur fuer diesen Kochvorgang" uebernommene Aenderungen aus dem Rezept-
  // Detail (VOR dem Kochstart bearbeitet, siehe RecipeDetailScreen) - werden
  // NACH dem Laden ueber das Rezept vom Server gelegt, nie gespeichert.
  sessionOverrides?: { ingredients?: Ingredient[]; steps?: RecipeStep[] };
  // Portionenzahl, wie sie im Rezeptdetail vor dem Start eingestellt war.
  // Fehlt sie (z.B. bei einer Beilage oder direkt aus dem Pool gekocht),
  // wird wie bisher der Profilwert geladen.
  initialServings?: number;
}

export default function SingleRecipeCookView({ recipeId, isActive, onTitleLoaded, onFinished, sessionOverrides, initialServings }: Props) {
  const { colors, gradient, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const { inhaltsBreiteZweispaltig, istTablet } = useLayout();
  const { t, sprache } = useUebersetzung();

  const [recipe, setRecipe] = useState<RecipeForCooking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [level, setLevel] = useState<HaubenLevel>('fortgeschritten');
  const [tippsLaden, setTippsLaden] = useState(false);
  // Waehrend einer Umstellung wird der Schirm gesperrt (siehe unten).
  const [umstellung, setUmstellung] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isIngredientsOpen, setIsIngredientsOpen] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoReadSteps, setAutoReadSteps] = useState(false);
  const [showBrutzel, setShowBrutzel] = useState(true);
  // Von der KI erzeugte Tipps je Schritt, per order. Bleibt leer, wenn der
  // Abruf scheitert - dann greifen die eingebauten Texte als Rueckfall.
  const [stepTips, setStepTips] = useState<Record<number, string>>({});
  const [isSpeakingTip, setIsSpeakingTip] = useState(false);
  // Der Tipp wird weiter unten aus dem aktuellen Schritt berechnet, der
  // Vorlese-Effekt steht aber weiter oben. Ein Ref ueberbrueckt das, ohne
  // die Reihenfolge im Code umzustellen - und er ist beim Auslesen nach
  // der Pause automatisch aktuell.
  const brutzelTipRef = React.useRef('');
  const [brutzelVoice, setBrutzelVoice] = useState<string | undefined>(undefined);
  const [vorleserVoice, setVorleserVoice] = useState<string | undefined>(undefined);
  const [largeText, setLargeText] = useState(false);
  const [techniqueVideo, setTechniqueVideo] = useState<TechniqueVideoInfo | null>(null);
  // Welche Technik in diesem Kochvorgang schon gezeigt wurde. Wer beim
  // Zwiebelschneiden zugesehen hat, braucht das Video drei Schritte
  // spaeter nicht noch einmal angeboten - es steht sonst als Angebot da,
  // das man schon abgelehnt oder erledigt hat. Ein useRef und kein
  // useState: Die Anzeige haengt nicht daran, und ein erneutes Zeichnen
  // beim Merken waere unnoetig.
  const gezeigteTechniken = useRef<Set<string>>(new Set());
  const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [isStepTextModalOpen, setIsStepTextModalOpen] = useState(false);
  const [stepTextDraft, setStepTextDraft] = useState('');
  const [isSavingStepText, setIsSavingStepText] = useState(false);
  const [editingIngredientIndex, setEditingIngredientIndex] = useState<number | null>(null);
  const [ingredientDraft, setIngredientDraft] = useState({ name: '', amount: '', unit: '' });
  const [isSavingIngredient, setIsSavingIngredient] = useState(false);

  // Gemeinsame Abfrage fuer jede Aenderung an Zutaten/Kochschritten waehrend
  // des Kochens: dauerhaft im Rezept speichern (PATCH ans Backend, gilt auch
  // kuenftig) oder nur fuer den aktuellen Kochvorgang uebernehmen (rein
  // lokaler State, das gespeicherte Rezept bleibt unveraendert). Bewusst
  // getrennt von der Notiz-Funktion (die hat ihre eigene, gleichartige
  // Abfrage), da Notiz ein eigenes Feld ist, hier geht es um die
  // eigentlichen Zutaten/Schritt-Daten.
  const saveRecipeChangeWithScope = (
    updatedFields: { ingredients?: Ingredient[] } & Partial<Record<StufenFeld, RecipeStep[]>>,
    applyLocally: () => void,
    setSaving: (v: boolean) => void,
    onDone: () => void,
  ) => {
    Keyboard.dismiss();
    Alert.alert(
      t('detail.aenderungSpeichern'),
      t('detail.aenderungFrage'),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('detail.nurDiesmal'),
          onPress: () => {
            applyLocally();
            onDone();
          },
        },
        {
          text: t('detail.dauerhaftImRezept'),
          onPress: () => mitStufenHinweis(recipe, recipe?.steps ?? [], updatedFields.steps, t, async () => {
            setSaving(true);
            // Aendert sich das Original inhaltlich, verwirft das Backend die
            // Stufenfassungen - lokal genauso, sonst zeigte der Koch-Modus
            // bis zum naechsten Laden noch die alten.
            const verwirftStufen =
              !!updatedFields.steps && !!recipe && schritteInhaltGeaendert(recipe.steps, updatedFields.steps);
            try {
              await api.patch(`/recipes/${recipeId}`, updatedFields);
              applyLocally();
              if (verwirftStufen) {
                setRecipe((prev) =>
                  prev ? { ...prev, steps_anfaenger: null, steps_profi: null, steps_fortgeschritten: null } : prev,
                );
              }
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
  const [isSavingNote, setIsSavingNote] = useState(false);
  // Portionen NUR fuer diesen Kochvorgang. Das Rezept behaelt seinen Wert -
  // ein Schweinsbraten ist fuer sechs gedacht, auch wenn heute fuer vier
  // gekocht wird. Deshalb wird hier nichts gespeichert.
  const [kochPortionen, setKochPortionen] = useState<number | null>(initialServings ?? null);

  useEffect(() => {
    api
      .get<{ auto_read_steps: boolean; default_hauben_level: HaubenLevel; large_text: boolean; show_brutzel: boolean; default_servings: number }>('/preferences/')
      .then((prefs) => {
        setAutoReadSteps(prefs.auto_read_steps);
        setLevel(prefs.default_hauben_level);
        setLargeText(prefs.large_text);
        setShowBrutzel(prefs.show_brutzel);
        // Nur den Profilwert nehmen, wenn keine Portionenzahl vom
        // Rezeptdetail mitkam - sonst wuerde die eigene Einstellung des
        // Nutzers ("ich koche heute fuer 8") vom Profil-Standard (4)
        // ueberschrieben, sobald diese Antwort zurueckkommt.
        if (initialServings == null) {
          setKochPortionen(prefs.default_servings);
        }
      })
      .catch(() => {
        // Praeferenz konnte nicht geladen werden - Auto-Vorlesen bleibt aus,
        // Hauben-Stufe bleibt beim Fallback 'fortgeschritten', kein Grund
        // den ganzen Koch-Modus zu blockieren
      });
  }, []);

  // Erzeugt das Backend fuer diese Stufe gerade noch eine eigene
  // Schrittfassung? Dann sind die Tipps noch nicht zu holen: Sie wuerden
  // zur alten, kuerzeren Liste entstehen und danach beim falschen Schritt
  // stehen ("nach 50 Minuten pruefen" neben "Backofen vorheizen").
  const stufenFeldJetzt: StufenFeld =
    level === 'anfaenger' ? 'steps_anfaenger' : level === 'profi' ? 'steps_profi' : 'steps_fortgeschritten';
  const brauchtAnpassung =
    !!recipe &&
    !recipe[stufenFeldJetzt]?.length &&
    !(level === 'fortgeschritten' && recipe.steps.length >= FORTGESCHRITTEN_MIN_SCHRITTE);
  // Scheitert die Anpassung (KI aus, kein Netz), gilt die Basisfassung -
  // dann passen Tipps dazu und duerfen geholt werden.
  const [anpassungFehlgeschlagen, setAnpassungFehlgeschlagen] = useState<string | null>(null);
  const stufeBereit = !!recipe && (!brauchtAnpassung || anpassungFehlgeschlagen === level);

  // Brutzels Tipps zum Rezept holen. Nur wenn Brutzel ueberhaupt
  // eingeschaltet ist - sonst waere es ein KI-Aufruf fuer etwas, das
  // niemand zu sehen bekommt.
  useEffect(() => {
    if (!showBrutzel || !recipe || !stufeBereit) return;
    // Die Stufe gehoert in die Anfrage: Die Schrittliste ist je Stufe eine
    // andere, und damit auch die Tipps. Ohne sie stand nach dem Umschalten
    // der Tipp zu Schritt 5 der einen Fassung neben Schritt 5 der anderen.
    setStepTips({});
    setTippsLaden(true);
    api
      .post<{ tips: { order: number; tip: string }[] }>(
        `/ai/step-tips/${recipeId}?level=${level}`,
      )
      .then((res) => {
        const byOrder: Record<number, string> = {};
        res.tips.forEach((t) => {
          if (t.order != null) byOrder[t.order] = t.tip;
        });
        setStepTips(byOrder);
      })
      .catch(() => {
        // Kein Grund, das Kochen zu stoeren - es greifen die eingebauten
        // Texte weiter unten.
      })
      .finally(() => setTippsLaden(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showBrutzel, recipeId, !!recipe, level, stufeBereit]);

  // Eigene Stimme fuer Brutzel: eine ANDERE deutsche Stimme als die, die
  // die Schritte vorliest. So ist ohne Hinsehen klar, ob gerade das Rezept
  // gesprochen wird oder Brutzel dazwischenredet. Gibt es nur eine
  // deutsche Stimme, bleibt es bei der Standardstimme - dann sorgen
  // Tonhoehe und Tempo unten fuer den Unterschied.
  // Brutzels Stimme kommt jetzt aus der Auswahl im Profil. Vorher wurde
  // einfach die letzte deutsche Systemstimme genommen - das war Zufall
  // und klang je nach Geraet beliebig.
  useEffect(() => {
    loadBrutzelVoice().then(setBrutzelVoice);
    vorleserStimme().then(setVorleserVoice);
  }, []);

  const handleSpeakTip = (text: string) => {
    if (isSpeakingTip) {
      Speech.stop();
      setIsSpeakingTip(false);
      return;
    }
    // Laufendes Schritt-Vorlesen zuerst stoppen, sonst reden beide
    // gleichzeitig.
    Speech.stop();
    setIsSpeaking(false);
    setIsSpeakingTip(true);
    Speech.speak(text, {
      language: SPEECH_LANGUAGE,
      voice: brutzelVoice,
      pitch: BRUTZEL_PITCH,
      rate: BRUTZEL_RATE,
      onDone: () => setIsSpeakingTip(false),
      onStopped: () => setIsSpeakingTip(false),
      onError: () => setIsSpeakingTip(false),
    });
  };

  const handleSpeak = () => {
    if (!currentStep) return;
    if (isSpeaking) {
      Speech.stop();
      setIsSpeaking(false);
      return;
    }
    setIsSpeaking(true);
    Speech.speak(currentStep.text, {
      language: SPEECH_LANGUAGE,
      voice: vorleserVoice,
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  // Beim Verlassen des Screens oder Schrittwechsel laufende Sprachausgabe
  // stoppen UND einen noch offenen Timer-Push abbrechen (per Ref, damit der
  // Cleanup immer die aktuelle Notification-ID sieht statt einer veralteten
  // aus dem ersten Render).
  useEffect(() => {
    return () => {
      Speech.stop();
      setIsSpeakingTip(false);
      cancelTimerNotification(timerNotificationIdRef.current);
    };
  }, []);
  useEffect(() => {
    Speech.stop();
    setIsSpeaking(false);
    if (!autoReadSteps || !currentStep) return;

    // Wird auf true gesetzt, sobald der Schritt gewechselt oder der Screen
    // verlassen wird. Ohne dieses Flag wuerde Brutzels Tipp nach der Pause
    // noch losreden, obwohl man laengst beim naechsten Schritt ist - der
    // Timer laeuft ja unabhaengig weiter.
    let abgebrochen = false;
    let tippTimer: ReturnType<typeof setTimeout> | null = null;

    setIsSpeaking(true);
    Speech.speak(currentStep.text, {
      language: SPEECH_LANGUAGE,
      voice: vorleserVoice,
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
      onDone: () => {
        setIsSpeaking(false);
        // Brutzels Tipp im Anschluss - aber nur, wenn er ueberhaupt
        // eingeschaltet ist und es einen Tipp gibt.
        if (abgebrochen || !showBrutzel || !brutzelTipRef.current) return;

        // Kurze Pause dazwischen: Ohne sie klingt es wie ein einziger
        // langer Satz, und man haelt den Tipp fuer einen Teil des
        // Arbeitsschritts.
        tippTimer = setTimeout(() => {
          if (abgebrochen) return;
          setIsSpeakingTip(true);
          Speech.speak(`Brutzels Tipp. ${brutzelTipRef.current}`, {
            language: SPEECH_LANGUAGE,
            voice: brutzelVoice,
            pitch: BRUTZEL_PITCH,
            rate: BRUTZEL_RATE,
            onDone: () => setIsSpeakingTip(false),
            onStopped: () => setIsSpeakingTip(false),
            onError: () => setIsSpeakingTip(false),
          });
        }, 900);
      },
    });

    return () => {
      abgebrochen = true;
      if (tippTimer) clearTimeout(tippTimer);
    };
    // currentStep bewusst nicht in den Dependencies - haengt schon an
    // currentIndex/level, die Referenz waere bei jedem Render neu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, level, autoReadSteps, recipe, showBrutzel, brutzelVoice]);

  // Timer-Zustand: nur aktiv, wenn der aktuelle Schritt timer_seconds hat
  // und der Nutzer ihn gestartet hat. Echtes setInterval, keine Attrappe.
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isEditingTimer, setIsEditingTimer] = useState(false);
  const [timerEditDraft, setTimerEditDraft] = useState('');
  // Welcher SCHRITT (Index) gerade einen laufenden/gestarteten Timer hat -
  // getrennt von currentIndex (welcher Schritt gerade ANGEZEIGT wird).
  // Ohne diese Trennung wurde der Timer bei jedem Weiter/Zurueck
  // faelschlich gestoppt und zurueckgesetzt (siehe Reset-Effekt unten).
  const [activeTimerStepIndex, setActiveTimerStepIndex] = useState<number | null>(null);
  const [timerNotificationId, setTimerNotificationId] = useState<string | null>(null);
  const timerNotificationIdRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setupNotificationChannel();
  }, []);

  useEffect(() => {
    timerNotificationIdRef.current = timerNotificationId;
  }, [timerNotificationId]);

  useEffect(() => {
    api
      .get<RecipeForCooking>(`/recipes/${recipeId}`)
      .then((data) => {
        // "Nur diesmal"-Aenderungen aus dem Rezept-Detail ueberschreiben
        // die vom Server geladenen Daten NUR fuer diese Session - werden
        // nirgends gespeichert.
        const merged = sessionOverrides
          ? {
              ...data,
              ingredients: sessionOverrides.ingredients ?? data.ingredients,
              steps: sessionOverrides.steps ?? data.steps,
            }
          : data;
        setRecipe(merged);
        onTitleLoaded?.(merged.title);
      })
      .catch((err) => setError(err instanceof ApiError ? err.detail : t('kochen.nichtGeladen')));
    // onTitleLoaded/sessionOverrides bewusst nicht in den Dependencies -
    // waeren bei jedem Render neue Referenzen vom Elternteil, wuerden den
    // Ladevorgang unnoetig wiederholen. recipeId ist der einzige relevante
    // Trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeId]);

  const [isAdaptingSteps, setIsAdaptingSteps] = useState(false);

  // Wenn auf Anfaenger/Profi gewechselt wird (oder das Rezept frisch in
  // dieser Stufe geladen wurde) und noch keine generierte Variante
  // vorliegt, jetzt beim Backend anfordern (generiert + cacht dort einmalig,
  // siehe POST /ai/adapt-steps/{id}) und ins lokale Rezept einmischen.
  // Fortgeschritten braucht das nur bei kurzen Originalen (weniger als
  // FORTGESCHRITTEN_MIN_SCHRITTE) - laengere Rezepte sind so, wie sie
  // erfasst wurden, schon die Fortgeschritten-Fassung.
  useEffect(() => {
    if (!recipe) return;
    const cachedField: StufenFeld =
      level === 'anfaenger' ? 'steps_anfaenger' : level === 'profi' ? 'steps_profi' : 'steps_fortgeschritten';
    if (level === 'fortgeschritten' && recipe.steps.length >= FORTGESCHRITTEN_MIN_SCHRITTE) return;
    const alreadyCached = recipe[cachedField] && recipe[cachedField]!.length > 0;
    if (alreadyCached) return;

    let cancelled = false;
    setIsAdaptingSteps(true);
    api
      .post<{ steps: RecipeStep[] }>(`/ai/adapt-steps/${recipeId}`, { level })
      .then((result) => {
        if (cancelled) return;
        setRecipe((prev) => (prev ? { ...prev, [cachedField]: result.steps } : prev));
      })
      .catch(() => {
        // Generierung fehlgeschlagen (z.B. kein OPENAI_API_KEY) - kein
        // Alert noetig, pickStepsForLevel faellt automatisch auf die
        // Basisfassung zurueck, das Kochen bleibt trotzdem moeglich.
        if (!cancelled) setAnpassungFehlgeschlagen(level);
      })
      .finally(() => {
        if (!cancelled) setIsAdaptingSteps(false);
      });
    return () => {
      cancelled = true;
    };
  }, [recipe?.id, level]);


  // --- Uebersetzung ---------------------------------------------------
  // Dieselbe Schicht wie im Rezeptdetail: Das Original bleibt, die
  // Uebersetzung liegt darueber. Im Koch-Modus zaehlt sie doppelt - hier
  // steht man am Herd und hat keine Zeit, einen fremden Satz zu deuten.
  const quellsprache = (recipe?.locale || 'de').slice(0, 2);
  const brauchtUebersetzung = !!recipe && quellsprache !== sprache;
  const [uebersetzung, setUebersetzung] = useState<{
    title: string;
    steps: RecipeStep[];
    steps_anfaenger?: RecipeStep[] | null;
    steps_profi?: RecipeStep[] | null;
    ingredients?: { name: string }[];
  } | null>(null);
  const [zeigeUebersetzung, setZeigeUebersetzung] = useState(true);
  const [uebersetztGerade, setUebersetztGerade] = useState(false);
  const [uebersetzungsfehler, setUebersetzungsfehler] = useState<string | null>(null);

  const holeUebersetzung = async () => {
    if (!recipe) return;
    setUebersetztGerade(true);
    setUebersetzungsfehler(null);
    try {
      const res = await api.post<{
        title: string; steps: RecipeStep[];
        steps_anfaenger?: RecipeStep[] | null; steps_profi?: RecipeStep[] | null;
        ingredients?: { name: string }[];
      }>(`/ai/translate/${recipe.id}?locale=${sprache}`, {});
      setUebersetzung(res);
      setZeigeUebersetzung(true);
    } catch (err) {
      setUebersetzungsfehler(err instanceof ApiError ? err.detail : t('uebersetzung.fehlgeschlagen'));
    } finally {
      setUebersetztGerade(false);
    }
  };

  // Liegt sie schon vor, kostet das Holen keinen KI-Aufruf.
  useEffect(() => {
    if (brauchtUebersetzung && recipe?.available_translations?.includes(sprache) && !uebersetzung) {
      holeUebersetzung();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brauchtUebersetzung, recipe?.id, sprache]);

  const zeigtUebersetzung = !!uebersetzung && zeigeUebersetzung;

  // Die Stufenfassung der Uebersetzung, sofern es sie gibt - sonst faellt
  // es auf deren Basisfassung zurueck, nicht auf das Original: lieber die
  // richtige Sprache in der falschen Ausfuehrlichkeit als umgekehrt.
  const uebersetzteSchritte = (): RecipeStep[] | null => {
    if (!zeigtUebersetzung || !uebersetzung) return null;
    if (level === 'anfaenger' && uebersetzung.steps_anfaenger?.length) return uebersetzung.steps_anfaenger;
    if (level === 'profi' && uebersetzung.steps_profi?.length) return uebersetzung.steps_profi;
    return uebersetzung.steps;
  };

  const derivedSteps = uebersetzteSchritte() ?? (recipe ? pickStepsForLevel(recipe, level) : []);
  const currentStep = derivedSteps[currentIndex];

  // Zutaten, die in diesem Schritt vorkommen - von der App selbst im
  // Schritttext gesucht (siehe utils/schrittZutaten.ts). Bei der
  // Uebersetzung mit den uebersetzten Namen, die Mengen bleiben die des
  // Originals; passt die Liste nicht Zeile fuer Zeile, lieber nichts zeigen.
  const zutatenNamen: { name: string }[] | null = !recipe
    ? null
    : zeigtUebersetzung
      ? uebersetzung?.ingredients && uebersetzung.ingredients.length === recipe.ingredients.length
        ? uebersetzung.ingredients
        : null
      : recipe.ingredients;
  const schrittZutaten = currentStep && zutatenNamen
    ? zutatenImSchritt(currentStep.text, zutatenNamen, zeigtUebersetzung ? sprache : quellsprache).map((index) => ({
        index,
        name: zutatenNamen[index].name,
      }))
    : [];

  // KI-Tipp zu genau diesem Schritt, sonst der eingebaute Technik-Tipp,
  // sonst ein allgemeiner. Die Reihenfolge ist Absicht: Der schrittgenaue
  // Hinweis ist der einzige, der wirklich hilft - die anderen sind
  // Rueckfall, falls die KI nicht erreichbar war.
  const istLetzterSchritt = currentIndex === derivedSteps.length - 1;
  const brutzelTip = currentStep
    ? (stepTips[currentStep.order] ??
       (currentStep.technique_tag
         ? (BRUTZEL_TIP_KEYS.includes(currentStep.technique_tag)
             ? t(`kochen.tipp.${currentStep.technique_tag}`)
             : t('kochen.technikAufmerksamkeit'))
         : istLetzterSchritt
           ? t(`kochen.tippAbschluss.${(derivedSteps.length % GENERIC_CLOSING_TIP_COUNT) + 1}`)
           : t(`kochen.tippAllgemein.${(currentIndex % GENERIC_TIP_COUNT) + 1}`)))
    : '';
  brutzelTipRef.current = brutzelTip;



  // Technik-Video zum aktuellen Schritt laden, falls ein technique_tag
  // gesetzt ist. Oeffentlicher Endpoint, kein Login-Overhead noetig.
  useEffect(() => {
    const tag = currentStep?.technique_tag;
    if (!tag) {
      setTechniqueVideo(null);
      return;
    }
    if (gezeigteTechniken.current.has(tag)) {
      // Schon einmal in diesem Kochvorgang angeboten - kein zweites Mal.
      setTechniqueVideo(null);
      return;
    }
    let cancelled = false;
    api
      .get<TechniqueVideoInfo>(`/technique-videos/${tag}`)
      .then((video) => {
        if (cancelled) return;
        setTechniqueVideo(video);
        if (video?.available && video.youtube_video_id) {
          gezeigteTechniken.current.add(tag);
        }
      })
      .catch(() => {
        if (!cancelled) setTechniqueVideo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentStep?.technique_tag]);

  // Beim Stufenwechsel auf Schritt 1 zurueckspringen - die Indizes bedeuten
  // je Stufe etwas anderes (unterschiedliche Gruppierung).
  // Fuer diesen Kochvorgang gilt die Portionenzahl aus dem Profil, sofern
  // das Rezept ueberhaupt eine eigene hat (sonst gibt es nichts umzurechnen).
  const angezeigtePortionen = recipe?.servings ? (kochPortionen ?? recipe.servings) : null;
  const portionsFaktor =
    recipe?.servings && angezeigtePortionen ? angezeigtePortionen / recipe.servings : 1;

  // Auf eine Nachkommastelle, und ganze Zahlen ohne Komma: "2.5 EL" ist
  // brauchbar, "2.4999999999999996 EL" nicht.
  const mengeUmgerechnet = (menge: number) => {
    const wert = menge * portionsFaktor;
    return Number.isInteger(wert) ? String(wert) : String(Math.round(wert * 10) / 10);
  };

  const handleLevelChange = (newLevel: HaubenLevel) => {
    if (newLevel === level) return;
    setUmstellung(true);
    setLevel(newLevel);
    setCurrentIndex(0);
  };

  // Die Sperre endet, wenn beide Nachladevorgaenge durch sind. Der Ref
  // merkt sich, dass ueberhaupt einer begonnen hat - sonst wuerde die
  // Sperre schon im selben Durchlauf wieder aufgehoben, bevor die
  // Anfragen ueberhaupt losgelaufen sind.
  const ladenBegonnen = useRef(false);
  useEffect(() => {
    if (!umstellung) return;
    if (isAdaptingSteps || tippsLaden) {
      ladenBegonnen.current = true;
      return;
    }
    if (ladenBegonnen.current) {
      ladenBegonnen.current = false;
      setUmstellung(false);
    }
  }, [umstellung, isAdaptingSteps, tippsLaden]);

  // Sicherheitsnetz: Antwortet weder Schritt- noch Tippabruf (kein
  // Schluessel, kein Netz), darf der Schirm nicht dauerhaft gesperrt
  // bleiben. Nach acht Sekunden geht es ohne die Umstellung weiter.
  useEffect(() => {
    if (!umstellung) return;
    const timer = setTimeout(() => setUmstellung(false), 8000);
    return () => clearTimeout(timer);
  }, [umstellung]);

  const handleOpenStepTextModal = () => {
    setStepTextDraft(currentStep.text);
    setIsStepTextModalOpen(true);
  };

  const handleSaveStepText = () => {
    if (!recipe || !stepTextDraft.trim()) return;
    // Wie bei der Notiz: in die Liste der gerade angezeigten Stufe. Vorher
    // aenderte der Stift (nur auf Anfaenger-Stufe sichtbar) den Schritt mit
    // derselben Nummer in der Grundfassung - also einen anderen Schritt.
    const feld = feldFuerStufe(recipe, level);
    const updatedSteps = (recipe[feld] ?? []).map((s) =>
      s.order === currentStep.order ? { ...s, text: stepTextDraft.trim() } : s,
    );
    saveRecipeChangeWithScope(
      { [feld]: updatedSteps },
      () => setRecipe({ ...recipe, [feld]: updatedSteps }),
      setIsSavingStepText,
      () => setIsStepTextModalOpen(false),
    );
  };

  const handleDeleteStep = () => {
    if (!recipe) return;
    const feld = feldFuerStufe(recipe, level);
    const liste = recipe[feld] ?? [];
    if (liste.length <= 1) {
      Alert.alert(t('detail.nichtMoeglich'), t('detail.mindestensEinSchritt'));
      return;
    }
    const updatedSteps = liste.filter((s) => s.order !== currentStep.order);
    saveRecipeChangeWithScope(
      { [feld]: updatedSteps },
      () => {
        setRecipe({ ...recipe, [feld]: updatedSteps });
        // Wurde der letzte Schritt geloescht, auf den jetzt letzten
        // verbleibenden zurueckspringen statt ins Leere zu zeigen.
        setCurrentIndex((prev) => Math.min(prev, updatedSteps.length - 1));
      },
      setIsSavingStepText,
      () => setIsStepTextModalOpen(false),
    );
  };

  const handleOpenIngredientModal = (index: number) => {
    const ing = recipe!.ingredients[index];
    setIngredientDraft({ name: ing.name, amount: ing.amount != null ? String(ing.amount) : '', unit: ing.unit ?? '' });
    setEditingIngredientIndex(index);
  };

  const handleSaveIngredient = () => {
    if (!recipe || editingIngredientIndex === null || !ingredientDraft.name.trim()) return;
    const updatedIngredients = recipe.ingredients.map((ing, i) =>
      i === editingIngredientIndex
        ? {
            name: ingredientDraft.name.trim(),
            amount: ingredientDraft.amount.trim() ? Number(ingredientDraft.amount.trim()) : null,
            unit: ingredientDraft.unit.trim() || null,
          }
        : ing,
    );
    saveRecipeChangeWithScope(
      { ingredients: updatedIngredients },
      () => setRecipe({ ...recipe, ingredients: updatedIngredients }),
      setIsSavingIngredient,
      () => setEditingIngredientIndex(null),
    );
  };

  const handleDeleteIngredient = () => {
    if (!recipe || editingIngredientIndex === null) return;
    const updatedIngredients = recipe.ingredients.filter((_, i) => i !== editingIngredientIndex);
    saveRecipeChangeWithScope(
      { ingredients: updatedIngredients },
      () => setRecipe({ ...recipe, ingredients: updatedIngredients }),
      setIsSavingIngredient,
      () => setEditingIngredientIndex(null),
    );
  };

  const handleOpenNoteModal = () => {
    setNoteDraft(currentStep.user_note ?? '');
    setIsNoteModalOpen(true);
  };

  const handleSaveNote = async () => {
    if (!recipe) return;

    // Die Notiz gehoert an den Schritt, den der Nutzer VOR SICH sieht -
    // also in die Liste der aktuellen Hauben-Stufe. Vorher wurde sie immer
    // in die Basisfassung geschrieben: Auf Anfaenger- oder Profi-Stufe
    // meint dieselbe Schrittnummer dort etwas anderes, die Notiz landete
    // am falschen Schritt oder nirgends.
    const feld = feldFuerStufe(recipe, level);
    const liste = recipe[feld] ?? [];
    const updatedSteps = liste.map((st) =>
      st.order === currentStep.order ? { ...st, user_note: noteDraft.trim() || null } : st,
    );

    Keyboard.dismiss();
    // Keine Rueckfrage mehr, ob dauerhaft oder nur diesmal. Eine Notiz ist
    // genau das, was man beim naechsten Mal wiederlesen will - "nur
    // diesmal" waere eine Notiz, die sich selbst wegwirft.
    setIsSavingNote(true);
    try {
      await api.patch(`/recipes/${recipeId}`, { [feld]: updatedSteps });
      setRecipe({ ...recipe, [feld]: updatedSteps });
      setIsNoteModalOpen(false);
    } catch (err) {
      Alert.alert(
        t('allgemein.fehler'),
        err instanceof ApiError ? err.detail : t('kochen.notizNichtGespeichert'),
      );
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleOpenTimerEdit = () => {
    setTimerEditDraft(displayedRemainingSeconds !== null ? String(Math.round(displayedRemainingSeconds / 60)) : '');
    setIsEditingTimer(true);
  };

  const handleSaveTimerEdit = () => {
    const minutes = Number(timerEditDraft.trim());
    if (!minutes || minutes <= 0) {
      Alert.alert(t('kochen.ungueltigeZeit'), t('kochen.zahlGroesserNull'));
      return;
    }
    setRemainingSeconds(Math.round(minutes * 60));
    setIsEditingTimer(false);
  };

  const startTimerNow = async (seconds: number | null) => {
    setRemainingSeconds(seconds);
    setIsTimerRunning(true);
    setActiveTimerStepIndex(currentIndex);
    if (recipe && currentStep && seconds) {
      const id = await scheduleTimerNotification(recipe.title, currentStep.text, seconds);
      setTimerNotificationId(id);
    }
  };

  const handleStartTimer = async () => {
    // Laeuft schon ein Timer auf einem ANDEREN Schritt: Brutzel fragt nach,
    // statt den laufenden Timer stillschweigend zu ueberschreiben.
    if (isTimerRunning && activeTimerStepIndex !== null && activeTimerStepIndex !== currentIndex) {
      const neueSekunden = currentStep ? getEffectiveTimerSeconds(currentStep) : null;
      Alert.alert(
        t('kochen.timerKonfliktTitel'),
        t('kochen.timerKonfliktText', { minuten: Math.max(1, Math.ceil((remainingSeconds ?? 0) / 60)) }),
        [
          { text: t('kochen.timerWeiterlaufen'), style: 'cancel' },
          {
            text: t('kochen.timerAbbrechenNeuStarten'),
            style: 'destructive',
            onPress: () => {
              cancelTimerNotification(timerNotificationIdRef.current);
              setTimerNotificationId(null);
              startTimerNow(neueSekunden);
            },
          },
        ],
      );
      return;
    }
    await startTimerNow(remainingSeconds);
  };

  const handlePauseTimer = () => {
    setIsTimerRunning(false);
    cancelTimerNotification(timerNotificationId);
    setTimerNotificationId(null);
  };

  // Beim Schrittwechsel: NUR zuruecksetzen, wenn der neu angezeigte Schritt
  // NICHT der Schritt mit dem laufenden/gestarteten Timer ist. Wechselt man
  // zwischenzeitlich zu einem anderen Schritt, bleibt der Timer im
  // Hintergrund unangetastet weiterlaufen (die Interval-Logik unten haengt
  // nur von isTimerRunning ab, nicht von currentIndex) - erst beim
  // Zurueckwechseln zu einem GANZ ANDEREN, timer-losen Schritt wird
  // zurueckgesetzt.
  useEffect(() => {
    if (activeTimerStepIndex !== null && activeTimerStepIndex === currentIndex) {
      return; // dieser Schritt hat den aktiven Timer - Anzeige unveraendert lassen
    }
    if (activeTimerStepIndex === null) {
      // Kein Timer aktiv irgendwo - normales Zuruecksetzen auf den
      // Startwert des jetzt angezeigten Schritts.
      setRemainingSeconds(currentStep ? getEffectiveTimerSeconds(currentStep) : null);
    }
    // Ist ein Timer fuer einen ANDEREN Schritt aktiv, wird hier bewusst
    // NICHTS an remainingSeconds/isTimerRunning veraendert - die Anzeige
    // fuer den jetzt sichtbaren (timer-losen oder eigenen) Schritt wird
    // weiter unten beim Rendern anhand von activeTimerStepIndex entschieden.
  }, [currentIndex]);

  useEffect(() => {
    if (!isTimerRunning) return;

    intervalRef.current = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev === null) return null;
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setIsTimerRunning(false);
          // Zuverlaessiges Tonsignal ueber Sprachausgabe (funktioniert
          // sicher im Vordergrund, unabhaengig davon, ob Benachrichtigungs-
          // Berechtigung erteilt wurde - die geplante Push-Benachrichtigung
          // allein reichte offenbar nicht als verlaessliches Signal).
          Speech.speak(t('kochen.timerFertig'), { language: SPEECH_LANGUAGE, voice: vorleserVoice });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isTimerRunning]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, display: isActive ? 'flex' : 'none' }]}>
        <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text>
      </View>
    );
  }

  if (!recipe || !currentStep) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, display: isActive ? 'flex' : 'none' }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const totalSteps = derivedSteps.length;
  const isLastStep = currentIndex === totalSteps - 1;

  // Was fuer den JETZT sichtbaren Schritt anzuzeigen ist: laeuft dessen
  // eigener Timer, zeigt sich der echte Live-Countdown; sonst dessen
  // eigene (nicht laufende) Dauer - inklusive einer manuellen Bearbeitung
  // ueber "Timer-Zeit aendern", auch wenn der Timer noch gar nicht
  // gestartet wurde (Bug: vorher wurde in dem Fall IMMER die urspruengliche
  // Schritt-Dauer neu aus dem Rezepttext abgeleitet, eine Bearbeitung VOR
  // dem Start ging dadurch sofort wieder verloren). Nur wenn fuer einen
  // ANDEREN Schritt gerade ein Timer im Hintergrund aktiv ist, wird bewusst
  // dessen eigene (unbearbeitete) Dauer gezeigt statt remainingSeconds, das
  // ja dem Hintergrund-Timer gehoert.
  const isViewingActiveTimerStep = activeTimerStepIndex === currentIndex;
  const isTimerActiveOnOtherStep = activeTimerStepIndex !== null && activeTimerStepIndex !== currentIndex;
  const displayedRemainingSeconds = isTimerActiveOnOtherStep
    ? (currentStep ? getEffectiveTimerSeconds(currentStep) : null)
    : remainingSeconds;
  const displayedIsTimerRunning = isViewingActiveTimerStep && isTimerRunning;
  const isTimerRunningElsewhere = !isViewingActiveTimerStep && activeTimerStepIndex !== null && isTimerRunning;

  const goNext = () => {
    if (isLastStep) {
      // Laeuft noch ein Timer - egal auf welchem Schritt -, erst
      // nachfragen. Ohne das beendet "Fertig" den Kochvorgang und der
      // Timer verschwindet mit, obwohl das Fleisch noch im Ofen steht.
      if (activeTimerStepIndex !== null && isTimerRunning) {
        Alert.alert(
          t('kochen.timerLaeuftNochTitel'),
          t('kochen.timerLaeuftNochText'),
          [
            { text: t('allgemein.abbrechen'), style: 'cancel' },
            { text: t('kochen.trotzdemBeenden'), style: 'destructive', onPress: () => onFinished(true) },
          ],
        );
        return;
      }
      onFinished(true);
      return;
    }
    setCurrentIndex((i) => i + 1);
  };

  const goBackStep = () => {
    if (currentIndex === 0) {
      // "Zurueck" auf dem ERSTEN Schritt verlaesst den Kochvorgang - anders
      // als auf jedem spaeteren Schritt, wo es nur einen Schritt zurueck
      // geht. Ohne Nachfrage verliert man versehentlich den ganzen
      // Fortschritt durch einen Tipp, der bisher immer harmlos war.
      Alert.alert(
        t('kochen.kochvorgangAbbrechenTitel'),
        t('kochen.kochvorgangAbbrechenText'),
        [
          { text: t('kochen.weiterkochen'), style: 'cancel' },
          { text: t('kochen.abbrechenBestaetigen'), style: 'destructive', onPress: () => onFinished(false) },
        ],
      );
      return;
    }
    setCurrentIndex((i) => i - 1);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.bg, display: isActive ? 'flex' : 'none' }]}>
      <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" style={{ flex: 1 }} contentContainerStyle={[{ paddingBottom: 16 }, inhaltsBreiteZweispaltig]}>
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

      {/* Stufenwahl als beschriftete Knoepfe.
          Vorher standen hier drei gleiche Hauben nebeneinander, von denen
          je nach Stufe eine bis drei eingefaerbt waren. Das verlangt vom
          Nutzer, Symbole zu ZAEHLEN und die Zahl zu deuten - und zeigt
          nirgends, was die Stufen bedeuten. Am Herd, mit fettigen
          Fingern, ist das der falsche Moment fuer ein Raetsel. */}
      <View style={styles.levelRow}>
        {([1, 2, 3] as const).map((hatCount) => {
          const stufe = HAT_COUNT_TO_LEVEL[hatCount];
          const aktiv = stufe === level;
          return (
            <Pressable
              key={hatCount}
              onPress={() => handleLevelChange(stufe)}
              // Ohne Beschriftung braucht der Knopf einen Namen fuer die
              // Sprachausgabe - die Anzahl der Gesichter allein ist fuer
              // Bedienungshilfen nichts.
              accessibilityRole="button"
              accessibilityState={{ selected: aktiv }}
              accessibilityLabel={t(stufe === 'anfaenger' ? 'profil.haubenAnfaenger'
                : stufe === 'profi' ? 'profil.haubenProfi'
                : 'profil.haubenFortgeschritten')}
              style={[styles.levelButton, {
                backgroundColor: aktiv ? gradient[0] : colors.card,
                borderRadius: radius.sm,
              }]}
            >
              {/* Nur die Gesichter, kein Text: "Fortgeschritten" passte nie
                  in ein Drittel der Breite und wurde abgeschnitten. Die
                  Anzahl sagt dasselbe und braucht keinen Platz. */}
              {Array.from({ length: hatCount }).map((_, i) => (
                <Text key={i} style={styles.levelHat}>👨‍🍳</Text>
              ))}
            </Pressable>
          );
        })}
      </View>

      {/* Auf dem Tablet nebeneinander: Zutaten links, Schritt rechts.
          Untereinander bliebe die halbe Flaeche leer, und man muesste zum
          Nachsehen der Menge scrollen - mitten im Kochen der laestigste
          Moment. Auf dem Handy bleibt alles wie bisher, die Stile sind
          dort undefined. */}
      <View style={istTablet ? styles.spaltenReihe : undefined}>
      <View style={istTablet ? styles.spalteZutaten : undefined}>
      <Pressable
        onPress={() => setIsIngredientsOpen((prev) => !prev)}
        style={[styles.ingredientsToggle, { backgroundColor: colors.card, borderRadius: radius.sm }]}
      >
        <Text style={[styles.ingredientsToggleText, { color: colors.text }]}>
          Zutaten ({recipe.ingredients.length})
          {angezeigtePortionen ? `  ·  für ${angezeigtePortionen} Portionen` : ''}
        </Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{isIngredientsOpen ? '▲' : '▼'}</Text>
      </Pressable>

      {(isIngredientsOpen || istTablet) && (
        <View style={[styles.ingredientsList, { backgroundColor: colors.card, borderRadius: radius.sm }]}>
          {recipe.ingredients.map((ing, i) => (
            <Pressable
              key={i}
              onPress={level === 'anfaenger' ? () => handleOpenIngredientModal(i) : undefined}
              style={styles.ingredientRow}
            >
              <Text style={[styles.ingredientLine, { color: colors.text, fontSize: largeText ? 16 : 13.5, flex: 1 }]}>
                {ing.amount ? `${mengeUmgerechnet(ing.amount)} ${ing.unit ?? ''} ` : ''}
                {ing.name}
              </Text>
              {level === 'anfaenger' && <MaterialCommunityIcons name="pencil-outline" size={14} color={colors.muted} />}
            </Pressable>
          ))}
        </View>
      )}

      </View>
      <View style={istTablet ? styles.spalteSchritt : undefined}>
      <Text style={[styles.stepIndicator, { color: colors.muted }]}>
        SCHRITT {currentIndex + 1}/{totalSteps}
      </Text>

      <View style={styles.progressIconsRow}>
        {derivedSteps.map((_, i) => (
          <View key={i} style={styles.progressIconSlot}>
            {activeTimerStepIndex === i && isTimerRunning && (
              <MaterialCommunityIcons name="clock-outline" size={13} color="#3B82F6" />
            )}
          </View>
        ))}
      </View>
      <View style={styles.progressSegmentsRow}>
        {derivedSteps.map((step, i) => {
          const isPassedOrCurrent = i <= currentIndex;
          const hasTimer = getEffectiveTimerSeconds(step) !== null;
          return (
            <View
              key={i}
              style={[
                styles.progressSegment,
                {
                  backgroundColor: isPassedOrCurrent ? gradient[0] : colors.card,
                  // Schritte mit Timer bekommen einen sichtbaren Rahmen in
                  // einer eigenen Akzentfarbe, unabhaengig vom Fortschritt -
                  // so sieht man auf einen Blick, wo noch ein Timer kommt.
                  borderWidth: hasTimer ? 2 : 0,
                  borderColor: '#3B82F6',
                },
              ]}
            />
          );
        })}
      </View>

      {isAdaptingSteps && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <ActivityIndicator size="small" color={colors.muted} />
          <Text style={{ color: colors.muted, fontSize: 11 }}>
            {level === 'anfaenger'
              ? t('kochen.umstellungAnfaenger')
              : level === 'profi'
                ? t('kochen.umstellungProfi')
                : t('kochen.umstellungAllgemein')}
          </Text>
        </View>
      )}
      <View style={styles.stepTextRow}>
        <Text style={[styles.stepText, { color: colors.text, fontSize: largeText ? 19 : 17, lineHeight: largeText ? 26 : 24 }]}>
          {currentStep.text}
        </Text>
        {/* Bearbeiten gilt der Originalfassung. Waehrend die Uebersetzung
            angezeigt wird, waere der Stift eine Falle - man aenderte einen
            Text, der so gar nicht dasteht. */}
        {!zeigtUebersetzung && (
          <Pressable onPress={handleOpenStepTextModal} style={[styles.speakButton, { backgroundColor: colors.card }]}>
            <MaterialCommunityIcons name="pencil-outline" size={15} color={colors.text} />
          </Pressable>
        )}
        <Pressable onPress={handleSpeak} style={[styles.speakButton, { backgroundColor: isSpeaking ? '#DC2626' : gradient[0] }]}>
          <MaterialCommunityIcons name={isSpeaking ? 'stop' : 'volume-high'} size={16} color="#fff" />
        </Pressable>
      </View>

      {schrittZutaten.length > 0 && (
        <View style={[styles.schrittZutaten, { backgroundColor: colors.card, borderRadius: radius.sm }]}>
          <Text style={[styles.schrittZutatenTitel, { color: colors.muted }]}>{t('kochen.fuerDiesenSchritt')}</Text>
          {schrittZutaten.map(({ index, name }) => {
            const ing = recipe.ingredients[index];
            return (
              <Text key={index} style={[styles.ingredientLine, { color: colors.text, fontSize: largeText ? 16 : 14 }]}>
                {ing.amount ? `${mengeUmgerechnet(ing.amount)} ${ing.unit ?? ''} ` : ''}
                {name}
              </Text>
            );
          })}
        </View>
      )}

      {currentStep.technique_tag && (
        <View style={[styles.techniqueBadge, { backgroundColor: colors.card, borderRadius: radius.sm }]}>
          <Text style={[styles.techniqueText, { color: colors.muted }]}>
            Technik: {capitalizeFirst(currentStep.technique_tag.replace(/_/g, ' '))}
          </Text>
        </View>
      )}

      {/* Brutzel nur zeigen, wenn er im Profil eingeschaltet ist. Wer ihn
          dort abschaltet, will ihn nirgends sehen - auch nicht mitten im
          Kochen. */}
      {showBrutzel && (
      <View style={[styles.brutzelCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <BrutzelAvatar size={88} variant="full" />
        <View style={{ flex: 1 }}>
          <Text style={[styles.brutzelText, { color: colors.muted }]}>
            <Text style={{ fontWeight: '700', color: gradient[0] }}>{t('kochen.brutzel')}</Text>
            {brutzelTip}
          </Text>
          <Pressable onPress={() => handleSpeakTip(brutzelTip)} hitSlop={8} style={styles.videoLink}>
            <MaterialCommunityIcons
              name={isSpeakingTip ? 'stop-circle-outline' : 'volume-high'}
              size={15}
              color={gradient[0]}
            />
            <Text style={[styles.videoLinkText, { color: gradient[0] }]}>
              {isSpeakingTip ? t('kochen.stopp') : t('kochen.vorlesen')}
            </Text>
          </Pressable>
          {techniqueVideo?.available && techniqueVideo.youtube_video_id && (
            <Pressable
              onPress={() => {
                // openURL wirft, wenn keine App den Link oeffnen kann -
                // ohne catch reisst das den Koch-Modus mit.
                Linking.openURL(`https://www.youtube.com/watch?v=${techniqueVideo.youtube_video_id}`).catch(() => {});
              }}
              style={styles.videoLink}
            >
              <MaterialCommunityIcons name="youtube" size={15} color="#DC2626" />
              <Text style={[styles.videoLinkText, { color: gradient[0] }]}>{t('kochen.technikVideo')}</Text>
            </Pressable>
          )}
        </View>
      </View>
      )}

      {/* Notizen auf allen drei Stufen: handleSaveNote schreibt die Notiz
          in die Schrittliste der gerade gewaehlten Stufe. Frueher war der
          Knopf nur auf Anfaenger-Stufe sichtbar - ein Rest aus der Zeit,
          als Notizen nur in der Basisfassung gespeichert wurden. */}
      {currentStep.user_note ? (
        <Pressable onPress={handleOpenNoteModal} style={styles.noteCard}>
          <Text style={styles.noteLabel}>📌 {t('kochen.deineNotizBearbeiten')}</Text>
          <Text style={styles.noteText}>{currentStep.user_note}</Text>
        </Pressable>
      ) : (
        <Pressable onPress={handleOpenNoteModal} style={[styles.addNoteButton, { borderColor: colors.muted, borderRadius: radius.sm }]}>
          <MaterialCommunityIcons name="note-plus-outline" size={14} color={colors.muted} />
          <Text style={[styles.addNoteText, { color: colors.muted }]}>{t('kochen.notizHinzufuegen')}</Text>
        </Pressable>
      )}

      {isTimerRunningElsewhere && (
        <View style={[styles.timerElsewhereBanner, { backgroundColor: colors.card, borderRadius: radius.sm }]}>
          <MaterialCommunityIcons name="timer-sand" size={14} color={gradient[0]} />
          <Text style={[styles.timerElsewhereText, { color: colors.muted }]}>
            Timer läuft weiter für Schritt {(activeTimerStepIndex ?? 0) + 1} · noch {formatTime(remainingSeconds ?? 0)}
          </Text>
        </View>
      )}

      {displayedRemainingSeconds !== null && (
        <View style={[styles.timerCard, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.timerLabel, { color: colors.muted }]}>
            {displayedIsTimerRunning ? 'TIMER LÄUFT' : displayedRemainingSeconds === 0 ? 'FERTIG' : 'TIMER'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={[styles.timerValue, { color: gradient[0] }]}>{formatTime(displayedRemainingSeconds)}</Text>
            {!isTimerRunningElsewhere && (
              <Pressable onPress={handleOpenTimerEdit} hitSlop={10}>
                <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>
          {!displayedIsTimerRunning && displayedRemainingSeconds > 0 && (
            <Pressable onPress={handleStartTimer} style={[styles.timerButton, { backgroundColor: gradient[0], borderRadius: radius.sm }]}>
              <Text style={styles.timerButtonText}>{t('kochen.timerStarten')}</Text>
            </Pressable>
          )}
          {displayedIsTimerRunning && (
            <Pressable onPress={handlePauseTimer} style={[styles.timerButton, { backgroundColor: colors.bg, borderRadius: radius.sm }]}>
              <Text style={[styles.timerButtonText, { color: colors.text }]}>{t('kochen.pausieren')}</Text>
            </Pressable>
          )}
        </View>
      )}
      </View>
      </View>
      </ScrollView>

      <View style={[styles.navRow, { paddingBottom: insets.bottom }]}>
        <Pressable onPress={goBackStep} style={[styles.navButtonSecondary, { borderColor: colors.muted, borderRadius: radius.md }]}>
          <Text style={[styles.navButtonSecondaryText, { color: colors.muted }]}>{t('allgemein.zurueck')}</Text>
        </Pressable>
        <Pressable onPress={goNext} style={[styles.navButtonPrimary, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={styles.navButtonPrimaryText}>{isLastStep ? t('allgemein.fertig') : t('allgemein.weiter')}</Text>
        </Pressable>
      </View>

      <Modal visible={isNoteModalOpen} transparent animationType="fade" onRequestClose={() => setIsNoteModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('kochen.notizZuSchritt')}</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('kochen.notizPlatzhalter')}
              placeholderTextColor={colors.muted}
              value={noteDraft}
              onChangeText={setNoteDraft}
              multiline
              autoFocus
            />
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => { Keyboard.dismiss(); setIsNoteModalOpen(false); }} style={styles.modalCancelButton}>
                <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={handleSaveNote}
                disabled={isSavingNote}
                style={[styles.modalSaveButton, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: isSavingNote ? 0.7 : 1 }]}
              >
                {isSavingNote ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>{t('allgemein.speichern')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isStepTextModalOpen} transparent animationType="fade" onRequestClose={() => setIsStepTextModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('kochen.kochschrittBearbeiten')}</Text>
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
                <Pressable onPress={() => { Keyboard.dismiss(); setIsStepTextModalOpen(false); }} style={styles.modalCancelButton}>
                  <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveStepText}
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
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('kochen.zutatBearbeiten')}</Text>
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
                  onPress={handleSaveIngredient}
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

      <Modal visible={isEditingTimer} transparent animationType="fade" onRequestClose={() => setIsEditingTimer(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('kochen.timerZeitAendern')}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <TextInput
                style={[styles.modalInput, { flex: 1, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, textAlign: 'center', fontSize: 20 }]}
                keyboardType="numeric"
                value={timerEditDraft}
                onChangeText={setTimerEditDraft}
                autoFocus
              />
              <Text style={{ color: colors.muted, fontSize: 13 }}>{t('kochen.minuten')}</Text>
            </View>
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => { Keyboard.dismiss(); setIsEditingTimer(false); }} style={styles.modalCancelButton}>
                <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={() => { Keyboard.dismiss(); handleSaveTimerEdit(); }}
                style={[styles.modalSaveButton, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
              >
                <Text style={styles.modalSaveText}>Übernehmen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {umstellung && (
        <View style={styles.umstellungOverlay}>
          <View style={[styles.umstellungKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <ActivityIndicator color={gradient[0]} />
            <Text style={[styles.umstellungText, { color: colors.text }]}>
              {level === 'anfaenger'
                ? t('kochen.umstellungAnfaenger')
                : level === 'profi'
                  ? t('kochen.umstellungProfi')
                  : t('kochen.umstellungAllgemein')}
            </Text>
            <Text style={[styles.umstellungHinweis, { color: colors.muted }]}>
              {t('kochen.umstellungHinweis')}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Deckt den ganzen Schirm ab und schluckt Beruehrungen: Waehrend der
  // Umstellung stehen Schritte und Tipps noch aus verschiedenen Fassungen
  // nebeneinander. Weiterblaettern waere da nicht nur verwirrend, sondern
  // am Herd auch gefaehrlich.
  umstellungOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  umstellungKarte: { padding: 22, alignItems: 'center', maxWidth: 320 },
  umstellungText: { fontSize: 14.5, fontWeight: '600', textAlign: 'center', marginTop: 12 },
  umstellungHinweis: { fontSize: 12, textAlign: 'center', marginTop: 6 },
  container: { flex: 1, padding: 20 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  levelRow: { flexDirection: 'row', marginBottom: 12, gap: 6 },
  levelButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 3, minHeight: 44, paddingHorizontal: 6,
  },
  levelHat: { fontSize: 17 },
  spaltenReihe: { flexDirection: 'row', gap: 20, alignItems: 'flex-start' },
  spalteZutaten: { width: 260 },
  spalteSchritt: { flex: 1 },
  ingredientsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, marginBottom: 4 },
  ingredientsToggleText: { fontSize: 12.5, fontWeight: '600' },
  ingredientsList: { padding: 12, marginBottom: 16 },
  schrittZutaten: { paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, gap: 2 },
  schrittZutatenTitel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 2 },
  ingredientLine: { fontSize: 12.5, lineHeight: 20 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  stepIndicator: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  progressSegmentsRow: { flexDirection: 'row', gap: 4, marginBottom: 24 },
  progressSegment: { flex: 1, height: 6, borderRadius: 3 },
  progressIconsRow: { flexDirection: 'row', gap: 4, marginBottom: 3, height: 14 },
  progressIconSlot: { flex: 1, alignItems: 'center' },
  stepTextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  stepText: { flex: 1, fontSize: 16, lineHeight: 24, fontWeight: '400' },
  speakButton: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  techniqueBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, marginBottom: 10 },
  techniqueText: { fontSize: 11 },
  brutzelCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 10 },
  brutzelText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },
  videoLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  videoLinkText: { fontSize: 11.5, fontWeight: '700' },
  noteCard: { backgroundColor: '#FEF3C7', borderRadius: 12, padding: 10, marginBottom: 16 },
  noteLabel: { fontSize: 10.5, fontWeight: '600', color: '#92400E', marginBottom: 3 },
  noteText: { fontSize: 11.5, fontStyle: 'italic', color: '#78350F' },
  addNoteButton: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderStyle: 'dashed', paddingVertical: 9, paddingHorizontal: 12, marginBottom: 16, alignSelf: 'flex-start' },
  addNoteText: { fontSize: 11.5 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 },
  modalCard: { padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 14 },
  modalInput: { minHeight: 80, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13.5, marginBottom: 16, textAlignVertical: 'top' },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  modalCancelButton: { paddingVertical: 8, paddingHorizontal: 4 },
  modalCancelText: { fontSize: 13, fontWeight: '600' },
  modalSaveButton: { paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  timerCard: { padding: 20, alignItems: 'center', marginBottom: 20 },
  timerElsewhereBanner: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, marginBottom: 10 },
  timerElsewhereText: { fontSize: 11.5, fontWeight: '600', flex: 1 },
  timerLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  timerValue: { fontSize: 32, fontWeight: '700', marginBottom: 12 },
  timerButton: { paddingHorizontal: 20, paddingVertical: 10 },
  timerButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  navRow: { flexDirection: 'row', gap: 10, marginTop: 'auto' },
  navButtonSecondary: { flex: 1, height: 50, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  navButtonSecondaryText: { fontWeight: '600', fontSize: 14 },
  navButtonPrimary: { flex: 2, height: 50, alignItems: 'center', justifyContent: 'center' },
  navButtonPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
