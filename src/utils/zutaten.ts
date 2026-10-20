/**
 * Zerlegt eine Zutatenzeile in Menge, Einheit und Name.
 *
 * Gebraucht wird das, weil die Erfassungs-Screens die Zutaten zum
 * Bearbeiten als eine Zeile je Zutat anzeigen ("500 g Hühnerbrust").
 * Beim Speichern wurde diese Zeile bisher vollstaendig in das Feld
 * "name" geschrieben, mit amount und unit auf null.
 *
 * Die Folgen sah man erst spaeter und an ganz anderer Stelle: Im
 * Rezept-PDF stand in jeder Portionsspalte "nach Bedarf", die
 * Einkaufsliste bekam Posten ohne Menge, das Umrechnen auf eine andere
 * Portionenzahl tat nichts, und die Naehrwert-Schaetzung hatte nichts zu
 * rechnen.
 *
 * Bewusst zurueckhaltend: Was sich nicht sicher zerlegen laesst, bleibt
 * vollstaendig im Namen. Eine falsch geratene Menge waere schlimmer als
 * gar keine - sie wird beim Umrechnen vervielfacht.
 */

export interface ZerlegteZutat {
  name: string;
  amount: number | null;
  unit: string | null;
}

// Gebraeuchliche Einheiten. Reihenfolge egal, der Vergleich ist exakt
// (nach Kleinschreibung und ohne Punkt am Ende).
const EINHEITEN = [
  'g', 'kg', 'mg', 'ml', 'l', 'dl', 'cl',
  // dag/dkg = Dekagramm, in oesterreichischen Rezepten gebraeuchlich
  'dag', 'dkg', 'deka', 'dekagramm',
  'gramm', 'kilo', 'kilogramm', 'liter', 'milliliter',
  'el', 'tl', 'kl', 'msp', 'prise', 'prisen',
  'eßl', 'essl', 'eßlöffel', 'esslöffel', 'teelöffel', 'kaffeelöffel', 'messerspitze',
  'stk', 'stück', 'stueck', 'st',
  'p', 'pk', 'pck', 'pkg', 'packung', 'päckchen', 'paeckchen', 'pkt', 'päckl', 'packerl',
  'dose', 'dosen', 'glas', 'gläser', 'glaeser',
  'bund', 'zehe', 'zehen', 'blatt', 'blätter', 'blaetter',
  'scheibe', 'scheiben', 'tasse', 'tassen', 'becher',
  'tropfen', 'schuss', 'handvoll', 'kopf', 'stange', 'stangen',
  'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb',
];

// Ausgeschriebene und abgekuerzte Schreibweisen auf eine gemeinsame Form
// bringen, damit die Einkaufsliste "3 Eßl" und "2 EL" zusammenzaehlt.
// Alles, was hier nicht steht, bleibt so, wie es auf der Vorlage stand.
const EINHEIT_NORMAL: Record<string, string> = {
  gramm: 'g', kilo: 'kg', kilogramm: 'kg', liter: 'l', milliliter: 'ml',
  dekagramm: 'dag', deka: 'dag',
  el: 'EL', 'eßl': 'EL', essl: 'EL', 'eßlöffel': 'EL', 'esslöffel': 'EL',
  tl: 'TL', 'teelöffel': 'TL', kl: 'KL', 'kaffeelöffel': 'KL',
  msp: 'Msp.', messerspitze: 'Msp.',
  p: 'Pkg.', pk: 'Pkg.', pck: 'Pkg.', pkg: 'Pkg.', pkt: 'Pkg.', packung: 'Pkg.',
  'päckchen': 'Pkg.', paeckchen: 'Pkg.', 'päckl': 'Pkg.', packerl: 'Pkg.',
};

/** Einheit in ihre gemeinsame Schreibweise bringen (siehe EINHEIT_NORMAL). */
export function einheitNormalisieren(einheit: string): string {
  const schluessel = einheit.toLowerCase().replace(/\.$/, '');
  return EINHEIT_NORMAL[schluessel] ?? einheit.replace(/\.$/, '');
}

