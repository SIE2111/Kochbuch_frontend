// Profil-Abschnitte "Freunde" (Einladungscode teilen, Code eines Freundes einloesen) und "E-Mail"
// (Tipps und Angebote per E-Mail, Double-Opt-in).
//
// Lag bis 12.10.2026 im Unterschirm "Einstellungen" (AppSettingsScreen) und steht seitdem direkt
// im Profil - so wie in Mein Weinkeller, Meine Bueroablage und Meine Medienablage. Gleicher Code,
// gleiche Reihenfolge: unmittelbar vor der AI-Coins-Karte.
import React, { useEffect, useState } from 'react';
import { View, Text, Switch, StyleSheet, ActivityIndicator, TextInput, Pressable } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung, getSprache } from '../i18n';
import { einwilligungAnfragen, statusLaden } from '../api/marketing';
import { showBrutzelHinweis } from './BrutzelHinweis';
import { einladungEinloesenMitHinweis, einladungTeilen } from '../utils/einladung';

export default function MarketingEinstellungen() {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  // 'aus' | 'angefragt' (Bestaetigungs-Mail unterwegs) | 'bestaetigt'; null = noch nicht geladen / kein Netz
  const [mailStand, setMailStand] = useState<'aus' | 'angefragt' | 'bestaetigt' | null>(null);
  const [mailSpeichert, setMailSpeichert] = useState(false);
  // Code eingeben nur fuer neue Konten, die noch keinen eingeloest haben
  const [einloesbar, setEinloesbar] = useState(false);
  const [codeEingabe, setCodeEingabe] = useState('');
  const [codePruefung, setCodePruefung] = useState(false);

  useEffect(() => {
    statusLaden()
      .then((s) => {
        setMailStand(s.einwilligung.bestaetigt ? 'bestaetigt' : s.einwilligung.angefragt ? 'angefragt' : 'aus');
        setEinloesbar(!!s.einladung_einloesbar);
      })
      .catch(() => setMailStand(null));
  }, []);

  const handleCodeEinloesen = async () => {
    if (!codeEingabe.trim()) return;
    setCodePruefung(true);
    const ok = await einladungEinloesenMitHinweis(codeEingabe);
    setCodePruefung(false);
    if (ok) { setEinloesbar(false); setCodeEingabe(''); }
  };

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

  // Bestaetigungs-Mail nicht angekommen: noch einmal schicken (der Server begrenzt auf wenige je Stunde)
  const handleErneutSenden = async () => {
    setMailSpeichert(true);
    try {
      await einwilligungAnfragen(true, getSprache());
      showBrutzelHinweis({ title: t('marketing.einstellung.titel'), text: t('marketing.einstellung.erneutGesendet') });
    } catch {
      showBrutzelHinweis({ title: t('marketing.einstellung.titel'), text: t('marketing.einstellung.fehler') });
    } finally {
      setMailSpeichert(false);
    }
  };

  return (
    <View>
      {/* Freunde einladen: beide bekommen 50 AI Coins, sobald der Freund den Code eingibt */}
      <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('marketing.einladung.abschnitt')}</Text>
      <Pressable
        onPress={() => { void einladungTeilen(); }}
        style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="account-multiple-plus-outline" size={20} color={colors.muted} style={styles.rowIcon} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.rowTitle, { color: colors.text }]}>{t('marketing.einladung.einladenTitel')}</Text>
          <Text style={[styles.rowSubtitle, { color: colors.muted }]}>{t('marketing.einladung.einladenSub')}</Text>
        </View>
        <Text style={{ color: colors.muted, fontSize: 16 }}>›</Text>
      </Pressable>
      {einloesbar && (
        <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
          <TextInput
            style={{ flex: 1, color: colors.text, fontSize: 14.5, paddingVertical: 4 }}
            placeholder={t('marketing.einladung.platzhalter')}
            placeholderTextColor={colors.muted}
            autoCapitalize="characters"
            autoCorrect={false}
            value={codeEingabe}
            onChangeText={setCodeEingabe}
          />
          {codePruefung ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <Pressable onPress={handleCodeEinloesen} hitSlop={8}>
              <Text style={{ color: gradient[0], fontWeight: '700', fontSize: 14 }}>{t('marketing.einladung.einloesenKnopf')}</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Tipps und Angebote per E-Mail (Double-Opt-in): der Schalter fordert die Bestaetigungs-Mail an,
          gueltig ist die Einwilligung erst nach dem Tipp auf den Link darin. */}
      {mailStand !== null && (
        <>
          <Text style={[styles.sectionLabel, { color: colors.muted, marginTop: 26 }]}>{t('marketing.einstellung.abschnitt')}</Text>
          <View style={[styles.row, { backgroundColor: colors.card, borderRadius: radius.md }]}>
            <MaterialCommunityIcons name="email-outline" size={20} color={colors.muted} style={styles.rowIcon} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.text }]}>{t('marketing.einstellung.titel')}</Text>
              <Text style={[styles.rowSubtitle, { color: colors.muted }]}>
                {t(mailStand === 'bestaetigt' ? 'marketing.einstellung.subBestaetigt'
                  : mailStand === 'angefragt' ? 'marketing.einstellung.subAngefragt'
                  : 'marketing.einstellung.subAus')}
              </Text>
            </View>
            {mailStand === 'angefragt' && !mailSpeichert && (
              <Pressable onPress={handleErneutSenden} hitSlop={8} style={{ marginRight: 10 }}>
                <MaterialCommunityIcons name="email-sync-outline" size={22} color={gradient[0]} />
              </Pressable>
            )}
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
    </View>
  );
}

// Gleiche Masse wie die uebrigen Profil-Zeilen (ProfileScreen), damit der Block nicht auffaellt.
const styles = StyleSheet.create({
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 14, marginBottom: 8 },
  rowIcon: { marginRight: 10 },
  rowTitle: { fontSize: 14.5, fontWeight: '600' },
  rowSubtitle: { fontSize: 12, marginTop: 2 },
});
