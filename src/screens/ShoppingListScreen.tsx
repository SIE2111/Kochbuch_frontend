import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, SectionList, Pressable, StyleSheet, ActivityIndicator, TextInput, Alert, Keyboard, Modal, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import * as Sharing from 'expo-sharing';
import ScanFab from '../components/ScanFab';
import { api, ApiError } from '../api/client';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList, MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';
import KochplanKarte from '../components/KochplanKarte';
import ZutatBild from '../components/ZutatBild';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Einkauf'>,
  NativeStackScreenProps<MainStackParamList>
>;

interface ShoppingItem {
  id: string;
  ingredient_name: string;
  amount: number | null;
  unit: string | null;
  category: string | null;
  checked: boolean;
  source_recipe_id: string | null;
  note: string | null;
  bild?: string | null;
}

export default function ShoppingListScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite, quer } = useLayout();
  const { t } = useUebersetzung();
  const [sections, setSections] = useState<{ title: string; data: ShoppingItem[] }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Mehrere Listen: null = Hauptliste. Jede weitere startet leer und bleibt, bis sie geloescht wird.
  const [listen, setListen] = useState<{ id: string | null; name: string; offen: number; haupt: boolean }[]>([]);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [neueListeOffen, setNeueListeOffen] = useState(false);
  const [neuerName, setNeuerName] = useState('');
  const lq = aktiv ? `?liste=${encodeURIComponent(aktiv)}` : '';

  const ladeListen = useCallback(async () => {
    try {
      setListen(await api.get('/shopping-list/lists'));
    } catch { /* Auswahl bleibt wie sie war */ }
  }, []);

  const listeAnlegen = async () => {
    const name = neuerName.trim();
    if (!name) return;
    try {
      const neu = await api.post<{ id: string }>('/shopping-list/lists', { name });
      setNeueListeOffen(false);
      setNeuerName('');
      await ladeListen();
      setAktiv(neu.id);
    } catch (err) {
      showBrutzelHinweis({ title: t('allgemein.fehler'), text: err instanceof ApiError ? err.detail : t('profil.unbekannterFehler') });
    }
  };

  const listeLoeschen = (id: string, name: string) => {
    showBrutzelHinweis({
      title: t('einkauf.listeLoeschenTitel'),
      text: t('einkauf.listeLoeschenText', { name }),
      buttons: [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('allgemein.loeschen'), style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/shopping-list/lists/${id}`);
              if (aktiv === id) setAktiv(null);
              ladeListen();
            } catch (err) {
              showBrutzelHinweis({ title: t('allgemein.fehler'), text: err instanceof ApiError ? err.detail : t('einkauf.nichtGeloescht') });
            }
          },
        },
      ],
    });
  };
  const [error, setError] = useState<string | null>(null);

  // Bearbeiten-Dialog: Name, Menge, Einheit und Notiz je Posten. Tippen
  // schaltet weiterhin ab/an, Lang-Druecken loescht weiterhin - das
  // Stift-Symbol in der Zeile oeffnet stattdessen diesen Dialog, damit
  // keine der bestehenden Gesten umgewidmet werden musste.
  const [bearbeiteItem, setBearbeiteItem] = useState<ShoppingItem | null>(null);
  const [bearbeitenName, setBearbeitenName] = useState('');
  const [bearbeitenMenge, setBearbeitenMenge] = useState('');
  const [bearbeitenEinheit, setBearbeitenEinheit] = useState('');
  const [bearbeitenNotiz, setBearbeitenNotiz] = useState('');
  const [speichertBearbeitung, setSpeichertBearbeitung] = useState(false);

  const oeffneBearbeiten = (item: ShoppingItem) => {
    setBearbeiteItem(item);
    setBearbeitenName(item.ingredient_name);
    setBearbeitenMenge(item.amount != null ? String(item.amount) : '');
    setBearbeitenEinheit(item.unit ?? '');
    setBearbeitenNotiz(item.note ?? '');
  };

  const speichereBearbeitung = async () => {
    if (!bearbeiteItem) return;
    const name = bearbeitenName.trim();
    if (!name) return;
    const menge = bearbeitenMenge.trim();
    const einheit = bearbeitenEinheit.trim();
    const notiz = bearbeitenNotiz.trim();
    setSpeichertBearbeitung(true);
    try {
      const aktualisiert = await api.patch<ShoppingItem>(`/shopping-list/${bearbeiteItem.id}`, {
        ingredient_name: name,
        amount: menge ? Number(menge) : null,
        amount_gesetzt: true,
        unit: einheit || null,
        unit_gesetzt: true,
        note: notiz || null,
        note_gesetzt: true,
      });
      setSections((prev) => prev.map((s) => ({ ...s, data: s.data.map((i) => (i.id === aktualisiert.id ? aktualisiert : i)) })));
      setBearbeiteItem(null);
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.nichtAktualisiert'));
    } finally {
      setSpeichertBearbeitung(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ categories: Record<string, ShoppingItem[]>; order?: string[] }>(
        `/shopping-list/${lq}`,
      );
      // Das Backend gibt die Reihenfolge der Abteilungen vor - Weg durch den
      // Supermarkt, nicht Alphabet. Faellt 'order' weg (aeltere Version),
      // bleibt es beim Alphabet, damit die Liste nicht durcheinandergeraet.
      const order = data.order ?? [];
      const rank = (title: string) => {
        const i = order.indexOf(title);
        return i === -1 ? order.length : i;
      };
      const list = Object.entries(data.categories)
        .map(([title, items]) => ({ title, data: items }))
        .sort((a, b) =>
          order.length ? rank(a.title) - rank(b.title) : a.title.localeCompare(b.title),
        );
      setSections(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t('einkauf.nichtGeladen'));
    }
  }, [lq]);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
    ladeListen();
  }, [load, ladeListen]);

  // Bei jeder Rueckkehr auf diesen Tab neu laden.
  //
  // Das war der Grund, warum die Einkaufsliste nach "Zutaten der Woche zur
  // Einkaufsliste" leer blieb, obwohl die Eintraege in der Datenbank
  // standen: Tab-Bildschirme bleiben geladen. Der useEffect oben laeuft
  // nur EINMAL, beim ersten Anzeigen - wer den Einkauf-Tab vorher schon
  // offen hatte, sah danach unveraendert den alten, leeren Stand.
  useFocusEffect(
    useCallback(() => {
      load();
      ladeListen();
    }, [load, ladeListen]),
  );

  const [isExporting, setIsExporting] = useState(false);
  const [isMailing, setIsMailing] = useState(false);

  // Drucken laeuft ueber PDF + Teilen-Blatt, nicht ueber ein eigenes
  // Druck-Paket: Dasselbe Verfahren wie beim Rezept-PDF, und aus dem
  // Teilen-Blatt heraus erreicht man den Drucker, AirDrop, Notizen und
  // alles andere - ein reiner Druckdialog koennte weniger.
  const handlePrint = async () => {
    setIsExporting(true);
    try {
      const localUri = await api.downloadFile(`/shopping-list/pdf${lq}`, 'einkaufsliste.pdf');
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(t('einkauf.nichtVerfuegbar'), t('einkauf.teilenNichtUnterstuetzt'));
        return;
      }
      await Sharing.shareAsync(localUri, { mimeType: 'application/pdf', dialogTitle: t('einkauf.titel') });
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.pdfFehlgeschlagen'));
    } finally {
      setIsExporting(false);
    }
  };

  const handleMail = () => {
    Alert.alert(
      t('einkauf.verschickenTitel'),
      t('einkauf.verschickenFrage'),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('einkauf.senden'),
          onPress: async () => {
            setIsMailing(true);
            try {
              await api.post('/shopping-list/email', { liste: aktiv });
              Alert.alert(t('einkauf.verschickt'), t('einkauf.unterwegs'));
            } catch (err) {
              Alert.alert(t('einkauf.nichtVerschickt'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
            } finally {
              setIsMailing(false);
            }
          },
        },
      ],
    );
  };

  const handleToggle = async (item: ShoppingItem) => {
    // Optimistisch umschalten, damit es sich sofort reaktionsschnell anfuehlt
    setSections((prev) =>
      prev.map((s) => ({ ...s, data: s.data.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)) })),
    );
    try {
      await api.patch(`/shopping-list/${item.id}/toggle`);
    } catch (err) {
      // 404 bedeutet meist nur eine harmlose Race Condition (z.B. der
      // Eintrag wurde kurz zuvor per Long-Press geloescht, bevor die Liste
      // neu geladen war) - dann reicht stilles Neuladen, kein Alert noetig.
      if (err instanceof ApiError && err.status === 404) {
        load();
        return;
      }
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.nichtAktualisiert'));
      load();
    }
  };

  const handleDelete = async (item: ShoppingItem) => {
    setSections((prev) => prev.map((s) => ({ ...s, data: s.data.filter((i) => i.id !== item.id) })));
    try {
      await api.delete(`/shopping-list/${item.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        load();
        return;
      }
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.nichtGeloescht'));
      load();
    }
  };

  const handleClearChecked = async () => {
    try {
      await api.delete(`/shopping-list/checked${lq}`);
      load();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.nichtGeleert'));
    }
  };

  const handleClearAll = () => {
    Alert.alert(t('einkauf.ganzeListeLoeschen'), t('einkauf.ganzeListeHinweis'), [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      {
        text: t('allgemein.loeschen'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/shopping-list/all${lq}`);
            load();
          } catch (err) {
            Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('einkauf.nichtGeloescht'));
          }
        },
      },
    ]);
  };

  const hasCheckedItems = sections.some((s) => s.data.some((i) => i.checked));
  const hasAnyItems = sections.some((s) => s.data.length > 0);

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  // Einmal definiert, an beiden Einsatzorten verwendet (Modal bei Handy/
  // hochkant, eingebettet bei quer) - siehe Rueckgabe unten.
  const bearbeitenFormular = (
    <ScrollView automaticallyAdjustKeyboardInsets keyboardShouldPersistTaps="handled" contentContainerStyle={quer ? { padding: 18 } : undefined}>
      <Text style={[styles.modalTitel, { color: colors.text }]}>{t('einkauf.postenBearbeiten')}</Text>

      <Text style={[styles.modalLabel, { color: colors.muted }]}>{t('einkauf.zutatPlatzhalter')}</Text>
      <TextInput
        value={bearbeitenName}
        onChangeText={setBearbeitenName}
        style={[styles.modalInput, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
      />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalLabel, { color: colors.muted }]}>{t('einkauf.mengePlatzhalter')}</Text>
          <TextInput
            value={bearbeitenMenge}
            onChangeText={setBearbeitenMenge}
            keyboardType="numeric"
            style={[styles.modalInput, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalLabel, { color: colors.muted }]}>{t('einkauf.einheitPlatzhalter')}</Text>
          <TextInput
            value={bearbeitenEinheit}
            onChangeText={setBearbeitenEinheit}
            style={[styles.modalInput, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
          />
        </View>
      </View>

      <Text style={[styles.modalLabel, { color: colors.muted }]}>{t('einkauf.notiz')}</Text>
      <TextInput
        value={bearbeitenNotiz}
        onChangeText={setBearbeitenNotiz}
        placeholder={t('einkauf.notizPlatzhalter')}
        placeholderTextColor={colors.muted}
        multiline
        numberOfLines={3}
        style={[
          styles.modalInput,
          styles.modalNotizInput,
          { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm },
        ]}
      />

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <Pressable
          onPress={() => setBearbeiteItem(null)}
          style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}
        >
          <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
        </Pressable>
        <Pressable
          onPress={speichereBearbeitung}
          disabled={speichertBearbeitung || !bearbeitenName.trim()}
          style={[
            styles.modalKnopf,
            { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: !bearbeitenName.trim() ? 0.5 : 1 },
          ]}
        >
          {speichertBearbeitung ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: '#fff', fontWeight: '700' }}>{t('allgemein.speichern')}</Text>
          )}
        </Pressable>
      </View>
    </ScrollView>
  );

  return (
    // "quer": Liste links (fester Rahmen ueber styles.container), rechts
    // der Bearbeiten-Bereich eingebettet. Sonst volle Breite wie bisher.
    <View style={{ flex: 1, flexDirection: quer ? 'row' : 'column' }}>
    <View style={[styles.container, { backgroundColor: colors.bg }, quer && { width: 400, flex: undefined, borderRightWidth: 1, borderRightColor: colors.cardBorder }]}>
      {/* Der Einkauf-Tab ist wie jeder Tab eigentlich eine Wurzel ohne
          "zurueck" (man wechselt ja einfach den Tab) - auf Wunsch trotzdem
          ein Knopf, der ausdruecklich zu Home fuehrt. navigation.navigate
          statt goBack(): goBack() waere hier ohnehin ohne Wirkung, ein
          Tab-Root hat nichts, wohin es "zurueck" gehen koennte. */}
      <Pressable
        onPress={() => navigation.navigate('Home')}
        hitSlop={10}
        style={[styles.backRow, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="chevron-left" size={20} color={colors.text} />
        <Text style={[styles.backText, { color: colors.text }]}>{t('allgemein.zurueck')}</Text>
      </Pressable>

      {error && <Text style={[styles.errorText, { color: '#DC2626' }]}>{error}</Text>}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 44, marginBottom: 10 }}
        contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
        {listen.map((l) => {
          const istAktiv = l.id === aktiv;
          return (
            <Pressable key={l.id ?? 'haupt'} onPress={() => setAktiv(l.id)}
              onLongPress={() => { if (l.id) listeLoeschen(l.id, l.name); }}
              style={[styles.listenChip, { borderColor: istAktiv ? 'transparent' : colors.cardBorder,
                backgroundColor: istAktiv ? gradient[0] : colors.card }]}>
              <Text style={{ color: istAktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>
                {l.name}{l.offen ? `  ${l.offen}` : ''}
              </Text>
            </Pressable>
          );
        })}
        <Pressable onPress={() => setNeueListeOffen(true)}
          style={[styles.listenChip, { borderColor: colors.cardBorder, backgroundColor: 'transparent', flexDirection: 'row', gap: 4 }]}>
          <MaterialCommunityIcons name="plus" size={15} color={colors.text} />
          <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600' }}>{t('einkauf.neueListe')}</Text>
        </Pressable>
      </ScrollView>

      <Pressable
        onPress={() => navigation.navigate('ZutatenWaehlen', { liste: aktiv })}
        style={[styles.waehlenKnopf, { backgroundColor: gradient[0], borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="plus-circle-outline" size={22} color="#fff" />
        <Text style={styles.waehlenText}>{t('einkauf.zutatenHinzufuegen')}</Text>
      </Pressable>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[{ paddingBottom: 40 }, inhaltsBreite]}
        ListHeaderComponent={<KochplanKarte />}
        ListEmptyComponent={
          !error ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {t('einkauf.leerHinweis')}
            </Text>
          ) : null
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.sectionHeader, { color: colors.muted }]}>{section.title.toUpperCase()}</Text>
        )}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => handleToggle(item)}
            onLongPress={() => handleDelete(item)}
            style={[styles.itemRow, { backgroundColor: colors.card, borderRadius: radius.sm }]}
          >
            <View style={{ opacity: item.checked ? 0.45 : 1 }}>
              <ZutatBild name={item.ingredient_name} abteilung={item.category} bild={item.bild} groesse={40} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[
                  styles.itemText,
                  { color: item.checked ? colors.muted : colors.text },
                  item.checked && styles.itemTextChecked,
                ]}
              >
                {item.ingredient_name}
              </Text>
              {!!item.amount && (
                <Text style={[styles.itemNote, { color: colors.muted, fontStyle: 'normal' }]}>
                  {item.amount}{item.unit ? ` ${item.unit}` : ''}
                </Text>
              )}
              {!!item.note && (
                <Text style={[styles.itemNote, { color: colors.muted }]} numberOfLines={2}>
                  {item.note}
                </Text>
              )}
            </View>
            <MaterialCommunityIcons
              name={item.checked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
              size={24}
              color={item.checked ? gradient[0] : colors.muted}
            />
            <Pressable onPress={() => oeffneBearbeiten(item)} hitSlop={10} style={{ padding: 4 }}>
              <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}
      />

      {hasAnyItems && (
        <View style={{ flexDirection: 'row', gap: 10, marginBottom: 4 }}>
          <Pressable
            onPress={handlePrint}
            disabled={isExporting}
            style={[styles.clearButton, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
          >
            {isExporting ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <MaterialCommunityIcons name="printer-outline" size={15} color={gradient[0]} />
            )}
            <Text style={[styles.clearButtonText, { color: gradient[0] }]}>{t('einkauf.druckenPdf')}</Text>
          </Pressable>
          <Pressable
            onPress={handleMail}
            disabled={isMailing}
            style={[styles.clearButton, { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center' }]}
          >
            {isMailing ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <MaterialCommunityIcons name="email-outline" size={15} color={gradient[0]} />
            )}
            <Text style={[styles.clearButtonText, { color: gradient[0] }]}>{t('einkauf.perMail')}</Text>
          </Pressable>
        </View>
      )}

      {(hasCheckedItems || hasAnyItems) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {hasCheckedItems && (
            <Pressable onPress={handleClearChecked} style={[styles.clearButton, { flex: 1 }]}>
              <Text style={[styles.clearButtonText, { color: colors.muted }]}>{t('einkauf.abgehakteEntfernen')}</Text>
            </Pressable>
          )}
          {hasAnyItems && (
            <Pressable onPress={handleClearAll} style={[styles.clearButton, { flex: 1 }]}>
              <Text style={[styles.clearButtonText, { color: '#DC2626' }]}>{t('einkauf.listeLeeren')}</Text>
            </Pressable>
          )}
        </View>
      )}
      <Modal visible={neueListeOffen} transparent animationType="fade" onRequestClose={() => setNeueListeOffen(false)}>
        <View style={[styles.modalUeberlagerung, { justifyContent: 'flex-start', paddingTop: 90 }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={Keyboard.dismiss} accessible={false} />
          <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <Text style={[styles.modalTitel, { color: colors.text }]}>{t('einkauf.neueListe')}</Text>
            <TextInput
              value={neuerName}
              onChangeText={setNeuerName}
              placeholder={t('einkauf.listenName')}
              placeholderTextColor={colors.muted}
              autoFocus
              maxLength={40}
              returnKeyType="done"
              onSubmitEditing={() => { Keyboard.dismiss(); listeAnlegen(); }}
              style={[styles.modalInput, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            />
            <Text style={{ color: colors.muted, fontSize: 12, marginTop: 8, lineHeight: 17 }}>{t('einkauf.neueListeHinweis')}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => { setNeueListeOffen(false); setNeuerName(''); }}
                style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable onPress={listeAnlegen} disabled={!neuerName.trim()}
                style={[styles.modalKnopf, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: neuerName.trim() ? 1 : 0.5 }]}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>{t('einkauf.listeAnlegen')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <ScanFab />

      {/* Formularinhalt einmal definiert, einmal verwendet - je nach
          "quer" entweder in ein Modal gepackt (Handy, iPad hochkant) oder
          direkt in die rechte Spalte eingebettet (iPad quer), statt der
          urspruenglichen Idee "Wochenplan oder Rezeptauswahl rechts":
          konsistent mit dem Liste-links/Detail-rechts-Muster der anderen
          Bildschirme, und tatsaechlich nuetzlich statt zwei lose
          verbundene Inhalte nebeneinander. */}
      {!quer && (
        <Modal visible={!!bearbeiteItem} transparent animationType="fade" onRequestClose={() => setBearbeiteItem(null)}>
          <View style={styles.modalUeberlagerung}>
            <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
              {bearbeitenFormular}
            </View>
          </View>
        </Modal>
      )}
    </View>
    {quer && (
      <View style={[styles.querDetailSpalte, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        {bearbeiteItem ? (
          bearbeitenFormular
        ) : (
          <View style={styles.leereAuswahl}>
            <MaterialCommunityIcons name="pencil-outline" size={36} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>{t('einkauf.keinPostenAusgewaehlt')}</Text>
          </View>
        )}
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 16 },
  querDetailSpalte: { flex: 1, borderLeftWidth: 0 },
  leereAuswahl: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  backRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 14, marginBottom: 12 },
  backText: { fontSize: 14, fontWeight: '600', marginLeft: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 12, marginBottom: 12 },
  listenChip: { paddingHorizontal: 14, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  waehlenKnopf: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, marginBottom: 14 },
  waehlenText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  addInput: { flex: 1, height: 44, paddingHorizontal: 14, fontSize: 13.5 },
  addAmountInput: { width: 56, height: 44, paddingHorizontal: 8, fontSize: 13.5, textAlign: 'center' },
  addUnitInput: { width: 52, height: 44, paddingHorizontal: 8, fontSize: 13.5, textAlign: 'center' },
  addButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 14, marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, marginBottom: 6 },
  itemText: { fontSize: 13.5 },
  itemNote: { fontSize: 11.5, fontStyle: 'italic', marginTop: 2 },
  itemTextChecked: { textDecorationLine: 'line-through' },
  modalUeberlagerung: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalKarte: { padding: 20, maxHeight: '80%' },
  modalTitel: { fontSize: 17, fontWeight: '700', marginBottom: 14 },
  modalLabel: { fontSize: 11.5, fontWeight: '600', marginTop: 10, marginBottom: 4 },
  modalInput: { height: 42, paddingHorizontal: 12, fontSize: 14 },
  modalNotizInput: { height: 72, paddingTop: 10, textAlignVertical: 'top' },
  modalKnopf: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  clearButton: { alignItems: 'center', paddingVertical: 14 },
  clearButtonText: { fontSize: 12, fontWeight: '600' },
});
