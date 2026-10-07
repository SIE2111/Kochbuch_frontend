import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Alert, Modal, TextInput, Switch, Linking,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { useLayout } from '../utils/layout';

/**
 * Eigene Rezept-Pools (23.09.2026) - EIGENER Block im Profil, bewusst
 * NICHT im neuen "Einstellungen"-Unterschirm untergebracht (Auftrag: die
 * Pool-Verwaltung ist keine Ein/Aus-Einstellung, sondern ein eigener
 * Bereich mit eigenem Inhalt - Anlegen, Einladen, Mitglieder).
 *
 * Ein Nutzer kann beliebig viele Pools anlegen ("Familie", "Kochclub", ...)
 * UND Mitglied in fremden sein, komplett getrennt vom Haushalt. Jede
 * Mitgliedschaft hat einen Aktiv/Inaktiv-Schalter - betrifft, welche
 * Pools beim Durchstoebern/Veroeffentlichen zur Auswahl stehen (nur bei
 * MEHREREN aktiven gibt es dort ueberhaupt eine Auswahl).
 */

interface MeinPool {
  id: string;
  name: string;
  owner_user_id: string | null;
  owner_display_name: string | null;
  is_community: boolean;
  active: boolean;
  member_count: number;
  is_owner: boolean;
}

interface Mitglied {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
}

