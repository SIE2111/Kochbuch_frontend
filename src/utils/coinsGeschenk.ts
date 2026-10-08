// Einmaliges Gratis-Paket (100 AI Coins), solange es noch keine Kaeufe gibt.
// Wird erst beim Aufruf geladen (api/client.ts importiert diese Datei nicht direkt: kein Importkreis).
import { api } from '../api/client';
import { t } from '../i18n';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';

type Stand = { gift_available?: boolean; gift_amount?: number; gift_received?: number };

/** Zeigt Brutzels Hinweis mit Knopf "Gratis holen". true = angeboten (dann KEIN weiterer Hinweis). */
export async function geschenkAnbieten(titel: string): Promise<boolean> {
  const s = await api.get<Stand>('/coins');
  if (!s?.gift_available) return false;
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
    showBrutzelHinweis(n > 0
      ? { title: t('hinweis.geschenkTitel'), text: t('hinweis.geschenkText', { n }) }
      : { title: t('hinweis.coinsTitel'), text: t('hinweis.geschenkSchonGeholt') });
    return n > 0;
  } catch {
    return false;
  }
}
