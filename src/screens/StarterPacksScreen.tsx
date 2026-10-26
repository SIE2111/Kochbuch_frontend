import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import { useLayout } from '../utils/layout';

type Pack = {
  key: string;
  label: string;
  description: string;
  count: number;
  /** Wie viele Rezepte dieses Pakets schon im eigenen Kochbuch liegen. */
  imported?: number;
};

type CleanupResult = {
  deleted: number;
  kept_changed: number;
  kept_cooked: number;
  kept_published: number;
};

// Ein Sinnbild je Paket - nur zur Wiedererkennung, die Auswahl trifft der
// Text darunter.
const PACK_ICONS: Record<string, string> = {
  standard: 'silverware-fork-knife',
  vegetarisch: 'leaf',
  cocktails: 'glass-cocktail',
  italienisch: 'pasta',
  polnisch: 'food-drumstick',
  deutsch: 'beer',
};

export default function StarterPacksScreen({ navigation }: any) {
  const { colors, radius, gradient } = useTheme();
  const { inhaltsBreite } = useLayout();
  const { t } = useUebersetzung();
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    // Zwei Abfragen: Die Paketliste kommt ohne Login aus, der Importstand
    // nicht. Faellt der Stand aus, zeigt die Seite trotzdem die Pakete -
    // dann eben ohne den Hinweis, was schon da ist.
    Promise.all([
      api.get<{ packs?: Pack[] }>('/onboarding/starter-pack-options'),
      api
        .get<{ packs?: { key: string; imported: number }[] }>('/onboarding/starter-pack-status')
        .catch(() => ({ packs: [] as { key: string; imported: number }[] })),
    ])
      .then(([optionen, stand]) => {
        const importiert = new Map((stand.packs ?? []).map((p) => [p.key, p.imported]));
        setPacks((optionen.packs ?? []).map((p) => ({ ...p, imported: importiert.get(p.key) })));
      })
      .catch((err) => setError(err instanceof ApiError ? err.detail : 'Pakete konnten nicht geladen werden'));
  }, []);

  useEffect(load, [load]);

  const handleImport = async (pack: Pack) => {
    setBusy(pack.key);
    setError(null);
    try {
      const res = await api.post<{ recipes_imported: number; recipes_skipped_already_imported?: number }>(
        '/onboarding/setup',
        { create_standard_folders: true, starter_packs: [pack.key] },
      );
      // Die Zahl der uebersprungenen mit ausgeben: "0 importiert" ohne
      // Erklaerung sieht nach einem Fehler aus, obwohl schlicht schon
      // alles da war.
      const uebersprungen = res.recipes_skipped_already_imported ?? 0;
      Alert.alert(
        'Fertig',
        `${res.recipes_imported} Rezepte importiert.` +
          (uebersprungen ? `\n\n${uebersprungen} waren schon da und wurden übersprungen.` : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : 'Import fehlgeschlagen');
    } finally {
      setBusy(null);
      load();
    }
  };

  const handleRemove = (pack: Pack) => {
    Alert.alert(
      `${pack.label} entfernen?`,
      'Entfernt werden nur Rezepte aus diesem Paket, die du nicht verändert, nie gekocht und nicht ' +
        'veröffentlicht hast. Alles andere bleibt.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Entfernen',
          style: 'destructive',
          onPress: async () => {
            setBusy(pack.key);
            setError(null);
            try {
              const res = await api.delete<CleanupResult>(
                `/onboarding/starter-import?pack=${encodeURIComponent(pack.key)}`,
              );
              const gruende = [
                res.kept_changed ? `${res.kept_changed} bearbeitet` : null,
                res.kept_cooked ? `${res.kept_cooked} schon gekocht` : null,
                res.kept_published ? `${res.kept_published} veröffentlicht` : null,
              ].filter(Boolean);
              Alert.alert(
                'Fertig',
                `${res.deleted} Rezepte entfernt.` +
                  (gruende.length ? `\n\nBehalten: ${gruende.join(', ')}.` : ''),
              );
            } catch (err) {
              setError(err instanceof ApiError ? err.detail : 'Entfernen fehlgeschlagen');
            } finally {
              setBusy(null);
              load();
            }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.container, inhaltsBreite]} keyboardShouldPersistTaps="handled">
        {navigation.canGoBack() && (
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={{ marginBottom: 10 }}>
            <Text style={{ color: gradient[0], fontSize: 14, fontWeight: '600' }}>‹ Zurück</Text>
          </Pressable>
        )}

        <Text style={[styles.title, { color: colors.text }]}>{t('starter.titel')}</Text>
        <Text style={[styles.subtitle, { color: colors.muted }]}>
          Drei Pakete, einzeln zum Holen und wieder Loswerden. Was schon in deinem Kochbuch liegt, wird
          beim Import übersprungen – es entstehen keine Doppelten.
        </Text>

        {packs === null && !error && <ActivityIndicator color={gradient[0]} style={{ marginTop: 24 }} />}

        {packs?.map((pack) => (
          <View
            key={pack.key}
            style={[styles.card, { backgroundColor: colors.card, borderRadius: radius.md }]}
          >
            <View style={styles.cardHead}>
              <MaterialCommunityIcons
                name={(PACK_ICONS[pack.key] ?? 'book-outline') as any}
                size={22}
                color={gradient[0]}
                style={{ marginRight: 10 }}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {pack.label} ({pack.count})
                </Text>
                <Text style={[styles.cardText, { color: colors.muted }]}>{pack.description}</Text>
                {pack.imported !== undefined && (
                  <View style={styles.statusRow}>
                    <MaterialCommunityIcons
                      name={pack.imported === 0 ? 'circle-outline' : pack.imported >= pack.count ? 'check-circle' : 'circle-slice-4'}
                      size={14}
                      color={pack.imported === 0 ? colors.muted : gradient[0]}
                      style={{ marginRight: 5 }}
                    />
                    <Text
                      style={[
                        styles.status,
                        { color: pack.imported === 0 ? colors.muted : gradient[0] },
                      ]}
                    >
                      {pack.imported === 0
                        ? 'Noch nicht importiert'
                        : pack.imported >= pack.count
                        ? 'Vollständig in deinem Kochbuch'
                        : `${pack.imported} von ${pack.count} in deinem Kochbuch`}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => handleImport(pack)}
                disabled={busy !== null || (pack.imported !== undefined && pack.imported >= pack.count)}
                style={[
                  styles.importButton,
                  {
                    backgroundColor: gradient[0],
                    borderRadius: radius.sm,
                    opacity: pack.imported !== undefined && pack.imported >= pack.count ? 0.45 : 1,
                  },
                ]}
              >
                {busy === pack.key ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.importText}>
                    {pack.imported !== undefined && pack.imported >= pack.count
                      ? 'Alles da'
                      : pack.imported
                      ? 'Rest holen'
                      : 'Importieren'}
                  </Text>
                )}
              </Pressable>
              {pack.imported !== 0 && (
                <Pressable
                  onPress={() => handleRemove(pack)}
                  disabled={busy !== null}
                  style={styles.removeButton}
                >
                  <Text style={{ color: '#DC2626', fontSize: 13, fontWeight: '600' }}>{t('allgemein.entfernen')}</Text>
                </Pressable>
              )}
            </View>
          </View>
        ))}

        {error && <Text style={[styles.error, { color: '#DC2626' }]}>{error}</Text>}

        <Text style={[styles.footnote, { color: colors.muted }]}>
          Importierte Rezepte sind in der Rezeptliste an ihrem Herkunftszeichen erkennbar. Entfernt wird
          immer nur, was unverändert, nie gekocht und nicht veröffentlicht ist – eigene Arbeit geht dabei
          nicht verloren.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  subtitle: { fontSize: 13.5, lineHeight: 19, marginBottom: 18 },
  card: { padding: 14, marginBottom: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { fontSize: 15.5, fontWeight: '600', marginBottom: 2 },
  cardText: { fontSize: 12.5, lineHeight: 17 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  status: { fontSize: 12.5, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  importButton: { minHeight: 44, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  importText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  removeButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center' },
  error: { fontSize: 13, marginTop: 6 },
  footnote: { fontSize: 12, lineHeight: 17, marginTop: 14 },
});
