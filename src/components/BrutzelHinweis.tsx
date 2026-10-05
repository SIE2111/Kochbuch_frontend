// Hinweise der Maskottchen-Figur Brutzel - fuer Meldungen, die nicht als nuechterner
// System-Alert erscheinen sollen (z.B. wenn die AI Coins aufgebraucht sind).
// Aufruf von ueberall: showBrutzelHinweis({ title, text }). <BrutzelHinweisHost /> einmal in App.tsx.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import BrutzelAvatar from './BrutzelAvatar';

type Hinweis = { title: string; text: string };
let aktuell: Hinweis | null = null;
const warteschlange: Hinweis[] = [];
const hoerer = new Set<(h: Hinweis | null) => void>();
const melden = () => hoerer.forEach((l) => l(aktuell));

export function showBrutzelHinweis(h: Hinweis) {
  if (aktuell && aktuell.text === h.text) return; // gleicher Hinweis nicht doppelt
  if (warteschlange.some((q) => q.text === h.text)) return;
  if (aktuell) {
    warteschlange.push(h);
    return;
  }
  aktuell = h;
  melden();
}

function schliessen() {
  aktuell = warteschlange.shift() || null;
  melden();
}

export default function BrutzelHinweisHost() {
  const { colors, radius, gradient } = useTheme();
  const [h, setH] = useState<Hinweis | null>(aktuell);
  useEffect(() => {
    hoerer.add(setH);
    return () => {
      hoerer.delete(setH);
    };
  }, []);
  return (
    <Modal visible={!!h} transparent animationType="fade" onRequestClose={schliessen}>
      <View style={st.hintergrund}>
        <View style={[st.karte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <View style={st.kopf}>
            <BrutzelAvatar size={56} />
            <View style={{ flex: 1 }}>
              <Text style={[st.wer, { color: colors.muted }]}>Brutzel hat einen Hinweis</Text>
              <Text style={[st.titel, { color: colors.text }]}>{h?.title}</Text>
            </View>
          </View>
          <ScrollView style={{ maxHeight: 320 }}>
            <Text style={[st.text, { color: colors.text }]}>{h?.text}</Text>
          </ScrollView>
          <Pressable onPress={schliessen} style={[st.knopf, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
            <Text style={st.knopfText}>Verstanden</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  hintergrund: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  karte: { padding: 18 },
  kopf: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  wer: { fontSize: 11, fontWeight: '600' },
  titel: { fontSize: 17, fontWeight: '800' },
  text: { fontSize: 14.5, lineHeight: 21 },
  knopf: { marginTop: 14, paddingVertical: 12, alignItems: 'center' },
  knopfText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
