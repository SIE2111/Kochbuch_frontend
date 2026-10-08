// "Freunde einladen": System-Teilen-Menue mit persoenlichem Code, und Einloesen eines Codes mit
// Rueckmeldung des Maskottchens. Beide bekommen beim Einloesen einmalig 50 AI Coins (Regeln im Backend).
import { Share } from 'react-native';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';
import { getSprache, t } from '../i18n';
import { einladungEinloesen, einladungLaden } from '../api/marketing';

/** Oeffnet das Teilen-Menue des Geraets mit Einladungstext (Code und Store-Link). */
export async function einladungTeilen(): Promise<void> {
  try {
    const info = await einladungLaden(getSprache());
    await Share.share({ message: info.text });
  } catch {
    showBrutzelHinweis({ title: t('marketing.einladung.titel'), text: t('marketing.einladung.teilenFehler') });
  }
}

/** Loest einen Code ein und zeigt das Ergebnis als Maskottchen-Hinweis. Gibt true bei Erfolg zurueck. */
export async function einladungEinloesenMitHinweis(code: string): Promise<boolean> {
  try {
    const r = await einladungEinloesen(code);
    showBrutzelHinweis({
      title: t('marketing.einladung.titel'),
      text: t(`marketing.einladung.status.${r.status}`, { bonus: r.bonus }),
    });
    return r.status === 'ok';
  } catch {
    showBrutzelHinweis({ title: t('marketing.einladung.titel'), text: t('marketing.einladung.status.fehler') });
    return false;
  }
}
