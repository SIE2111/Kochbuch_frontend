import React, { useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, SafeAreaView, ActivityIndicator, Keyboard } from 'react-native';
import { WebView } from 'react-native-webview';

// react-native-webview's Typdefinitionen sind noch nicht auf React 19
// abgestimmt (bekanntes Oekosystem-Problem waehrend der React-19-
// Migration) - betrifft nur die TypeScript-Typpruefung, nicht das
// tatsaechliche Laufzeitverhalten der Komponente.
const WebViewAny = WebView as any;
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<MainStackParamList, 'WebBrowse'>;

function buildGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

export default function WebBrowseScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { t } = useUebersetzung();
  const webViewRef = useRef<WebView>(null);

  const [searchText, setSearchText] = useState(route.params?.initialQuery ?? '');
  // initialUrl: "Ansehen" aus der Rezeptsuche öffnet direkt die Seite (04.10.2026)
  const [currentUrl, setCurrentUrl] = useState(route.params?.initialUrl ?? buildGoogleSearchUrl(route.params?.initialQuery ?? 'rezept'));
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);

  const handleSearch = () => {
    const trimmed = searchText.trim();
    if (!trimmed) return;
    Keyboard.dismiss();
    setCurrentUrl(buildGoogleSearchUrl(trimmed));
  };

  const handleUseThisLink = () => {
    // Gibt die aktuell im Browser geoeffnete URL an WebImportScreen zurueck
    // (ueber navigate mit Params, statt eines eigenen State-Management-
    // Umwegs - React Navigation merged Params beim Zurueckspringen).
    navigation.navigate('WebImport', { pickedUrl: currentUrl });
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.bg }]}>
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('wochenplan.suchen')}
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          onSubmitEditing={handleSearch}
          returnKeyType="search"
        />
        {isLoading && <ActivityIndicator size="small" color={colors.muted} />}
      </View>

      <View style={styles.webviewWrapper}>
        <WebViewAny
          ref={webViewRef}
          source={{ uri: currentUrl }}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onNavigationStateChange={(navState: { url: string; canGoBack: boolean }) => {
            setCurrentUrl(navState.url);
            setCanGoBack(navState.canGoBack);
          }}
          style={{ flex: 1 }}
        />
      </View>

      <View style={[styles.bottomBar, { backgroundColor: colors.card }]}>
        <Pressable
          onPress={() => webViewRef.current?.goBack()}
          disabled={!canGoBack}
          hitSlop={10}
          style={{ opacity: canGoBack ? 1 : 0.3 }}
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        </Pressable>

        <Text style={[styles.currentUrl, { color: colors.muted }]} numberOfLines={1}>
          {currentUrl.replace(/^https?:\/\//, '')}
        </Text>

        <Pressable
          onPress={handleUseThisLink}
          style={[styles.useButton, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
        >
          <Text style={styles.useButtonText}>{t('sonstiges.linkUebernehmen')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 13.5 },
  webviewWrapper: { flex: 1 },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  currentUrl: { flex: 1, fontSize: 10.5 },
  useButton: { paddingHorizontal: 12, paddingVertical: 9 },
  useButtonText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
});
