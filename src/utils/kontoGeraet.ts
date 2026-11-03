// Hat auf diesem Geraet schon einmal jemand mit einem echten Konto (nicht als Gast) angemeldet?
// Dann zeigt der Anmeldeschirm "Erst mal umschauen" nicht mehr an (Wunsch 03.11.2026): Der Knopf ist fuer
// Neue gedacht, wer schon registriert ist, soll sich anmelden. Zaehlt auch die gemerkte E-Mail.
import AsyncStorage from '@react-native-async-storage/async-storage';

const KONTO_KEY = 'hat_echtes_konto_v1';

export function kontoMerken(): void {
  AsyncStorage.setItem(KONTO_KEY, '1').catch(() => undefined);
}

export async function hatKontoAufGeraet(merkenKey: string): Promise<boolean> {
  try {
    const [k, m] = await Promise.all([AsyncStorage.getItem(KONTO_KEY), AsyncStorage.getItem(merkenKey)]);
    return !!k || !!m;
  } catch {
    return false;
  }
}