/** "1/2" und "1,5" ebenso wie "1.5" und "1 1/2". */
function zahlLesen(text: string): { wert: number; rest: string } | null {
  const gemischt = text.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)\s*(.*)$/s);
  if (gemischt) {
    const nenner = Number(gemischt[3]);
    if (nenner > 0) {
      return { wert: Number(gemischt[1]) + Number(gemischt[2]) / nenner, rest: gemischt[4] };
    }
  }
  const bruch = text.match(/^(\d+)\s*\/\s*(\d+)\s*(.*)$/s);
  if (bruch) {
    const nenner = Number(bruch[2]);
    if (nenner > 0) return { wert: Number(bruch[1]) / nenner, rest: bruch[3] };
  }
  const dezimal = text.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/s);
  if (dezimal) {
    return { wert: Number(dezimal[1].replace(',', '.')), rest: dezimal[2] };
  }
  return null;
}

export function zutatZerlegen(zeile: string): ZerlegteZutat {
  const text = zeile.trim();
  if (!text) return { name: '', amount: null, unit: null };

  const zahl = zahlLesen(text);
  if (!zahl) {
    // Kein fuehrender Zahlenwert: "Salz", "Pfeffer". "etwas Milch" / "ein Schuss Rum"
    // (20.10.2026): Menge leer, das Wort steht als Einheit, der Rest ist der Name.
    const ohneZahl = text.match(/^(?:ein(?:en|e)?\s+)?(etwas|schuss|schuß|spritzer)\s+(.+)$/i);
    if (ohneZahl) {
      const wort = ohneZahl[1].toLowerCase();
      return { name: ohneZahl[2].trim(), amount: null, unit: wort === 'etwas' ? 'etwas' : wort === 'spritzer' ? 'Spritzer' : 'Schuss' };
    }
    return { name: text, amount: null, unit: null };
  }

  const rest = zahl.rest.trim();

  // Spannen bleiben ungeteilt: "2 bis 3 Bananen", "2 -3 Ei", "2-3 Eier".
  // Eine Spanne hat keine eine Menge - "2" herauszuziehen und "bis 3
  // Bananen" als Namen stehen zu lassen, waere schlechter als gar nichts.
  if (/^(bis|-|–|bis zu)\b/i.test(rest) || /^\d/.test(rest)) {
    return { name: text, amount: null, unit: null };
  }
  const woerter = rest.split(/\s+/);
  const erstes = (woerter[0] || '').toLowerCase().replace(/\.$/, '');

  if (erstes && EINHEITEN.includes(erstes)) {
    const name = woerter.slice(1).join(' ').trim();
    // "500 g" ohne Zutat waere unbrauchbar - dann lieber alles im Namen.
    if (!name) return { name: text, amount: null, unit: null };
    return { name, amount: zahl.wert, unit: einheitNormalisieren(woerter[0]) };
  }

  // Zahl ohne Einheit: "3 Zwiebeln", "4 Eier".
  if (!rest) return { name: text, amount: null, unit: null };
  return { name: rest, amount: zahl.wert, unit: null };
}

/** Menge aus einem Eingabefeld in eine Zahl umwandeln (20.10.2026): Komma UND Punkt als
 * Dezimaltrenner ("62,5" = "62.5"), auch "1/2". Leer oder unlesbar → null. Vorher wurde
 * "62,5" zu NaN und die Menge beim Speichern komplett gelöscht. */
export function mengeAlsZahl(eingabe: string | number | null | undefined): number | null {
  if (eingabe === null || eingabe === undefined) return null;
  if (typeof eingabe === 'number') return Number.isFinite(eingabe) ? eingabe : null;
  const s = eingabe.trim().replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const bruch = s.match(/^(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
  if (bruch) {
    const n = Number(bruch[1]) / Number(bruch[2]);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
