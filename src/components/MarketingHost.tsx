// Marketing-Hinweise des Maskottchens (Phase 1), einmal im NavigationContainer eingehaengt.
// Zeigt auf der Startseite (Home), hoechstens EIN Fenster je Pruefung und in dieser Reihenfolge:
//   1. Fuehrung zum ersten Eintrag ("Fotografiere jetzt dein Lieblingsrezept") - nur beim ersten Start
//   2. Bewertungsabfrage nach dem 5. Eintrag (System-Dialog, einmal je Nutzer und App)
//   3. "Plus ist da" (nur fuer Vormerker, nach dem Plus-Start)
//   4. AI Coins knapp (80 % verbraucht): "Plus kommt bald - vormerken" bzw. (ab Plus-Start) Kaufhinweis
//   5. Ende der Starteraktion naht (ab Plus-Start)
//   6. Freunde einladen, einmalig nach dem 10. Eintrag
//   (neu, Okt 2026) Einmalige Frage "Benachrichtigungen erhalten?" beim ersten Start (vor allem anderen); Ja fragt danach das System
//   (neu, Okt 2026) Einmalige Frage "Tipps und Angebote per E-Mail?" nach dem 1. Eintrag - ja ODER nein, danach nie wieder
// Alle Fenster kommen vom Maskottchen, nie als System-Alert. Fehler und fehlendes Netz stoeren nichts.
import { useEffect, useRef } from 'react';
import { AppState, Linking } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showBrutzelHinweis } from './BrutzelHinweis';
import { t, getSprache } from '../i18n';
import { api } from '../api/client';
import { ensureNotificationPermission, notificationCanAskAgain, notificationPermissionStatus } from '../utils/notifications';
import { aufBegruessungHoeren, begruessungStand } from '../utils/begruessung';
import { bewertungGefragt, einladungGezeigt, ersterSchrittErledigt, mailFrageBeantworten, statusLaden } from '../api/marketing';
import { einladungTeilen } from '../utils/einladung';
import { plusDaZeigen, plusVormerkenZeigen, setzeProfilAktion } from '../utils/plusHinweis';

type Nav = {
  addListener: (event: 'state', cb: () => void) => () => void;
  getCurrentRoute: () => { name: string } | undefined;
  isReady: () => boolean;
  navigate: (...args: any[]) => void;
};

const NACHRICHTEN_GEFRAGT_KEY = 'nachrichten_frage_beantwortet_v1';   // erste Fassung, nur noch zum Uebernehmen
const NACHRICHTEN_STAND_KEY = 'nachrichten_frage_stand_v2';
const MIN_ABSTAND_MS = 20000;   // nicht bei jedem Tab-Wechsel neu beim Server nachfragen
const COINS_ANTEIL_KNAPP = 0.8;  // AI Coins: ab 80 % verbraucht

type CoinsStand = { monthly_total: number; monthly_remaining: number; purchased: number; trial_ends?: string | null };
const STARTERAKTION_HINWEIS_TAGE = 14;   // so viele Tage vor dem Ende der Starteraktion

async function bewertungAnzeigen(): Promise<boolean> {
  // Eigenes Bewertungsfenster von iOS/Android (expo-store-review). Das Modul kommt erst mit einem
  // vollen Build; in aelteren Builds fehlt es, dann geschieht hier nichts - und es wird NICHT als
  // "gefragt" vermerkt, damit die Abfrage nach dem naechsten Build noch kommt.
  let modul: { isAvailableAsync?: () => Promise<boolean>; requestReview: () => Promise<void> } | null = null;
  try {
    // try/catch um require() allein reicht nicht: Metro meldet den Ladefehler vorab als FATAL (Absturz im Weinkeller 08.10.2026)
    if (!requireOptionalNativeModule('ExpoStoreReview')) return false;
    modul = require('expo-store-review');
  } catch { modul = null; }
  if (!modul) return false;
  try {
    if (modul.isAvailableAsync && !(await modul.isAvailableAsync())) return false;
    await bewertungGefragt();     // erst vermerken, dann fragen: hoechstens einmal je Nutzer und App
    await modul.requestReview();
    return true;
  } catch {
    return false;
  }
}

async function coinsLaden(): Promise<CoinsStand | null> {
  try { return await api.get<CoinsStand>('/coins'); } catch { return null; }
}

function coinsKnapp(c: CoinsStand): boolean {
  if (c.monthly_total <= 0 || c.purchased > 0) return false;
  return c.monthly_remaining > 0 && c.monthly_remaining <= c.monthly_total * (1 - COINS_ANTEIL_KNAPP);
}

/** Tage bis zum Ende der Starteraktion (null = laeuft nicht), Datum 'JJJJ-MM-TT'. */
function tageBisStarteraktionEnde(c: CoinsStand): number | null {
  if (!c.trial_ends) return null;
  const ende = new Date(c.trial_ends + 'T23:59:59');
  return Math.ceil((ende.getTime() - Date.now()) / 86400000);
}

