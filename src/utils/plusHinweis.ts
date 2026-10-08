// "Plus kommt bald - vormerken": Hinweis des Maskottchens an den Stellen, an denen spaeter Kaufhinweise
// stehen (AI Coins knapp/aufgebraucht, Teilen, Speicher knapp). Gilt nur, solange der Schalter
// PURCHASES_ENABLED im Backend AUS ist (dann gibt es nirgends etwas zu kaufen). Je Nutzer und App
// wird nur EINMAL vorgemerkt; danach kommen diese Hinweise nicht mehr. Ein "Spaeter" blendet den
// Hinweis fuer denselben Anlass bis zum naechsten Monat aus.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';
import { t } from '../i18n';
import { letzterStatus, plusVormerken, statusLaden, type PlusAnlass } from '../api/marketing';

const SCHLUESSEL = 'meinkochbuch:plusHinweis:';

function monat(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Mehrere gleichzeitige Fehlschlaege (z. B. 402 bei zwei Anfragen) sollen nur EIN Fenster ergeben.
const letzteAnzeige: Partial<Record<PlusAnlass, number>> = {};

async function diesenMonatSchonGezeigt(anlass: PlusAnlass): Promise<boolean> {
  try { return (await AsyncStorage.getItem(SCHLUESSEL + anlass)) === monat(); } catch { return false; }
}

async function diesenMonatMerken(anlass: PlusAnlass) {
  try { await AsyncStorage.setItem(SCHLUESSEL + anlass, monat()); } catch { /* ohne Speicher: dann eben ohne Merker */ }
}

/**
 * Zeigt den Vormerk-Hinweis, falls er jetzt dran ist. Gibt true zurueck, wenn ein Fenster erschien.
 * `vorText`: Satz davor (z. B. die Meldung "AI Coins aufgebraucht"), `titel`: eigener Titel.
 * `immer`: Monatssperre ignorieren (nur fuer "AI Coins aufgebraucht" - dort erscheint ohnehin ein Fenster).
 */
export async function plusVormerkenZeigen(
  anlass: PlusAnlass,
  opts: { vorText?: string; titel?: string; immer?: boolean } = {},
): Promise<boolean> {
  try {
    if (Date.now() - (letzteAnzeige[anlass] ?? 0) < 8000) return true;
    const status = letzterStatus() ?? (await statusLaden());
    if (status.kaeufe_aktiv || !status.plus_vormerken_anbieten) return false;
    if (!opts.immer && (await diesenMonatSchonGezeigt(anlass))) return false;
    letzteAnzeige[anlass] = Date.now();
    await diesenMonatMerken(anlass);

    const text = (opts.vorText ? opts.vorText + '\n\n' : '') + t(`marketing.plus.${anlass}`);
    showBrutzelHinweis({
      title: opts.titel ?? t('marketing.plus.titel'),
      text,
      buttons: [
        {
          text: t('marketing.plus.ja'),
          onPress: () => {
            plusVormerken(anlass)
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
