// Einmaliges Gratis-Paket (100 AI Coins), solange es noch keine Kaeufe gibt.
// Wird erst beim Aufruf geladen (api/client.ts importiert diese Datei nicht direkt: kein Importkreis).
import { api } from '../api/client';
import { t } from '../i18n';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';

type GeschenkApp = { key: string; name: string; url: string; installed: boolean };
type Stand = { gift_available?: boolean; gift_amount?: number; gift_received?: number; gift_locked?: boolean; gift_apps?: GeschenkApp[]; gift_apps_needed?: number };

/** Zeigt Brutzels Hinweis mit Knopf "Gratis holen". true = angeboten (dann KEIN weiterer Hinweis). */
export async function geschenkAnbieten(titel: string): Promise<boolean> {
  const s = await api.get<Stand>('/coins');
  if (!s?.gift_available) return false;
  if (s.gift_locked) { gesperrtZeigen(s); return true; }
  const n = s.gift_amount || 100;
  showBrutzelHinweis({
    title: titel,
    text: t('hinweis.coinsTextGeschenk', { n }),
    buttons: [
      { text: t('hinweis.geschenkHolen', { n }), onPress: () => { geschenkHolen(); } },
      { text: t('hinweis.spaeter'), style: 'cancel' },
    ],
  });
  return true;
}

export async function geschenkHolen(): Promise<boolean> {
  try {
    const s = await api.post<Stand>('/coins/gift', {});
    const n = s?.gift_received || 0;
    if (!n && s?.gift_locked) { gesperrtZeigen(s); return false; }
    showBrutzelHinweis(n > 0
      ? { title: t('hinweis.geschenkTitel'), text: t('hinweis.geschenkText', { n }) }
      : { title: t('hinweis.coinsTitel'), text: t('hinweis.geschenkSchonGeholt') });
    return n > 0;
  } catch {
    return false;
  }
}

/** Profil: "AI Coins kaufen" - bis es Bezahlung gibt, ist das Paket mit 100 AI Coins einmalig und vorerst ohne Kosten abholbar. */
export function kaufenZeigen(verfuegbar: boolean, n: number, danach?: () => void, stand?: Stand) {
  if (verfuegbar && stand?.gift_locked) { gesperrtZeigen(stand); return; }
  if (!verfuegbar) {
    showBrutzelHinweis({ title: t('hinweis.kaufenTitel'), text: t('hinweis.schonAbgeholt', { n }) });
    return;
  }
  showBrutzelHinweis({
    title: t('hinweis.kaufenTitel'),
    gross: String(n),
    grossText: t('hinweis.kaufenGross'),
    text: t('hinweis.kaufenText'),
    buttons: [
      { text: t('hinweis.bestaetigenAbholen'), onPress: () => { geschenkHolen().then(() => danach && danach()); } },
      { text: t('hinweis.spaeter'), style: 'cancel' },
    ],
  });
}

/** Das Gratis-Paket gibt es erst ab 3 unserer Apps (Wunsch 02.11.2026): zeigt, welche schon da sind, und verlinkt die fehlenden. */
export function gesperrtZeigen(s: any): void {
  const apps: { name: string; url: string; installed: boolean }[] = s?.gift_apps || [];
  const anzahl = apps.filter((a) => a.installed).length;
  const liste = apps.map((a) => `${a.installed ? '✓' : '○'} ${a.name}`).join('\n');
  const { Linking } = require('react-native');
  showBrutzelHinweis({
    title: t('hinweis.geschenkAbDreiTitel'),
    text: t('hinweis.geschenkAbDreiText', { n: s?.gift_amount || 100, min: s?.gift_apps_needed || 3, anzahl, liste }),
    buttons: [
      ...apps.filter((a) => !a.installed).map((a) => ({ text: t('hinweis.appAnsehen', { name: a.name }), onPress: () => { Linking.openURL(a.url).catch(() => undefined); } })),
      { text: t('hinweis.spaeter'), style: 'cancel' as const },
    ],
  });
}
