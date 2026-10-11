import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api } from '../api/client';
import { kochplanEntfernen } from '../utils/kochplan';
import SingleRecipeCookView from '../components/SingleRecipeCookView';
import CookingFinishedCelebration from '../components/CookingFinishedCelebration';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<MainStackParamList, 'CookMode'>;

const MAX_PARALLEL_RECIPES = 3;

export default function CookModeScreen({ route, navigation }: Props) {
  const { colors, gradient } = useTheme();
  const { t } = useUebersetzung();
  const recipeIds = route.params.recipeIds.slice(0, MAX_PARALLEL_RECIPES);

  const [activeIndex, setActiveIndex] = useState(0);
  // Welche Rezepte tatsaechlich fertiggekocht sind - NICHT ueber den
  // aktiven Reiter ableitbar. Genau das war der Fehler: Geprueft wurde, ob
  // der aktive Reiter der letzte in der Liste ist. Wer beim Parallelkochen
  // zuerst das dritte Rezept fertig hatte, beendete damit den gesamten
  // Vorgang, obwohl eins und zwei noch offen waren.
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [showCelebration, setShowCelebration] = useState(false);

  // "Nur fuer diesen Kochvorgang" uebernommene Verbesserungsvorschlaege
  // (siehe RecipeDetailScreen) - werden NICHT im Rezept gespeichert, nur
  // hier einmalig beim Betreten des Koch-Modus angezeigt.
  useEffect(() => {
    if (route.params.sessionNote) {
      Alert.alert(t('sonstiges.fuerDiesenKochvorgang'), route.params.sessionNote);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Nur kochen, nicht behalten": Das Rezept wurde nur angelegt, damit der
  // Koch-Modus ueberhaupt etwas zu arbeiten hat - Timer, Schritt-Tipps,
  // Hauben-Stufen und Notizen haengen alle an einer Rezept-ID. Nach dem
  // Vorgang kommt es wieder weg.
  //
  // Fehler werden geschluckt: Bleibt das Rezept im Kochbuch stehen, ist das
  // aergerlich, aber harmlos - eine Fehlermeldung nach dem Essen waere
  // schlimmer als ein Rezept zu viel.
  const discardIfRequested = async () => {
    const id = route.params.discardAfterId;
    if (!id) return;
    try {
      await api.delete(`/recipes/${id}`);
    } catch {
      // siehe oben
    }
  };

  const finishSession = () => {
    // Nur das HAUPTGERICHT (recipeIds[0]) zaehlt als "zubereitet" fuers
    // Dashboard - mitgekochte Beilagen bleiben davon bewusst ausgenommen.
    api.post(`/recipes/${recipeIds[0]}/mark-cooked`).catch(() => {
      // Nicht kritisch fuers eigentliche Kochen - ein Fehler hier soll die
      // Feier/den Abschluss nicht blockieren.
    });
    // Fertig gekocht -> "Bereit zum Kochen" auf dem Dashboard wieder ausblenden
    kochplanEntfernen(recipeIds[0]).catch(() => {});
    setShowCelebration(true);
  };

  const handleFinished = (recipeId: string, completed: boolean) => {
    if (!completed) {
      // Am ersten Schritt "Zurueck" gedrueckt = Kochvorgang abgebrochen/
      // verlassen, nicht tatsaechlich fertig gekocht - einfach verlassen,
      // OHNE als zubereitet zu markieren und OHNE die Guten-Appetit-Feier
      // (war zuvor ein Bug: beides loeste dieselbe Feier aus).
      discardIfRequested();
      navigation.goBack();
      return;
    }

    const nowCompleted = completedIds.includes(recipeId) ? completedIds : [...completedIds, recipeId];
    setCompletedIds(nowCompleted);

    const stillOpen = recipeIds.filter((id) => !nowCompleted.includes(id));
    if (stillOpen.length === 0) {
      finishSession();
      return;
    }

    // Zum naechsten NOCH OFFENEN Rezept wechseln, nicht stur zum
    // naechsten in der Reihenfolge - sonst landet man auf einem, das
    // schon fertig ist.
    setActiveIndex(recipeIds.indexOf(stillOpen[0]));
  };

  if (showCelebration) {
    // Bei mehreren parallel gekochten Rezepten alle Titel zusammenfassen,
    // statt willkuerlich nur eines zu nennen.
    const finishedTitles = recipeIds.map((id) => titles[id]).filter(Boolean).join(', ');
    // Nach dem Kochen aufs Dashboard, nicht nur einen Schritt zurueck:
    // goBack() landete je nach Weg im Rezept-Detail oder im Beilagen-
    // Screen - also mitten im gerade beendeten Vorgang. Das Dashboard ist
    // der natuerliche Abschluss, dort steht das Gericht dann auch als
    // zuletzt gekocht.
    return (
      <CookingFinishedCelebration
        recipeTitle={finishedTitles || undefined}
        onDone={async () => {
          await discardIfRequested();
          navigation.navigate('MainTabs', { screen: 'Home' });
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {recipeIds.length > 1 && (
        <View style={styles.tabRow}>
          {recipeIds.map((id, index) => (
            <Pressable
              key={id}
              onPress={() => setActiveIndex(index)}
              style={[
                styles.tab,
                { borderBottomColor: index === activeIndex ? gradient[0] : 'transparent' },
              ]}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.tabText,
                  { color: index === activeIndex ? gradient[0] : colors.muted, fontWeight: index === activeIndex ? '700' : '500' },
                ]}
              >
                {/* Haken auf fertigen Reitern: Beim Parallelkochen muss
                    auf einen Blick erkennbar sein, was noch aussteht. */}
                {completedIds.includes(id) ? '✓ ' : ''}{titles[id] ?? '…'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {recipeIds.map((id, index) => (
        <SingleRecipeCookView
          key={id}
          recipeId={id}
          isActive={index === activeIndex}
          onTitleLoaded={(title) => setTitles((prev) => ({ ...prev, [id]: title }))}
          onFinished={(completed) => handleFinished(id, completed)}
          sessionOverrides={index === 0 ? route.params.sessionOverrides : undefined}
          initialServings={index === 0 ? route.params.sessionServings : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: 'row', paddingHorizontal: 12, paddingTop: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2 },
  tabText: { fontSize: 12.5 },
});
