import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert, ScrollView, Linking, TextInput } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import PasswortFeld from '../components/PasswortFeld';
import StorageMigrationModal from '../components/StorageMigrationModal';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'StorageSettings'>;

type StorageMode = 'lokal' | 'nas' | 'eigene_cloud' | 'drittanbieter_cloud';

interface Preferences {
  storage_mode: StorageMode;
  drittanbieter_provider: string | null;
}

// Angeboten wird nur, was auch wirklich funktioniert.
//
// 'lokal' und 'nas' standen hier, ohne dass dahinter Code lag: Beide
// verhielten sich exakt wie 'eigene_cloud'. Der Untertitel bei 'lokal'
// versprach sogar "Verbleibt ausschliesslich auf diesem Geraet" - das
// war schlicht unwahr, und vor einer Veroeffentlichung ist so ein Satz
// nicht nur ein Schoenheitsfehler.
//
// Der Unterbau fuer eine lokale Kopie ist gebaut (src/utils/titelbild.ts
// legt Bilder bei storage_mode 'lokal' im Geraeteverzeichnis ab, nach
// dem Vorbild von HomeArchive). Angeboten wird die Wahl erst, wenn auch
// das Rezept-PDF diesen Weg geht - vorher waere es ein halbes
// Versprechen.
const STORAGE_OPTIONS: { key: StorageMode; title: string; subtitle: string; icon: keyof typeof MaterialCommunityIcons.glyphMap }[] = [
  { key: 'eigene_cloud', title: 'sonstiges.speicherEigeneCloud', subtitle: 'sonstiges.speicherEigeneCloudText', icon: 'cloud-outline' },
  { key: 'nas', title: 'sonstiges.nasTitel', subtitle: 'sonstiges.speicherNasText', icon: 'nas' },
];

const CLOUD_PROVIDER_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  google_drive: 'google-drive',
  onedrive: 'microsoft-onedrive',
  dropbox: 'dropbox',
};

const CLOUD_PROVIDERS: { key: string; apiPrefix: string; title: string; subtitle: string }[] = [
  { key: 'google_drive', apiPrefix: '/google-auth', title: 'Google Drive', subtitle: 'sonstiges.speicherDriveText' },
  { key: 'onedrive', apiPrefix: '/onedrive-auth', title: 'OneDrive', subtitle: 'sonstiges.speicherOneDriveText' },
  { key: 'dropbox', apiPrefix: '/dropbox-auth', title: 'Dropbox', subtitle: 'sonstiges.speicherDropboxText' },
];

/**
 * Eigener Screen fuer die Speicherort-Auswahl - war urspruenglich Teil des
 * Profil-Screens ganz oben, jetzt ausgelagert und im Profil nur noch ueber
 * einen Link (weiter unten, nach den uebrigen Einstellungen) erreichbar.
 */
