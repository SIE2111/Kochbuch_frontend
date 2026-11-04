// Marketing-Hinweise des Maskottchens (Phase 1), einmal im NavigationContainer eingehaengt.
// Zeigt auf der Startseite (Home), hoechstens EIN Fenster je Pruefung und in dieser Reihenfolge:
//   1. Bewertungsabfrage nach dem 5. Eintrag (System-Dialog, einmal je Nutzer und App)
//   2. "Plus ist da" (nur fuer Vormerker, nach dem Plus-Start)
//   3. AI Coins knapp (80 % verbraucht): "Plus kommt bald - vormerken" bzw. (ab Plus-Start) Kaufhinweis
//   4. Ende der Starteraktion naht (ab Plus-Start)
//   5. Freunde einladen, einmalig nach dem 10. Eintrag
//   Einmalige Frage "Tipps und Angebote per E-Mail?" - ja ODER nein, danach nie wieder
//   (Nov 2026) Als Gast ("Erst mal umschauen") kommt KEIN Fenster. Die Frage nach Benachrichtigungen und die
//   Fuehrung "Los geht's" gibt es nicht mehr: Das System fragt selbst, wenn der erste Kochtimer gestartet wird.
// Alle Fenster kommen vom Maskottchen, nie als System-Alert. Fehler und fehlendes Netz stoeren nichts.
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showBrutzelHinweis } from './BrutzelHinweis';
import { t, getSprache } from '../i18n';
import { api } from '../api/client';
import { aufBegruessungHoeren, begruessungStand } from '../utils/begruessung';
import { EINLADUNG_FRAGE_KEY, useAuth } from '../context/AuthContext';
import { bewertungGefragt, einladungGezeigt, mailFrageBeantworten, statusLaden } from '../api/marketing';
import { einladungTeilen } from '../utils/einladung';
import { plusDaZeigen, plusVormerkenZeigen, setzeProfilAktion } from '../utils/plusHinweis';

type Nav = {
  addListener: (event: 'state', cb: () => void) => () => void;
  getCurrentRoute: () => { name: string } | undefined;
  isReady: () => boolean;
  navigate: (...args: any[]) => void;
};

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
    // Erst die Figur der App fragen (Wunsch 29.10.2026), bei "Ja" das Bewertungsfenster des Systems
    const store = modul;
    await bewertungGefragt();     // erst vermerken, dann fragen: hoechstens einmal je Nutzer und App
    showBrutzelHinweis({
      title: t('marketing.bewertung.titel'),
      text: t('marketing.bewertung.text'),
      buttons: [
        { text: t('marketing.bewertung.ja'), onPress: () => { setTimeout(() => { store.requestReview().catch(() => undefined) }, 700) } },
        { text: t('marketing.bewertung.nein'), style: 'cancel' },
      ],
    });
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

let weiterPruefen: () => void = () => undefined;   // nach einer beantworteten Frage gleich die naechste pruefen (MarketingHost setzt es)

export default function MarketingHost({ navigationRef }: { navigationRef: Nav }) {
  const laeuft = useRef(false);
  const letzte = useRef(0);
  const start = useRef(Date.now());
  // Wer nur "Erst mal umschauen" gewaehlt hat, wird mit keinem Fenster gestoert
  const { isGuest } = useAuth();
  const gast = useRef(isGuest);
  gast.current = isGuest;

  useEffect(() => {
    const pruefen = async () => {
      if (laeuft.current || gast.current || !navigationRef.isReady()) return;
      if (navigationRef.getCurrentRoute()?.name !== 'Home') return;
      if (Date.now() - letzte.current < MIN_ABSTAND_MS) return;
      // Erst nach der Begruessung (Brutzel-Video beim Start), sonst laege das Fenster darueber.
      // Hat die Startseite nach 8 s noch nicht entschieden (z. B. kein Netz), nicht ewig warten.
      if (begruessungStand() === 'aktiv') return;
      if (begruessungStand() === 'offen' && Date.now() - start.current < 8000) { setTimeout(() => { void pruefen(); }, 1500); return; }
      laeuft.current = true;
      letzte.current = Date.now();
      try {
        const status = await statusLaden();

        // Werbe-Info per E-Mail: nur fuer angemeldete Nutzer, danach nie wieder
        if (status.mail_frage_faellig) {
          const antworten = async (antwort: 'ja' | 'nein') => {
            try {
              const erg = await mailFrageBeantworten(antwort, getSprache());
              if (antwort === 'nein') weiterPruefen();
              // Mit bestaetigter E-Mail gilt das "Ja" sofort - sonst kommt die Bestaetigungs-Mail
              if (antwort === 'ja') showBrutzelHinweis({ title: t('marketing.mailFrage.titel'), text: t(erg?.status === 'bestaetigt' ? 'marketing.einstellung.sofortDabei' : 'marketing.mailFrage.danke') });
            } catch {
              if (antwort === 'nein') weiterPruefen();
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

        // Nach dem ersten Apple-/Google-Login: Einladungscode gab es dort kein Feld - also kurz fragen
        if (status.einladung_einloesbar && (await AsyncStorage.getItem(EINLADUNG_FRAGE_KEY).catch(() => null))) {
          await AsyncStorage.removeItem(EINLADUNG_FRAGE_KEY).catch(() => undefined);
          showBrutzelHinweis({
            title: t('marketing.einladungFrageTitel'),
            text: t('marketing.einladungFrageText'),
            buttons: [
              { text: t('marketing.einladungFrageJa'), onPress: () => { navigationRef.navigate('MainTabs', { screen: 'Profil' }); } },
              { text: t('marketing.einladungFrageNein'), style: 'cancel', onPress: () => { weiterPruefen(); } },
            ],
          });
          return;
        }

        if (status.bewertung_faellig) {
          if (await bewertungAnzeigen()) return;
        }

        if (status.plus_da_hinweis && (await plusDaZeigen())) return;

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
    weiterPruefen = () => { letzte.current = 0; setTimeout(() => { void pruefen(); }, 900); };
    const abmelden = navigationRef.addListener('state', () => { void pruefen(); });
    const begr = aufBegruessungHoeren(() => { if (begruessungStand() === 'fertig') { letzte.current = 0; setTimeout(() => { void pruefen(); }, 600); } });
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') { letzte.current = 0; void pruefen(); } });
    void pruefen();
    return () => { abmelden(); begr(); app.remove(); setzeProfilAktion(null); };
  }, [navigationRef]);

  return null;
}
