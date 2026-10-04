import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, ScrollView, TextInput, Modal, Linking, Switch, KeyboardAvoidingView, Platform } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme, type BackgroundStyle, type AccentColor } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import MarkenZeile from '../components/MarkenZeile';
import AppSettingsScreen from './AppSettingsScreen';
import * as Application from 'expo-application';
import { useFocusEffect, type CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList, MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';
import { UpdateInfo } from '../components/UpdateInfo';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Profil'>,
  NativeStackScreenProps<MainStackParamList>
>;

type StorageMode = 'lokal' | 'nas' | 'eigene_cloud' | 'drittanbieter_cloud';
type HaubenLevel = 'anfaenger' | 'fortgeschritten' | 'profi';

interface Preferences {
  show_brutzel: boolean;
  large_text: boolean;
  auto_read_steps: boolean;
  server_sync_enabled: boolean;
  play_animation_music: boolean;
  show_greeting_animation: boolean;
  storage_mode: StorageMode;
  default_hauben_level: HaubenLevel;
  drittanbieter_provider: string | null;
  default_servings: number;
  display_name: string | null;
  household_role: string | null;
  notifications_enabled: boolean;
  ai_enabled: boolean;
  ai_calls_this_month: number;
  ai_monthly_limit: number;
}

type PreferenceKey = 'show_brutzel' | 'large_text' | 'auto_read_steps' | 'server_sync_enabled' | 'show_greeting_animation' | 'play_animation_music' | 'notifications_enabled' | 'ai_enabled';

// Kurzbezeichnungen der Speicherorte fuer die Profil-Zeile. Bewusst nur
// die Modi - welcher Drittanbieter verbunden ist, steht im Speicherort-
// Screen selbst; hier wuerde es die Zeile ueberfrachten.
const HILFE_URL = 'https://www.homearchive.at/meinkochbuch/hilfe';
const AGB_URL = 'https://www.homearchive.at/agb';
const DATENSCHUTZ_URL = 'https://www.homearchive.at/datenschutz';

// Anzeigenamen aller Apps der HomeArchive-Familie - dupliziert in
// buero-ablage/mobile-bueroablage und medien-ablage sowie im Backend
// (routers/account.py), da es zwischen den Repos keine gemeinsame
// Bibliothek gibt (siehe docs/UMBAU.md: bewusste Entscheidung gegen
// Code-Merge).
const APP_DISPLAY_NAMES: Record<string, string> = {
  bueroablage: 'Meine Büroablage',
  medienablage: 'Meine Medienablage',
  kochbuch: 'Mein Kochbuch',
  weinkeller: 'Mein Weinkeller',
};

// Schluessel statt fertiger Texte: Die Tabellen stehen auf Modulebene und
// werden einmal beim Laden ausgewertet - ein dort eingesetzter Text waere
// fuer immer in der Sprache des ersten Starts.
const STORAGE_MODE_LABELS: Record<string, string> = {
  lokal: 'profil.speicherLokal',
  nas: 'profil.speicherNas',
  eigene_cloud: 'profil.speicherEigeneCloud',
  drittanbieter_cloud: 'profil.speicherDrittanbieter',
};

const HAUBEN_OPTIONS: { key: HaubenLevel; title: string; hats: number }[] = [
  { key: 'anfaenger', title: 'profil.haubenAnfaenger', hats: 1 },
  { key: 'fortgeschritten', title: 'profil.haubenFortgeschritten', hats: 2 },
  { key: 'profi', title: 'profil.haubenProfi', hats: 3 },
];

const BACKGROUND_OPTIONS: { key: BackgroundStyle; title: string }[] = [
  { key: 'warm-hell', title: 'profil.hintergrundWarm' },
  { key: 'kuehl-hell', title: 'profil.hintergrundKuehl' },
  { key: 'dunkel', title: 'profil.hintergrundDunkel' },
];

const ACCENT_OPTIONS: { key: AccentColor; title: string; color: string }[] = [
  { key: 'orange', title: 'profil.farbeOrange', color: '#EA580C' },
  { key: 'gruen', title: 'profil.farbeGruen', color: '#16A34A' },
  { key: 'tuerkis', title: 'profil.farbeTuerkis', color: '#0D9488' },
  { key: 'pink', title: 'profil.farbePink', color: '#DB2777' },
  { key: 'gelb', title: 'profil.farbeGelb', color: '#EAB308' },
  { key: 'bernstein', title: 'profil.farbeBernstein', color: '#B07A12' },
];

// Die einzelnen Schalter-Definitionen (Darstellung, Server-Sync,
// Benachrichtigungen, KI) leben seit 23.09.2026 in AppSettingsScreen -
// hier bleibt nur noch der Link dorthin (siehe "profil.einstellungen"
// weiter unten).

export default function ProfileScreen({ navigation }: Props) {
  const { colors, gradient, radius, theme, setTheme } = useTheme();
  const { inhaltsBreite, quer } = useLayout();
  const { t } = useUebersetzung();
  const { signOut, session } = useAuth();
  // Nur Major.Minor, wie bei HomeArchive AI's eigenem "v2.4" im Profil.
  // nativeApplicationVersion statt app.json: Bei appVersionSource "remote"
  // (siehe eas.json) ist app.json nicht mehr die verbindliche Quelle, das
  // hier eingebettete Ergebnis des jeweiligen Builds schon. Ab jetzt
  // wieder aktiv (23.09.2026) - der naechste Build bindet expo-application
  // fest ein, das Risiko eines fehlenden nativen Moduls entfaellt damit.
  let versionAnzeige: string | null = null;
  try {
    versionAnzeige = Application.nativeApplicationVersion?.split('.').slice(0, 2).join('.') ?? null;
  } catch {
    versionAnzeige = null;
  }
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  // Moderations-Zeile nur für Moderatoren (MODERATOR_EMAILS am Server)
  const [istModerator, setIstModerator] = useState(false);
  useEffect(() => {
    api.get<{ moderator: boolean }>('/pool/moderation/me').then((r) => setIstModerator(!!r.moderator)).catch(() => setIstModerator(false));
  }, []);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<PreferenceKey | 'default_hauben_level' | 'default_servings' | 'display_name' | null>(null);
  const [otherApps, setOtherApps] = useState<string[]>([]);

  // Fuer den Loesch-Dialog: in welchen anderen Apps der HomeArchive-
  // Familie ist dieses Konto noch registriert? Rein informativ - schlaegt
  // der Abruf fehl, bleibt die Liste einfach leer, die eigentliche
  // Loeschung haengt nicht davon ab.
  useEffect(() => {
    api
      .get<{ apps: string[]; app_names: string[] }>('/account/registered-apps')
      .then((data) => {
        setOtherApps(data.apps.filter((a) => a !== 'kochbuch').map((a) => APP_DISPLAY_NAMES[a] ?? a));
      })
      .catch(() => {});
  }, []);

  const loadPrefs = () => {
    api
      .get<Preferences>('/preferences/')
      .then(setPrefs)
      .catch((err) => setError(err instanceof ApiError ? err.detail : t('profil.einstellungenNichtGeladen')));
  };

  // Bei jeder Rueckkehr auf diesen Screen neu laden - nach der Anbieter-
  // Anmeldung im System-Browser ebenso wie nach einer Aenderung im
  // Speicherort-Screen. useFocusEffect statt navigation.addListener('focus'):
  // Profil ist ein Tab-Screen UNTER einem Stack-Screen, und in dieser
  // Verschachtelung ist useFocusEffect die verlaessliche Variante.
  useFocusEffect(
    React.useCallback(() => {
      loadPrefs();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  // Wieder da (23.09.2026, vorher kurzzeitig komplett in AppSettingsScreen
  // ausgelagert) - nur noch fuer die zwei Zeilen, die dort wieder raus
  // sollten: Benachrichtigungen und KI-Analyse.
  const handleToggle = async (key: 'notifications_enabled' | 'ai_enabled', value: boolean) => {
    if (!prefs) return;
    const vorher = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSavingKey(key);
    try {
      const updated = await api.patch<Preferences>('/preferences/', { [key]: value });
      setPrefs(updated);
    } catch (err) {
      setPrefs(vorher);
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleHaubenLevelSelect = async (level: HaubenLevel) => {
    if (!prefs || prefs.default_hauben_level === level) return;
    const previous = prefs;
    setPrefs({ ...prefs, default_hauben_level: level });
    setSavingKey('default_hauben_level');
    try {
      const updated = await api.patch<Preferences>('/preferences/', { default_hauben_level: level });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  const [servingsInput, setServingsInput] = useState('');
  useEffect(() => {
    if (prefs) setServingsInput(String(prefs.default_servings));
  }, [prefs?.default_servings]);

  const handleSaveDefaultServings = async () => {
    if (!prefs) return;
    const value = Number(servingsInput);
    if (!value || value < 1 || value > 20) {
      Alert.alert(t('profil.ungueltigerWert'), t('profil.zahlZwischen'));
      setServingsInput(String(prefs.default_servings));
      return;
    }
    if (value === prefs.default_servings) return;
    const previous = prefs;
    setPrefs({ ...prefs, default_servings: value });
    setSavingKey('default_servings');
    try {
      const updated = await api.patch<Preferences>('/preferences/', { default_servings: value });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      setServingsInput(String(previous.default_servings));
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  const [nameInput, setNameInput] = useState('');
  useEffect(() => {
    if (prefs) setNameInput(prefs.display_name ?? '');
  }, [prefs?.display_name]);

  const handleSaveDisplayName = async () => {
    if (!prefs) return;
    const trimmed = nameInput.trim();
    if (!trimmed) {
      Alert.alert(t('profil.nameFehlt'), t('profil.bitteName'));
      setNameInput(prefs.display_name ?? '');
      return;
    }
    if (trimmed === prefs.display_name) return;
    const previous = prefs;
    setPrefs({ ...prefs, display_name: trimmed });
    setSavingKey('display_name');
    try {
      const updated = await api.patch<Preferences>('/preferences/', { display_name: trimmed });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      setNameInput(previous.display_name ?? '');
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <Text style={{ color: '#DC2626', fontSize: 13 }}>{error}</Text>
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  const accountEmail = session?.user?.email ?? '';

  // Konto loeschen ist zweistufig: erst die Warnung, dann muss die eigene
  // E-Mail abgetippt werden. Ein einzelner "Wirklich?"-Dialog ist bei
  // einer unwiderruflichen Aktion zu wenig - der wird weggetippt, ohne
  // gelesen zu werden. Apple verlangt die Funktion in der App (Guideline
  // 5.1.1(v)), die DSGVO ohnehin.
  //
  // Bewusst ein eigenes Modal statt Alert.prompt: Alert.prompt gibt es
  // NUR auf iOS, unter Android passiert damit gar nichts.
  // Nach dem Loeschen der Kochbuch-Daten: fragt automatisch nach, ob auch
  // der GETEILTE Login (Buerroablage/Medienablage/Kochbuch, dieselbe
  // Privatarchive-DB) komplett entfernt werden soll - aber NUR, wenn das
  // Backend meldet, dass keine Registrierung in einer anderen App der
  // Familie mehr uebrig ist (remainingApps leer). Sonst bliebe der Login
  // bestehen, damit die Anmeldung in den anderen Apps weiter funktioniert -
  // genau das ist der Sinn des geteilten Kontos.
  //
  // WICHTIG: wartet auf die Nutzer-Antwort UND ruft DELETE /account/login
  // auf, BEVOR signOut() passiert - danach waere die Sitzung schon weg und
  // der Aufruf faellig, falls die Route einen gueltigen Token voraussetzt.
  const maybeAskDeleteLogin = (remainingApps: string[]): Promise<void> => {
    if (remainingApps.length > 0) return Promise.resolve();
    return new Promise((resolve) => {
      Alert.alert(
        t('profil.auchLoginLoeschen'),
        t('profil.auchLoginLoeschenHinweis'),
        [
          { text: t('profil.nurAppDatenBehalten'), style: 'cancel', onPress: () => resolve() },
          {
            text: t('profil.loginEndgueltigLoeschen'),
            style: 'destructive',
            onPress: async () => {
              try {
                await api.delete('/account/login');
              } catch {
                // Login-Loeschung ist ein separater, expliziter Zusatzschritt -
                // schlaegt er fehl, sind die Kochbuch-Daten trotzdem schon weg;
                // einfach weiter zum Logout, spaeter erneut versuchbar.
              }
              resolve();
            },
          },
        ],
      );
    });
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toLowerCase() !== accountEmail.toLowerCase()) {
      Alert.alert(t('profil.nichtGeloescht'), 'Die eingegebene Adresse stimmt nicht überein.');
      return;
    }
    setIsDeleting(true);
    try {
      const result = await api.delete<{ remaining_apps?: string[] }>('/account', { confirm_email: accountEmail });
      setShowDeleteDialog(false);
      await maybeAskDeleteLogin(result?.remaining_apps ?? []);
      // Kein Erfolgs-Dialog noetig: Die Abmeldung wirft den Nutzer direkt
      // auf den Login-Screen, das ist Rueckmeldung genug.
      await signOut();
    } catch (err) {
      const message = err instanceof ApiError ? err.detail : t('profil.loeschenFehlgeschlagen');
      Alert.alert(t('profil.loeschenFehlgeschlagen'), message);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    // "quer": Profilmenue links (max. 400pt), Einstellungen-Bildschirm
    // rechts eingebettet - wie bei den anderen Bildschirmen ist
    // AppSettingsScreen dafuer ideal, weil es schon KEINE eigenen
    // navigation/route-Props braucht (laedt seine Daten selbst).
    <View style={{ flex: 1, flexDirection: quer ? 'row' : 'column' }}>
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={[{ backgroundColor: colors.bg }, quer && { width: 400, borderRightWidth: 1, borderRightColor: colors.cardBorder }]}
      contentContainerStyle={[styles.container, inhaltsBreite]}>
      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 4 }]}>{t('profil.name')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <TextInput
          style={[
            { flex: 1, height: 44, paddingHorizontal: 14, fontSize: 15, backgroundColor: colors.card, color: colors.text },
            { borderRadius: radius.md },
          ]}
          value={nameInput}
          onChangeText={setNameInput}
          onBlur={handleSaveDisplayName}
          onSubmitEditing={handleSaveDisplayName}
          placeholder={t('sonstiges.deinName')}
          placeholderTextColor={colors.muted}
        />
        {savingKey === 'display_name' && <ActivityIndicator color={colors.muted} size="small" />}
      </View>
      {!!accountEmail && (
        <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 8 }}>{accountEmail}</Text>
      )}
      {prefs.household_role && (
        <View style={[styles.adminBadge, { backgroundColor: prefs.household_role === 'owner' ? gradient[0] : colors.card, borderRadius: radius.sm }]}>
          <MaterialCommunityIcons
            name={prefs.household_role === 'owner' ? 'shield-crown-outline' : 'account-outline'}
            size={13}
            color={prefs.household_role === 'owner' ? '#fff' : colors.muted}
          />
          <Text style={{ color: prefs.household_role === 'owner' ? '#fff' : colors.muted, fontSize: 11.5, fontWeight: '700', marginLeft: 5 }}>
            {prefs.household_role === 'owner' ? t('profil.rolleAdmin') : t('profil.rolleMitglied')}
          </Text>
        </View>
      )}

      <Pressable
        onPress={() => navigation.getParent()?.navigate('Household')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 16 }]}
      >
        <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>{t('profil.haushalt')}</Text>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 20 }]}>{t('profil.standardStufe')}</Text>
      <View style={styles.chipsRow}>
        {HAUBEN_OPTIONS.map((option) => {
          const isSelected = prefs.default_hauben_level === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => handleHaubenLevelSelect(option.key)}
              style={[
                styles.chip,
                { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm },
              ]}
            >
              {savingKey === 'default_hauben_level' && isSelected ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  {Array.from({ length: option.hats }).map((_, i) => (
                    <Text key={i} style={{ fontSize: 12 }}>👨‍🍳</Text>
                  ))}
                  <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600', marginLeft: 4 }}>
                    {t(option.title)}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.muted, marginBottom: 8 }]}>
        Wird beim Start des Koch-Modus vorausgewählt, kannst du dort jederzeit ändern.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 12 }]}>{t('profil.standardPortionen')}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <TextInput
          style={[
            { width: 70, height: 40, paddingHorizontal: 12, fontSize: 14, backgroundColor: colors.card, color: colors.text },
            { borderRadius: radius.sm },
          ]}
          keyboardType="numeric"
          value={servingsInput}
          onChangeText={setServingsInput}
          onBlur={handleSaveDefaultServings}
          onSubmitEditing={handleSaveDefaultServings}
        />
        {savingKey === 'default_servings' && <ActivityIndicator color={colors.muted} size="small" />}
      </View>
      <Text style={[styles.hint, { color: colors.muted, marginBottom: 8 }]}>
        Wird bei neuen Rezepten und im Wochenplan vorgeschlagen, kann jederzeit angepasst werden.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 12 }]}>{t('profil.akzentfarbe')}</Text>
      <View style={styles.chipsRow}>
        {ACCENT_OPTIONS.map((option) => {
          const isSelected = theme.accent === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setTheme({ accent: option.key })}
              style={[
                styles.chip,
                { backgroundColor: isSelected ? option.color : colors.card, borderRadius: radius.sm },
              ]}
            >
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: isSelected ? '#fff' : option.color, marginRight: 7 }} />
              <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>{t(option.title)}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 12 }]}>{t('profil.darstellungHellDunkel')}</Text>
      <View style={styles.chipsRow}>
        {BACKGROUND_OPTIONS.map((option) => {
          const isSelected = theme.background === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => setTheme({ background: option.key })}
              style={[
                styles.chip,
                { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm },
              ]}
            >
              <Text style={{ color: isSelected ? '#fff' : colors.text, fontSize: 12, fontWeight: '600' }}>
                {t(option.title)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 20 }]}>{t('profil.darstellungBedienung')}</Text>

      {/* Alle Schalter jetzt gesammelt auf einem eigenen Unterschirm
          (23.09.2026) - sieben Stueck verstreut zwischen Farbwahl, Links
          und Konto-Aktionen waren schon sehr unuebersichtlich. */}
      <Pressable
        onPress={() => {
          if (!quer) navigation.getParent()?.navigate('AppSettings');
        }}
        style={[styles.row, { backgroundColor: quer ? colors.bg : colors.card, borderRadius: radius.md }, quer && { borderWidth: 1, borderColor: gradient[0] }]}
      >
        <MaterialCommunityIcons name="tune-variant" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.einstellungen')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('profil.einstellungenSub')}</Text>
        </View>
        {!quer && <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>}
      </Pressable>

      {/* "Vorlesen & Stimme" zieht in den Einstellungen-Unterschirm um
          (23.09.2026) - gehoert inhaltlich zur Brutzel-Animation dort,
          er spricht ja waehrend sie laeuft. */}
      <Pressable
        onPress={() => navigation.getParent()?.navigate('StarterPacks')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 8 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.starterRezepte')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.starterRezepteSub')}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      {/* Eigener Block, bewusst NICHT im "Einstellungen"-Unterschirm - das
          hier ist kein Ein/Aus-Schalter, sondern ein eigener Bereich mit
          eigenem Inhalt (Pools anlegen, einladen, Mitglieder). */}
      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('sonstiges.communyPoolsAbschnitt')}</Text>
      <Pressable
        onPress={() => navigation.getParent()?.navigate('MyPools')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="account-group-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('sonstiges.meinePools')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('sonstiges.meinePoolsSub')}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>
      {istModerator && (
        <Pressable
          onPress={() => navigation.getParent()?.navigate('Moderation')}
          style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 8 }]}
        >
          <MaterialCommunityIcons name="shield-check-outline" size={20} color={colors.muted} style={styles.rowIcon} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.rowTitle, { color: colors.text }]}>{t('moderation.titel')}</Text>
            <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('moderation.zeileSub')}</Text>
          </View>
          <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
        </Pressable>
      )}

      {/* Benachrichtigungen und KI-Analyse (23.09.2026 zurueck auf den
          Profil-Hauptbildschirm, vorher kurz in Einstellungen) - anders
          als Darstellung/Server-Sync/Vorlesen keine Sache der Brutzel-
          Animation, gehoeren eigenstaendig direkt hierher. */}
      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('profil.benachrichtigungen')}</Text>
      <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <MaterialCommunityIcons name="bell-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.benachrichtigungenZeile')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('profil.benachrichtigungenSub')}</Text>
        </View>
        {savingKey === 'notifications_enabled' ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Switch
            value={prefs.notifications_enabled}
            onValueChange={(v) => handleToggle('notifications_enabled', v)}
            trackColor={{ false: '#E7E1D4', true: gradient[0] }}
            thumbColor="#fff"
          />
        )}
      </View>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 22 }]}>{t('profil.kiFunktionen')}</Text>
      <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <MaterialCommunityIcons name="auto-fix" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.kiAnalyse')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.kiAnalyseSub')}
            {t('profil.kiVerbrauch', { verbraucht: prefs.ai_calls_this_month, grenze: prefs.ai_monthly_limit })}
          </Text>
        </View>
        {savingKey === 'ai_enabled' ? (
          <ActivityIndicator color={colors.muted} />
        ) : (
          <Switch
            value={prefs.ai_enabled}
            onValueChange={(v) => handleToggle('ai_enabled', v)}
            trackColor={{ false: '#E7E1D4', true: gradient[0] }}
            thumbColor="#fff"
          />
        )}
      </View>

      <Pressable onPress={() => signOut()} style={[styles.signOutButton, { borderColor: '#DC2626', borderRadius: radius.md, marginTop: 22 }]}>
        <Text style={styles.signOutText}>{t('profil.abmelden')}</Text>
      </Pressable>

      <Pressable
        onPress={() => navigation.getParent()?.navigate('StorageSettings')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 8 }]}
      >
        <MaterialCommunityIcons name="cloud-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.speicherort')}</Text>
          {/* Zeigt den AKTUELL gewaehlten Ort statt einer Aufzaehlung aller
              moeglichen. Vorher stand hier immer derselbe Text - eine
              Aenderung im Speicherort-Screen blieb danach unsichtbar, man
              musste erneut hineinnavigieren, um sie zu sehen. */}
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {prefs.storage_mode && STORAGE_MODE_LABELS[prefs.storage_mode]
              ? t(STORAGE_MODE_LABELS[prefs.storage_mode])
              : t('profil.nochNichtGewaehlt')}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      <Pressable
        onPress={() => navigation.getParent()?.navigate('LanguageSettings')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 8 }]}
      >
        <MaterialCommunityIcons name="translate" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.sprache')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.spracheSub')}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('profil.hilfe')}</Text>
      <Pressable
        onPress={() => Linking.openURL(HILFE_URL).catch(() => {})}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="help-circle-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.hilfeAnleitung')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.hilfeAnleitungSub')}
          </Text>
        </View>
        <MaterialCommunityIcons name="open-in-new" size={15} color={colors.muted} />
      </Pressable>

      <Pressable
        onPress={() => navigation.getParent()?.navigate('Support')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="lifebuoy" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.support')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.supportSub')}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('profil.rechtliches')}</Text>
      <Pressable
        onPress={() => Linking.openURL(AGB_URL).catch(() => {})}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>{t('profil.agb')}</Text>
        <MaterialCommunityIcons name="open-in-new" size={15} color={colors.muted} />
      </Pressable>
      <Pressable
        onPress={() => Linking.openURL(DATENSCHUTZ_URL).catch(() => {})}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="shield-lock-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>{t('profil.datenschutz')}</Text>
        <MaterialCommunityIcons name="open-in-new" size={15} color={colors.muted} />
      </Pressable>

      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 30 }]}>{t('profil.konto')}</Text>
      <Pressable
        onPress={() => { setDeleteConfirmText(''); setShowDeleteDialog(true); }}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="account-remove-outline" size={20} color="#DC2626" style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: '#DC2626' }]}>{t('profil.kontoLoeschen')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            {t('profil.kontoLoeschenSub')}
          </Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      {/* Marke + Versionsnummer ganz unten, wie es HomeArchive AI in seinem
          eigenen Profil-Bildschirm schon macht (dort "HomeArchive AI v2.4").
          Die Versionsnummer kommt bewusst NICHT aus app.json - die eas.json
          hat appVersionSource "remote", app.json ist also nicht die
          verbindliche Quelle. Stattdessen die tatsaechlich in DIESEM Build
          eingebettete native Versionsnummer, zweistellig wie bei HomeArchive
          AI (nur Major.Minor, ohne Patch-Stelle). */}
      <View style={styles.footer}>
        <MarkenZeile />
        {versionAnzeige && (
          <Text style={[styles.footerVersion, { color: colors.muted }]}>{`v${versionAnzeige}`}</Text>
        )}
        <UpdateInfo akzent={gradient[0]} gedaempft={colors.muted} />
      </View>

      <Modal visible={showDeleteDialog} transparent animationType="fade" onRequestClose={() => setShowDeleteDialog(false)}>
        {/* KeyboardAvoidingView HIER, nicht nur um den Bildschirm herum:
            ein <Modal> rendert in einem eigenen nativen Fenster ausserhalb
            der normalen View-Hierarchie - eine aeussere KeyboardAvoidingView
            wirkt darauf nicht. Ohne diese lag die Tastatur beim Eintippen
            der E-Mail-Adresse ueber dem Eingabefeld/Knopf. */}
        <KeyboardAvoidingView
          style={styles.modalBackdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('profil.kontoEndgueltig')}</Text>
            <Text style={[styles.modalBody, { color: colors.muted }]}>
              Alle deine Rezepte, Ordner, Wochenpläne und Einkaufslisten werden dauerhaft gelöscht.
              Das lässt sich nicht rückgängig machen.
              {'\n\n'}Tippe zur Bestätigung deine E-Mail-Adresse ein:
              {'\n'}<Text style={{ color: colors.text, fontWeight: '600' }}>{accountEmail}</Text>
            </Text>
            {otherApps.length > 0 && (
              <Text style={[styles.modalBody, { color: colors.muted, marginTop: -6, marginBottom: 10 }]}>
                {t('profil.andereAppsBleiben')} {otherApps.join(', ')}.
              </Text>
            )}
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="deine@email.at"
              placeholderTextColor={colors.muted}
              style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            />
            <Pressable
              onPress={handleDeleteAccount}
              disabled={isDeleting}
              style={[styles.modalDanger, { borderRadius: radius.md, opacity: isDeleting ? 0.6 : 1 }]}
            >
              {isDeleting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalDangerText}>{t('profil.endgueltigLoeschen')}</Text>
              )}
            </Pressable>
            <Pressable onPress={() => setShowDeleteDialog(false)} disabled={isDeleting} style={{ marginTop: 14 }}>
              <Text style={[styles.modalCancel, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    {quer && (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <AppSettingsScreen />
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  adminBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowIcon: { marginRight: 12 },
  rowTitle: { fontSize: 13.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 10.5, marginTop: 2 },
  hint: { fontSize: 10.5, lineHeight: 15, marginTop: 6, marginBottom: 20 },
  signOutButton: { height: 46, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  signOutText: { color: '#DC2626', fontWeight: '600', fontSize: 14 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 380, padding: 22 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalBody: { fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  modalInput: { height: 44, paddingHorizontal: 14, fontSize: 14, marginTop: 16 },
  modalDanger: { height: 46, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  modalDangerText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalCancel: { fontSize: 12.5, textAlign: 'center' },
  footer: { alignItems: 'center', marginTop: 34, marginBottom: 6 },
  footerVersion: { fontSize: 11, marginTop: 10 },
});
