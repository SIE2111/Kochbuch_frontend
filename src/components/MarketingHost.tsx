// Marketing-Hinweise des Maskottchens (Phase 1), einmal im NavigationContainer eingehaengt.
// Zeigt auf der Startseite (Home), hoechstens EIN Fenster je Pruefung und in dieser Reihenfolge:
//   1. Fuehrung zum ersten Eintrag ("Fotografiere jetzt dein Lieblingsrezept") - nur beim ersten Start
//   2. Bewertungsabfrage nach dem 5. Eintrag (System-Dialog, einmal je Nutzer und App)
//   3. "Plus ist da" (nur fuer Vormerker, nach dem Plus-Start)
//   4. AI Coins knapp (80 % verbraucht): "Plus kommt bald - vormerken" bzw. (ab Plus-Start) Kaufhinweis
//   5. Ende der Starteraktion naht (ab Plus-Start)
// Alle Fenster kommen vom Maskottchen, nie als System-Alert. Fehler und fehlendes Netz stoeren nichts.
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { showBrutzelHinweis } from './BrutzelHinweis';
import { t } from '../i18n';
import { api } from '../api/client';
import { bewertungGefragt, ersterSchrittErledigt, statusLaden } from '../api/marketing';
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
  try { modul = require('expo-store-review'); } catch { modul = null; }
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

export default function MarketingHost({ navigationRef }: { navigationRef: Nav }) {
  const laeuft = useRef(false);
  const letzte = useRef(0);
  const ersterSchrittGezeigt = useRef(false);

  useEffect(() => {
    const pruefen = async () => {
      if (laeuft.current || !navigationRef.isReady()) return;
      if (navigationRef.getCurrentRoute()?.name !== 'Home') return;
      if (Date.now() - letzte.current < MIN_ABSTAND_MS) return;
      laeuft.current = true;
      letzte.current = Date.now();
      try {
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

        if (status.plus_vormerken_anbieten || status.kaeufe_aktiv) {
          const coins = await coinsLaden();
          if (coins) {
            if (coinsKnapp(coins) && (await plusVormerkenZeigen('coins_80'))) return;
            const tage = tageBisStarteraktionEnde(coins);
            if (status.kaeufe_aktiv && tage !== null && tage >= 0 && tage <= STARTERAKTION_HINWEIS_TAGE) {
              await plusVormerkenZeigen('starteraktion_ende', { werte: { datum: datumAnzeige(coins.trial_ends as string) } });
            }
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
    const app = AppState.addEventListener('change', (s) => { if (s === 'active') { letzte.current = 0; void pruefen(); } });
    void pruefen();
    return () => { abmelden(); app.remove(); setzeProfilAktion(null); };
  }, [navigationRef]);

  return null;
}
