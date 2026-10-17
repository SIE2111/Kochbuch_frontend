import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Kochplan: Rezepte, deren Zutaten in die Einkaufsliste übernommen wurden -
 * damit man nach dem Einkaufen direkt in die Zubereitung einsteigen kann.
 *
 * Bewusst NICHT aus der Einkaufsliste abgeleitet (dort steht zwar
 * source_recipe_id): Wer nach dem Einkauf "Erledigte löschen" tippt, würde
 * damit genau dann den Bezug verlieren, wenn er kochen will.
 *
 * Ein Eintrag = Hauptgericht + gewählte Beilagen (so wie sie gemeinsam in die
 * Liste gingen) - wird gemeinsam im Koch-Modus gestartet (max. 3 parallel,
 * siehe CookModeScreen MAX_PARALLEL_RECIPES). Nur auf diesem Gerät.
 */
const KEY = 'kochbuch_kochplan';
const MAX_EINTRAEGE = 10;
const MAX_ALTER_TAGE = 14;

export interface KochplanEintrag {
  id: string;            // Hauptgericht
  titel: string;
  recipeIds: string[];   // [Hauptgericht, ...Beilagen] - Reihenfolge wichtig (Portionen gelten fürs erste)
  beilagen: string[];    // Titel der Beilagen, nur zur Anzeige
  portionen?: number;
  hinzugefuegtAm: string;
  begonnen?: boolean;    // Koch-Modus gestartet, aber noch nicht fertig -> Startseite 'Zuletzt zubereitet' (weiterkochen)
  verwerfenId?: string;  // 'Nur kochen, nicht behalten': Rezept wird erst nach dem Fertigkochen bzw. beim Entfernen gelöscht
}

function frisch(e: KochplanEintrag, jetzt = Date.now()): boolean {
  return jetzt - new Date(e.hinzugefuegtAm).getTime() < MAX_ALTER_TAGE * 24 * 3600 * 1000;
}

export async function kochplanLaden(): Promise<KochplanEintrag[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const liste: KochplanEintrag[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(liste) ? liste.filter((e) => e && e.id && Array.isArray(e.recipeIds) && frisch(e)) : [];
  } catch {
    return [];
  }
}

/** Gleiches Hauptgericht erneut übernommen -> Eintrag wird ersetzt (neue
 * Beilagen/Portionen) und rückt nach oben. */
export async function kochplanMerken(eintrag: Omit<KochplanEintrag, 'hinzugefuegtAm'>): Promise<void> {
  const liste = (await kochplanLaden()).filter((e) => e.id !== eintrag.id);
  const neu = [{ ...eintrag, recipeIds: eintrag.recipeIds.slice(0, 3), hinzugefuegtAm: new Date().toISOString() }, ...liste];
  await AsyncStorage.setItem(KEY, JSON.stringify(neu.slice(0, MAX_EINTRAEGE)));
}

export async function kochplanEntfernen(id: string): Promise<void> {
  const liste = (await kochplanLaden()).filter((e) => e.id !== id);
  await AsyncStorage.setItem(KEY, JSON.stringify(liste));
}

/** Koch-Modus wurde gestartet: Eintrag bleibt auf der Startseite, bis fertig gekocht
 * (kochplanEntfernen) oder vom Nutzer entfernt - auch nach "Zurück". */
export async function kochplanBegonnen(eintrag: Omit<KochplanEintrag, 'hinzugefuegtAm' | 'begonnen'>): Promise<void> {
  const liste = (await kochplanLaden()).filter((e) => e.id !== eintrag.id);
  const neu = [{ ...eintrag, recipeIds: eintrag.recipeIds.slice(0, 3), begonnen: true, hinzugefuegtAm: new Date().toISOString() }, ...liste];
  await AsyncStorage.setItem(KEY, JSON.stringify(neu.slice(0, MAX_EINTRAEGE)));
}
