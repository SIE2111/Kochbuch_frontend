// Kleine Knoepfe "oder anmelden mit  [ Apple]  [G Google]" ganz unten am Anmelde- und Registrierschirm
// (Version 1.1, Wunsch 02.11.2026: unten und klein). Apple nur auf iPhone/iPad, Google nur, wenn die
// Client-IDs eingetragen sind (src/config/socialLogin.ts). Fehlt beides, wird gar nichts angezeigt.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { appleVerfuegbar, googleVerfuegbar } from '../utils/socialLogin';

type Props = {
  /** Vom Registrierschirm: Haekchen/Felder des Formulars mitnehmen. Ohne = Anmeldeschirm. */
  formular?: { agbAkzeptiert: boolean; marketingOptIn: boolean; einladungscode: string };
  onAgbOeffnen: (art: 'agb' | 'datenschutz') => void;
};

function AppleLogo() {
  return (
    <Svg width={13} height={15} viewBox="0 0 17 20">
      <Path fill="#fff" d="M14.1 10.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.4-.9C3.6 4.7 2 5.8 1 7.4c-1.9 3.3-.5 8.1 1.4 10.8.9 1.3 2 2.8 3.4 2.7 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3.1-.1 0-2.9-1.1-2.9-4.3zM11.5 2.9c.7-.9 1.2-2.1 1.1-3.3-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3-1.5z" />
    </Svg>
  );
}

function GoogleLogo() {
  return (
    <Svg width={14} height={14} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 2.9-2.2 5.4-4.7 7.1l7.6 5.9c4.4-4.1 6.9-10.1 6.9-17.5z" />
      <Path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C.9 16.6 0 20.2 0 24s.9 7.4 2.6 10.7l7.9-6.1z" />
      <Path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </Svg>
  );
}

export default function SocialLoginKnoepfe({ formular, onAgbOeffnen }: Props) {
  const { colors, gradient } = useTheme();
  const { t } = useUebersetzung();
  const { signInSocial } = useAuth();
  const [apple, setApple] = useState(false);
  const [laeuft, setLaeuft] = useState<null | 'apple' | 'google'>(null);
  const google = googleVerfuegbar();

  useEffect(() => { appleVerfuegbar().then(setApple).catch(() => setApple(false)); }, []);

  if (!apple && !google) return null;

  const los = async (art: 'apple' | 'google') => {
    if (laeuft) return;
    if (formular && !formular.agbAkzeptiert) {
      Alert.alert(t('auth.zustimmungTitel'), t('auth.zustimmungText'));
      return;
    }
    setLaeuft(art);
    try {
      await signInSocial(art, formular ? { marketingOptIn: formular.marketingOptIn, einladungscode: formular.einladungscode } : undefined);
      // Weiter geht es automatisch, sobald AuthContext die Sitzung meldet
    } catch (e: any) {
      Alert.alert(t('auth.anmeldungFehlgeschlagen'), t('auth.socialFehler', { fehler: String(e?.message || e) }));
    } finally {
      setLaeuft(null);
    }
  };

  const welche = apple && google ? t('auth.socialAppleGoogle') : apple ? 'Apple' : 'Google';

  return (
    <View style={{ marginTop: 22 }}>
      <View style={styles.oderZeile}>
        <View style={[styles.linie, { backgroundColor: colors.cardBorder ?? '#E3DBCB' }]} />
        <Text style={[styles.oder, { color: colors.muted }]}>{t('auth.oderAnmeldenMit')}</Text>
        <View style={[styles.linie, { backgroundColor: colors.cardBorder ?? '#E3DBCB' }]} />
      </View>
      <View style={styles.knoepfe}>
        {apple && (
          <Pressable onPress={() => los('apple')} style={[styles.pille, { backgroundColor: '#000' }]} accessibilityLabel={t('auth.mitApple')}>
            {laeuft === 'apple' ? <ActivityIndicator color="#fff" size="small" /> : <AppleLogo />}
            <Text style={[styles.pilleText, { color: '#fff' }]}>Apple</Text>
          </Pressable>
        )}
        {google && (
          <Pressable onPress={() => los('google')} style={[styles.pille, styles.google]} accessibilityLabel={t('auth.mitGoogle')}>
            {laeuft === 'google' ? <ActivityIndicator color="#444" size="small" /> : <GoogleLogo />}
            <Text style={[styles.pilleText, { color: '#1f1f1f' }]}>Google</Text>
          </Pressable>
        )}
      </View>
      <Text style={[styles.recht, { color: colors.muted }]}>
        {t('auth.socialRecht1', { welche })}
        <Text style={{ color: gradient[0], fontWeight: '600' }} onPress={() => onAgbOeffnen('agb')}>{t('auth.agbKurz')}</Text>
        {t('auth.socialRecht2')}
        <Text style={{ color: gradient[0], fontWeight: '600' }} onPress={() => onAgbOeffnen('datenschutz')}>{t('auth.datenschutzKurz')}</Text>
        {'.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  oderZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  linie: { flex: 1, height: StyleSheet.hairlineWidth * 2 },
  oder: { fontSize: 11.5 },
  knoepfe: { flexDirection: 'row', justifyContent: 'center', gap: 10 },
  pille: { height: 38, minWidth: 96, paddingHorizontal: 16, borderRadius: 19, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  google: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dadce0' },
  pilleText: { fontSize: 13, fontWeight: '600' },
  recht: { fontSize: 10.5, lineHeight: 15, textAlign: 'center', marginTop: 8, marginHorizontal: 4 },
});
