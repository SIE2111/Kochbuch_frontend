// Ton der Begruessung (Wunsch 05.11.2026): Die Animation startet immer stumm - ungefragter Ton erschreckt.
// Ein Tipp auf "Ton an" schaltet Musik und Begruessung ein; die Wahl merkt sich die App fuer das naechste Mal.
// Der Profil-Schalter "Animations-Musik" bleibt die Obergrenze: steht er auf aus, startet es nie mit Ton.
import AsyncStorage from '@react-native-async-storage/async-storage'

const KEY = 'begruessung_ton_an_v1'

export async function begruessungTonGemerkt(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(KEY)) === '1' } catch { return false }
}

export function begruessungTonMerken(an: boolean): void {
  AsyncStorage.setItem(KEY, an ? '1' : '0').catch(() => undefined)
}
