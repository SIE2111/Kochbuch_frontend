// Maskottchen-Fenster der App (Brutzel) - ersetzt ALLE System-Meldungen (Alert.alert) der App.
// Hinweise und Fehler (ein Knopf) ebenso wie Rueckfragen mit mehreren Knoepfen kommen von der Figur,
// nie als nuechterner System-Alert. Zweisprachig (Deutsch/Englisch), Knoepfe behalten ihre Aktion.
//   showBrutzelHinweis({ title, text })               - Hinweis mit Knopf "Verstanden"
//   showBrutzelHinweis({ title, text, knopf, danach }) - eigener Knopf, danach wird etwas ausgefuehrt
//   showBrutzelHinweis({ title, text, buttons })      - Rueckfrage mit mehreren Knoepfen
// <BrutzelHinweisHost /> einmal ganz oben in App.tsx. Alert.alert wird hier umgeleitet; ist (noch) kein
// Fenster eingehaengt, gilt der normale System-Alert.
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Platform, Alert, AlertButton } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import BrutzelAvatar from './BrutzelAvatar';

export type HinweisKnopf = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
type Hinweis = { title: string; text: string; gross?: string; grossText?: string; knopf?: string; danach?: () => void; buttons?: HinweisKnopf[] };

let aktuell: Hinweis | null = null;
const warteschlange: Hinweis[] = [];
const hoerer = new Set<(h: Hinweis | null) => void>();
const melden = () => hoerer.forEach((l) => l(aktuell));

export function showBrutzelHinweis(h: Hinweis) {
  // gleicher Hinweis (ohne Knoepfe) nicht doppelt
  if (!h.buttons) {
    if (aktuell && !aktuell.buttons && aktuell.text === h.text && aktuell.title === h.title) return;
    if (warteschlange.some((q) => !q.buttons && q.text === h.text && q.title === h.title)) return;
  }
  if (aktuell) {
    warteschlange.push(h);
    return;
  }
  aktuell = h;
  melden();
}

function schliessen(dann?: () => void) {
  const fertig = aktuell;
  aktuell = warteschlange.shift() || null;
  melden();
  // erst NACH dem Schliessen ausfuehren: eine Folgemeldung reiht sich sauber ein
  try { dann?.(); fertig?.danach?.(); } catch (e) { console.warn('[Brutzel]', e); }
}

// --- Alert.alert umleiten ---------------------------------------------------------------
let hostAnzahl = 0;
let coinsText = '';
let coinsZeit = 0;
/** AI Coins aufgebraucht: Brutzel hat es schon gesagt - ein gleichlautender Fehler-Alert wird verschluckt. */
export function merkeCoinsMeldung(text: string) { coinsText = text; coinsZeit = Date.now(); }

const alertOriginal = Alert.alert.bind(Alert);
Alert.alert = ((title: string, message?: string, buttons?: AlertButton[], options?: any) => {
  if (hostAnzahl === 0) return alertOriginal(title, message, buttons, options);
  const text = message ?? '';
  if (coinsText && Date.now() - coinsZeit < 8000 && (text.includes(coinsText) || (title ?? '').includes(coinsText))) return;
  const bs = (buttons ?? []).filter(Boolean);
  if (bs.length === 0 || (bs.length === 1 && !bs[0].onPress)) {
    showBrutzelHinweis({ title: title ?? '', text, knopf: bs[0]?.text });
    return;
  }
  showBrutzelHinweis({
    title: title ?? '', text,
    buttons: bs.map((b) => ({ text: b.text ?? '', style: b.style as HinweisKnopf['style'], onPress: b.onPress as (() => void) | undefined })),
  });
}) as typeof Alert.alert;

export default function BrutzelHinweisHost() {
  const { colors, radius, gradient } = useTheme();
  const { t } = useUebersetzung();
  const [h, setH] = useState<Hinweis | null>(aktuell);
  useEffect(() => {
    hostAnzahl++;
    hoerer.add(setH);
    setH(aktuell);
    return () => {
      hoerer.delete(setH);
      hostAnzahl--;
    };
  }, []);
  if (!h) return null;

  // Knoepfe: Abbrechen ans Ende, der letzte "normale" Knopf ist der Hauptknopf
  const liste: HinweisKnopf[] = h.buttons?.length ? [...h.buttons] : [{ text: h.knopf ?? t('hinweis.verstanden') }];
  const reihenfolge = [...liste.filter((k) => k.style !== 'cancel'), ...liste.filter((k) => k.style === 'cancel')];
  let hauptIdx = -1;
  for (let i = reihenfolge.length - 1; i >= 0; i--) {
    if (reihenfolge[i].style !== 'cancel' && reihenfolge[i].style !== 'destructive') { hauptIdx = i; break; }
  }
  const abbrechenKnopf = liste.find((k) => k.style === 'cancel');
  const hinten = () => {
    if (abbrechenKnopf) schliessen(abbrechenKnopf.onPress);
    else if (liste.length <= 1) schliessen(liste[0]?.onPress);
  };

  const inhalt = (
    <View style={st.hintergrund}>
      <View style={[st.karte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <View style={st.kopf}>
          <BrutzelAvatar size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[st.wer, { color: colors.muted }]}>{t('hinweis.von')}</Text>
            <Text style={[st.titel, { color: colors.text }]}>{h.title}</Text>
          </View>
        </View>
{!!h.gross && (
          <View style={{ alignItems: 'center', marginVertical: 14 }}>
            <Text style={{ fontSize: 60, fontWeight: '800', lineHeight: 66, color: gradient[0] }}>{h.gross}</Text>
            {!!h.grossText && <Text style={{ fontSize: 19, fontWeight: '700', textAlign: 'center', color: colors.text }}>{h.grossText}</Text>}
          </View>
        )}
        {!!h.text && (
          <ScrollView style={{ maxHeight: 320 }}>
            <Text style={[st.text, { color: colors.text }]}>{h.text}</Text>
          </ScrollView>
        )}
        <View style={{ gap: 8, marginTop: 14 }}>
          {reihenfolge.map((k, i) => {
            const haupt = i === hauptIdx;
            const gefahr = k.style === 'destructive';
            return (
              <Pressable
                key={i}
                onPress={() => schliessen(k.onPress)}
                style={[st.knopf, { borderRadius: radius.md },
                  haupt ? { backgroundColor: gradient[0], borderColor: gradient[0] } : { borderColor: gefahr ? '#DC2626' : '#8884' }]}
              >
                <Text style={[st.knopfText, { color: haupt ? '#fff' : gefahr ? '#DC2626' : colors.text }]}>{k.text}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );

  // iOS: eigenes Fenster ueber ALLEM (auch ueber geoeffneten Modals) - ein zweites Modal wuerde dort
  // nicht erscheinen. Android: normales Modal (liegt dort immer oben).
  if (Platform.OS === 'ios') return <FullWindowOverlay>{inhalt}</FullWindowOverlay>;
  return <Modal visible transparent animationType="fade" onRequestClose={hinten}>{inhalt}</Modal>;
}

const st = StyleSheet.create({
  hintergrund: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  karte: { padding: 18 },
  kopf: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  wer: { fontSize: 11, fontWeight: '600' },
  titel: { fontSize: 17, fontWeight: '800' },
  text: { fontSize: 14.5, lineHeight: 21 },
  knopf: { borderWidth: 1.5, paddingVertical: 12, alignItems: 'center' },
  knopfText: { fontWeight: '800', fontSize: 15 },
});
