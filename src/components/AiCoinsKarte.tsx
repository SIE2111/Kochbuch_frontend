// Profil-Block "AI COINS" (ersetzt "KI-FUNKTIONEN"): Monats-Coins, gekaufte Coins
// (gelten fuer alle Apps), Liste "Wofuer AI Coins gebraucht werden" und KI-Schalter.
// Stand und Liste: GET /coins
import React, { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, Pressable, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api } from '../api/client';
import { geschenkHolen } from '../utils/coinsGeschenk';

type Eintrag = { key: string; label: string; label_en?: string; cost: string; cost_en?: string; note?: string; note_en?: string };
type Stand = { monthly_total: number; monthly_remaining: number; purchased: number; trial_ends?: string | null; bonus?: number; gift_available?: boolean; gift_amount?: number; items: Eintrag[] };

// 'JJJJ-MM-TT' -> 'TT.MM.JJJJ'
function datumAnzeige(iso: string): string {
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

export default function AiCoinsKarte({ refreshKey }: {
  refreshKey?: number;
}) {
  const { colors, radius, gradient } = useTheme();
  const { t, sprache } = useUebersetzung();
  const [stand, setStand] = useState<Stand | null>(null);
  const [offen, setOffen] = useState(false);
  const en = sprache === 'en';

  const laden = useCallback(async () => {
    try { setStand(await api.get<Stand>('/coins')); } catch { /* Anzeige bleibt leer */ }
  }, []);
  // Bei JEDEM Anzeigen des Profils neu laden: Der Bildschirm bleibt im Tab-Wechsel erhalten, ein einmaliges
  // Laden beim Start zeigte nach Uploads, Downloads und Analysen noch den alten Stand (05.10.2026).
  useFocusEffect(useCallback(() => { laden(); }, [laden, refreshKey]));

  const zeile = [st.zeile];
  const mitTrenner = [st.zeile, st.trenner];
  return (
    <View>
      <Text style={[st.label, { color: colors.muted, marginTop: 22 }]}>{t('profil.aiCoins')}</Text>

      <View style={[st.rahmen, { backgroundColor: colors.card, borderRadius: radius.md }]}>
      <View style={mitTrenner}>
        <MaterialCommunityIcons name="circle-multiple-outline" size={20} color={colors.muted} style={st.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[st.titel, { color: colors.text }]}>{t('profil.aiCoinsMonat')}</Text>
          <Text style={[st.sub, { color: colors.muted }]}>{t('profil.aiCoinsMonatHinweis', { n: stand?.monthly_total ?? 25 })}{stand?.trial_ends ? '\n' + t('profil.aiCoinsKennenlernen', { basis: 25, bonus: stand.bonus ?? 25, datum: datumAnzeige(stand.trial_ends) }) : ''}</Text>
        </View>
        {stand ? <Text style={[st.zahl, { color: colors.text }]}>{stand.monthly_remaining} / {stand.monthly_total}</Text> : <ActivityIndicator color={colors.muted} />}
      </View>

      <View style={mitTrenner}>
        <MaterialCommunityIcons name="circle-multiple" size={20} color={colors.muted} style={st.icon} />
        <View style={{ flex: 1 }}>
          <Text style={[st.titel, { color: colors.text }]}>{t('profil.aiCoinsGekauft')}</Text>
          <Text style={[st.sub, { color: colors.muted }]}>{t('profil.aiCoinsGekauftHinweis')}</Text>
        </View>
        {stand ? <Text style={[st.zahl, { color: colors.text }]}>{stand.purchased}</Text> : null}
      </View>

      {stand?.gift_available ? (
        <Pressable style={mitTrenner} onPress={async () => { await geschenkHolen(); laden(); }}>
          <MaterialCommunityIcons name="gift-outline" size={20} color={colors.muted} style={st.icon} />
          <View style={{ flex: 1 }}>
            <Text style={[st.titel, { color: colors.text, fontWeight: '800' }]}>{t('profil.aiCoinsGeschenk', { n: stand.gift_amount ?? 100 })}</Text>
            <Text style={[st.sub, { color: colors.muted }]}>{t('profil.aiCoinsGeschenkHinweis')}</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
        </Pressable>
      ) : null}

      <Pressable style={zeile} onPress={() => { setOffen(true); laden(); }}>
        <MaterialCommunityIcons name="format-list-bulleted" size={20} color={colors.muted} style={st.icon} />
        <Text style={[st.titel, { color: colors.text, flex: 1 }]}>{t('profil.aiCoinsWofuer')}</Text>
        <MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted} />
      </Pressable>

      </View>

      <Modal visible={offen} transparent animationType="fade" onRequestClose={() => setOffen(false)}>
        <View style={st.hintergrund}>
          <View style={[st.blatt, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <View style={st.kopf}>
              <Text style={[st.blattTitel, { color: colors.text }]}>{t('profil.aiCoinsWofuer')}</Text>
              <Pressable onPress={() => setOffen(false)} hitSlop={12}>
                <MaterialCommunityIcons name="close" size={22} color={colors.muted} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {(stand?.items || []).map((it) => (
                <View key={it.key} style={st.eintrag}>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.titel, { color: colors.text }]}>{en && it.label_en ? it.label_en : it.label}</Text>
                    {(en ? it.note_en : it.note) ? <Text style={[st.sub, { color: colors.muted }]}>{en ? it.note_en : it.note}</Text> : null}
                  </View>
                  <Text style={[st.preis, { color: gradient[0] }]}>{en && it.cost_en ? it.cost_en : it.cost}</Text>
                </View>
              ))}
              {!stand ? <ActivityIndicator style={{ marginVertical: 16 }} color={gradient[0]} /> : null}
            </ScrollView>
            <Text style={[st.sub, { color: colors.muted, marginTop: 12 }]}>{t('profil.aiCoinsReihenfolge')}</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  label: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  rahmen: { marginBottom: 8, overflow: 'hidden' },
  zeile: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  trenner: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8884' },
  icon: { marginRight: 12 },
  titel: { fontSize: 13.5, fontWeight: '600' },
  sub: { fontSize: 10.5, marginTop: 2, lineHeight: 15 },
  zahl: { fontSize: 15, fontWeight: '800', marginLeft: 8 },
  hintergrund: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  blatt: { padding: 18 },
  kopf: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  blattTitel: { fontSize: 17, fontWeight: '800', flex: 1, paddingRight: 12 },
  eintrag: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#8884' },
  preis: { fontSize: 14, fontWeight: '800', textAlign: 'right', maxWidth: 110 },
});
