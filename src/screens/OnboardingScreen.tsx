import React, { useEffect, useState } from 'react';
import { geraeteLand } from '../utils/region';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Switch, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';
import type { HaubenLevel } from '../utils/stepLevels';
import { useLayout } from '../utils/layout';
import BrutzelIntroScreens from '../components/BrutzelIntroScreens';

// Gleiche Reihenfolge und Benennung wie im Profil - die Auswahl hier ist
// nur die Erstbelegung, geaendert wird sie spaeter dort.
const HAUBEN_OPTIONS: { key: HaubenLevel; title: string; subtitle: string; hats: number }[] = [
  { key: 'anfaenger', title: 'profil.haubenAnfaenger', subtitle: 'sonstiges.stufeAnfaengerText', hats: 1 },
  { key: 'fortgeschritten', title: 'profil.haubenFortgeschritten', subtitle: 'sonstiges.stufeFortgeschrittenText', hats: 2 },
  { key: 'profi', title: 'profil.haubenProfi', subtitle: 'sonstiges.stufeProfiText', hats: 3 },
];

type Props = NativeStackScreenProps<MainStackParamList, 'Onboarding'>;

export default function OnboardingScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const { clearJustRegistered } = useAuth();
  const [createFolders, setCreateFolders] = useState(true);
  // Bei der Anmeldung wird nur das Standard-Paket angeboten. Cocktails
  // und Vegetarisch holt man sich im Profil, wenn man sie will - sie
  // gleich mitzuliefern hiesse, jedem Neuling 38 Rezepte aufzudraengen,
  // die er vielleicht nie braucht.
  const [importStandard, setImportStandard] = useState(true);
  // Vorbelegung wie in der Datenbank (default_hauben_level='fortgeschritten')
  const [haubenLevel, setHaubenLevel] = useState<HaubenLevel>('fortgeschritten');
  const [totalAvailable, setTotalAvailable] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Brutzels kurze Einfuehrung laeuft VOR diesem Einrichtungsschritt -
  // eigener Zustand statt eigener Navigationsroute, damit "Los geht's"
  // am Ende der Einfuehrung ohne Zwischenschritt hierher wechselt.
  const [zeigeIntro, setZeigeIntro] = useState(true);

  useEffect(() => {
    api
      .get<{ packs?: { key: string; count: number }[] }>('/onboarding/starter-pack-options')
      .then((res) => setTotalAvailable(res.packs?.find((p) => p.key === 'standard')?.count ?? null))
      .catch(() => {
        // Nur fuer die Anzeige der Rezeptanzahl - schlaegt das Laden fehl,
        // bleibt der Text generisch, der Import selbst funktioniert trotzdem
      });
  }, []);

  const handleContinue = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.post('/onboarding/setup', {
        create_standard_folders: createFolders,
        // Wer das Gerät auf Deutschland eingestellt hat, bekommt die deutschen
        // Klassiker automatisch zu den Standard-Rezepten dazu.
        starter_packs: importStandard ? (geraeteLand() === 'DE' ? ['standard', 'deutsch'] : geraeteLand() === 'CH' ? ['standard', 'schweiz'] : ['standard']) : null,
      });
      // Bewusst NACH dem Setup und in einem eigenen try: Scheitert nur das
      // Speichern der Stufe, waere es unsinnig, das komplette Onboarding
      // (inkl. importierter Rezepte) als fehlgeschlagen zu melden - die
      // Stufe laesst sich im Profil jederzeit nachstellen.
      try {
        await api.patch('/preferences/', { default_hauben_level: haubenLevel });
      } catch {
        // still ignorieren, siehe oben
      }
      clearJustRegistered();
      navigation.replace('MainTabs');
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t('sonstiges.einrichtungFehlgeschlagen'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Scrollbar, seit die Stufen-Auswahl dazugekommen ist: Auf kleinen
  // Geraeten passte der Inhalt sonst nicht mehr auf eine Bildschirmhoehe
  // und der "Los geht's"-Button lag unerreichbar unterhalb der Kante.
  if (zeigeIntro) {
    return <BrutzelIntroScreens onFertig={() => setZeigeIntro(false)} />;
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bg }]} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.container, inhaltsBreite]} keyboardShouldPersistTaps="handled">
      {/* Nur wenn es ueberhaupt ein Zurueck gibt: Beim ersten Start nach
          der Registrierung ist das hier der Anfang, da waere ein
          Zurueck-Knopf sinnlos. Wird der Screen dagegen aus dem Profil
          geoeffnet ('Starter-Rezepte importieren'), sass man bisher fest -
          Kopfzeile und Wischgeste sind hier bewusst abgeschaltet. */}
      {navigation.canGoBack() && (
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.backRow}>
          <Text style={{ color: gradient[0], fontSize: 14, fontWeight: '600' }}>‹ Zurück</Text>
        </Pressable>
      )}
      <Text style={[styles.title, { color: colors.text }]}>{t('sonstiges.willkommen')}</Text>
      <Text style={[styles.subtitle, { color: colors.muted }]}>{t('sonstiges.paarDinge')}</Text>

      <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('sonstiges.standardOrdner')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('sonstiges.ordnerListe')}</Text>
        </View>
        <Switch value={createFolders} onValueChange={setCreateFolders} trackColor={{ false: '#E7E1D4', true: gradient[0] }} thumbColor="#fff" />
      </View>

      <Text style={[styles.sectionLabel, { color: colors.muted }]}>WIE AUSFÜHRLICH SOLLEN REZEPTE SEIN?</Text>

      {HAUBEN_OPTIONS.map((option) => {
        const isSelected = haubenLevel === option.key;
        return (
          <Pressable
            key={option.key}
            onPress={() => setHaubenLevel(option.key)}
            style={[
              styles.row,
              { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: isSelected ? 1.5 : 0, borderColor: gradient[0] },
            ]}
          >
            <Text style={{ fontSize: 13, marginRight: 10 }}>
              {Array.from({ length: option.hats }).map(() => '👨‍🍳').join('')}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{t(option.title)}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t(option.subtitle)}</Text>
            </View>
            {isSelected && <Text style={{ color: gradient[0], fontSize: 18 }}>✓</Text>}
          </Pressable>
        );
      })}

      <Text style={[styles.rowSubtitle, { color: colors.muted, marginBottom: 4 }]}>
        Lässt sich beim Kochen jederzeit umschalten und später im Profil ändern.
      </Text>

      <Text style={[styles.sectionLabel, { color: colors.muted }]}>STARTER-REZEPTE IMPORTIEREN</Text>
      <Text style={[styles.rowSubtitle, { color: colors.muted, marginBottom: 6 }]}>
        Cocktails und vegetarische Rezepte gibt es später im Profil.
      </Text>

      <Pressable
        onPress={() => setImportStandard(true)}
        style={[
          styles.row,
          { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: importStandard ? 1.5 : 0, borderColor: gradient[0] },
        ]}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>
            Standard-Rezepte{totalAvailable !== null ? ` (${totalAvailable})` : ''}
          </Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
            Vorspeisen, Suppen, Hauptgerichte, Beilagen, Backen & Desserts
          </Text>
        </View>
        {importStandard && <Text style={{ color: gradient[0], fontSize: 18 }}>✓</Text>}
      </Pressable>

      <Pressable
        onPress={() => setImportStandard(false)}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: !importStandard ? 1.5 : 0, borderColor: gradient[0] }]}
      >
        <Text style={[styles.rowTitle, { color: colors.text, flex: 1 }]}>{t('sonstiges.keineStarter')}</Text>
        {!importStandard && <Text style={{ color: gradient[0], fontSize: 18 }}>✓</Text>}
      </Pressable>

      {error && <Text style={[styles.errorText, { color: '#DC2626' }]}>{error}</Text>}

      <Pressable onPress={handleContinue} disabled={isSubmitting} style={[styles.continueButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}>
        {isSubmitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.continueButtonText}>{t('sonstiges.losGehts')}</Text>}
      </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  backRow: { paddingVertical: 6, marginBottom: 4, alignSelf: 'flex-start' },
  container: { padding: 20, paddingBottom: 32 },
  title: { fontSize: 19, fontWeight: '700' },
  subtitle: { fontSize: 12.5, marginTop: 4, marginBottom: 22 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowTitle: { fontSize: 13.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 10.5, marginTop: 2 },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginTop: 16, marginBottom: 10 },
  errorText: { fontSize: 12, marginTop: 8 },
  removeRow: { marginTop: 22, paddingVertical: 10 },
  continueButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  continueButtonText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
});
