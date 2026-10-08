import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { t } from '../i18n';
import { statusLaden } from '../api/marketing';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';

// Absichtlich nur das, was hier gebraucht wird, statt des vollen
// Navigations-Typs: Die Funktion wird aus vier verschiedenen Screens
// aufgerufen, deren navigation-Objekte jeweils an ihre eigene Route
// gebunden sind und daher nicht denselben Typ haben. Sie koennen aber
// alle navigate und replace - und mehr braucht es nicht.
type Nav = Pick<NativeStackNavigationProp<MainStackParamList>, 'navigate' | 'replace'>;

// Was die KI aus Foto/Text erkannt hat - fuer die Anzeige beim allerersten Eintrag.
export type Erkannt = { zutaten: number; schritte: number; timer: number };

const ERKANNT_GEZEIGT = 'meinkochbuch:erkanntGezeigt';

/**
 * Beim ALLERERSTEN Eintrag zeigt Brutzel klar, was die KI erkannt hat (Zutaten, Schritte, Timer) -
 * einmal, danach nie wieder. Ohne Netz oder bei einem spaeteren Eintrag: leerer Text.
 */
async function erkanntText(erkannt?: Erkannt): Promise<string> {
  if (!erkannt) return '';
  try {
    if ((await AsyncStorage.getItem(ERKANNT_GEZEIGT)) === '1') return '';
    const status = await Promise.race([
      statusLaden(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
    ]);
    if (!status || status.eintraege !== 1) return '';
    await AsyncStorage.setItem(ERKANNT_GEZEIGT, '1');
    return '\n\n' + t('marketing.erkannt', erkannt);
  } catch {
    return '';
  }
}

/**
 * Was passiert, nachdem ein Rezept erfasst wurde - egal auf welchem Weg
 * (KI, Foto, Web-Import, aus dem Pool uebernommen).
 *
 * Vorher landete man nach dem Speichern wortlos wieder auf den Tabs. Das
 * ist genau der falsche Moment fuer eine Sackgasse: Wer sich gerade ein
 * Rezept besorgt hat, will es meistens entweder ansehen oder gleich
 * kochen - und dann auch die Zutaten einkaufen.
 *
 * Drei Wege statt eines, in der Reihenfolge ihrer Haeufigkeit:
 *   - Ansehen: Rezeptseite, dort haengen Einkaufsliste, Drucken, Notizen
 *   - Jetzt kochen: direkt in den Koch-Modus
 *   - Fertig: zurueck zur Uebersicht
 *
 * Als gemeinsame Funktion, weil vier Screens denselben Abschluss brauchen
 * und vier Kopien garantiert auseinanderlaufen wuerden.
 */
export function askWhatNext(
  navigation: Nav,
  recipe: { id: string; title: string },
  /**
   * true = das Rezept wurde nur angelegt, um es kochen zu koennen, und
   * soll danach wieder verschwinden ("Nur kochen"). Dann entfaellt die
   * Frage: Es geht direkt in den Koch-Modus, der es hinterher entfernt.
   */
  discardAfterCooking = false,
  /** Zahlen fuer die Anzeige "Das habe ich erkannt" (nur beim ersten Eintrag sichtbar). */
  erkannt?: Erkannt,
) {
  if (discardAfterCooking) {
    navigation.replace('CookMode', { recipeIds: [recipe.id], discardAfterId: recipe.id });
    return;
  }

  // Zwei Wege statt drei. 'Fertig' war der dritte Knopf und fuehrte nur
  // aufs Dashboard - dasselbe erreicht man mit 'Abbrechen', und genau das
  // erwartet man bei einem Dialog auch. Drei fast gleichwertige Knoepfe
  // kosten eine Entscheidung, die niemand treffen will.
  void erkanntText(erkannt).then((zusatz) => {
    Alert.alert(
      t('nachSpeichern.titel'),
      t('nachSpeichern.text', { titel: recipe.title }) + zusatz,
      [
        { text: t('nachSpeichern.abbrechen'), style: 'cancel', onPress: () => navigation.navigate('MainTabs') },
        {
          text: t('nachSpeichern.ansehen'),
          onPress: () =>
            navigation.replace('RecipeDetail', { recipeId: recipe.id, title: recipe.title }),
        },
        {
          text: t('nachSpeichern.kochen'),
          onPress: () =>
            // replace statt navigate: Der Erfassen-Screen soll nicht hinter
            // dem Koch-Modus liegen bleiben - ein "Zurueck" aus dem Kochen
            // fuehrt sonst in ein Formular, das es so nicht mehr gibt.
            navigation.replace('CookMode', { recipeIds: [recipe.id] }),
        },
      ],
    );
  });
}
