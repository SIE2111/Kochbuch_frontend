import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { kochplanLaden, kochplanEntfernen, KochplanEintrag } from '../utils/kochplan';

/**
 * "Bereit zum Kochen" - Rezepte, die in die Einkaufsliste übernommen wurden.
 * Oben auf der Startseite (Dashboard); "Jetzt kochen" startet den
 * Koch-Modus direkt mit Hauptgericht + Beilagen und der gemerkten
 * Portionenzahl. Unsichtbar, wenn der Kochplan leer ist.
 */
export default function KochplanKarte() {
  const navigation = useNavigation<any>();
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [eintraege, setEintraege] = useState<KochplanEintrag[]>([]);

  useFocusEffect(useCallback(() => { kochplanLaden().then(setEintraege); }, []));

  if (eintraege.length === 0) return null;

  async function entfernen(id: string) {
    await kochplanEntfernen(id);
    setEintraege(await kochplanLaden());
  }

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.md, borderColor: colors.cardBorder }]}>
      <Text style={[styles.title, { color: colors.text }]}>🍳 {t('kochplan.titel')}</Text>
      {eintraege.map((e) => {
        const zusatz = [
          e.beilagen.length ? t('kochplan.beilagen', { anzahl: String(e.beilagen.length) }) : null,
          e.portionen ? t('kochplan.portionen', { anzahl: String(e.portionen) }) : null,
        ].filter(Boolean).join(' · ');
        return (
          <View key={e.id} style={[styles.eintrag, { borderTopColor: colors.cardBorder }]}>
            <View style={styles.kopf}>
              <View style={styles.textBlock}>
                <Text style={[styles.rezept, { color: colors.text }]} numberOfLines={1}>{e.titel}</Text>
                {!!zusatz && <Text style={[styles.zusatz, { color: colors.muted }]} numberOfLines={1}>{zusatz}</Text>}
                {e.beilagen.length > 0 && (
                  <Text style={[styles.zusatz, { color: colors.muted }]} numberOfLines={1}>+ {e.beilagen.join(', ')}</Text>
                )}
              </View>
              <Pressable onPress={() => entfernen(e.id)} hitSlop={10} accessibilityLabel={t('kochplan.entfernen')}>
                <Text style={[styles.x, { color: colors.muted }]}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.knoepfe}>
              <Pressable
                onPress={() => navigation.navigate('RecipeDetail', { recipeId: e.id, title: e.titel })}
                style={[styles.knopf, { borderColor: colors.cardBorder, borderRadius: radius.md }]}
              >
                <Text style={[styles.knopfText, { color: colors.text }]}>{t('kochplan.ansehen')}</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('CookMode', { recipeIds: e.recipeIds, sessionServings: e.portionen })}
                style={[styles.knopf, styles.kochen, { backgroundColor: gradient[0], borderRadius: radius.md }]}
              >
                <Text style={[styles.knopfText, styles.kochenText]}>{t('kochplan.jetztKochen')}</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, marginBottom: 16, borderWidth: 1 },
  title: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  eintrag: { paddingTop: 10, marginTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  kopf: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  textBlock: { flex: 1, minWidth: 0 },
  rezept: { fontSize: 15, fontWeight: '600' },
  zusatz: { fontSize: 12, marginTop: 2 },
  x: { fontSize: 16, paddingHorizontal: 4 },
  knoepfe: { flexDirection: 'row', gap: 8, marginTop: 10 },
  knopf: { flex: 1, paddingVertical: 9, alignItems: 'center', borderWidth: 1 },
  kochen: { borderWidth: 0 },
  knopfText: { fontSize: 14, fontWeight: '600' },
  kochenText: { color: '#FFFFFF' },
});
