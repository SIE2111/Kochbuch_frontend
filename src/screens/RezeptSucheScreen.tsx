import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList, ActivityIndicator, Image } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';

type Props = NativeStackScreenProps<MainStackParamList, 'RezeptSuche'>;
interface Treffer { titel: string; url: string; seite: string; beschreibung: string; bild: string | null }

/** Rezeptsuche im Internet (Brave, 04.10.2026): saubere Trefferliste statt
 * Google im eingebauten Browser. Antippen übernimmt über den Web-Import. */
export default function RezeptSucheScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [q, setQ] = useState(route.params?.initialQuery ?? '');
  const [treffer, setTreffer] = useState<Treffer[] | null>(null);
  const [laedt, setLaedt] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

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
      <FlatList
        data={treffer ?? []}
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
  karte: { flexDirection: 'row', gap: 12, padding: 12, marginBottom: 10 },
  bild: { width: 76, height: 76 },
  titel: { fontSize: 15, fontWeight: '700', lineHeight: 20 },
  seite: { fontSize: 12.5, fontWeight: '600', marginTop: 2 },
  text: { fontSize: 13, lineHeight: 18, marginTop: 3 },
  aktionen: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  aktion: { fontSize: 13.5, fontWeight: '700' },
});
