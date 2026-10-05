// In expo-file-system 57 liegen die klassischen Funktionen
// (documentDirectory, copyAsync, ...) im legacy-Zweig; der neue Zweig
// arbeitet mit File-/Directory-Objekten.
import * as FileSystem from 'expo-file-system/legacy';
import { api } from '../api/client';

/**
 * Legt ein Titelbild dort ab, wo der gewaehlte Speicherort es verlangt.
 *
 * Vorbild ist HomeArchive: Dort bleiben die Metadaten beim Server, und
 * nur die DATEI liegt bei "nur lokal" ausschliesslich am Geraet. Genau
 * dieses Muster gilt hier - das Rezept selbst (Titel, Zutaten, Schritte)
 * geht weiterhin in die Datenbank, sonst gaebe es weder Haushalt noch
 * Pool noch Wochenplan.
 *
 * Was "nur lokal" damit bedeutet, und was nicht:
 * - Das Bild verlaesst das Geraet nicht.
 * - Es ist damit auch nur auf diesem Geraet sichtbar. Andere im
 *   Haushalt sehen das Rezept ohne Bild, und beim Geraetewechsel ist es
 *   weg. Das ist der Preis, nicht ein Fehler.
 */

const ORDNER = 'rezeptbilder';

async function ordnerSicherstellen(): Promise<string> {
  // documentDirectory erst zur Laufzeit lesen: Beim allerersten Start
  // kann es zum Zeitpunkt des Imports noch leer sein.
  const pfad = `${FileSystem.documentDirectory || ''}${ORDNER}/`;
  const info = await FileSystem.getInfoAsync(pfad);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(pfad, { intermediates: true });
  }
  return pfad;
}

export type BildErgebnis = {
  /** Was als cover_image_url gespeichert wird. */
  url: string;
  /** Hinweis des Servers, falls beim Hochladen etwas auffiel. */
  warnung?: string | null;
  /** True, wenn das Bild nur auf diesem Gerät liegt. */
  nurLokal: boolean;
};

export async function titelbildAblegen(
  uri: string,
  storageMode: string | null | undefined,
  /** true: Das Foto eines eben ausgelesenen Rezepts - Auslesen und Hochladen zusammen kosten 1 AI Coin. */
  inklusiveScan = false,
): Promise<BildErgebnis> {
  const dateiname = uri.split('/').pop() ?? 'bild.jpg';
  const endung = dateiname.split('.').pop()?.toLowerCase();
  const typ = endung === 'png' ? 'image/png' : 'image/jpeg';

  if (storageMode === 'lokal') {
    const ordner = await ordnerSicherstellen();
    // Eindeutiger Name, damit zwei Fotos mit gleichem Namen aus der
    // Kamera einander nicht ueberschreiben.
    const ziel = `${ordner}${Date.now()}_${dateiname}`;
    await FileSystem.copyAsync({ from: uri, to: ziel });
    return { url: ziel, warnung: null, nurLokal: true };
  }

  const ergebnis = await api.uploadImage('/images/upload', uri, dateiname, typ, inklusiveScan ? { inkl_scan: 'true' } : {});
  return { url: ergebnis.url, warnung: ergebnis.storage_warning, nurLokal: false };
}
