import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung, getSprache } from '../i18n';
import { einwilligungAnfragen, statusLaden } from '../api/marketing';
import { showBrutzelHinweis } from '../components/BrutzelHinweis';
import { api, ApiError } from '../api/client';
import { useServerSync } from '../context/ServerSyncContext';
import { useLayout } from '../utils/layout';

/**
 * Alle Ein/Aus-Schalter an einem Ort (23.09.2026).
 *
 * Vorher standen sieben Schalter verstreut im Profil-Bildschirm, zwischen
 * Farbwahl, Links zu anderen Unterschirmen und Konto-Aktionen - das war
 * schon sehr unuebersichtlich. Genau wie bei VoiceSettingsScreen zuvor:
 * Was zusammengehoert (hier: JEDER Schalter), gehoert auf eine eigene
 * Seite. Die Farbwahl (Akzentfarbe/Hell-Dunkel) bleibt bewusst im Profil -
 * das sind Chip-Auswahlen, keine Schalter, und sie sind zu visuell/schoen,
 * um sie zu verstecken.
 */

type PreferenceKey =
  | 'show_brutzel'
  | 'large_text'
  | 'show_greeting_animation'
  | 'play_animation_music'
  | 'server_sync_enabled';

interface Preferences {
  show_brutzel: boolean;
  large_text: boolean;
  show_greeting_animation: boolean;
  play_animation_music: boolean;
  server_sync_enabled: boolean;
  storage_mode: string;
}

// Abschnitt "Animation" - Überschrift in allen HomeArchive-Apps gleich (03.10.2026)
const ANIMATION_ROWS: { key: PreferenceKey; title: string; subtitle: string }[] = [
  { key: 'show_brutzel', title: 'profil.brutzelAnzeigen', subtitle: 'profil.brutzelAnzeigenSub' },
  { key: 'show_greeting_animation', title: 'profil.brutzelAnimation', subtitle: 'profil.brutzelAnimationSub' },
  { key: 'play_animation_music', title: 'profil.animationMusik', subtitle: 'profil.animationMusikSub' },
];
const DARSTELLUNG_ROWS: { key: PreferenceKey; title: string; subtitle: string }[] = [
  { key: 'large_text', title: 'profil.grosseSchrift', subtitle: 'profil.grosseSchriftSub' },
];

