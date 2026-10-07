import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, Platform,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { useLayout } from '../utils/layout';

// Muss mit "version" in app.json uebereinstimmen. Beim Versionswechsel
// hier mitziehen - sonst meldet die App im Supportfall die falsche.
const APP_VERSION = '0.1.0';

/**
 * Support-Nachricht aus der App heraus.
 *
 * Bewusst ein Formular statt eines mailto:-Links. Ein mailto oeffnet das
 * Mailprogramm des Geraets - das auf vielen Handys gar nicht eingerichtet
 * ist, und dann passiert beim Antippen einfach nichts. Der Nutzer haelt
 * das fuer einen Fehler und schreibt am Ende gar nicht.
 *
 * App-Version und Plattform gehen automatisch mit: Bei einem Fehlerbericht
 * ist die erste Rueckfrage sonst immer 'welche Version hast du?', und
 * genau die weiss kaum jemand.
 */
export default function SupportScreen() {
  const { colors, gradient, radius } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const canSend = subject.trim().length > 0 && message.trim().length > 0;

  const send = async () => {
    if (!canSend || isSending) return;
    setIsSending(true);
    try {
      await api.post('/support/contact', {
        subject: subject.trim(),
        message: message.trim(),
        // Version aus app.json statt ueber expo-constants: Das Paket ist
        // hier nicht installiert, und fuer eine einzige Zahl lohnt keine
        // neue Abhaengigkeit.
        app_version: APP_VERSION,
        platform: Platform.OS,
      });
      setSent(true);
      setSubject('');
      setMessage('');
    } catch (err) {
      Alert.alert(t('sonstiges.nichtGesendet'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsSending(false);
    }
  };

  if (sent) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <MaterialCommunityIcons name="check-circle-outline" size={52} color={gradient[0]} />
        <Text style={[styles.sentTitle, { color: colors.text }]}>{t('sonstiges.nachrichtUnterwegs')}</Text>
        <Text style={[styles.sentBody, { color: colors.muted }]}>
          Du bekommst gleich eine Empfangsbestätigung per E-Mail. Wir melden uns so bald wie möglich.
        </Text>
        <Pressable
          onPress={() => setSent(false)}
          style={[styles.sendButton, { backgroundColor: gradient[0], borderRadius: radius.md, marginTop: 24 }]}
        >
          <Text style={styles.sendButtonText}>{t('sonstiges.weitereNachricht')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView automaticallyAdjustKeyboardInsets
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container, inhaltsBreite]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <Text style={[styles.hint, { color: colors.muted }]}>
        Etwas funktioniert nicht, ein Rezept wird falsch erkannt, oder dir fehlt eine Funktion?
        Schreib uns – App-Version und Gerätetyp schicken wir automatisch mit.
      </Text>

      <Text style={[styles.label, { color: colors.muted }]}>BETREFF</Text>
      <TextInput
        value={subject}
        onChangeText={setSubject}
        placeholder={t('sonstiges.betreffPlatzhalter')}
        placeholderTextColor={colors.muted}
        style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
      />

      <Text style={[styles.label, { color: colors.muted }]}>NACHRICHT</Text>
      <TextInput
        value={message}
        onChangeText={setMessage}
        placeholder={t('sonstiges.textPlatzhalter')}
        placeholderTextColor={colors.muted}
        multiline
        style={[
          styles.input,
          styles.multiline,
          { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md },
        ]}
      />

      <Pressable
        onPress={send}
        disabled={!canSend || isSending}
        style={[
          styles.sendButton,
          { backgroundColor: gradient[0], borderRadius: radius.md, opacity: canSend && !isSending ? 1 : 0.45 },
        ]}
      >
        {isSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>{t('sonstiges.absenden')}</Text>}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 40 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  hint: { fontSize: 12.5, lineHeight: 18, marginBottom: 20 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6, marginTop: 8 },
  input: { minHeight: 46, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14 },
  multiline: { minHeight: 150, textAlignVertical: 'top' },
  sendButton: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 22 },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14.5 },
  sentTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, textAlign: 'center' },
  sentBody: { fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
});
