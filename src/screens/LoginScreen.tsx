import React, { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import PasswortFeld from '../components/PasswortFeld';
import LanguageSwitchRow from '../components/LanguageSwitchRow';
import SocialLoginKnoepfe from '../components/SocialLoginKnoepfe';
import RechtFenster from '../components/RechtFenster';

const AGB_URL = 'https://www.homearchive.at/agb';
const DATENSCHUTZ_URL = 'https://www.homearchive.at/datenschutz';
import { useAuth } from '../context/AuthContext';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

// Wie in Buero-/Medienablage: E-Mail merken (Haekchen auf dem Anmeldeschirm).
const REMEMBER_EMAIL_KEY = 'ha_remember_email';

// Supabase liefert Fehlermeldungen nur auf Englisch (z.B. "Invalid login
// credentials") - roh angezeigt versteht das nicht jeder Nutzer.
// Gleiche Uebersetzung wie in Buerroablage/Medienablage (dortige
// LoginScreen.tsx), damit die Meldung ueberall gleich klingt.
function translateAuthError(message: string): string {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-Mail oder Passwort ist falsch.';
  if (m.includes('email not confirmed')) return 'Bitte bestätige zuerst deine E-Mail-Adresse.';
  if (m.includes('rate limit')) return 'Zu viele Versuche. Bitte später erneut versuchen.';
  if (m.includes('email') && m.includes('valid')) return 'Bitte eine gültige E-Mail-Adresse eingeben.';
  return message || 'Unbekannter Fehler';
}

export default function LoginScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const { signInWithPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [legal, setLegal] = useState<null | 'agb' | 'datenschutz'>(null);

  useEffect(() => {
    AsyncStorage.getItem(REMEMBER_EMAIL_KEY).then(saved => {
      if (saved) { setEmail(saved); setRememberMe(true); }
    }).catch(() => {});
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert(t('auth.fehltNochWas'), t('auth.bitteEmailPasswort'));
      return;
    }
    setIsSubmitting(true);
    try {
      await signInWithPassword(email, password);
      if (rememberMe) await AsyncStorage.setItem(REMEMBER_EMAIL_KEY, email).catch(() => {});
      else await AsyncStorage.removeItem(REMEMBER_EMAIL_KEY).catch(() => {});
      // Navigation zur App uebernimmt der Root-Navigator automatisch,
      // sobald AuthContext eine gueltige Session meldet.
    } catch (err) {
      const message = err instanceof Error ? translateAuthError(err.message) : t('auth.loginFehlgeschlagen');
      Alert.alert(t('auth.anmeldungFehlgeschlagen'), message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={[styles.card, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
        {/* Logo ueber dem Namen: Der Anmeldeschirm war das einzige Bild
            der App ohne jedes Erkennungszeichen - man sah ein Formular
            und musste dem Titel glauben, in der richtigen App zu sein. */}
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={[styles.title, { color: colors.text }]}>{t('auth.appName')}</Text>

        <Text style={[styles.label, { color: colors.muted }]}>{t('auth.email')}</Text>
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

        <Pressable onPress={() => setRememberMe(v => !v)} style={styles.checkRow}>
          <View style={[styles.checkbox, { borderRadius: radius.sm ?? 4, borderColor: gradient[0] }, rememberMe && { backgroundColor: gradient[0] }]}>
            {rememberMe && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={[styles.checkText, { color: colors.muted }]}>{t('auth.anmeldedatenMerken')}</Text>
        </Pressable>

        <Pressable onPress={handleLogin} disabled={isSubmitting} style={{ marginTop: 8 }}>
          <LinearGradient
            colors={gradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.button, { borderRadius: radius.md }]}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>{t('auth.anmelden')}</Text>
            )}
          </LinearGradient>
        </Pressable>

        <Pressable onPress={() => navigation.navigate('Register')} style={{ marginTop: 20 }}>
          <Text style={[styles.link, { color: colors.muted }]}>
            {t('auth.keinKonto')}{' '}
            <Text style={{ color: gradient[0], fontWeight: '600' }}>{t('auth.registrieren')}</Text>
          </Text>
        </Pressable>

        <Pressable

          onPress={() => navigation.navigate('ForgotPassword')}

          style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}

        >

          <Text style={{ color: colors.muted, fontSize: 13.5 }}>{t('passwort.vergessen')}</Text>

        </Pressable>

        <SocialLoginKnoepfe onAgbOeffnen={setLegal} />

        <LanguageSwitchRow />
      </View>
      </ScrollView>
      <RechtFenster titel={legal === 'agb' ? t('auth.agbLesen') : t('auth.datenschutzLesen')} url={legal ? (legal === 'agb' ? AGB_URL : DATENSCHUTZ_URL) + '?embedded=1' : null} onClose={() => setLegal(null)} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: { width: 84, height: 84, alignSelf: 'center', marginBottom: 10, borderRadius: 18 },
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  // Obergrenze fuers Tablet: Ein Formular ueber die volle Breite wirkt
  // verloren. Breiter als jedes Handy, dort also unveraendert.
  card: { marginHorizontal: 20, padding: 24, width: '100%', maxWidth: 460, alignSelf: 'center' },
  title: { fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 28 },
  label: { fontSize: 11, fontWeight: '500', marginBottom: 6, marginTop: 12 },
  input: { height: 46, paddingHorizontal: 14, fontSize: 14 },
  button: { height: 48, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14.5 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 14 },
  checkbox: { width: 16, height: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  checkmark: { color: '#fff', fontSize: 11, fontWeight: '700' },
  checkText: { fontSize: 12 },
  link: { fontSize: 12.5, textAlign: 'center' },
});
