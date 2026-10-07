import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, ActivityIndicator, Image } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';

type Props = NativeStackScreenProps<MainStackParamList, 'RezeptSuche'>;
interface Treffer { titel: string; url: string; seite: string; beschreibung: string; bild: string | null; bewertung?: number | null; anzahl?: number | null; score?: number | null }

/** Rezeptsuche im Internet (Brave, 04.10.2026): saubere Trefferliste statt
 * Google im eingebauten Browser. Antippen übernimmt über den Web-Import. */
export default function RezeptSucheScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [q, setQ] = useState(route.params?.initialQuery ?? '');
  const [treffer, setTreffer] = useState<Treffer[] | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [nachBewertung, setNachBewertung] = useState(false);

  async function suchen(begriff = q) {
    const b = begriff.trim();
    if (b.length < 2 || laedt) return;
    setLaedt(true); setFehler(null);
    try {
      const r = await api.get<{ treffer: Treffer[] }>(`/rezept-suche?q=${encodeURIComponent(b)}`);
      setTreffer(r.treffer);
    } catch (e) {
      setFehler(e instanceof ApiError ? (e as any).detail ?? e.message : t('rezeptSuche.fehler'));
    } finally { setLaedt(false); }
  }

  // Sortierung: Relevanz = Reihenfolge der Suche, sonst nach gewichteter Bewertung (Treffer ohne Bewertung zuletzt)
  const angezeigt = React.useMemo(() => {
    const liste = treffer ?? [];
    if (!nachBewertung) return liste;
    return liste.map((x, i) => ({ x, i })).sort((a, b) => (b.x.score ?? -1) - (a.x.score ?? -1) || a.i - b.i).map((z) => z.x);
  }, [treffer, nachBewertung]);

  React.useEffect(() => { if ((route.params?.initialQuery ?? '').trim().length >= 2) suchen(route.params!.initialQuery!); }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={styles.leiste}>
        <TextInput
          style={[styles.eingabe, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          value={q} onChangeText={setQ} placeholder={t('rezeptSuche.platzhalter')} placeholderTextColor={colors.muted}
          autoFocus={!route.params?.initialQuery} returnKeyType="search" onSubmitEditing={() => suchen()} autoCorrect={false} clearButtonMode="while-editing"
        />
        <Pressable onPress={() => suchen()} style={[styles.knopf, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
          {laedt ? <ActivityIndicator color="#fff" /> : <Text style={styles.knopfText}>{t('rezeptSuche.suchen')}</Text>}
        </Pressable>
      </View>
      <Text style={[styles.hinweis, { color: colors.muted }]}>{t('rezeptSuche.hinweis')}</Text>
      {!!fehler && <Text style={[styles.hinweis, { color: '#d9534f' }]}>{fehler}</Text>}
      {!!treffer && treffer.length > 1 && (
        <View style={styles.sortZeile}>
          <Text style={[styles.sortText, { color: colors.muted }]}>{t('rezeptSuche.sortieren')}</Text>
          {([false, true] as const).map((b) => (
            <Pressable key={String(b)} onPress={() => setNachBewertung(b)}
              style={[styles.chip, { borderRadius: radius.md, backgroundColor: nachBewertung === b ? gradient[0] : colors.card }]}>
              <Text style={[styles.chipText, { color: nachBewertung === b ? '#fff' : colors.text }]}>{b ? t('rezeptSuche.sortBewertung') : t('rezeptSuche.sortRelevanz')}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <FlatList
        data={angezeigt}
        keyExtractor={(x) => x.url}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40 }}
        ListEmptyComponent={treffer && !laedt ? <Text style={[styles.hinweis, { color: colors.muted, textAlign: 'center', marginTop: 32 }]}>{t('rezeptSuche.keine')}</Text> : null}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('WebImport', { pickedUrl: item.url })}
            style={[styles.karte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            {item.bild ? <Image source={{ uri: item.bild }} style={[styles.bild, { borderRadius: radius.sm }]} /> : <View style={[styles.bild, { borderRadius: radius.sm, backgroundColor: colors.bg }]} />}
            <View style={{ flex: 1 }}>
              <Text style={[styles.titel, { color: colors.text }]} numberOfLines={2}>{item.titel}</Text>
              {!!item.seite && <Text style={[styles.seite, { color: gradient[0] }]} numberOfLines={1}>{item.seite}</Text>}
              {item.bewertung != null
                ? <Text style={[styles.sterne, { color: colors.text }]}>{'★ '}{item.bewertung.toFixed(1).replace('.', ',')}{item.anzahl ? <Text style={{ color: colors.muted, fontWeight: '500' }}>{` (${item.anzahl})`}</Text> : null}</Text>
                : <Text style={[styles.sterne, { color: colors.muted, fontWeight: '500' }]}>{t('rezeptSuche.keineBewertung')}</Text>}
              {!!item.beschreibung && <Text style={[styles.text, { color: colors.muted }]} numberOfLines={2}>{item.beschreibung}</Text>}
              <View style={styles.aktionen}>
                <Text style={[styles.aktion, { color: gradient[0] }]}>{t('rezeptSuche.uebernehmen')}</Text>
                <Pressable hitSlop={8} onPress={() => navigation.navigate('WebBrowse', { initialUrl: item.url })}>
                  <Text style={[styles.aktion, { color: colors.muted }]}>{t('rezeptSuche.ansehen')}</Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  leiste: { flexDirection: 'row', gap: 8, padding: 16, paddingBottom: 8 },
  eingabe: { flex: 1, paddingHorizontal: 14, paddingVertical: 11, fontSize: 16 },
  knopf: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', minWidth: 80 },
  knopfText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  hinweis: { fontSize: 12.5, lineHeight: 18, paddingHorizontal: 16, marginBottom: 6 },
  sortZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  sortText: { fontSize: 12.5 },
  chip: { paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { fontSize: 13, fontWeight: '700' },
  sterne: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  karte: { flexDirection: 'row', gap: 12, padding: 12, marginBottom: 10 },
  bild: { width: 76, height: 76 },
  titel: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  seite: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  text: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  aktionen: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  aktion: { fontSize: 13.5, fontWeight: '700' },
});
