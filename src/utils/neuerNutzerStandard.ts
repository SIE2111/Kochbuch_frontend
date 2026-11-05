// Standard fuer NEUE Konten: Animations-Musik ist aus.
// Gilt einmal je Konto und nur fuer Konten, die noch nicht lange bestehen - wer schon laenger dabei ist,
// behaelt seine Einstellung. Danach entscheidet allein der Schalter im Profil (er wird nie wieder ueberschrieben).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';

const NEU_TAGE = 2;   // so lange gilt ein Konto als "neu"

export async function musikStandardFuerNeue(userId: string | undefined, erstellt: string | undefined, aktuell: boolean): Promise<boolean> {
  if (!userId) return aktuell;
  const key = `musik_standard_aus_v1_${userId}`;
  try {
    if (await AsyncStorage.getItem(key)) return aktuell;
    await AsyncStorage.setItem(key, '1');
    const alter = erstellt ? Date.now() - new Date(erstellt).getTime() : Infinity;
    if (!(alter >= 0 && alter < NEU_TAGE * 86400000)) return aktuell;
    if (aktuell) await api.patch('/preferences/', { play_animation_music: false });
    return false;
  } catch {
    return aktuell;
  }
}
