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
