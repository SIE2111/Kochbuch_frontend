import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';
import ZutatBild from '../components/ZutatBild';
import type { MainStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<MainStackParamList, 'ZutatenWaehlen'>;

interface Vorschlag {
  name: string;
  unit: string | null;
  category: string | null;
  bild: string | null;
  auf_liste: number | null;
}

interface Start {
  haeufig?: Vorschlag[];
  zuletzt?: Vorschlag[];
  start?: Vorschlag[];
  kategorien?: string[];
  items?: Vorschlag[];
}

// Einkaufsliste erfassen wie bei Bring!: antippen statt tippen. Die Zutat
// landet sofort auf der Liste, ein weiterer Tipp erhoeht die Menge.
export default function ZutatenWaehlenScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [start, setStart] = useState<Start>({});
  const [liste, setListe] = useState<Vorschlag[] | null>(null);   // Suche oder Abteilung
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [laedt, setLaedt] = useState(true);
  const [anzahl, setAnzahl] = useState(0);                         // Tipps in dieser Sitzung
  const [menge, setMenge] = useState<Record<string, number>>({});  // aktueller Stand je Name
  const sucheZaehler = useRef(0);

  const meldeFehler = (err: unknown) =>
    showBrutzelHinweis({ title: t('einkauf.nichtHinzugefuegt'), text: err instanceof ApiError ? err.detail : t('profil.unbekannterFehler') });

  const ladeStart = useCallback(async () => {
    try {
      const d = await api.get<Start>('/shopping-list/vorschlaege');
      setStart(d);
      const m: Record<string, number> = {};
      [...(d.haeufig ?? []), ...(d.zuletzt ?? []), ...(d.start ?? [])].forEach((v) => { if (v.auf_liste) m[v.name.toLowerCase()] = v.auf_liste; });
      setMenge((alt) => ({ ...m, ...alt }));
    } catch (err) {
      meldeFehler(err);
    } finally {
      setLaedt(false);
    }
  }, []);

  useEffect(() => { ladeStart(); }, [ladeStart]);

  const ladeListe = useCallback(async (q: string, kat: string | null) => {
    if (!q.trim() && !kat) { setListe(null); return; }
    const nr = ++sucheZaehler.current;
    try {
      const d = await api.get<Start>(`/shopping-list/vorschlaege?q=${encodeURIComponent(q.trim())}&kategorie=${encodeURIComponent(q.trim() ? '' : kat ?? '')}`);
      if (nr !== sucheZaehler.current) return;
      const m: Record<string, number> = {};
      (d.items ?? []).forEach((v) => { if (v.auf_liste) m[v.name.toLowerCase()] = v.auf_liste; });
      setMenge((alt) => ({ ...m, ...alt }));
      setListe(d.items ?? []);
    } catch (err) {
      if (nr === sucheZaehler.current) meldeFehler(err);
    }
  }, []);

  useEffect(() => {
    const id = setTimeout(() => ladeListe(suche, kategorie), 200);
    return () => clearTimeout(id);
  }, [suche, kategorie, ladeListe]);

  const antippen = async (name: string, unit: string | null) => {
    const schluessel = name.trim().toLowerCase();
    if (!schluessel) return;
    // Sofort sichtbar, danach mit dem Stand vom Server abgleichen
    setMenge((m) => ({ ...m, [schluessel]: (m[schluessel] ?? 0) + 1 }));
    setAnzahl((a) => a + 1);
    try {
      const r = await api.post<{ amount: number | null }>('/shopping-list/manual', {
        ingredient_name: name.trim(), unit, amount: 1, zusammenfassen: true,
      });
      if (r?.amount != null) setMenge((m) => ({ ...m, [schluessel]: r.amount as number }));
    } catch (err) {
      setMenge((m) => ({ ...m, [schluessel]: Math.max(0, (m[schluessel] ?? 1) - 1) }));
      setAnzahl((a) => Math.max(0, a - 1));
      meldeFehler(err);
    }
  };

  const vergessen = (v: Vorschlag) => {
    showBrutzelHinweis({
      title: t('einkauf.vergessenTitel'),
      text: t('einkauf.vergessenText', { name: v.name }),
      buttons: [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('einkauf.vergessen'), style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/shopping-list/vorschlaege?name=${encodeURIComponent(v.name)}`);
              ladeStart();
            } catch (err) { meldeFehler(err); }
          },
        },
      ],
    });
  };

  const kachel = (v: Vorschlag, key: string) => {
    const n = menge[v.name.toLowerCase()] ?? 0;
    return (
      <Pressable key={key} onPress={() => antippen(v.name, v.unit)} onLongPress={() => vergessen(v)}
        style={styles.kachel}>
        <View>
          <ZutatBild name={v.name} abteilung={v.category} bild={v.bild} groesse={64} aktiv={n > 0} />
          {n > 0 && (
            <View style={[styles.abzeichen, { backgroundColor: gradient[0] }]}>
              <Text style={styles.abzeichenText}>{n}</Text>
            </View>
          )}
        </View>
        <Text numberOfLines={2} style={[styles.kachelName, { color: colors.text }]}>{v.name}</Text>
      </Pressable>
    );
  };

  const raster = (arr: Vorschlag[], prefix: string) => (
    <View style={styles.raster}>{arr.map((v, i) => kachel(v, `${prefix}${i}${v.name}`))}</View>
  );

  const suchtext = suche.trim();
  const neuAnlegen = suchtext && !(liste ?? []).some((v) => v.name.toLowerCase() === suchtext.toLowerCase());
  const hatVerlauf = (start.haeufig?.length ?? 0) > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.kopf}>
        <View style={[styles.suchfeld, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.muted} />
          <TextInput
            value={suche}
            onChangeText={setSuche}
            placeholder={t('einkauf.sucheOderNeu')}
            placeholderTextColor={colors.muted}
            style={[styles.sucheInput, { color: colors.text }]}
            returnKeyType="done"
            onSubmitEditing={() => { if (neuAnlegen) { antippen(suchtext, null); setSuche(''); Keyboard.dismiss(); } }}
          />
          {!!suche && (
            <Pressable onPress={() => setSuche('')} hitSlop={10}>
              <MaterialCommunityIcons name="close-circle" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}
        contentContainerStyle={styles.reiter}>
        {[null, ...(start.kategorien ?? [])].map((k) => {
          const aktiv = kategorie === k && !suchtext;
          return (
            <Pressable key={k ?? 'alle'} onPress={() => { setSuche(''); setKategorie(k); }}
              style={[styles.reiterChip, { borderColor: aktiv ? 'transparent' : colors.cardBorder,
                backgroundColor: aktiv ? gradient[0] : 'transparent' }]}>
              <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                {k ?? t('einkauf.reiterMeine')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 110, paddingHorizontal: 12 }}>
        {laedt ? (
          <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
        ) : liste ? (
          <>
            {neuAnlegen ? (
              <Pressable onPress={() => { antippen(suchtext, null); setSuche(''); Keyboard.dismiss(); }}
                style={[styles.neuZeile, { backgroundColor: colors.card, borderRadius: radius.md }]}>
                <MaterialCommunityIcons name="plus-circle" size={22} color={gradient[0]} />
                <Text style={{ color: colors.text, fontSize: 14, flex: 1 }}>{t('einkauf.neuAnlegen', { name: suchtext })}</Text>
              </Pressable>
            ) : null}
            {raster(liste, 'l')}
          </>
        ) : (
          <>
            {!hatVerlauf && (start.start?.length ?? 0) > 0 && (
              <>
                <Text style={[styles.titel, { color: colors.muted }]}>{t('einkauf.startAuswahl')}</Text>
                {raster(start.start ?? [], 's')}
                <Text style={[styles.hinweis, { color: colors.muted }]}>{t('einkauf.startHinweis')}</Text>
              </>
            )}
            {hatVerlauf && (
              <>
                <Text style={[styles.titel, { color: colors.muted }]}>{t('einkauf.haeufig')}</Text>
                {raster(start.haeufig ?? [], 'h')}
                <Text style={[styles.titel, { color: colors.muted }]}>{t('einkauf.zuletzt')}</Text>
                {raster(start.zuletzt ?? [], 'z')}
                <Text style={[styles.hinweis, { color: colors.muted }]}>{t('einkauf.langDruckHinweis')}</Text>
              </>
            )}
          </>
        )}
      </ScrollView>

      <View style={[styles.fuss, { backgroundColor: colors.card, borderTopColor: colors.cardBorder }]}>
        <Text style={{ color: colors.text, fontSize: 13.5, flex: 1 }}>
          {anzahl > 0 ? t('einkauf.dazugekommen', { n: anzahl }) : t('einkauf.antippenHinweis')}
        </Text>
        <Pressable onPress={() => navigation.goBack()}
          style={[styles.fertig, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>{t('einkauf.fertig')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  kopf: { paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  suchfeld: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 46 },
  sucheInput: { flex: 1, fontSize: 15, height: 46 },
  reiter: { paddingHorizontal: 12, gap: 8, paddingBottom: 8 },
  reiterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  titel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, marginBottom: 6, marginLeft: 4, textTransform: 'uppercase' },
  hinweis: { fontSize: 12, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  raster: { flexDirection: 'row', flexWrap: 'wrap' },
  kachel: { width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2 },
  kachelName: { fontSize: 11.5, textAlign: 'center', marginTop: 5, minHeight: 28 },
  abzeichen: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  abzeichenText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  neuZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, marginTop: 6, marginHorizontal: 2 },
  fuss: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 26, borderTopWidth: 1 },
  fertig: { paddingHorizontal: 22, height: 44, alignItems: 'center', justifyContent: 'center' },
});
