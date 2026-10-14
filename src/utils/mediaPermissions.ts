import { Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

/**
 * Fragt Foto-Bibliothek-Zugriff an und behandelt dabei zwei Faelle, die die
 * simple "if (!permission.granted)"-Pruefung bisher falsch behandelt hat:
 *
 * 1. iOS "Ausgewaehlte Fotos" (eingeschraenkter Zugriff, accessPrivileges
 *    === 'limited') ist ein GUELTIGER Zugriff, kein Ablehnen - der Nutzer
 *    hat bewusst nur einen Teil freigegeben, das reicht fuer die Auswahl.
 * 2. Wurde der Zugriff bereits einmal abgelehnt, fragt iOS beim erneuten
 *    Aufruf NICHT nochmal nach (canAskAgain === false) - der Dialog
 *    "Zugriff verweigert" allein bringt dann nichts, weil kein System-
 *    Dialog mehr erscheint. In diesem Fall bieten wir direkt einen Knopf
 *    zu den Einstellungen an, statt nur zu informieren.
 *
 * Android: Die Bildauswahl laeuft ueber den System-Fotoauswahldialog (Photo Picker),
 * der keine Berechtigung braucht. Google Play verlangt deshalb keine Foto-Berechtigung
 * (READ_MEDIA_IMAGES ist aus der App entfernt) - hier gibt es nichts anzufragen.
 *
 * Gibt true zurueck, wenn mit der Bildauswahl fortgefahren werden kann.
 */
export async function ensureMediaLibraryAccess(): Promise<boolean> {
  if (Platform.OS === 'android') return true;

  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (permission.granted || permission.accessPrivileges === 'limited' || permission.accessPrivileges === 'all') {
    return true;
  }

  if (!permission.canAskAgain) {
    Alert.alert(
      'Foto-Zugriff nötig',
      'Der Zugriff auf deine Fotos wurde bereits abgelehnt. Öffne die Einstellungen und aktiviere ihn dort für Mein Kochbuch, um Bilder auswählen zu können.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        { text: 'Einstellungen öffnen', onPress: () => Linking.openSettings() },
      ],
    );
    return false;
  }

  Alert.alert('Zugriff verweigert', 'Ohne Foto-Zugriff kann kein Bild ausgewählt werden.');
  return false;
}
