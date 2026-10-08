import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, Linking, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { supabase } from '../api/supabaseClient';
import { plusVormerkenZeigen } from '../utils/plusHinweis';
import { useLayout } from '../utils/layout';

interface Member {
  user_id: string;
  display_name: string;
  role: 'owner' | 'member';
  joined_at: string;
}

interface Household {
  id: string;
  name: string;
  created_by: string;
  members: Member[];
}

interface InviteListItem {
  id: string;
  code: string;
  invitee_name: string | null;
  invitee_email: string | null;
  expires_at: string;
  status: 'beigetreten' | 'ausgetreten' | 'offen' | 'abgelaufen';
}

export default function HouseholdScreen() {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);

  // Haushaltsname nachträglich ändern (nur Owner, das Backend prüft ebenfalls).
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setMyUserId(data.session?.user?.id ?? null));
  }, []);
  const isOwner = !!household?.members?.some((m) => m.user_id === myUserId && m.role === 'owner');

  async function handleRename() {
    const newName = renameValue.trim();
    if (!newName || !household) return;
    if (newName === household.name) {
      setRenaming(false);
      return;
    }
    setRenameBusy(true);
    try {
      const updated = await api.patch<Household>('/households/', { name: newName });
      setHousehold(updated);
      setRenaming(false);
    } catch (e: any) {
      Alert.alert(t('allgemein.fehler'), e?.message || t('haushalt.fehlgeschlagen'));
    } finally {
      setRenameBusy(false);
    }
  }
  const [error, setError] = useState<string | null>(null);

  const [newHouseholdName, setNewHouseholdName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  // Vom Server fertig zusammengebaut, inkl. App-Store-Links (23.09.2026,
  // "gleiche Logik" wie bei Pools) - lieber das verwenden als hier lokal
  // einen zweiten, staendig veraltenden Text zu pflegen.
  const [inviteShareText, setInviteShareText] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [invites, setInvites] = useState<InviteListItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);

  const loadHousehold = () => {
    api
      .get<Household | null>('/households/me')
      .then(setHousehold)
      .catch((err) => setError(err instanceof ApiError ? err.detail : t('haushalt.nichtGeladen')));
  };

  useEffect(() => {
    loadHousehold();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    if (!newHouseholdName.trim()) return;
    setIsBusy(true);
    try {
      const created = await api.post<Household>('/households/', { name: newHouseholdName.trim() });
      setHousehold(created);
      setNewHouseholdName('');
    } catch (err) {
      Alert.alert(t('haushalt.anlegenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    setIsBusy(true);
    try {
      const joined = await api.post<Household>('/households/join', { code: joinCode.trim().toUpperCase() });
      setHousehold(joined);
      setJoinCode('');
    } catch (err) {
      Alert.alert(t('haushalt.beitretenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsBusy(false);
    }
  };

  const loadInvites = async () => {
    try {
      setInvites(await api.get<InviteListItem[]>('/households/invites'));
    } catch {
      // Die Liste ist Zusatzinformation - schlaegt sie fehl, soll der
      // Haushalt trotzdem bedienbar bleiben.
    }
  };

  const handleInviteByEmail = async () => {
    const email = inviteEmail.trim();
    if (!email.includes('@')) {
      Alert.alert(t('haushalt.emailFehlt'), t('haushalt.bitteEmail'));
      return;
    }
    setIsBusy(true);
    try {
      const invite = await api.post<{ code: string; email_sent: boolean; share_text: string }>('/households/invite', {
        name: inviteName.trim() || null,
        email,
      });
      setInviteName('');
      setInviteEmail('');
      setInviteShareText(invite.share_text);
      await loadInvites();
      if (invite.email_sent) {
        Alert.alert(t('haushalt.einladungVerschickt'), t('haushalt.einladungVerschicktText', { email }));
      } else {
        // Der Code gilt trotzdem - deshalb wird er hier gezeigt, statt nur
        // einen Fehler zu melden. Sonst waere die Einladung angelegt, aber
        // fuer den Nutzer unbrauchbar.
        setInviteCode(invite.code);
        Alert.alert(
          'E-Mail nicht zugestellt',
          `Die Einladung wurde angelegt, die E-Mail ging aber nicht raus. Gib den Code ${invite.code} direkt weiter.`,
        );
      }
      void plusVormerkenZeigen('teilen');
    } catch (err) {
      Alert.alert(t('haushalt.einladenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleDeleteInvite = (invite: InviteListItem) => {
    Alert.alert(
      t('haushalt.einladungEntfernen'),
      invite.status === 'beigetreten'
        ? t('haushalt.einladungEntfernenMitglied')
        : t('haushalt.einladungEntfernenCode'),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('allgemein.entfernen'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/households/invites/${invite.id}`);
              await loadInvites();
            } catch (err) {
              Alert.alert(t('haushalt.fehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
            }
          },
        },
      ],
    );
  };

  const handleInvite = async () => {
    setIsBusy(true);
    try {
      const invite = await api.post<{ code: string; expires_at: string; share_text: string }>('/households/invite');
      setInviteCode(invite.code);
      setInviteShareText(invite.share_text);
      void plusVormerkenZeigen('teilen');
    } catch (err) {
      Alert.alert(t('haushalt.einladungFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsBusy(false);
    }
  };

  const handleShareInvite = () => {
    if (!inviteCode) return;
    // Direkter WhatsApp-Link statt Share.share() (23.09.2026) - der
    // allgemeine iOS-Teilen-Dialog kuerzt Text+Link-Kombinationen bei
    // WhatsApp oft auf nur den Link, der Rest der Nachricht faellt weg.
    // Direkt an wa.me behaelt den kompletten Text zuverlaessig (gleicher
    // Ansatz wie beim Pool-Einladen, siehe MyPoolsScreen.tsx).
    const text =
      inviteShareText
      ?? `Komm in meinen Kochbuch-Haushalt "${household?.name}"! Gib in der App unter Profil → Haushalt diesen Code ein: ${inviteCode} (24 Std. gültig)`;
    Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`).catch(() => {
      // WhatsApp nicht installiert/erreichbar - kein Alert noetig, der
      // Code steht ja weiterhin sichtbar da.
    });
  };

  const handleLeave = () => {
    Alert.alert(t('haushalt.verlassenFrage'), t('haushalt.verlassenHinweis'), [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      {
        text: t('haushalt.verlassen'),
        style: 'destructive',
        onPress: async () => {
          setIsBusy(true);
          try {
            await api.delete('/households/leave');
            setHousehold(null);
            setInviteCode(null);
          } catch (err) {
            Alert.alert(t('haushalt.fehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
          } finally {
            setIsBusy(false);
          }
        },
      },
    ]);
  };

  const handleRemoveMember = (memberUserId: string) => {
    Alert.alert(t('haushalt.mitgliedEntfernen'), undefined, [
      { text: t('allgemein.abbrechen'), style: 'cancel' },
      {
        text: t('allgemein.entfernen'),
        style: 'destructive',
        onPress: async () => {
          try {
            await api.delete(`/households/members/${memberUserId}`);
            loadHousehold();
          } catch (err) {
            Alert.alert(t('haushalt.fehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
          }
        },
      },
    ]);
  };

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text>
      </View>
    );
  }

  if (household === undefined) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (household === null) {
    return (
      <View style={[styles.container, { backgroundColor: colors.bg }]}>
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>HAUSHALT ANLEGEN</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('haushalt.namePlatzhalter')}
          placeholderTextColor={colors.muted}
          value={newHouseholdName}
          onChangeText={setNewHouseholdName}
        />
        <Pressable onPress={handleCreate} disabled={isBusy} style={[styles.primaryButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={styles.primaryButtonText}>{t('haushalt.haushaltAnlegen')}</Text>
        </Pressable>

        <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 28 }]}>ODER BEITRETEN</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('haushalt.codePlatzhalter')}
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          value={joinCode}
          onChangeText={setJoinCode}
        />
        <Pressable onPress={handleJoin} disabled={isBusy} style={[styles.secondaryButton, { borderColor: gradient[0], borderRadius: radius.md }]}>
          <Text style={[styles.secondaryButtonText, { color: gradient[0] }]}>{t('haushalt.beitreten')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    // Scrollbar, seit Einladungsformular und -liste dazugekommen sind:
    // Bei mehreren Einladungen passt der Inhalt sonst nicht mehr auf eine
    // Bildschirmhoehe und t('haushalt.haushaltVerlassen') liegt unerreichbar unten.
    <ScrollView automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.scrollContent, inhaltsBreite]}
      keyboardShouldPersistTaps="handled"
    >
      {renaming ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <TextInput
            value={renameValue}
            onChangeText={setRenameValue}
            autoFocus
            maxLength={80}
            placeholder={t('haushalt.namePlatzhalter')}
            placeholderTextColor={colors.muted}
            returnKeyType="done"
            onSubmitEditing={handleRename}
            style={[styles.input, { flex: 1, marginBottom: 0, backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          />
          <Pressable onPress={handleRename} disabled={!renameValue.trim() || renameBusy} hitSlop={8}>
            {renameBusy ? <ActivityIndicator color={colors.muted} /> : <MaterialCommunityIcons name="check" size={24} color={colors.text} />}
          </Pressable>
          <Pressable onPress={() => setRenaming(false)} disabled={renameBusy} hitSlop={8}>
            <MaterialCommunityIcons name="close" size={24} color={colors.muted} />
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.householdName, { color: colors.text, flexShrink: 1 }]}>{household.name}</Text>
          {isOwner && (
            <Pressable onPress={() => { setRenameValue(household.name); setRenaming(true); }} hitSlop={10}>
              <MaterialCommunityIcons name="pencil-outline" size={18} color={colors.muted} />
            </Pressable>
          )}
        </View>
      )}
      <Text style={[styles.hint, { color: colors.muted, marginTop: 14 }]}>
        Alle Mitglieder sehen dieselben Rezepte, dieselbe Einkaufsliste und denselben Wochenplan.
        Ändern und löschen kann ein Rezept nur, wer es angelegt hat.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 20 }]}>MITGLIEDER</Text>
      {household.members.map((member) => (
        <View key={member.user_id} style={[styles.memberRow, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.memberText, { color: colors.text }]} numberOfLines={1}>
            {member.display_name}
          </Text>
          <Text style={[styles.roleTag, { color: colors.muted }]}>{member.role === 'owner' ? 'Owner' : t('haushalt.mitglied')}</Text>
          {member.role !== 'owner' && (
            <Pressable onPress={() => handleRemoveMember(member.user_id)} hitSlop={8}>
              <Text style={{ color: '#DC2626', fontSize: 12 }}>{t('allgemein.entfernen')}</Text>
            </Pressable>
          )}
        </View>
      ))}

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 24 }]}>MITGLIED EINLADEN</Text>
      <Text style={[styles.hint, { color: colors.muted }]}>
        Name und E-Mail eingeben – die Person bekommt eine Nachricht mit ihrem Beitrittscode.
      </Text>
      <TextInput
        value={inviteName}
        onChangeText={setInviteName}
        placeholder={t('haushalt.einladungNamePlatzhalter')}
        placeholderTextColor={colors.muted}
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
      />
      <TextInput
        value={inviteEmail}
        onChangeText={setInviteEmail}
        placeholder={t('haushalt.einladungEmailPlatzhalter')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        keyboardType="email-address"
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginTop: 8 }]}
      />
      <Pressable
        onPress={handleInviteByEmail}
        disabled={isBusy}
        style={[styles.secondaryButton, { borderColor: gradient[0], borderRadius: radius.md, marginTop: 10, opacity: isBusy ? 0.6 : 1 }]}
      >
        <Text style={[styles.secondaryButtonText, { color: gradient[0] }]}>{t('haushalt.einladungSenden')}</Text>
      </Pressable>

      {/* Der reine Code bleibt als zweiter Weg erhalten: fuer alle, die
          gerade keine Adresse zur Hand haben und den Code muendlich oder
          per Messenger weitergeben wollen. */}
      <Pressable onPress={handleInvite} disabled={isBusy} style={{ marginTop: 12, alignSelf: 'center' }}>
        <Text style={{ color: colors.muted, fontSize: 12.5 }}>
          Stattdessen <Text style={{ color: gradient[0], fontWeight: '600' }}>nur einen Code erzeugen</Text>
        </Text>
      </Pressable>

      {invites.length > 0 && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 24 }]}>BISHERIGE EINLADUNGEN</Text>
          {invites.map((invite) => (
            <View key={invite.id} style={[styles.memberRow, { backgroundColor: colors.card, borderRadius: radius.md }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.memberText, { color: colors.text }]} numberOfLines={1}>
                  {invite.invitee_name || invite.invitee_email || `Code ${invite.code}`}
                </Text>
                <Text style={{ fontSize: 11, marginTop: 2, color: invite.status === 'beigetreten' ? '#16A34A' : colors.muted }}>
                  {invite.status === 'beigetreten'
                    ? t('haushalt.beigetreten')
                    : invite.status === 'ausgetreten'
                      ? t('haushalt.ausgetreten')
                      : invite.status === 'abgelaufen'
                        ? t('haushalt.abgelaufen')
                        : `Offen · Code ${invite.code}`}
                  {invite.invitee_name && invite.invitee_email ? ` · ${invite.invitee_email}` : ''}
                </Text>
              </View>
              <Pressable onPress={() => handleDeleteInvite(invite)} hitSlop={8}>
                <MaterialCommunityIcons name="trash-can-outline" size={18} color="#DC2626" />
              </Pressable>
            </View>
          ))}
        </>
      )}

      {inviteCode && (
        <View style={[styles.inviteCodeBox, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <Text style={[styles.inviteCodeLabel, { color: colors.muted }]}>{t('haushalt.einladungscode')}</Text>
          <Text style={[styles.inviteCodeValue, { color: gradient[0] }]}>{inviteCode}</Text>
          <Pressable onPress={handleShareInvite} style={[styles.shareInviteButton, { borderColor: gradient[0], borderRadius: radius.sm }]}>
            <Text style={{ color: gradient[0], fontSize: 12.5, fontWeight: '700' }}>{t('haushalt.codeTeilen')}</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={handleLeave} style={[styles.leaveButton, { borderColor: '#DC2626', borderRadius: radius.md, marginTop: 28 }]}>
        <Text style={styles.leaveButtonText}>{t('haushalt.haushaltVerlassen')}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 18 },
  // Ohne eigenen Style waere hier 'flex: 1' gelandet - im
  // contentContainerStyle einer ScrollView verhindert das das Scrollen
  // vollstaendig, der Inhalt wird stattdessen gestaucht.
  scrollContent: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  input: { height: 44, paddingHorizontal: 14, fontSize: 13.5, marginBottom: 10 },
  primaryButton: { height: 46, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },
  secondaryButton: { height: 44, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontWeight: '700', fontSize: 13 },
  householdName: { fontSize: 18, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginBottom: 7 },
  memberText: { flex: 1, fontSize: 11.5 },
  roleTag: { fontSize: 10.5, fontWeight: '600' },
  hint: { fontSize: 11.5, lineHeight: 17, marginBottom: 10 },
  inviteCodeBox: { padding: 16, alignItems: 'center', marginTop: 12 },
  inviteCodeLabel: { fontSize: 10, marginBottom: 6 },
  inviteCodeValue: { fontSize: 24, fontWeight: '700', letterSpacing: 3 },
  shareInviteButton: { marginTop: 10, paddingHorizontal: 16, paddingVertical: 8, borderWidth: 1.3 },
  leaveButton: { height: 44, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 'auto' },
  leaveButtonText: { color: '#DC2626', fontWeight: '600', fontSize: 13 },
});
