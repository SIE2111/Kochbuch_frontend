import React from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../navigation/AppNavigator';

type Props = NativeStackScreenProps<MainStackParamList, 'RecipeSourceMenu'>;

interface SourceOption {
  key: string;
  title: string;
  subtitle: string;
  target: 'ManualRecipe' | 'CommunityPool' | 'PhotoCapture' | 'WebImport' | 'AIGenerate' | null;
}

const OPTIONS: SourceOption[] = [
  { key: 'manual', title: 'sonstiges.quelleSelbst', subtitle: 'sonstiges.quelleSelbstText', target: 'ManualRecipe' },
  { key: 'photo', title: 'sonstiges.quelleFoto', subtitle: 'sonstiges.quelleFotoText', target: 'PhotoCapture' },
  { key: 'ai', title: 'sonstiges.quelleKi', subtitle: 'sonstiges.quelleKiText', target: 'AIGenerate' },
  { key: 'web', title: 'sonstiges.quelleWeb', subtitle: 'sonstiges.quelleWebText', target: 'WebImport' },
  { key: 'pool', title: 'sonstiges.quellePool', subtitle: 'sonstiges.quellePoolText', target: 'CommunityPool' },
];

export default function RecipeSourceMenuScreen({ navigation }: Props) {
  const { colors, radius } = useTheme();
  const { t } = useUebersetzung();
  const insets = useSafeAreaInsets();
  const untenFrei = Platform.OS === 'android' ? Math.max(insets.bottom, 48) : insets.bottom;   // Android-Steuerleiste

  return (
    <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.4)' }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => navigation.goBack()} />
      <View style={[styles.sheet, { paddingBottom: 32 + untenFrei, backgroundColor: colors.bg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }]}>
        <View style={styles.handle} />
        {/* Sichtbares Schliessen. Das Wegtippen auf den abgedunkelten
            Bereich funktionierte zwar schon, war aber nirgends erkennbar -
            und ein Blatt, das sich nur ueber eine unsichtbare Flaeche
            schliessen laesst, wirkt wie eine Sackgasse. */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: colors.text }]}>{t('sonstiges.neuesRezept')}</Text>
            <Text style={[styles.subtitle, { color: colors.muted }]}>{t('sonstiges.waehleWeg')}</Text>
          </View>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Schließen"
            style={[styles.closeButton, { backgroundColor: colors.card, borderRadius: radius.sm }]}
          >
            <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
          </Pressable>
        </View>

        {OPTIONS.map((option) => (
          <Pressable
            key={option.key}
            disabled={!option.target}
            onPress={() => {
              if (option.target) {
                navigation.replace(option.target);
              }
            }}
            style={[
              styles.optionRow,
              { backgroundColor: colors.card, borderRadius: radius.md, opacity: option.target ? 1 : 0.4 },
            ]}
          >
            <Text style={[styles.optionTitle, { color: colors.text }]}>{t(option.title)}</Text>
            <Text style={[styles.optionSubtitle, { color: colors.muted }]}>{t(option.subtitle)}</Text>
            {!option.target && (
              <Text style={[styles.comingSoon, { color: colors.muted }]}>{t('sonstiges.nochNichtGebaut')}</Text>
            )}
          </Pressable>
        ))}

        <Pressable onPress={() => navigation.goBack()} style={styles.cancelRow}>
          <Text style={[styles.cancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { padding: 20, paddingBottom: 32 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#D6D3D1', alignSelf: 'center', marginBottom: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700' },
  subtitle: { fontSize: 12, marginTop: 2 },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  cancelRow: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 13, fontWeight: '600' },
  optionRow: { padding: 14, marginBottom: 8 },
  optionTitle: { fontSize: 13.5, fontWeight: '600' },
  optionSubtitle: { fontSize: 11, marginTop: 2 },
  comingSoon: { fontSize: 9.5, marginTop: 4, fontStyle: 'italic' },
});
