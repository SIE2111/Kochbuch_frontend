import { Platform, NativeModules } from 'react-native';

/**
 * Laeuft die App gerade in Expo Go auf Android?
 *
 * Dort hat Expo seit SDK 53 den Push-Teil von expo-notifications
 * entfernt. Die Bibliothek wirft deshalb schon beim Registrieren des
 * Handlers - noch bevor ein Bildschirm erscheint, und obwohl diese App
 * gar keine Push-Nachrichten verschickt, sondern nur lokale
 * Timer-Meldungen.
 *
 * In einem richtigen Build (Entwicklungs- oder Store-Build) gibt es die
 * Einschraenkung nicht. Deshalb wird hier nicht die Funktion
 * abgeschaltet, sondern nur der eine Fall umgangen - sonst waere die App
 * auf Android in Expo Go ueberhaupt nicht zu testen.
 */
const IST_EXPO_GO_ANDROID =
  Platform.OS === 'android' &&
  (NativeModules?.ExponentConstants?.appOwnership ?? 'expo') === 'expo';

/**
 * Das Modul wird ERST BEIM AUFRUF geladen, nicht oben per import.
 *
 * Der erste Anlauf hat den Handler abgesichert und trotzdem nicht
 * gereicht: expo-notifications wirft bereits beim LADEN des Moduls, also
 * in dem Moment, in dem die Zeile `import ... from 'expo-notifications'`
 * ausgewertet wird. Eine Pruefung weiter unten im Code kommt dafuer zu
 * spaet - sie laeuft nie.
 *
 * Mit require() im Funktionsrumpf wird das Modul in Expo Go auf Android
 * gar nicht erst angefasst. In jedem echten Build laedt es wie zuvor.
 */
function nachrichten(): any | null {
  if (IST_EXPO_GO_ANDROID) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('expo-notifications');
}

/**
 * Timer-Push-Benachrichtigungen: wenn die App im Hintergrund ist und ein
 * Kochtimer ablaeuft, soll der Nutzer trotzdem benachrichtigt werden (siehe
 * Umsetzungskonzept, Abschnitt "paralleles Kochen" - Timer laeuft weiter,
 * auch wenn man gerade nicht in der App ist).
 */

const N = nachrichten();
if (N) {
  N.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/** Systemberechtigung fuer Benachrichtigungen, OHNE zu fragen: 'granted' | 'denied' | 'undetermined' | 'unavailable' (z. B. Expo Go). */
export async function notificationPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined' | 'unavailable'> {
  const N = nachrichten();
  if (!N) return 'unavailable';
  try {
    const { status } = await N.getPermissionsAsync();
    return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined';
  } catch { return 'unavailable'; }
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const N = nachrichten();
  if (!N) return false;
  const { status: existingStatus } = await N.getPermissionsAsync();
  if (existingStatus === 'granted') return true;

  const { status } = await N.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Plant eine lokale Benachrichtigung fuer den Moment, an dem der Timer
 * ablaeuft. Gibt die Notification-ID zurueck, die zum Abbrechen (Pause/
 * Schrittwechsel) gebraucht wird - oder null, wenn keine Berechtigung
 * vorliegt (Timer laeuft dann trotzdem weiter, nur ohne Push).
 */
export async function scheduleTimerNotification(recipeTitle: string, stepText: string, secondsFromNow: number): Promise<string | null> {
  const hasPermission = await ensureNotificationPermission();
  if (!hasPermission || secondsFromNow <= 0) return null;
  const N = nachrichten();
  if (!N) return null;

  return N.scheduleNotificationAsync({
    content: {
      title: `Timer fertig: ${recipeTitle}`,
      body: stepText.length > 80 ? `${stepText.slice(0, 80)}…` : stepText,
      sound: true,
    },
    trigger: {
      type: N.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsFromNow,
      ...(Platform.OS === 'android' ? { channelId: 'timer' } : {}),
    },
  });
}

export async function cancelTimerNotification(notificationId: string | null): Promise<void> {
  const N = nachrichten();
  if (!notificationId || !N) return;
  await N.cancelScheduledNotificationAsync(notificationId);
}

/** Android braucht einen expliziten Notification-Channel, sonst werden
 * Sound/Priority-Einstellungen ignoriert. iOS braucht das nicht. */
export async function setupNotificationChannel(): Promise<void> {
  const N = nachrichten();
  if (Platform.OS !== 'android' || !N) return;
  await N.setNotificationChannelAsync('timer', {
    name: 'Kochtimer',
    importance: N.AndroidImportance.HIGH,
    sound: 'default',
  });
}