function datumAnzeige(iso: string): string {
  const [j, m, tag] = iso.split('-');
  return `${tag}.${m}.${j}`;
}

/**
 * Brutzel fragt, ob der Nutzer Benachrichtigungen (Timer-Ende beim Kochen, Erinnerungen aus dem Wochenplan) erhalten
 * moechte: beim ersten Start, und solange sie nicht an sind wieder nach 7, 14 und 30 Tagen, danach einmal im Monat.
 * "Ja": das System fragt (hat man dort schon endgueltig abgelehnt, oeffnen sich die Einstellungen) und der Schalter im
 * Profil geht an. "Nein": Schalter im Profil aus. Sind sie im System erlaubt UND im Profil an, wird nicht mehr gefragt.
 * Gibt true zurueck, wenn ein Fenster gezeigt wurde.
 */
const TAG_MS = 86400000;
const NACHRICHTEN_ABSTAENDE_TAGE = [0, 7, 14, 30];   // ab der ersten Frage; danach alle 30 Tage ab der letzten
const NACHRICHTEN_MONATLICH_TAGE = 30;
type NachrichtenStand = { erstes: number; letztes: number; anzahl: number; fertig?: boolean };

async function nachrichtenStandLaden(): Promise<NachrichtenStand> {
  const roh = await AsyncStorage.getItem(NACHRICHTEN_STAND_KEY);
  if (roh) { try { return JSON.parse(roh); } catch { /* neu anfangen */ } }
  const alt = await AsyncStorage.getItem(NACHRICHTEN_GEFRAGT_KEY);   // Stand der ersten Fassung (nur einmal gefragt)
  const jetzt = Date.now();
  if (alt === 'ja' || alt === 'granted') return { erstes: jetzt, letztes: jetzt, anzahl: 1, fertig: true };
  if (alt) return { erstes: jetzt, letztes: jetzt, anzahl: 1 };
  return { erstes: 0, letztes: 0, anzahl: 0 };
}

function nachrichtenFaellig(st: NachrichtenStand, jetzt: number): boolean {
  if (st.anzahl <= 0) return true;
  const ab = st.anzahl < NACHRICHTEN_ABSTAENDE_TAGE.length
    ? st.erstes + NACHRICHTEN_ABSTAENDE_TAGE[st.anzahl] * TAG_MS
    : st.letztes + NACHRICHTEN_MONATLICH_TAGE * TAG_MS;
  return jetzt >= ab;
}

let nachrichtenFrageOffen = false;   // Fenster steht gerade: nicht doppelt zeigen
async function nachrichtenFrageZeigen(): Promise<boolean> {
  if (nachrichtenFrageOffen) return false;
  try {
    const status = await notificationPermissionStatus();
    if (status === 'unavailable') return false;                 // z. B. Expo Go auf Android: geht hier gar nicht
    const st = await nachrichtenStandLaden();
    const jetzt = Date.now();
    if (!nachrichtenFaellig(st, jetzt)) return false;
    // Schon an (im System erlaubt UND im Profil eingeschaltet)? Dann nie mehr fragen.
    if (status === 'granted') {
      let profilAn = st.fertig === true;
      try { profilAn = (await api.get<{ notifications_enabled?: boolean }>('/preferences/')).notifications_enabled !== false; } catch { /* wie gemerkt */ }
      if (profilAn) {
        await AsyncStorage.setItem(NACHRICHTEN_STAND_KEY, JSON.stringify({ ...st, fertig: true }));
        return false;
      }
    }
    const nochmal = st.anzahl > 0;
    const nurEinstellungen = status === 'denied' && !(await notificationCanAskAgain());
    const neu: NachrichtenStand = { erstes: st.erstes || jetzt, letztes: jetzt, anzahl: st.anzahl + 1 };
    await AsyncStorage.setItem(NACHRICHTEN_STAND_KEY, JSON.stringify(neu));
    nachrichtenFrageOffen = true;
    const speichern = async (an: boolean) => {
      try { await api.patch('/preferences/', { notifications_enabled: an }); } catch { /* Profil-Schalter bleibt wie er ist */ }
    };
    showBrutzelHinweis({
      title: t(nochmal ? 'marketing.nachrichtenFrage.titelNochmal' : 'marketing.nachrichtenFrage.titel'),
      text: t('marketing.nachrichtenFrage.text') + (nurEinstellungen ? '\n\n' + t('marketing.nachrichtenFrage.einstellungen') : ''),
      buttons: [
        {
          text: t('marketing.nachrichtenFrage.ja'),
          onPress: () => {
            nachrichtenFrageOffen = false;
            void (async () => {
              if (nurEinstellungen) {
                await speichern(true);
                Linking.openSettings().catch(() => undefined);
                return;   // ob es dort eingeschaltet wurde, zeigt die naechste Pruefung
              }
              const ok = await ensureNotificationPermission();
              await speichern(ok);
              if (ok) await AsyncStorage.setItem(NACHRICHTEN_STAND_KEY, JSON.stringify({ ...neu, fertig: true })).catch(() => undefined);
            })();
          },
        },
        {
          text: t('marketing.nachrichtenFrage.nein'),
          style: 'cancel',
          onPress: () => { nachrichtenFrageOffen = false; void speichern(false); },
        },
      ],
    });
    return true;
  } catch { return false; }
}

