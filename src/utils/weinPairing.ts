import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * "Passender Wein" - Absprung nach Mein Weinkeller und Rücksprung.
 *
 * Hin:    meinweinkeller://pairing?dish=…&ingredients=a,b&return=meinkochbuch://recipe/<id>
 * Zurück: meinkochbuch://recipe/<id>?wine=<Weinname>   bzw.  ?wine_result=none
 *
 * Der Rücksprung-Link kann von jeder App/Webseite aufgerufen werden und ist
 * daher unvertrauenswürdig: Rezept-ID nur aus erlaubten Zeichen, Weinname
 * gekürzt und von Steuerzeichen befreit. Er ändert nur eine lokale Notiz am
 * Rezept ("Dazu: …"), nichts am Rezept selbst.
 */

const STORAGE_PREFIX = 'kochbuch_wein_';
const PENDING_KEY = 'kochbuch_wein_offen';
const RECIPE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export interface GewaehlterWein {
  label: string;
  gewaehltAm: string; // ISO-Datum
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildWeinkellerLink(recipe: { id: string; title: string; ingredients: { name: string }[] }): string {
  const zutaten = recipe.ingredients.map((i) => clean(i.name.replace(/,/g, ' '), 60)).filter(Boolean).slice(0, 30);
  const params = [
    `dish=${encodeURIComponent(clean(recipe.title, 200))}`,
    ...(zutaten.length ? [`ingredients=${encodeURIComponent(zutaten.join(','))}`] : []),
    `return=${encodeURIComponent(`meinkochbuch://recipe/${recipe.id}`)}`,
  ];
  return `meinweinkeller://pairing?${params.join('&')}`;
}

export interface Ruecksprung {
  recipeId: string;
  wein: string | null; // null = ohne Wein zurück
}

/** Akzeptiert auch Expo-Entwicklungslinks (exp://…/--/recipe/<id>?…). */
export function parseRuecksprung(url: string | null | undefined): Ruecksprung | null {
  if (!url) return null;
  const q = url.indexOf('?');
  const pfad = q >= 0 ? url.slice(0, q) : url;
  const treffer = pfad.match(/(?:^meinkochbuch:\/\/|\/--\/)recipe\/([^/?#]+)\/?$/i);
  if (!treffer || !RECIPE_ID_PATTERN.test(treffer[1])) return null;
  const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '');
  const wein = clean(params.get('wine') ?? '', 200);
  return { recipeId: treffer[1], wein: wein || null };
}

export async function weinFuerRezeptLaden(recipeId: string): Promise<GewaehlterWein | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_PREFIX + recipeId);
    return raw ? (JSON.parse(raw) as GewaehlterWein) : null;
  } catch {
    return null;
  }
}

export async function weinFuerRezeptSpeichern(recipeId: string, label: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_PREFIX + recipeId, JSON.stringify({ label, gewaehltAm: new Date().toISOString() }));
}

export async function weinFuerRezeptEntfernen(recipeId: string): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_PREFIX + recipeId);
}

/** Merkt sich Titel des Rezepts vor dem Absprung - der Rücksprung-Link
 * enthält nur die ID, die Navigation braucht aber auch den Titel. */
export async function absprungMerken(recipeId: string, title: string): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ recipeId, title }));
}

export async function gemerktenTitelHolen(recipeId: string): Promise<string> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return p?.recipeId === recipeId ? String(p.title ?? '') : '';
  } catch {
    return '';
  }
}


/**
 * Sprung aus Mein Weinkeller ("Was koche ich dazu?" -> "Im Kochbuch öffnen",
 * 04.10.2026): meinkochbuch://gericht?name=Spargel%20mit%20Hollandaise&wein=…
 * Das Kochbuch öffnet ein eigenes Rezept mit diesem Namen oder - falls keins
 * existiert - "KI-Rezept", vorausgefüllt mit Gericht und Wein.
 */
export interface GerichtAusWeinkeller { name: string; wein: string | null }

export function parseGericht(url: string | null | undefined): GerichtAusWeinkeller | null {
  if (!url) return null;
  const q = url.indexOf('?');
  const pfad = q >= 0 ? url.slice(0, q) : url;
  if (!/(?:^meinkochbuch:\/\/|\/--\/)gericht\/?$/i.test(pfad)) return null;
  const params = new URLSearchParams(q >= 0 ? url.slice(q + 1) : '');
  const name = clean(params.get('name') ?? '', 120);
  if (!name) return null;
  const wein = clean(params.get('wein') ?? '', 200);
  return { name, wein: wein || null };
}

/** Gleicher Name ohne Groß/Klein, Akzente und Satzzeichen. */
export function gleicherTitel(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  return n(a) === n(b);
}

/** Ähnlicher Name: einer enthält den anderen (min. 2 Wörter bzw. 8 Zeichen),
 * z. B. "Spargel mit Sauce Hollandaise" ~ "Spargel mit Hollandaise" ist KEIN Treffer,
 * aber "Wiener Schnitzel" ~ "Wiener Schnitzel mit Erdäpfelsalat" schon. */
export function aehnlicherTitel(a: string, b: string): boolean {
  const n = (x: string) => x.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9äöüß]+/g, ' ').trim();
  const x = n(a), y = n(b);
  const kurz = x.length <= y.length ? x : y;
  const lang = x.length <= y.length ? y : x;
  if (kurz.length < 8 || kurz.split(' ').length < 2) return false;
  return (' ' + lang + ' ').includes(' ' + kurz + ' ');
}
