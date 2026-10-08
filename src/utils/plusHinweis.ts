// Hinweise des Maskottchens an den Stellen, an denen es um Plus geht (AI Coins knapp/aufgebraucht, Teilen,
// Speicher knapp, Ende der Starteraktion). Welcher Hinweis kommt, bestimmt der Schalter PURCHASES_ENABLED
// im Backend (Status `kaeufe_aktiv`) - ohne neuen Build umschaltbar:
//   AUS: "Plus kommt bald - vormerken?" (nichts zu kaufen). Je Nutzer und App nur EINMAL vormerkbar.
//   AN : Kaufhinweis "Mehr mit Plus" mit "Plus ansehen" / "Spaeter".
// Jeder Hinweis erscheint je Anlass hoechstens einmal im Monat; "Spaeter" schliesst ihn nur.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';
import { t } from '../i18n';
import { letzterStatus, plusVormerken, statusLaden, type KaufAnlass, type PlusAnlass } from '../api/marketing';

const SCHLUESSEL = 'meinkochbuch:plusHinweis:';
const SCHLUESSEL_KAUF = 'meinkochbuch:kaufHinweis:';
const PLUS_DA_GEZEIGT = 'meinkochbuch:plusDaGezeigt';

// "Plus ansehen" fuehrt zum Profil (dort steht der Block AI Coins). Registriert MarketingHost.
let zumProfil: (() => void) | null = null;
export function setzeProfilAktion(aktion: (() => void) | null) { zumProfil = aktion; }

function monat(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mehrere gleichzeitige Fehlschlaege (z. B. 402 bei zwei Anfragen) sollen nur EIN Fenster ergeben.
const letzteAnzeige: Partial<Record<KaufAnlass, number>> = {};

async function diesenMonatSchonGezeigt(schluessel: string): Promise<boolean> {
  try { return (await AsyncStorage.getItem(schluessel)) === monat(); } catch { return false; }
}

async function diesenMonatMerken(schluessel: string) {
  try { await AsyncStorage.setItem(schluessel, monat()); } catch { /* ohne Speicher: dann eben ohne Merker */ }
}

/**
 * Zeigt den passenden Plus-Hinweis, falls er jetzt dran ist. Gibt true zurueck, wenn ein Fenster erschien.
 * `vorText`: Satz davor (z. B. die Meldung "AI Coins aufgebraucht"), `titel`: eigener Titel,
 * `immer`: Monatssperre ignorieren (nur fuer "AI Coins aufgebraucht" - dort erscheint ohnehin ein Fenster),
 * `werte`: Platzhalter fuer den Text (z. B. { datum }).
 */
export async function plusVormerkenZeigen(
  anlass: KaufAnlass,
  opts: { vorText?: string; titel?: string; immer?: boolean; werte?: Record<string, string | number> } = {},
): Promise<boolean> {
  try {
    if (Date.now() - (letzteAnzeige[anlass] ?? 0) < 8000) return true;
    const status = letzterStatus() ?? (await statusLaden());

    if (status.kaeufe_aktiv) {
      const key = SCHLUESSEL_KAUF + anlass;
      if (!opts.immer && (await diesenMonatSchonGezeigt(key))) return false;
      letzteAnzeige[anlass] = Date.now();
      await diesenMonatMerken(key);
      showBrutzelHinweis({
        title: opts.titel ?? t('marketing.kauf.titel'),
        text: (opts.vorText ? opts.vorText + '\n\n' : '') + t(`marketing.kauf.${anlass}`, opts.werte),
        buttons: [
          { text: t('marketing.kauf.ansehen'), onPress: () => zumProfil?.() },
          { text: t('marketing.kauf.spaeter'), style: 'cancel' },
        ],
      });
      return true;
    }

    // Kaeufe noch aus: nur "Plus kommt bald", und nur solange noch nicht vorgemerkt.
    if (!status.plus_vormerken_anbieten || anlass === 'starteraktion_ende') return false;
    const key = SCHLUESSEL + anlass;
    if (!opts.immer && (await diesenMonatSchonGezeigt(key))) return false;
    letzteAnzeige[anlass] = Date.now();
    await diesenMonatMerken(key);

    const vormerkAnlass: PlusAnlass = anlass;
    showBrutzelHinweis({
      title: opts.titel ?? t('marketing.plus.titel'),
      text: (opts.vorText ? opts.vorText + '\n\n' : '') + t(`marketing.plus.${vormerkAnlass}`),
      buttons: [
        {
          text: t('marketing.plus.ja'),
          onPress: () => {
            plusVormerken(vormerkAnlass)
              .then(() => showBrutzelHinweis({ title: t('marketing.plus.titel'), text: t('marketing.plus.danke') }))
              .catch(() => showBrutzelHinweis({ title: t('marketing.plus.titel'), text: t('marketing.plus.fehler') }));
          },
        },
        { text: t('marketing.plus.spaeter'), style: 'cancel' },
      ],
    });
    return true;
  } catch {
    return false;   // ohne Netz einfach kein Hinweis - nie den eigentlichen Ablauf stoeren
  }
}

/** Plus ist gestartet: wer sich vormerken liess, bekommt EINMAL "Plus ist da". */
export async function plusDaZeigen(): Promise<boolean> {
  try {
    if ((await AsyncStorage.getItem(PLUS_DA_GEZEIGT)) === '1') return false;
    await AsyncStorage.setItem(PLUS_DA_GEZEIGT, '1');
    showBrutzelHinweis({
      title: t('marketing.plusDa.titel'),
      text: t('marketing.plusDa.text'),
      buttons: [
        { text: t('marketing.kauf.ansehen'), onPress: () => zumProfil?.() },
        { text: t('marketing.kauf.spaeter'), style: 'cancel' },
      ],
    });
    return true;
  } catch {
    return false;
  }
}
