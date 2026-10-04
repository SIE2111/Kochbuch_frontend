import React, { useState } from 'react';
import { View, Text, Modal, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import BrutzelAvatar from './BrutzelAvatar';
import { maskottchenAngetippt } from '../utils/tipps';
import { FrageAbzeichen } from './Abzeichen';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

// Feste (nicht KI-generierte) Fragen+Antworten - kostet kein KI-Kontingent,
// ist sofort da, liefert immer denselben geprueften Text. Icons sind
// bewusst dieselben wie die echten Knoepfe/Tabs in der App (z.B.
// account-group-outline = Pool-Tab, cart-outline = Einkauf-Tab) - direkter
// Wiedererkennungswert statt generischer Bebilderung. Gleiches Muster wie
// KlammiFaqBubble/BlitziFaqBubble in Buerroablage/Medienablage.
const BRUTZEL_FAQ: { icon: IconName; frage: string; antwort: string }[] = [
  { icon: 'camera-outline', frage: 'Wie erfasse ich ein neues Rezept?', antwort: 'Tippe auf den Plus-Knopf: Du kannst ein Rezept abfotografieren (z.B. aus einem Kochbuch oder von handgeschriebenen Notizen), von Hand eintippen, oder aus dem Internet bzw. dem Community-Pool übernehmen.' },
  { icon: 'web', frage: 'Wie importiere ich ein Rezept aus dem Internet?', antwort: 'Beim Erfassen "Aus dem Internet" wählen und einen Link einfügen - zeigt er auf eine Rezeptseite, wird sie automatisch ausgelesen. Kennst du die Adresse nicht, kannst du direkt in der App danach suchen, ganz ohne eigenen Browser.' },
  { icon: 'creation', frage: 'Kann ich mir ein Rezept von der KI erstellen lassen?', antwort: 'Ja! Beim Erfassen "KI-Rezept" wählen, Zutaten, Ernährungsform und gewünschte Zeit angeben - ich schlage dir ein passendes Rezept vor, das du danach ganz normal speichern kannst.' },
  { icon: 'calendar-week-outline', frage: 'Was ist der Wochenplan?', antwort: 'Im Wochenplan legst du fest, was du an welchem Tag kochen möchtest - die Zutaten der geplanten Rezepte kannst du von dort direkt auf die Einkaufsliste übernehmen.' },
  { icon: 'cart-outline', frage: 'Wie funktioniert die Einkaufsliste?', antwort: 'Im Tab Einkauf sammelst du, was du noch besorgen musst - einzeln eingetragen oder automatisch aus den Zutaten deines Wochenplans.' },
  { icon: 'chef-hat', frage: 'Was ist der Kochmodus?', antwort: 'Der Kochmodus führt dich Schritt für Schritt durchs Rezept, mit Timer für Koch- und Backzeiten - der Bildschirm bleibt dabei an, deine Finger können klebrig sein.' },
  { icon: 'cloud-outline', frage: 'Wo werden meine Rezepte gespeichert?', antwort: 'Unter Profil → Speicherort entscheidest du, wo deine Rezepte und Fotos liegen: in unserer eigenen Cloud, oder in deinem eigenen Google Drive/OneDrive/Dropbox.' },
  { icon: 'home-group', frage: 'Wie teile ich Rezepte mit meiner Familie?', antwort: 'Lade Familienmitglieder per Code ein, damit ihr gemeinsam auf dieselben Rezepte zugreifen könnt - unter Profil → Haushalt.' },
  { icon: 'account-group-outline', frage: 'Was ist der Community-Pool?', antwort: 'Im Tab Pool findest du Rezepte, die andere Nutzer geteilt haben, und kannst eigene dorthin veröffentlichen - unabhängig von deinem privaten Rezeptbuch.' },
  { icon: 'fire', frage: 'Wer bist du eigentlich?', antwort: 'Ich bin Brutzel, dein Assistent in dieser App! Ich begleite dich beim Erfassen und Kochen deiner Rezepte. Unter Profil kannst du meine Begrüßung und Vorlesestimme einzeln an- oder abschalten.' },
];

// Kleines, jederzeit antippbares Brutzel-Symbol fuers Dashboard - analog zu
// KlammiFaqBubble (Buerroablage) und BlitziFaqBubble (Medienablage),
// hierher uebertragen auf Kochbuchs eigenes Theme-System (colors/gradient/
// radius statt Spacing/FontSize, MaterialCommunityIcons statt lucide).
export default function BrutzelFaqBubble() {
  const { colors, gradient, radius } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<typeof BRUTZEL_FAQ[number] | null>(null);

  function handleClose() {
    setOpen(false);
    // Erst nach dem Zuklappen zuruecksetzen (kleine Verzoegerung durch die
    // Modal-Schliessanimation) - sonst blitzt beim Schliessen kurz die
    // Fragenliste statt der gerade gelesenen Antwort auf.
    setTimeout(() => setSelected(null), 300);
  }

  return (
    <>
      <View>
        <Pressable onPress={() => { maskottchenAngetippt(); setOpen(true); }} hitSlop={8} style={[styles.bubble, { borderColor: gradient[0], backgroundColor: colors.card }]}>
          <BrutzelAvatar size={36} variant="head" />
        </Pressable>
        <FrageAbzeichen farbe={gradient[0]} />
      </View>

      <Modal visible={open} animationType="slide" onRequestClose={handleClose} presentationStyle="pageSheet">
        <View style={[styles.container, { backgroundColor: colors.bg, paddingTop: insets.top + 16 }]}>
          <View style={[styles.header, { borderBottomColor: colors.card }]}>
            {selected ? (
              <Pressable onPress={() => setSelected(null)} hitSlop={8} style={styles.headerBtnSlot}>
                <MaterialCommunityIcons name="arrow-left" size={20} color={colors.muted} />
              </Pressable>
            ) : (
              <View style={styles.headerBtnSlot} />
            )}
            <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>Frag Brutzel</Text>
            <Pressable onPress={handleClose} hitSlop={8} style={[styles.headerBtnSlot, { alignItems: 'flex-end' }]}>
              <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
            </Pressable>
          </View>

          {selected ? (
            <ScrollView contentContainerStyle={styles.answerScroll}>
              <View style={[styles.answerIconWrap, { backgroundColor: colors.card }]}>
                <MaterialCommunityIcons name={selected.icon} size={28} color={gradient[0]} />
              </View>
              <Text style={[styles.answerFrage, { color: colors.text }]}>{selected.frage}</Text>
              <Text style={[styles.answerText, { color: colors.muted }]}>{selected.antwort}</Text>
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
              <View style={styles.introRow}>
                <BrutzelAvatar size={48} variant="head" />
                <Text style={[styles.introText, { color: colors.muted }]}>Hallo! Worüber möchtest du mehr wissen?</Text>
              </View>
              {BRUTZEL_FAQ.map((item, i) => (
                <Pressable key={i} onPress={() => setSelected(item)} style={[styles.faqRow, { borderBottomColor: colors.card }]}>
                  <View style={[styles.faqIconWrap, { backgroundColor: colors.card, borderRadius: radius.md }]}>
                    <MaterialCommunityIcons name={item.icon} size={18} color={gradient[0]} />
                  </View>
                  <Text style={[styles.faqText, { color: colors.text }]}>{item.frage}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={colors.muted} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    width: 36, height: 36, borderRadius: 18, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  container: { flex: 1, paddingHorizontal: 18 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 14, borderBottomWidth: 1,
  },
  headerBtnSlot: { flexShrink: 0, width: 32 },
  headerTitle: { flex: 1, fontSize: 15.5, fontWeight: '700', textAlign: 'center' },
  introRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20 },
  introText: { flex: 1, fontSize: 13, lineHeight: 19 },
  faqRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, borderBottomWidth: 1,
  },
  faqIconWrap: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  faqText: { flex: 1, fontSize: 13.5, fontWeight: '600' },
  answerScroll: { paddingTop: 32, alignItems: 'center' },
  answerIconWrap: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  answerFrage: { fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 10, paddingHorizontal: 18 },
  answerText: { fontSize: 13.5, lineHeight: 20, textAlign: 'center', paddingHorizontal: 18 },
});
