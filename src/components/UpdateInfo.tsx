import React from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import * as Updates from 'expo-updates';
import { t } from '../i18n';

/**
 * Update-Stand, "Nach Updates suchen" und "Update-Protokoll" (04.10.2026,
 * gleich in allen HomeArchive-Apps). Das Protokoll stammt vom Update-Modul
 * selbst und zeigt, warum ein Update nicht startet - so fanden wir beim
 * Weinkeller die fehlenden EXPO_PUBLIC-Werte in `eas update`.
 */
export function versionsStand(): string {
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return t('update.build');
  const datum = Updates.createdAt
    ? new Date(Updates.createdAt).toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '';
  return [`Update ${Updates.updateId.slice(0, 8)}`, datum, Updates.channel || null].filter(Boolean).join(' · ');
}

async function suchen() {
  if (__DEV__ || !Updates.isEnabled) {
    Alert.alert(t('update.suchen'), t('update.aktuell'));
    return;
  }
  try {
    const r = await Updates.checkForUpdateAsync();
    if (!r.isAvailable) {
      Alert.alert(t('update.suchen'), t('update.aktuell'));
      return;
    }
    await Updates.fetchUpdateAsync();
    Alert.alert(t('update.titel'), t('update.text'), [
      { text: t('update.spaeter'), style: 'cancel' },
      { text: t('update.jetzt'), onPress: () => { Updates.reloadAsync().catch(() => {}); } },
    ]);
  } catch (e) {
    Alert.alert(t('update.suchen'), `${t('update.fehler')}\n\n${e instanceof Error ? e.message : String(e)}`);
  }
}

async function protokoll() {
  let text = '';
  try {
    const eintraege = await Updates.readLogEntriesAsync(3 * 24 * 60 * 60 * 1000);
    const wichtig = eintraege.filter((e) => e.level === 'error' || e.level === 'fatal' || e.level === 'warn');
    text = (wichtig.length ? wichtig : eintraege).slice(-12)
      .map((e) => `${new Date(e.timestamp).toLocaleString()} [${e.level}] ${e.code ? e.code + ': ' : ''}${e.message}`)
      .join('\n\n');
  } catch (e) {
    text = e instanceof Error ? e.message : String(e);
  }
  Alert.alert(t('update.protokoll'), text || t('update.protokollLeer'));
}

export function UpdateInfo({ akzent, gedaempft }: { akzent: string; gedaempft: string }) {
  return (
    <View style={{ alignItems: 'center', marginTop: 12, gap: 8 }}>
      <TouchableOpacity onPress={suchen} hitSlop={8}>
        <Text style={{ fontSize: 13, color: akzent }}>{t('update.suchen')}</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={protokoll} hitSlop={8}>
        <Text style={{ fontSize: 13, color: gedaempft }}>{t('update.protokoll')}</Text>
      </TouchableOpacity>
      <Text style={{ fontSize: 12, color: gedaempft, textAlign: 'center' }}>{versionsStand()}</Text>
    </View>
  );
}
