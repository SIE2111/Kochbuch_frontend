import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, Modal, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { plusVormerkenZeigen } from '../utils/plusHinweis';

/**
 * Ein Rezept an eine bestimmte Person schicken.
 *
 * Bewusst getrennt vom Veroeffentlichen im Pool, obwohl beides "teilen"
 * heisst: Der Pool geht an alle und ist eine Entscheidung mit Gewicht,
 * das hier geht an eine Adresse und ist so beilaeufig wie eine Nachricht.
 * Deshalb hier auch keine Warnung vorweg, sondern direkt das Formular.
 *
 * Der Empfaenger braucht die App nicht zu haben - die Zuordnung laeuft
 * ueber die E-Mail-Adresse. Wer sich spaeter damit registriert, findet
 * das Rezept beim ersten Oeffnen vor. Genau das sagt der Hinweistext im
 * Formular, damit niemand glaubt, er koenne nur an App-Nutzer schicken.
 */
export default function ShareRecipeButton({
  recipeId,
  recipeTitle,
  size = 18,
  style,
}: {
  recipeId: string;
  recipeTitle: string;
  size?: number;
  style?: object;
}) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const send = async () => {
    if (!email.includes('@')) {
      Alert.alert(t('haushalt.emailFehlt'), t('haushalt.bitteEmail'));
      return;
    }
    setIsSending(true);
    try {
      await api.post('/shares', {
        recipe_id: recipeId,
        email: email.trim(),
        name: name.trim() || null,
        message: message.trim() || null,
      });
      setIsOpen(false);
      setName('');
      setEmail('');
      setMessage('');
      Alert.alert(t('teilen.verschickt'), `„${recipeTitle}" ist unterwegs.`);
      void plusVormerkenZeigen('teilen');
    } catch (err) {
      Alert.alert(t('teilen.verschickenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <>
      <Pressable
        onPress={() => setIsOpen(true)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Rezept an jemanden schicken"
        style={[styles.button, style]}
      >
        <MaterialCommunityIcons name="email-fast-outline" size={size} color={colors.muted} />
      </Pressable>

      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={() => setIsOpen(false)}>
        <View style={styles.backdrop}>
          <View style={[styles.card, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.title, { color: colors.text }]}>{t('teilen.rezeptSchicken')}</Text>
            <Text style={[styles.body, { color: colors.muted }]}>
              „{recipeTitle}" an eine Person senden. Sie bekommt eine E-Mail und kann das Rezept in
              ihr Kochbuch übernehmen – auch wenn sie die App noch nicht hat.
            </Text>

            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={t('teilen.namePlatzhalter')}
              placeholderTextColor={colors.muted}
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
            />
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('teilen.emailPlatzhalter')}
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              keyboardType="email-address"
              style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginTop: 8 }]}
            />
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder={t('teilen.nachrichtPlatzhalter')}
              placeholderTextColor={colors.muted}
              multiline
              style={[styles.input, styles.multiline, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md, marginTop: 8 }]}
            />

            <Pressable
              onPress={send}
              disabled={isSending}
              style={[styles.sendButton, { backgroundColor: gradient[0], borderRadius: radius.md, opacity: isSending ? 0.6 : 1 }]}
            >
              {isSending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>{t('teilen.schicken')}</Text>}
            </Pressable>
            <Pressable onPress={() => setIsOpen(false)} disabled={isSending} style={{ marginTop: 12 }}>
              <Text style={{ color: colors.muted, fontSize: 12.5, textAlign: 'center' }}>{t('allgemein.abbrechen')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: { padding: 4 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, padding: 22 },
  title: { fontSize: 17, fontWeight: '700' },
  body: { fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  input: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, marginTop: 14 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  sendButton: { height: 46, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  sendButtonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
