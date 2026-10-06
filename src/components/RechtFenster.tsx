import React from 'react';
import { Modal, View, Text, Pressable, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';

// AGB / Datenschutz / Hilfe im App-Fenster (WebView) statt im Browser:
// "Schließen" führt direkt zurück in die App (06.10.2026).
const WebViewAny = WebView as any;

export default function RechtFenster({ titel, url, onClose }: { titel: string; url: string | null; onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useUebersetzung();
  return (
    <Modal visible={!!url} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === 'ios' ? 54 : 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: colors.text }}>{titel}</Text>
          <Pressable onPress={onClose} style={{ backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 14 }}>{t('allgemein.schliessen')}</Text>
          </Pressable>
        </View>
        {!!url && <WebViewAny source={{ uri: url }} />}
      </View>
    </Modal>
  );
}
