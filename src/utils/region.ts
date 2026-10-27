import * as Localization from 'expo-localization';

/** Ländercode des Geräts (z. B. 'DE', 'AT'); null, wenn nicht ermittelbar. Defensiv, damit nie der Start leidet. */
export function geraeteLand(): string | null {
  try {
    const code = Localization.getLocales?.()?.[0]?.regionCode;
    return code ? code.toUpperCase() : null;
  } catch {
    return null;
  }
}

const LAND_PAKET: Record<string, string> = {
  AT: 'oesterreich', DE: 'deutsch', CH: 'schweiz', IT: 'italienisch', PL: 'polnisch',
};

/** Starter-Paket des Landes (z. B. 'AT' -> ['oesterreich']); leer, wenn es keins gibt. */
export function landesPaket(land: string | null): string[] {
  const key = land ? LAND_PAKET[land] : undefined;
  return key ? [key] : [];
}