export default function MarketingHost({ navigationRef }: { navigationRef: Nav }) {
  const laeuft = useRef(false);
  const letzte = useRef(0);
  const ersterSchrittGezeigt = useRef(false);
  const start = useRef(Date.now());

  useEffect(() => {
    const pruefen = async () => {
      if (laeuft.current || !navigationRef.isReady()) return;
      if (navigationRef.getCurrentRoute()?.name !== 'Home') return;
      if (Date.now() - letzte.current < MIN_ABSTAND_MS) return;
      // Erst nach der Begruessung (Brutzel-Video beim Start), sonst laege das Fenster darueber.
      // Hat die Startseite nach 8 s noch nicht entschieden (z. B. kein Netz), nicht ewig warten.
      if (begruessungStand() === 'aktiv') return;
      if (begruessungStand() === 'offen' && Date.now() - start.current < 8000) { setTimeout(() => { void pruefen(); }, 1500); return; }
      laeuft.current = true;
      letzte.current = Date.now();
      try {
        if (await nachrichtenFrageZeigen()) return;     // beim ersten Start zuerst: Benachrichtigungen ja/nein
        const status = await statusLaden();

        if (status.erster_schritt_offen && !ersterSchrittGezeigt.current) {
          ersterSchrittGezeigt.current = true;
          showBrutzelHinweis({
            title: t('marketing.ersterSchritt.titel'),
            text: t('marketing.ersterSchritt.text'),
            buttons: [
              {
                text: t('marketing.ersterSchritt.foto'),
                onPress: () => {
                  ersterSchrittErledigt('foto').catch(() => undefined);
                  navigationRef.navigate('PhotoCapture');
                },
              },
              {
                text: t('marketing.ersterSchritt.spaeter'),
                style: 'cancel',
                onPress: () => { ersterSchrittErledigt('spaeter').catch(() => undefined); },
              },
            ],
          });
          return;
        }

        if (status.bewertung_faellig) {
          if (await bewertungAnzeigen()) return;
        }

        if (status.plus_da_hinweis && (await plusDaZeigen())) return;

        if (status.mail_frage_faellig) {
          const antworten = async (antwort: 'ja' | 'nein') => {
            try {
              await mailFrageBeantworten(antwort, getSprache());
              if (antwort === 'ja') showBrutzelHinweis({ title: t('marketing.mailFrage.titel'), text: t('marketing.mailFrage.danke') });
            } catch {
              if (antwort === 'ja') showBrutzelHinweis({ title: t('marketing.mailFrage.titel'), text: t('marketing.mailFrage.fehler') });
            }
          };
          showBrutzelHinweis({
            title: t('marketing.mailFrage.titel'),
            text: t('marketing.mailFrage.text', { bonus: status.mail_bonus ?? 10 }),
            buttons: [
              { text: t('marketing.mailFrage.ja'), onPress: () => { void antworten('ja'); } },
              { text: t('marketing.mailFrage.nein'), style: 'cancel', onPress: () => { void antworten('nein'); } },
            ],
          });
          return;
        }

        if (status.einladung_faellig) {
          einladungGezeigt().catch(() => undefined);   // nur EINMAL anbieten, egal wie die Antwort ausfaellt
          showBrutzelHinweis({
            title: t('marketing.einladung.titel'),
            text: t('marketing.einladung.angebot'),
            buttons: [
              { text: t('marketing.einladung.einladen'), onPress: () => { void einladungTeilen(); } },
              { text: t('marketing.einladung.spaeter'), style: 'cancel' },
            ],
          });
          return;
        }

        if (status.plus_vormerken_anbieten || status.kaeufe_aktiv) {
          const coins = await coinsLaden();
          if (coins) {
            if (coinsKnapp(coins) && (await plusVormerkenZeigen('coins_80'))) return;
          }
        }
      } catch {
        // kein Netz o. ae.: beim naechsten Mal wieder
      } finally {
        laeuft.current = false;
      }
    };

    setzeProfilAktion(() => navigationRef.navigate('MainTabs', { screen: 'Profil' }));
    const abmelden = navigationRef.addListener('state', () => { void pruefen(); });
    const begr = aufBegruessungHoeren(() => { if (begruessungStand() === 'fertig') { letzte.current = 0; setTimeout(() => { void pruefen(); }, 600); } });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') { letzte.current = 0; void pruefen(); } });
    void pruefen();
    return () => { abmelden(); begr(); app.remove(); setzeProfilAktion(null); };
  }, [navigationRef]);

  return null;
}
