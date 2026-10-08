// Marketing-Funktionen fuer Gratis-Nutzer (Phase 1): Anbindung an /marketing im Backend.
// Gleichlautend in jeder App der Familie - nur der Basis-Pfad der API (client.ts) unterscheidet sich.
import { api } from './client';

/** Anlaesse, an denen spaeter Kaufhinweise erscheinen - bis zum Plus-Start nur "Plus kommt bald". */
export type PlusAnlass = 'coins_80' | 'coins_leer' | 'teilen' | 'speicher_80';
/** Anlaesse nur fuer Kaufhinweise (gibt es nach dem Plus-Start): Ende der Starteraktion. */
export type KaufAnlass = PlusAnlass | 'starteraktion_ende';

export type MarketingStatus = {
  /** Schalter PURCHASES_ENABLED im Backend. false = es gibt keine Kaufoptionen und keine Kaufhinweise. */
  kaeufe_aktiv: boolean;
  /** Vormerk-Hinweis ("Plus kommt bald") darf noch gezeigt werden: Kaeufe aus und noch nicht vorgemerkt. */
  plus_vormerken_anbieten: boolean;
  plus_vorgemerkt: boolean;
  /** Plus ist gestartet und der Nutzer hatte sich vormerken lassen: einmal "Plus ist da" zeigen. */
  plus_da_hinweis: boolean;
  /** Freunde einladen: nach dem 10. Eintrag einmal anbieten. */
  einladung_faellig: boolean;
  /** Neues Konto, das noch einen Einladungscode eingeben darf. */
  einladung_einloesbar: boolean;
  eintraege: number;
  erster_schritt_offen: boolean;
  bewertung_faellig: boolean;
  einwilligung: { bestaetigt: boolean; angefragt: boolean };
};

// Letzter bekannter Stand - fuer Stellen, die nicht auf das Netz warten sollen (z. B. "AI Coins aufgebraucht").
let zwischenspeicher: MarketingStatus | null = null;

export function letzterStatus(): MarketingStatus | null {
  return zwischenspeicher;
}

export async function statusLaden(): Promise<MarketingStatus> {
  const s = await api.get<MarketingStatus>('/marketing/status');
  zwischenspeicher = s;
  return s;
}

/** Zwischenspeicher nach einer Aenderung (z. B. Vormerkung) nachziehen, ohne neu zu laden. */
export function statusMerken(teil: Partial<MarketingStatus>) {
  if (zwischenspeicher) zwischenspeicher = { ...zwischenspeicher, ...teil };
}

export async function einwilligungAnfragen(optIn: boolean, sprache: string): Promise<{ status: string }> {
  return api.post<{ status: string }>('/marketing/einwilligung', { opt_in: optIn, sprache });
}

export async function ersterSchrittErledigt(aktion: 'foto' | 'spaeter'): Promise<void> {
  await api.post('/marketing/erster-schritt', { aktion });
}

export async function bewertungGefragt(): Promise<void> {
  await api.post('/marketing/bewertung-gefragt');
}

export async function plusVormerken(anlass: PlusAnlass): Promise<void> {
  await api.post('/marketing/plus-vormerken', { anlass });
  statusMerken({ plus_vorgemerkt: true, plus_vormerken_anbieten: false });
}

export type EinladungInfo = { code: string; text: string; bonus: number; eingeladen_diesen_monat: number; limit_pro_monat: number };
export type EinloeseStatus = 'ok' | 'ungueltig' | 'eigener' | 'schon_eingeloest' | 'zu_alt' | 'limit_erreicht';

export async function einladungLaden(sprache: string): Promise<EinladungInfo> {
  return api.get<EinladungInfo>(`/marketing/einladung?sprache=${encodeURIComponent(sprache)}`);
}

export async function einladungEinloesen(code: string): Promise<{ status: EinloeseStatus; bonus: number }> {
  return api.post<{ status: EinloeseStatus; bonus: number }>('/marketing/einladung/einloesen', { code });
}

export async function einladungGezeigt(): Promise<void> {
  await api.post('/marketing/einladung-gezeigt');
}
