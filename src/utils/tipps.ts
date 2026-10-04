import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Tipps des Maskottchens (04.10.2026, gleich in allen HomeArchive-Apps).
 * - Ein Tipp je App-Start, der Reihe nach; jeder nur einmal (gemerkt).
 * - Neue Tipps (hinten an die Liste) erscheinen automatisch, weil sie noch
 *   niemand gesehen hat - auch für "Neu: …"-Hinweise.
 * - Der erste Tipp "antippen" bleibt, bis man das Maskottchen einmal
 *   angetippt (oder den Tipp weggeklickt) hat; bis dahin trägt das
 *   Maskottchen ein "?"-Abzeichen.
 */
export const APP = 'kochbuch';
const K = (x: string) => `${APP}:tipps:${x}`;
const hoerer = new Set<() => void>();
const melden = () => hoerer.forEach((h) => h());

export async function gesehenLaden(): Promise<string[]> {
  try { return JSON.parse((await AsyncStorage.getItem(K('gesehen'))) ?? '[]'); } catch { return []; }
}

export async function alsGesehen(id: string): Promise<void> {
  const l = await gesehenLaden();
  if (!l.includes(id)) await AsyncStorage.setItem(K('gesehen'), JSON.stringify([...l, id])).catch(() => {});
}

/** Lokaler Schalter (Spiegel des "… hilft dir"-Schalters im Profil). */
export async function tippsErlaubt(): Promise<boolean> {
  return (await AsyncStorage.getItem(K('aus')).catch(() => null)) !== '1';
}

export async function tippsErlaubtSetzen(an: boolean): Promise<void> {
  await AsyncStorage.setItem(K('aus'), an ? '0' : '1').catch(() => {});
  melden();
}

/** Vom Maskottchen-Knopf aufrufen: blendet "?" und den Antipp-Tipp aus. */
export async function maskottchenAngetippt(): Promise<void> {
  await AsyncStorage.setItem(K('angetippt'), '1').catch(() => {});
  await alsGesehen('antippen');
  melden();
}

export function aufAenderungHoeren(fn: () => void): () => void {
  hoerer.add(fn);
  return () => { hoerer.delete(fn); };
}

/** Für das "?"-Abzeichen am Maskottchen. */
export function useMaskottchenAngetippt(): boolean {
  const [angetippt, setAngetippt] = useState(true);
  useEffect(() => {
    const laden = () => AsyncStorage.getItem(K('angetippt')).then((v) => setAngetippt(v === '1')).catch(() => {});
    laden();
    return aufAenderungHoeren(laden);
  }, []);
  return angetippt;
}