export default function AppSettingsScreen() {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const { refresh: refreshServerSync } = useServerSync();
  // useNavigation() statt eines navigation-Props (23.09.2026): dieser
  // Bildschirm laeuft sowohl als eigener Stack-Screen als auch OHNE Props
  // eingebettet im Profil quer (siehe ProfileScreen.tsx) - der Hook
  // funktioniert in beiden Faellen gleich, ein durchgereichtes Prop nur
  // im ersten.
  const navigation = useNavigation<any>();
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [savingKey, setSavingKey] = useState<PreferenceKey | null>(null);
  // Tipps und Angebote per E-Mail: 'aus' | 'angefragt' (Bestaetigungs-Mail unterwegs) | 'bestaetigt'
  const [mailStand, setMailStand] = useState<'aus' | 'angefragt' | 'bestaetigt' | null>(null);
  const [mailSpeichert, setMailSpeichert] = useState(false);

  useEffect(() => {
    api
      .get<Preferences>('/preferences/')
      .then(setPrefs)
      .catch(() => {});
  }, []);

  useEffect(() => {
    statusLaden()
      .then((s) => setMailStand(s.einwilligung.bestaetigt ? 'bestaetigt' : s.einwilligung.angefragt ? 'angefragt' : 'aus'))
      .catch(() => setMailStand(null));
  }, []);

  const handleMailToggle = async (an: boolean) => {
    setMailSpeichert(true);
    try {
      await einwilligungAnfragen(an, getSprache());
      if (an) {
        setMailStand('angefragt');
        showBrutzelHinweis({ title: t('marketing.einstellung.titel'), text: t('marketing.einstellung.mailGesendet') });
      } else {
        setMailStand('aus');
        showBrutzelHinweis({ title: t('marketing.einstellung.titel'), text: t('marketing.einstellung.abgemeldet') });
      }
    } catch {
      showBrutzelHinweis({ title: t('marketing.einstellung.titel'), text: t('marketing.einstellung.fehler') });
    } finally {
      setMailSpeichert(false);
    }
  };

  const handleToggle = async (key: PreferenceKey, value: boolean) => {
    if (!prefs) return;
    const vorher = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSavingKey(key);
    try {
      const updated = await api.patch<Preferences>('/preferences/', { [key]: value });
      if (key === 'server_sync_enabled') {
        // Die Pool-Knoepfe in den Listen haengen an diesem Wert - ohne
        // Auffrischen blieben sie bis zum naechsten App-Start ausgegraut.
        // (Uebernommen aus dem frueheren handleToggle im Profil-Bildschirm.)
        refreshServerSync();
      }
      setPrefs(updated);
    } catch (err) {
      setPrefs(vorher);
      Alert.alert(t('profil.nichtGespeichert'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setSavingKey(null);
    }
  };

  if (!prefs) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }

  // storage_mode wird nicht mehr fuer isServerSyncLocked gebraucht (die
  // Server-Sync-Zeile ist ja jetzt ausgeblendet) - Feld bleibt im
  // Preferences-Interface, falls spaeter wieder gebraucht.

  const Zeile = ({ zeile, gesperrt, untertitel }: { zeile: { key: PreferenceKey; title: string; subtitle: string }; gesperrt?: boolean; untertitel?: string }) => (
    <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, { color: colors.text }]}>{t(zeile.title)}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{untertitel ?? t(zeile.subtitle)}</Text>
      </View>
      {savingKey === zeile.key ? (
        <ActivityIndicator color={colors.muted} />
      ) : (
        <Switch
          value={prefs[zeile.key] as boolean}
          onValueChange={(v) => handleToggle(zeile.key, v)}
          disabled={gesperrt}
          trackColor={{ false: '#E7E1D4', true: gradient[0] }}
          thumbColor="#fff"
        />
      )}
    </View>
  );

  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={[styles.container, inhaltsBreite]}>
      <Text style={[styles.label, { color: colors.muted }]}>{t('profil.animation')}</Text>
      {ANIMATION_ROWS.map((zeile) => (
        <Zeile key={zeile.key} zeile={zeile} />
      ))}

      {/* Server-Sync-Zeile ABSICHTLICH nicht mehr angezeigt (23.09.2026,
          vorerst) - er steht fuer alle fest auf aktiv (siehe Migration),
          ein sichtbarer Schalter dafuer hat nur verwirrt, ohne dass es
          normalerweise einen Grund gaebe, ihn abzuschalten. Feld und
          Backend-Logik bleiben unangetastet, falls spaeter doch wieder
          gebraucht. */}

      {/* Gehoert inhaltlich zur Brutzel-Animation direkt darueber - er
          spricht ja waehrend sie laeuft (23.09.2026, vorher ein eigener
          Link im Profil-Hauptbildschirm). */}
      <Pressable
        onPress={() => navigation.navigate('VoiceSettings')}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, marginTop: 8 }]}
      >
        <MaterialCommunityIcons name="account-voice" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('profil.vorlesenStimme')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('profil.vorlesenStimmeSub')}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>

      <Text style={[styles.label, { color: colors.muted, marginTop: 20 }]}>{t('profil.darstellung')}</Text>
      {DARSTELLUNG_ROWS.map((zeile) => (
        <Zeile key={zeile.key} zeile={zeile} />
      ))}

      {/* Tipps und Angebote per E-Mail (Double-Opt-in): der Schalter fordert die Bestaetigungs-Mail an,
          gueltig ist die Einwilligung erst nach dem Tipp auf den Link darin. */}
      {mailStand !== null && (
        <>
          <Text style={[styles.label, { color: colors.muted, marginTop: 20 }]}>{t('marketing.einstellung.abschnitt')}</Text>
          <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{t('marketing.einstellung.titel')}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
                {t(mailStand === 'bestaetigt' ? 'marketing.einstellung.subBestaetigt'
                  : mailStand === 'angefragt' ? 'marketing.einstellung.subAngefragt'
                  : 'marketing.einstellung.subAus')}
              </Text>
            </View>
            {mailSpeichert ? (
              <ActivityIndicator color={colors.muted} />
            ) : (
              <Switch
                value={mailStand !== 'aus'}
                onValueChange={handleMailToggle}
                trackColor={{ false: '#E7E1D4', true: gradient[0] }}
                thumbColor="#fff"
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 18, paddingBottom: 40 },
  label: { fontSize: 11.5, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowIcon: { marginRight: 10 },
  rowTitle: { fontSize: 14.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, marginTop: 2 },
  hint: { fontSize: 11.5, marginTop: -2, marginBottom: 10, paddingHorizontal: 4 },
});