export default function MyPoolsScreen() {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();

  const [pools, setPools] = useState<MeinPool[] | null>(null);
  const [umschaltetId, setUmschaltetId] = useState<string | null>(null);

  const laden = useCallback(() => {
    api.get<MeinPool[]>('/pools/').then(setPools).catch(() => setPools([]));
  }, []);
  useEffect(laden, [laden]);

  const toggle = async (pool: MeinPool) => {
    setUmschaltetId(pool.id);
    try {
      const aktualisiert = await api.patch<MeinPool>(`/pools/${pool.id}/toggle`, {});
      setPools((prev) => (prev ?? []).map((p) => (p.id === pool.id ? aktualisiert : p)));
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setUmschaltetId(null);
    }
  };

  // --- Neuen Pool anlegen ---
  const [erstellenOffen, setErstellenOffen] = useState(false);
  const [neuerName, setNeuerName] = useState('');
  const [erstelltGerade, setErstelltGerade] = useState(false);
  const erstellePool = async () => {
    const name = neuerName.trim();
    if (!name) return;
    setErstelltGerade(true);
    try {
      await api.post('/pools/', { name });
      setErstellenOffen(false);
      setNeuerName('');
      laden();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setErstelltGerade(false);
    }
  };

  // --- Pool per Code beitreten ---
  const [beitretenOffen, setBeitretenOffen] = useState(false);
  const [beitrittsCode, setBeitrittsCode] = useState('');
  const [tritGeradeBei, setTrittGeradeBei] = useState(false);
  const [pruefeGerade, setPrueftGerade] = useState(false);
  // Vorschau VOR dem eigentlichen Beitreten (23.09.2026) - der Code wird
  // dabei noch nicht verbraucht, erst mit "Beitreten" im Bestaetigungs-
  // Dialog unten.
  const [vorschau, setVorschau] = useState<{ code: string; poolName: string; inviterName: string; aktivePoolsAnzahl: number } | null>(null);

  const pruefeCode = async () => {
    const code = beitrittsCode.trim();
    if (!code) return;
    setPrueftGerade(true);
    try {
      const res = await api.get<{ pool_name: string; inviter_name: string; aktive_pools_anzahl: number }>(
        `/pools/preview/${encodeURIComponent(code)}`,
      );
      setBeitretenOffen(false);
      setVorschau({ code, poolName: res.pool_name, inviterName: res.inviter_name, aktivePoolsAnzahl: res.aktive_pools_anzahl });
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setPrueftGerade(false);
    }
  };

  const tretePoolBeiWirklich = async (andereAktivLassen: boolean) => {
    if (!vorschau) return;
    setTrittGeradeBei(true);
    try {
      const beigetreten = await api.post<{ id: string }>('/pools/join', { code: vorschau.code });
      if (!andereAktivLassen) {
        // Alle anderen AKTUELL aktiven Pools abschalten, ausser dem
        // gerade erst beigetretenen - der bleibt in jedem Fall aktiv.
        const alle = await api.get<MeinPool[]>('/pools/');
        const abzuschalten = alle.filter((p) => p.active && p.id !== beigetreten.id);
        await Promise.all(abzuschalten.map((p) => api.patch(`/pools/${p.id}/toggle`, {})));
      }
      setVorschau(null);
      setBeitrittsCode('');
      laden();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setTrittGeradeBei(false);
    }
  };

  const bestaetigeBeitritt = () => {
    if (!vorschau) return;
    if (vorschau.aktivePoolsAnzahl === 0) {
      // Nichts zu entscheiden - es gibt noch keinen aktiven Pool, der
      // in Konflikt geraten koennte.
      tretePoolBeiWirklich(true);
      return;
    }
    Alert.alert(
      t('sonstiges.bestehendeAktivFrage'),
      t('sonstiges.bestehendeAktivText'),
      [
        { text: t('sonstiges.nurNeuerPool'), onPress: () => tretePoolBeiWirklich(false) },
        { text: t('sonstiges.alleAktivLassen'), onPress: () => tretePoolBeiWirklich(true) },
      ],
    );
  };

  // --- Verwalten (Einladen, Mitglieder, Umbenennen, Verlassen) ---
  const [verwaltePool, setVerwaltePool] = useState<MeinPool | null>(null);
  const [mitglieder, setMitglieder] = useState<Mitglied[] | null>(null);
  const [einladenName, setEinladenName] = useState('');
  const [einladenEmail, setEinladenEmail] = useState('');
  const [ladeGerade, setLadeGerade] = useState(false);
  const [letzterCode, setLetzterCode] = useState<{ code: string; shareText: string; emailSent: boolean } | null>(null);

  const oeffneVerwalten = async (pool: MeinPool) => {
    setVerwaltePool(pool);
    setMitglieder(null);
    setLetzterCode(null);
    setEinladenName('');
    setEinladenEmail('');
    try {
      const detail = await api.get<MeinPool & { members: Mitglied[] }>(`/pools/${pool.id}`);
      setMitglieder(detail.members);
    } catch {
      setMitglieder([]);
    }
  };

  const sendeEinladung = async () => {
    if (!verwaltePool) return;
    setLadeGerade(true);
    try {
      const res = await api.post<{ code: string; share_text: string; email_sent: boolean }>(
        `/pools/${verwaltePool.id}/invite`,
        { name: einladenName.trim() || null, email: einladenEmail.trim() || null },
      );
      setLetzterCode({ code: res.code, shareText: res.share_text, emailSent: res.email_sent });
      setEinladenName('');
      setEinladenEmail('');
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setLadeGerade(false);
    }
  };

  const teileWhatsapp = (text: string) => {
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => {
      Alert.alert(t('allgemein.fehler'), t('sonstiges.whatsappNichtVerfuegbar'));
    });
  };

  const verlasseWirklich = async (keepRecipes: boolean) => {
    if (!verwaltePool) return;
    try {
      await api.delete(`/pools/${verwaltePool.id}/leave?keep_recipes=${keepRecipes}`);
      setVerwaltePool(null);
      laden();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    }
  };

  const verlassePool = () => {
    if (!verwaltePool) return;
    Alert.alert(
      t('sonstiges.poolVerlassenFrage'),
      t('sonstiges.poolVerlassenText', { name: verwaltePool.name }),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('sonstiges.verlassen'),
          style: 'destructive',
          onPress: () => {
            // Zweite Frage (23.09.2026): was mit selbst veroeffentlichten
            // Rezepten in DIESEM Pool passiert - unabhaengig davon, ob
            // ueberhaupt welche vorhanden sind (dann ist die Wahl
            // folgenlos, aber die Frage stellt sich einheitlich).
            Alert.alert(
              t('sonstiges.eigeneRezepteFrage'),
              t('sonstiges.eigeneRezepteText'),
              [
                { text: t('sonstiges.rezepteBehalten'), onPress: () => verlasseWirklich(true) },
                { text: t('sonstiges.rezepteEntfernen'), style: 'destructive', onPress: () => verlasseWirklich(false) },
              ],
            );
          },
        },
      ],
    );
  };

  if (!pools) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView automaticallyAdjustKeyboardInsets contentContainerStyle={[styles.container, inhaltsBreite]}>
        <Text style={[styles.hinweis, { color: colors.muted }]}>{t('sonstiges.poolsHinweis')}</Text>

        {pools.map((pool) => (
          <Pressable
            key={pool.id}
            onPress={() => oeffneVerwalten(pool)}
            style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
          >
            <MaterialCommunityIcons
              name={pool.is_community ? 'earth' : 'account-group'}
              size={20}
              color={colors.muted}
              style={{ marginRight: 10 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{pool.name}</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]}>
                {t('sonstiges.mitgliederAnzahl', { anzahl: pool.member_count })}
                {!pool.is_owner && !pool.is_community && pool.owner_display_name
                  ? ` · ${t('sonstiges.vonName', { name: pool.owner_display_name })}`
                  : ''}
              </Text>
            </View>
            {umschaltetId === pool.id ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <Switch
                value={pool.active}
                onValueChange={() => toggle(pool)}
                trackColor={{ false: '#E7E1D4', true: gradient[0] }}
                thumbColor="#fff"
              />
            )}
          </Pressable>
        ))}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
          <Pressable
            onPress={() => setErstellenOffen(true)}
            style={[styles.aktionKnopf, { backgroundColor: gradient[0], borderRadius: radius.md }]}
          >
            <MaterialCommunityIcons name="plus" size={16} color="#fff" />
            <Text style={styles.aktionKnopfText}>{t('sonstiges.poolErstellen')}</Text>
          </Pressable>
          <Pressable
            onPress={() => setBeitretenOffen(true)}
            style={[styles.aktionKnopf, { backgroundColor: colors.card, borderRadius: radius.md }]}
          >
            <MaterialCommunityIcons name="login-variant" size={16} color={colors.text} />
            <Text style={[styles.aktionKnopfText, { color: colors.text }]}>{t('sonstiges.poolBeitreten')}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Pool erstellen */}
      <Modal visible={erstellenOffen} transparent animationType="fade" onRequestClose={() => setErstellenOffen(false)}>
        <View style={styles.modalUeberlagerung}>
          <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <Text style={[styles.modalTitel, { color: colors.text }]}>{t('sonstiges.poolErstellen')}</Text>
            <TextInput
              value={neuerName}
              onChangeText={setNeuerName}
              placeholder={t('sonstiges.poolNamePlatzhalter')}
              placeholderTextColor={colors.muted}
              autoFocus
              style={[styles.input, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setErstellenOffen(false)} style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={erstellePool}
                disabled={erstelltGerade || !neuerName.trim()}
                style={[styles.modalKnopf, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: !neuerName.trim() ? 0.5 : 1 }]}
              >
                {erstelltGerade ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('sonstiges.poolErstellen')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pool beitreten */}
      <Modal visible={beitretenOffen} transparent animationType="fade" onRequestClose={() => setBeitretenOffen(false)}>
        <View style={styles.modalUeberlagerung}>
          <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <Text style={[styles.modalTitel, { color: colors.text }]}>{t('sonstiges.poolBeitreten')}</Text>
            <TextInput
              value={beitrittsCode}
              onChangeText={setBeitrittsCode}
              placeholder={t('sonstiges.beitrittscodePlatzhalter')}
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              autoFocus
              style={[styles.input, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setBeitretenOffen(false)} style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={pruefeCode}
                disabled={pruefeGerade || !beitrittsCode.trim()}
                style={[styles.modalKnopf, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: !beitrittsCode.trim() ? 0.5 : 1 }]}
              >
                {pruefeGerade ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('sonstiges.pruefen')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Bestaetigung VOR dem eigentlichen Beitreten - zeigt, wohin und
          von wem, statt den Code blind einzuloesen. */}
      <Modal visible={!!vorschau} transparent animationType="fade" onRequestClose={() => setVorschau(null)}>
        <View style={styles.modalUeberlagerung}>
          <View style={[styles.modalKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <Text style={[styles.modalTitel, { color: colors.text }]}>{t('sonstiges.beitrittBestaetigen')}</Text>
            {vorschau && (
              <Text style={{ color: colors.text, fontSize: 14, lineHeight: 20, marginBottom: 4 }}>
                {t('sonstiges.beitrittBestaetigenText', { pool: vorschau.poolName, name: vorschau.inviterName })}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <Pressable onPress={() => setVorschau(null)} style={[styles.modalKnopf, { borderColor: colors.muted, borderWidth: 1, borderRadius: radius.sm }]}>
                <Text style={{ color: colors.muted, fontWeight: '600' }}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={bestaetigeBeitritt}
                disabled={tritGeradeBei}
                style={[styles.modalKnopf, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
              >
                {tritGeradeBei ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>{t('sonstiges.poolBeitreten')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Pool verwalten */}
      <Modal visible={!!verwaltePool} transparent animationType="fade" onRequestClose={() => setVerwaltePool(null)}>
        <View style={styles.modalUeberlagerung}>
          <View style={[styles.modalKarte, styles.verwaltenKarte, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <View style={styles.pickerHeader}>
              <Text style={[styles.modalTitel, { color: colors.text }]}>{verwaltePool?.name}</Text>
              <Pressable onPress={() => setVerwaltePool(null)} hitSlop={10}>
                <MaterialCommunityIcons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView>
              <Text style={[styles.abschnittLabel, { color: colors.muted }]}>{t('sonstiges.mitglieder')}</Text>
              {mitglieder === null ? (
                <ActivityIndicator color={colors.muted} style={{ marginVertical: 10 }} />
              ) : (
                mitglieder.map((m) => (
                  <Text key={m.user_id} style={{ color: colors.text, fontSize: 13.5, marginBottom: 4 }}>
                    {m.display_name}{m.role === 'owner' ? ` · ${t('sonstiges.owner')}` : ''}
                  </Text>
                ))
              )}

              {/* Jedes Mitglied darf einladen, nicht nur der Owner
                  (23.09.2026) - muss nicht der eigene Pool sein. */}
              {!verwaltePool?.is_community && (
                <>
                  <Text style={[styles.abschnittLabel, { color: colors.muted, marginTop: 18 }]}>{t('sonstiges.einladen')}</Text>
                  <TextInput
                    value={einladenName}
                    onChangeText={setEinladenName}
                    placeholder={t('sonstiges.namePlatzhalterOptional')}
                    placeholderTextColor={colors.muted}
                    style={[styles.input, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm, marginBottom: 8 }]}
                  />
                  <TextInput
                    value={einladenEmail}
                    onChangeText={setEinladenEmail}
                    placeholder={t('sonstiges.emailPlatzhalterOptional')}
                    placeholderTextColor={colors.muted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={[styles.input, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
                  />
                  <Pressable
                    onPress={sendeEinladung}
                    disabled={ladeGerade}
                    style={[styles.aktionKnopf, { backgroundColor: gradient[0], borderRadius: radius.sm, marginTop: 10, alignSelf: 'flex-start' }]}
                  >
                    {ladeGerade ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.aktionKnopfText}>{t('sonstiges.einladungErstellen')}</Text>}
                  </Pressable>

                  {letzterCode && (
                    <View style={[styles.codeBox, { backgroundColor: colors.bg, borderRadius: radius.sm }]}>
                      <Text style={{ color: colors.muted, fontSize: 11.5 }}>
                        {letzterCode.emailSent ? t('sonstiges.einladungMailVersendet') : t('sonstiges.einladungNurCode')}
                      </Text>
                      <Text style={{ color: colors.text, fontSize: 22, fontWeight: '700', letterSpacing: 4, marginTop: 4 }}>
                        {letzterCode.code}
                      </Text>
                      <Pressable
                        onPress={() => teileWhatsapp(letzterCode.shareText)}
                        style={[styles.aktionKnopf, { backgroundColor: '#25D366', borderRadius: radius.sm, marginTop: 10, alignSelf: 'flex-start' }]}
                      >
                        <MaterialCommunityIcons name="whatsapp" size={16} color="#fff" />
                        <Text style={styles.aktionKnopfText}>{t('sonstiges.perWhatsappTeilen')}</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}

              {!verwaltePool?.is_community && (
                <Pressable onPress={verlassePool} style={{ marginTop: 20, alignSelf: 'center' }}>
                  <Text style={{ color: '#C0392B', fontWeight: '600', fontSize: 13 }}>{t('sonstiges.poolVerlassen')}</Text>
                </Pressable>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 18, paddingBottom: 40 },
  hinweis: { fontSize: 12, marginBottom: 14, lineHeight: 17 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowTitle: { fontSize: 14.5, fontWeight: '600' },
  rowSub: { fontSize: 11.5, marginTop: 2 },
  aktionKnopf: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', height: 44 },
  aktionKnopfText: { color: '#fff', fontWeight: '700', fontSize: 12.5 },
  modalUeberlagerung: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 },
  modalKarte: { padding: 20 },
  verwaltenKarte: { maxHeight: '80%' },
  modalTitel: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  modalKnopf: { flex: 1, height: 46, alignItems: 'center', justifyContent: 'center' },
  input: { height: 44, paddingHorizontal: 12, fontSize: 14 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  abschnittLabel: { fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8 },
  codeBox: { padding: 14, marginTop: 12, alignItems: 'center' },
});