export default function StorageSettingsScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<'storage_mode' | 'drittanbieter_provider' | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);
  // Speicher-Umzug der Rezeptbilder (02.10.2026, wie Buero-/Medienablage):
  // 'manual' ueber die Zeile unten, 'ask' automatisch nach einem Wechsel.
  const [migration, setMigration] = useState<'ask' | 'manual' | null>(null);
  const letztesZiel = useRef<string | null>(null);

  const loadPrefs = () => {
    api
      .get<Preferences>('/preferences/')
      .then(setPrefs)
      .catch((err) => setError(err instanceof ApiError ? err.detail : t('profil.einstellungenNichtGeladen')));
  };

  useEffect(() => {
    loadPrefs();
    const unsubscribe = navigation.addListener('focus', loadPrefs);
    return unsubscribe;
  }, [navigation]);

  // --- NAS ------------------------------------------------------------
  const [nas, setNas] = useState<{ eingerichtet: boolean; url?: string | null; user?: string | null; folder?: string | null } | null>(null);
  const [nasUrl, setNasUrl] = useState('');
  const [nasUser, setNasUser] = useState('');
  const [nasPasswort, setNasPasswort] = useState('');
  const [nasOrdner, setNasOrdner] = useState('');
  const [nasLaeuft, setNasLaeuft] = useState(false);
  // Das Formular muss sichtbar sein, BEVOR 'nas' gespeichert ist: Der Server
  // lehnt den Modus ohne hinterlegte Verbindung mit 409 ab. Ohne diesen
  // Zustand war die Einrichtung unerreichbar - Formular erst nach dem
  // Speichern, Speichern erst nach dem Formular.
  const [nasFormularOffen, setNasFormularOffen] = useState(false);
  const [hersteller, setHersteller] = useState<string>('synology');
  const [sucheLaeuft, setSucheLaeuft] = useState(false);
  const [vorschlaege, setVorschlaege] = useState<{ url: string; status: string }[] | null>(null);

  /**
   * Adresse vorschlagen statt raten lassen.
   *
   * Der Nutzer kennt den Namen seines NAS, aber selten den Port und den
   * Pfad, unter dem WebDAV dort liegt. Die sind je Hersteller immer
   * dieselben - also probiert der Server sie durch.
   */
  const adresseSuchen = async () => {
    if (!nasUrl.trim() || !nasUser.trim() || !nasPasswort) {
      Alert.alert(t('sonstiges.nasFehler'), t('sonstiges.nasWichtig'));
      return;
    }
    setSucheLaeuft(true);
    setVorschlaege(null);
    try {
      const res = await api.post<{ vorschlaege: { url: string; status: string }[] }>('/nas/suchen', {
        host: nasUrl.trim(),
        user: nasUser.trim(),
        password: nasPasswort,
        hersteller,
      });
      setVorschlaege(res.vorschlaege);
    } catch (err) {
      Alert.alert(t('sonstiges.nasFehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSucheLaeuft(false);
    }
  };

  useEffect(() => {
    api.get<{ eingerichtet: boolean; url?: string | null; user?: string | null; folder?: string | null }>('/nas/')
      .then((res) => {
        setNas(res);
        setNasUrl(res.url ?? '');
        setNasUser(res.user ?? '');
        setNasOrdner(res.folder ?? '');
      })
      .catch(() => setNas({ eingerichtet: false }));
  }, []);

  const nasAufruf = async (was: 'test' | 'speichern') => {
    setNasLaeuft(true);
    try {
      const koerper = {
        url: nasUrl.trim(),
        user: nasUser.trim(),
        password: nasPasswort || undefined,
        folder: nasOrdner.trim() || undefined,
      };
      if (was === 'test') {
        await api.post('/nas/test', koerper);
        Alert.alert(t('sonstiges.nasGeprueft'), '');
      } else {
        const res = await api.put<{ eingerichtet: boolean; url: string; user: string; folder: string }>('/nas/', koerper);
        setNas(res);
        // Das Passwort wird nach dem Speichern nicht mehr gebraucht und
        // bleibt nicht im Formular stehen.
        setNasPasswort('');
        // Jetzt erst darf der Modus gesetzt werden - ab hier nimmt ihn der
        // Server an. Vorher stand er nur lokal und war nach dem naechsten
        // Laden wieder weg.
        const aktualisiert = await api.patch<Preferences>('/preferences/', { storage_mode: 'nas' });
        setPrefs(aktualisiert);
        setNasFormularOffen(false);
      }
    } catch (err) {
      Alert.alert(t('sonstiges.nasFehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setNasLaeuft(false);
    }
  };

  const nasTrennen = async () => {
    setNasLaeuft(true);
    try {
      await api.delete('/nas/');
      setNas({ eingerichtet: false });
      setNasPasswort('');
      const aktualisiert = await api.get<Preferences>('/preferences/');
      setPrefs(aktualisiert);
    } catch (err) {
      Alert.alert(t('sonstiges.nasFehler'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setNasLaeuft(false);
    }
  };

  const handleConnectProvider = async (providerKey: string, apiPrefix: string) => {
    setConnectingProvider(providerKey);
    try {
      const { authorize_url } = await api.get<{ authorize_url: string }>(`${apiPrefix}/connect`);
      await Linking.openURL(authorize_url);
    } catch (err) {
      Alert.alert(t('sonstiges.verbindenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setConnectingProvider(null);
    }
  };

  const handleReactivateProvider = async (providerKey: string) => {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, storage_mode: 'drittanbieter_cloud', drittanbieter_provider: providerKey });
    setSavingKey('drittanbieter_provider');
    try {
      const updated = await api.patch<Preferences>('/preferences/', { drittanbieter_provider: providerKey });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      Alert.alert(t('sonstiges.reaktivierenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  const handleDisconnectProvider = async (apiPrefix: string) => {
    try {
      await api.post(`${apiPrefix}/disconnect`);
      loadPrefs();
    } catch (err) {
      Alert.alert(t('sonstiges.trennenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    }
  };

  const handleStorageSelect = async (mode: StorageMode) => {
    if (!prefs || prefs.storage_mode === mode) return;
    // Noch keine Verbindung hinterlegt: erst einrichten lassen, gar nicht
    // erst speichern - der Aufruf koennte nur mit 409 zurueckkommen.
    if (mode === 'nas' && !nas?.eingerichtet) {
      setNasFormularOffen(true);
      return;
    }
    const previous = prefs;
    setPrefs({ ...prefs, storage_mode: mode });
    setSavingKey('storage_mode');
    try {
      const updated = await api.patch<Preferences>('/preferences/', { storage_mode: mode });
      setPrefs(updated);
    } catch (err) {
      setPrefs(previous);
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  // Nach einem Wechsel des Speicherorts (auch nach der Rueckkehr aus dem
  // Google/OneDrive/Dropbox-Login) fragt Brutzel, ob vorhandene Bilder
  // mitkommen sollen - aber nur, wenn wirklich etwas zu verschieben ist.
  useEffect(() => {
    if (!prefs) return;
    const ziel = prefs.storage_mode === 'drittanbieter_cloud'
      ? `cloud:${prefs.drittanbieter_provider ?? ''}`
      : prefs.storage_mode === 'nas' ? 'eigene_cloud' : prefs.storage_mode;
    const vorher = letztesZiel.current;
    letztesZiel.current = ziel;
    if (vorher === null || vorher === ziel || ziel === 'lokal') return;
    api.get<{ supported: boolean; ready: boolean; movable: number }>('/storage-migration/status')
      .then((st) => { if (st.supported && st.ready && st.movable > 0) setMigration('ask'); })
      .catch(() => { /* Rueckfrage ist nur ein Angebot - ohne Status keine */ });
  }, [prefs?.storage_mode, prefs?.drittanbieter_provider]);

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

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.container, inhaltsBreite]}>
      {STORAGE_OPTIONS.map((option) => {
        const isSelected = prefs.storage_mode === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => handleStorageSelect(option.key)}
            style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
          >
            <MaterialCommunityIcons name={option.icon} size={20} color={colors.muted} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{t(option.title)}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t(option.subtitle)}</Text>
            </View>
            {savingKey === 'storage_mode' && isSelected ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <MaterialCommunityIcons
                name={isSelected ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={isSelected ? gradient[0] : colors.muted}
              />
            )}
          </Pressable>
        );
      })}

      {(prefs.storage_mode === 'nas' || nasFormularOffen) && (
        <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, flexDirection: 'column', alignItems: 'stretch' }]}>
          {nas?.eingerichtet && (
            <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 10 }}>
              {t('sonstiges.nasVerbunden', { adresse: nas.url ?? '' })}
            </Text>
          )}
          <Text style={{ color: colors.text, fontSize: 12.5, lineHeight: 17, marginBottom: 10 }}>{t('sonstiges.nasDatenHinweis')}</Text>
          <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 6 }}>{t('sonstiges.nasHersteller')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(['synology', 'qnap', 'nextcloud', 'truenas', 'andere'] as const).map((h) => (
              <Pressable
                key={h}
                onPress={() => { setHersteller(h); setVorschlaege(null); }}
                style={{
                  paddingHorizontal: 12, minHeight: 36, justifyContent: 'center',
                  borderRadius: radius.sm,
                  backgroundColor: hersteller === h ? gradient[0] : colors.bg,
                }}
              >
                <Text style={{ color: hersteller === h ? '#fff' : colors.text, fontSize: 13 }}>
                  {t(`sonstiges.nas${h.charAt(0).toUpperCase()}${h.slice(1)}`)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '700', marginBottom: 3 }}>
            {t('sonstiges.nasAnleitungTitel')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
            {t(`sonstiges.nasAnleitung${hersteller.charAt(0).toUpperCase()}${hersteller.slice(1)}`)}
          </Text>

          <TextInput
            style={[styles.eingabe, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            placeholder={t('sonstiges.nasAdresse')} placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false} keyboardType="url"
            value={nasUrl} onChangeText={setNasUrl}
          />
          <TextInput
            style={[styles.eingabe, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            placeholder={t('sonstiges.nasBenutzer')} placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false}
            value={nasUser} onChangeText={setNasUser}
          />
          <PasswortFeld
            placeholder={t('sonstiges.nasPasswort')}
            value={nasPasswort} onChangeText={setNasPasswort}
            style={{ marginBottom: 8 }}
          />
          {nas?.eingerichtet && (
            <Text style={{ color: colors.muted, fontSize: 11.5, marginBottom: 8 }}>
              {t('sonstiges.nasPasswortBleibt')}
            </Text>
          )}
          <TextInput
            style={[styles.eingabe, { backgroundColor: colors.bg, color: colors.text, borderRadius: radius.sm }]}
            placeholder={t('sonstiges.nasOrdner')} placeholderTextColor={colors.muted}
            autoCapitalize="none" autoCorrect={false}
            value={nasOrdner} onChangeText={setNasOrdner}
          />
          <Pressable
            onPress={adresseSuchen}
            disabled={sucheLaeuft}
            style={{ minHeight: 44, justifyContent: 'center', marginBottom: 4 }}
          >
            {sucheLaeuft ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ActivityIndicator size="small" color={colors.muted} />
                <Text style={{ color: colors.muted, fontSize: 13 }}>{t('sonstiges.nasSuchtGerade')}</Text>
              </View>
            ) : (
              <Text style={{ color: gradient[0], fontSize: 13.5, fontWeight: '600' }}>
                🔍 {t('sonstiges.nasSuchen')}
              </Text>
            )}
          </Pressable>

          {vorschlaege !== null && (
            <View style={{ marginBottom: 10 }}>
              {vorschlaege.length === 0 ? (
                <Text style={{ color: '#B45309', fontSize: 12.5, lineHeight: 18 }}>
                  {t('sonstiges.nasNichtsGefunden')}
                </Text>
              ) : (
                <>
                  <Text style={{ color: colors.muted, fontSize: 12.5, marginBottom: 6 }}>
                    {t('sonstiges.nasGefunden')}
                  </Text>
                  {vorschlaege.map((v) => (
                    <Pressable
                      key={v.url}
                      onPress={() => { setNasUrl(v.url); setVorschlaege(null); }}
                      style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 4 }}
                    >
                      <Text style={{ color: colors.text, fontSize: 13 }}>{v.url}</Text>
                      {v.status === 'zugang' && (
                        <Text style={{ color: '#B45309', fontSize: 11.5 }}>
                          {t('sonstiges.nasZugangFalsch')}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Pressable
              onPress={() => nasAufruf('test')} disabled={nasLaeuft}
              style={{ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' }}
            >
              <Text style={{ color: gradient[0], fontSize: 13.5, fontWeight: '600' }}>{t('sonstiges.nasPruefen')}</Text>
            </Pressable>
            <Pressable
              onPress={() => nasAufruf('speichern')} disabled={nasLaeuft}
              style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', backgroundColor: gradient[0], borderRadius: radius.sm }}
            >
              {nasLaeuft ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{t('sonstiges.nasSpeichern')}</Text>
              )}
            </Pressable>
            {nas?.eingerichtet && (
              <Pressable onPress={nasTrennen} disabled={nasLaeuft} style={{ minHeight: 44, justifyContent: 'center', marginLeft: 'auto' }}>
                <Text style={{ color: '#DC2626', fontSize: 13.5 }}>{t('sonstiges.nasTrennen')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {CLOUD_PROVIDERS.map((p) => {
        const hasTokens = prefs.drittanbieter_provider === p.key;
        const isActive = prefs.storage_mode === 'drittanbieter_cloud' && hasTokens;
        return (
          <Pressable
            key={p.key}
            onPress={() => {
              if (isActive) return;
              if (hasTokens) {
                handleReactivateProvider(p.key);
              } else {
                handleConnectProvider(p.key, p.apiPrefix);
              }
            }}
            disabled={connectingProvider !== null || savingKey === 'drittanbieter_provider'}
            style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, opacity: connectingProvider && connectingProvider !== p.key ? 0.5 : 1 }]}
          >
            <MaterialCommunityIcons
              name={CLOUD_PROVIDER_ICONS[p.key]}
              size={20}
              color={isActive ? '#16A34A' : colors.muted}
              style={styles.rowIcon}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: isActive ? '#16A34A' : colors.text }]}>
                {isActive ? `${p.title} ✓ verbunden` : hasTokens ? `${p.title} (verbunden, nicht aktiv)` : p.title}
              </Text>
              <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t(p.subtitle)}</Text>
              {hasTokens && (
                <Pressable onPress={() => handleDisconnectProvider(p.apiPrefix)} hitSlop={8} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                  <Text style={{ color: '#DC2626', fontSize: 11.5, fontWeight: '700' }}>{t('sonstiges.trennen')}</Text>
                </Pressable>
              )}
            </View>
            {connectingProvider === p.key || (savingKey === 'drittanbieter_provider' && hasTokens && !isActive) ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <MaterialCommunityIcons
                name={isActive ? 'radiobox-marked' : 'radiobox-blank'}
                size={22}
                color={isActive ? '#16A34A' : colors.muted}
              />
            )}
          </Pressable>
        );
      })}

      {/* Speicher-Umzug: vorhandene Rezeptbilder an den gewaehlten Ort bringen,
          alte Kopien aufraeumen, fehlende Bilder bereinigen. */}
      {prefs.storage_mode !== 'lokal' && (
        <Pressable
          onPress={() => setMigration('manual')}
          style={{
            marginTop: 16, borderWidth: 2, borderColor: gradient[0], borderRadius: radius.md,
            paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center',
          }}
        >
          <Text style={{ color: gradient[0], fontSize: 15, fontWeight: '800', textAlign: 'center' }}>
            Rezeptbilder in den aktuellen Speicher verschieben
          </Text>
        </Pressable>
      )}

      <StorageMigrationModal visible={migration !== null} mode={migration} onClose={() => setMigration(null)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  eingabe: { minHeight: 44, paddingHorizontal: 12, fontSize: 14, marginBottom: 8 },
  container: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowIcon: { marginRight: 12 },
  rowTitle: { fontSize: 13.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 10.5, marginTop: 2 },
});
