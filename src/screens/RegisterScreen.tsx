import React, { useState } from 'react';
import RechtFenster from '../components/RechtFenster';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, Linking, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import PasswortFeld from '../components/PasswortFeld';
import LanguageSwitchRow from '../components/LanguageSwitchRow';
import DismissKeyboardView from '../components/DismissKeyboardView';
import { useAuth } from '../context/AuthContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

const AGB_URL = 'https://www.homearchive.at/agb';
const DATENSCHUTZ_URL = 'https://www.homearchive.at/datenschutz';

export default function RegisterScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [legal, setLegal] = useState<null | 'agb' | 'datenschutz'>(null);
  const { registerWithCode } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  // Einwilligung in Tipps und Angebote per E-Mail: NICHT vorausgewaehlt, getrennt von den AGB.
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  // Einladungscode eines Freundes (freiwillig): beide bekommen 50 AI Coins.
  const [einladungscode, setEinladungscode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleRegister = async () => {
    if (!email || !password) {
      Alert.alert(t('auth.fehltNochWas'), t('auth.bitteEmailPasswort'));
      return;
    }
    if (!termsAccepted) {
      Alert.alert(t('auth.zustimmungTitel'), t('auth.zustimmungText'));
      return;
    }
    setIsSubmitting(true);
    try {
      // Laeuft ueber das eigene Backend, nicht ueber supabase.auth.signUp:
      // Das Konto wird angelegt und ein 4-stelliger Code per Mail
      // verschickt. Bestaetigt wird auf dem naechsten Screen durch
      // Abtippen des Codes - ohne Link, ohne Ruecksprung in die App.
      await registerWithCode(email, password, marketingOptIn, einladungscode);
      navigation.navigate('ConfirmEmail', { email: email.trim().toLowerCase() });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('auth.registrierungFehlgeschlagen');
      Alert.alert(t('auth.registrierungFehlgeschlagen'), message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <DismissKeyboardView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.card, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.title, { color: colors.text }]}>{t('auth.kontoErstellen')}</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>{t('auth.dauertEineMinute')}</Text>

        <Text style={[styles.label, { color: colors.muted }]}>{t('auth.name')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('auth.namePlatzhalter')}
          placeholderTextColor={colors.muted}
          value={name}
          onChangeText={setName}
        />

        <Text style={[styles.label, { color: colors.muted }]}>E-Mail</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('auth.emailPlatzhalter')}
          placeholderTextColor={colors.muted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={[styles.label, { color: colors.muted }]}>{t('auth.passwort')}</Text>
        <PasswortFeld
          placeholder="••••••••••"
          value={password}
          onChangeText={setPassword}
        />

        <Text style={[styles.label, { color: colors.muted }]}>{t('marketing.einladung.registrierenFeld')}</Text>
        <TextInput
          style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
          placeholder={t('marketing.einladung.platzhalter')}
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          value={einladungscode}
          onChangeText={setEinladungscode}
        />

        {/* EIN Haekchen fuer beides. Vorher waren es zwei getrennte - das
            ist rechtlich nicht noetig und kostet nur einen zusaetzlichen
            Tipp bei jeder Registrierung. Die beiden Dokumente stehen als
            eigene Zeile darunter, damit sie trotzdem einzeln aufrufbar
            sind und nicht im Fliesstext untergehen. */}
        <Pressable onPress={() => setTermsAccepted((prev) => !prev)} style={styles.checkboxRow}>
          <View
            style={[
              styles.checkbox,
              { borderRadius: radius.sm, backgroundColor: termsAccepted ? gradient[0] : 'transparent', borderColor: gradient[0] },
            ]}
          >
            {termsAccepted && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.muted }]}>
            {t('auth.akzeptiere')}
          </Text>
        </Pressable>

        <View style={styles.legalLinksRow}>
          <Text style={{ color: gradient[0], fontSize: 12, fontWeight: '600' }} onPress={() => setLegal('agb')}>
            {t('auth.agbLesen')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 12 }}>·</Text>
          <Text style={{ color: gradient[0], fontSize: 12, fontWeight: '600' }} onPress={() => setLegal('datenschutz')}>
            {t('auth.datenschutzLesen')}
          </Text>
        </View>

        {/* Eigenes Haekchen fuer Tipps und Angebote per E-Mail - freiwillig und nicht vorausgewaehlt.
            Gueltig wird die Einwilligung erst, wenn der Link in der Bestaetigungs-Mail (Double-Opt-in)
            angetippt wurde. */}
        <Pressable onPress={() => setMarketingOptIn((prev) => !prev)} style={styles.checkboxRow}>
          <View
            style={[
              styles.checkbox,
              { borderRadius: radius.sm, backgroundColor: marketingOptIn ? gradient[0] : 'transparent', borderColor: gradient[0] },
            ]}
          >
            {marketingOptIn && <Text style={styles.checkboxMark}>✓</Text>}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.muted }]}>
            {t('marketing.registrierenHaken')}
          </Text>
        </Pressable>

        <Pressable onPress={handleRegister} disabled={isSubmitting} style={{ marginTop: 12 }}>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.button, { borderRadius: radius.md }]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('auth.kontoErstellen')}</Text>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Login')} style={{ marginTop: 18 }}>
          <Text style={[styles.link, { color: colors.muted }]}>
            {t('auth.schonKonto')}{' '}
            <Text style={{ color: gradient[0], fontWeight: '600' }}>{t('auth.anmelden')}</Text>
          </Text>
        </Pressable>

        <LanguageSwitchRow />
      </View>
    </DismissKeyboardView>
    <RechtFenster titel={legal === 'agb' ? t('auth.agbLesen') : t('auth.datenschutzLesen')} url={legal ? (legal === 'agb' ? AGB_URL : DATENSCHUTZ_URL) + '?embedded=1' : null} onClose={() => setLegal(null)} />
    </>
  );
}

const styles = StyleSheet.create({
  logo: { width: 84, height: 84, alignSelf: 'center', marginBottom: 10, borderRadius: 18 },
  container: { flex: 1, justifyContent: 'center' },
  // Obergrenze fuers Tablet: Ein Formular ueber die volle Breite wirkt
  // verloren. Breiter als jedes Handy, dort also unveraendert.
  card: { marginHorizontal: 20, padding: 24, width: '100%', maxWidth: 460, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 12, textAlign: 'center', marginBottom: 22 },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6, marginTop: 10 },
  input: { height: 44, paddingHorizontal: 14, fontSize: 14 },
  legalLinksRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 6, marginLeft: 30 },
  checkboxRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 16, gap: 9 },
  checkbox: { width: 16, height: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxMark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  checkboxLabel: { fontSize: 11, lineHeight: 16, flex: 1 },
  button: { height: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
  link: { fontSize: 12.5, textAlign: 'center' },
});
