// "Erst mal umschauen" ohne Konto (Version 1.1, Wunsch 02.11.2026).
// Der Gast ist ein anonymes Supabase-Konto. Will er etwas, das ein echtes Konto braucht (Pool, Haushalt,
// Einladungscode, Geschenk) - oder tippt er auf "Jetzt sichern" -, bietet Brutzel an, das Konto zu sichern:
// mit Apple, Google oder E-Mail. Vorher holt die App ein Uebernahme-Ticket; mit dem neuen Konto wandert
// danach alles, was der Gast angelegt hat, hinueber (Backend: POST /account/gast-uebernehmen).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../api/supabaseClient';
import { t } from '../i18n';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';

export const GAST_TICKET_KEY = 'gast_uebernahme_ticket_v1';

let fensterOffen = false;

async function ticketHolen(): Promise<boolean> {
  try {
    const { api } = require('../api/client') as typeof import('../api/client');   // erst beim Aufruf: kein Importkreis
    const r = await api.post<{ ticket: string }>('/account/gast-token', {});
    if (r?.ticket) await AsyncStorage.setItem(GAST_TICKET_KEY, r.ticket);
    return !!r?.ticket;
  } catch {
    return false;
  }
}

/** Brutzels Fenster "Sichere deine Rezepte". grund: kurzer Satz, warum (z. B. bei Pool-Teilen). */
export async function sichernAnbieten(grund?: string): Promise<void> {
  if (fensterOffen) return;
  fensterOffen = true;
  const { appleVerfuegbar, googleVerfuegbar, mitAppleAnmelden, mitGoogleAnmelden } =
    require('./socialLogin') as typeof import('./socialLogin');
  const apple = await appleVerfuegbar();
  const google = googleVerfuegbar();
  const fehler = (e: any) => showBrutzelHinweis({ title: t('gast.sichernTitel'), text: t('auth.socialFehler', { fehler: String(e?.message || e) }) });
  const social = (art: 'apple' | 'google') => async () => {
    fensterOffen = false;
    if (!(await ticketHolen())) { fehler(t('gast.ticketFehler')); return; }
    try {
      const erg = art === 'apple' ? await mitAppleAnmelden() : await mitGoogleAnmelden();
      if (!erg) await AsyncStorage.removeItem(GAST_TICKET_KEY).catch(() => undefined);   // abgebrochen: bleibt Gast
      // sonst: neue Sitzung -> AppNavigator uebernimmt die Gast-Rezepte
    } catch (e) { fehler(e); }
  };
  showBrutzelHinweis({
    title: t('gast.sichernTitel'),
    text: (grund ? grund + '\n\n' : '') + t('gast.sichernText'),
    buttons: [
      ...(apple ? [{ text: t('gast.mitApple'), onPress: social('apple') }] : []),
      ...(google ? [{ text: t('gast.mitGoogle'), onPress: social('google') }] : []),
      {
        text: t('gast.mitEmail'),
        onPress: async () => {
          fensterOffen = false;
          if (!(await ticketHolen())) { fehler(t('gast.ticketFehler')); return; }
          // Zur Anmeldung/Registrierung: Gast abmelden, die Rezepte kommen nach dem Anmelden mit
          await supabase.auth.signOut().catch(() => undefined);
        },
      },
      { text: t('hinweis.spaeter'), style: 'cancel' as const, onPress: () => { fensterOffen = false; } },
    ],
  });
}

/** Nach dem Anmelden mit einem echten Konto: Gast-Rezepte uebernehmen (falls ein Ticket wartet). */
export async function uebernahmeAusfuehren(): Promise<number> {
  const ticket = await AsyncStorage.getItem(GAST_TICKET_KEY).catch(() => null);
  if (!ticket) return 0;
  try {
    const { api } = require('../api/client') as typeof import('../api/client');
    const r = await api.post<{ moved: number }>('/account/gast-uebernehmen', { ticket });
    await AsyncStorage.removeItem(GAST_TICKET_KEY).catch(() => undefined);
    const n = r?.moved || 0;
    if (n > 0) showBrutzelHinweis({ title: t('gast.uebernommenTitel'), text: t('gast.uebernommenText') });
    return n;
  } catch {
    // Ticket abgelaufen o. ae.: nicht endlos wiederholen
    await AsyncStorage.removeItem(GAST_TICKET_KEY).catch(() => undefined);
    return 0;
  }
}
