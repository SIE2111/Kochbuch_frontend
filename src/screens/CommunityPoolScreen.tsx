import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator, Alert, RefreshControl, Image, ScrollView } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import { api, ApiError } from '../api/client';
import ScanFab from '../components/ScanFab';
import type { MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';
import PoolRecipeDetailScreen from './PoolRecipeDetailScreen';
import RecipeDetailScreen from './RecipeDetailScreen';

interface PublicRecipeSummary {
  id: string;
  title: string;
  servings: number | null;
  prep_time_minutes: number | null;
  fork_count: number;
  download_count: number;
  avg_rating: number | null;
  cover_image_url: string | null;
  // Vom Aufrufer selbst veroeffentlicht bzw. schon uebernommen. Der
  // Uebernehmen-Knopf entfaellt dann - eine Kopie waere ein Duplikat.
  is_own?: boolean;
  already_forked?: boolean;
  // Name der Person, die das Rezept eingestellt hat - None bei einem
  // Konto ohne gesetzten Anzeigenamen.
  owner_display_name?: string | null;
}

interface ForkFeedback {
  // Gerade JETZT in dieser Sitzung uebernommen - zeigt kurz den
  // Zielordner an ("Übernommen ✓"). Bei already_forked aus dem GET
  // (aus einer frueheren Sitzung) fehlt das und der Knopf zeigt
  // stattdessen direkt den Öffnen-Link (siehe Auftrag Punkt 12).
  folderName?: string | null;
  localRecipeId?: string;
}

/**
 * Der Community-Pool ist seit dem Tabwechsel ein eigener Bereich in der
 * unteren Leiste (vorher nur ueber das Erfassen-Menue erreichbar). Er wird
 * sowohl als Tab als auch als Stack-Screen verwendet - deshalb holt er
 * sich die Navigation ueber useNavigation statt ueber Props: So
 * funktioniert 'RecipeDetail' in beiden Faellen, weil der Aufruf an den
 * uebergeordneten Stack weitergereicht wird.
 */
export default function CommunityPoolScreen() {
  const { colors, gradient, radius } = useTheme();
  const { quer, hoch, inhaltsBreiteZweispaltig } = useLayout();
  const { t } = useUebersetzung();
  const navigation = useNavigation<NativeStackNavigationProp<MainStackParamList>>();
  // "pool": noch unveraendertes fremdes Rezept, "lokal": schon uebernommene
  // eigene Kopie (z.B. nach dem 409-Fall in handleFork) - genau eine der
  // beiden eingebetteten Ansichten ist aktiv, nie beide gleichzeitig.
  const [auswahl, setAuswahl] = useState<
    { art: 'pool' | 'lokal'; id: string; titel: string } | null
  >(null);
  const [recipes, setRecipes] = useState<PublicRecipeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forkingId, setForkingId] = useState<string | null>(null);
  const [forkFeedback, setForkFeedback] = useState<Record<string, ForkFeedback>>({});
  // Umschalter nur bei MEHREREN aktiven Pools (23.09.2026) - bei genau
  // einem (im Regelfall der Community-Pool) entfaellt die Zeile ganz und
  // genau dieser eine wird durchsucht.
  const [aktivePools, setAktivePools] = useState<{ id: string; name: string; is_community: boolean }[]>([]);
  const [gewaehlterPoolId, setGewaehlterPoolId] = useState('community');

  useEffect(() => {
    api
      .get<{ id: string; name: string; is_community: boolean; active: boolean }[]>('/pools/')
      .then((alle) => setAktivePools(alle.filter((p) => p.active)))
      .catch(() => {});
  }, []);

  const load = React.useCallback(async () => {
    try {
      setRecipes(await api.get<PublicRecipeSummary[]>(`/pool/?pool_id=${encodeURIComponent(gewaehlterPoolId)}`));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError(t('sonstiges.poolBrauchtSync'));
      } else {
        setError(err instanceof ApiError ? err.detail : t('sonstiges.poolNichtGeladen'));
      }
    }
  }, [gewaehlterPoolId]);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
  }, [load]);

  // Neu laden, wenn man zurueckkommt - z.B. nachdem gerade ein eigenes
  // Rezept veroeffentlicht wurde; es soll dann hier auftauchen.
  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load]),
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  // Deckt zwei Faelle ab (Auftrag Punkt 12), beide ohne Dialog:
  //  - noch nicht uebernommen: Uebernahme, Knopf wird "Übernommen ✓" mit
  //    Hinweis auf den Zielordner, bleibt auf der Liste stehen.
  //  - schon uebernommen (already_forked): derselbe Aufruf liefert 409 mit
  //    local_recipe_id - direkt in die eigene Sammlung oeffnen, statt
  //    erneut anzufragen, welche id das eigentlich ist.
  const handleFork = async (recipe: PublicRecipeSummary) => {
    setForkingId(recipe.id);
    try {
      const result = await api.post<{ status: string; local_recipe_id: string; folder_name?: string }>(
        `/pool/${recipe.id}/fork`,
      );
      setForkFeedback((prev) => ({ ...prev, [recipe.id]: { folderName: result.folder_name ?? null } }));
      setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, already_forked: true } : r)));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const localRecipeId = (err.data as { local_recipe_id?: string } | undefined)?.local_recipe_id;
        if (localRecipeId) {
          if (quer) {
            setAuswahl({ art: 'lokal', id: localRecipeId, titel: recipe.title });
          } else {
            navigation.navigate('RecipeDetail', { recipeId: localRecipeId, title: recipe.title });
          }
          return;
        }
      }
      Alert.alert(t('sonstiges.uebernehmenFehlgeschlagen'), err instanceof ApiError ? err.detail : t('profil.unbekannterFehler'));
    } finally {
      setForkingId(null);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg, padding: 24 }]}>
        <MaterialCommunityIcons name="account-group-outline" size={40} color={colors.muted} />
        <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20, marginTop: 12 }}>{error}</Text>
        <ScanFab />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: quer ? 'row' : 'column' }}>
    <View style={{ flex: quer ? undefined : 1, width: quer ? 400 : undefined, borderRightWidth: quer ? 1 : 0, borderRightColor: colors.cardBorder, backgroundColor: colors.bg }}>
      <FlatList
        contentContainerStyle={[{ padding: 18, paddingBottom: 100 }, inhaltsBreiteZweispaltig]}
        data={recipes}
        keyExtractor={(item) => item.id}
        // Nur "hoch" bekommt das 3-spaltige Bild-Raster - "quer" bleibt
        // einspaltig (Liste links, Detail rechts eingebettet).
        key={`spalten-${hoch ? 3 : 1}`}
        numColumns={hoch ? 3 : 1}
        columnWrapperStyle={hoch ? { gap: 9 } : undefined}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        ListHeaderComponent={
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <Text style={[styles.header, { color: colors.text, flex: 1 }]}>{t('sonstiges.gemeinschaftskochbuch')}</Text>
              <Pressable
                onPress={() => navigation.navigate('MyPools')}
                accessibilityRole="button"
                accessibilityLabel={t('sonstiges.poolsVerwalten')}
                style={[styles.poolChip, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
              >
                <MaterialCommunityIcons name="account-multiple-plus" size={15} color="#fff" style={{ marginRight: 5 }} />
                <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>{t('sonstiges.poolsVerwalten')}</Text>
              </Pressable>
            </View>
            <Text style={[styles.headerSub, { color: colors.muted }]}>
              Rezepte, die andere geteilt haben. Übernommene Rezepte landen als eigene Kopie in deiner
              Sammlung – Änderungen daran bleiben bei dir.
            </Text>
            {aktivePools.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, alignItems: 'center' }}
                style={styles.poolUmschalterBar}
              >
                {aktivePools.map((p) => {
                  const aktiv = gewaehlterPoolId === p.id;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setGewaehlterPoolId(p.id)}
                      style={[styles.poolChip, { backgroundColor: aktiv ? gradient[0] : colors.card, borderRadius: radius.sm }]}
                    >
                      <MaterialCommunityIcons
                        name={p.is_community ? 'earth' : 'account-group'}
                        size={13}
                        color={aktiv ? '#fff' : colors.muted}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={{ color: aktiv ? '#fff' : colors.text, fontSize: 12.5, fontWeight: '600' }}>{p.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </>
        }
        ListEmptyComponent={
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 24 }}>
            Hier ist noch nichts. Du kannst den Anfang machen: Bei jedem eigenen Rezept sitzt ein kleines
            Gruppen-Symbol, mit dem du es für alle sichtbar machst.
          </Text>
        }
        renderItem={({ item }) => {
          const oeffnePool = () => {
            if (quer) setAuswahl({ art: 'pool', id: item.id, titel: item.title });
            else navigation.navigate('PoolRecipeDetail', { publicRecipeId: item.id, title: item.title });
          };
          const status = (kompakt: boolean) => {
            if (item.is_own) {
              return (
                <View style={[styles.forkButton, kompakt && styles.statusKompakt, !kompakt && styles.statusBox]}>
                  <Text style={[styles.besitzText, kompakt && { textAlign: 'left' }, { color: colors.muted }]} numberOfLines={2}>{t('sonstiges.vonDir')}</Text>
                </View>
              );
            }
            const feedback = forkFeedback[item.id];
            if (feedback) {
              // Gerade jetzt uebernommen - kein Dialog, der Knopf zeigt
              // direkt den Zielordner (Auftrag Punkt 12).
              return (
                <View style={[styles.forkButton, kompakt && styles.statusKompakt, !kompakt && styles.statusBox]}>
                  <Text style={[styles.besitzText, kompakt && { textAlign: 'left' }, { color: '#16A34A' }]} numberOfLines={2}>
                    {t('sonstiges.uebernommenHaken')}
                  </Text>
                  {feedback.folderName && !kompakt && (
                    <Text style={[styles.folderHintText, kompakt && { textAlign: 'left' }, { color: colors.muted }]} numberOfLines={2}>
                      {feedback.folderName}
                    </Text>
                  )}
                </View>
              );
            }
            if (item.already_forked) {
              return (
                <Pressable
                  onPress={() => handleFork(item)}
                  disabled={forkingId === item.id}
                  style={[styles.forkButton, kompakt && styles.statusKompakt, !kompakt && styles.statusBox]}
                >
                  {forkingId === item.id ? (
                    <ActivityIndicator color={colors.muted} size="small" />
                  ) : (
                    <Text style={[styles.besitzText, kompakt && { textAlign: 'left' }, { color: gradient[0] }]} numberOfLines={2}>
                      {t('sonstiges.inSammlungOeffnen')}
                    </Text>
                  )}
                </Pressable>
              );
            }
            return (
              <Pressable
                onPress={() => handleFork(item)}
                disabled={forkingId === item.id}
                style={[
                  styles.forkButton,
                  kompakt && styles.statusKompakt,
                  !kompakt && styles.statusBox,
                  { backgroundColor: gradient[0], borderRadius: radius.sm },
                ]}
              >
                {forkingId === item.id ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={[styles.forkButtonText, kompakt && { textAlign: 'left' }]} numberOfLines={2}>Übernehmen</Text>
                )}
              </Pressable>
            );
          };

          // hoch: Karte mit grossem Bild oben, Status als schmale Zeile
          // darunter. Sonst (Handy, quer): die bisherige Zeile mit
          // Vorschaubild links, Status rechts in fester Breite.
          if (hoch) {
            return (
              <Pressable
                onPress={oeffnePool}
                style={[styles.karte, { backgroundColor: colors.card, borderRadius: radius.md }]}
              >
                {item.cover_image_url ? (
                  <Image source={{ uri: item.cover_image_url }} style={styles.karteBild} />
                ) : (
                  <View style={[styles.karteBild, styles.thumbEmpty]}>
                    <MaterialCommunityIcons name="silverware-fork-knife" size={22} color={colors.muted} />
                  </View>
                )}
                <View style={{ padding: 10 }}>
                  <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
                  <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
                    {[
                      item.prep_time_minutes ? `${item.prep_time_minutes} Min.` : null,
                      item.servings ? `${item.servings} Port.` : null,
                      `${item.download_count}× übernommen`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {!item.is_own && item.owner_display_name && (
                    <Text style={[styles.ownerHint, { color: colors.muted }]} numberOfLines={1}>
                      {t('rezepte.vonMitglied', { name: item.owner_display_name })}
                    </Text>
                  )}
                  <View style={{ marginTop: 6, alignItems: 'flex-start' }}>{status(true)}</View>
                </View>
              </Pressable>
            );
          }

          return (
            // Antippen oeffnet die Vollansicht. Vorher konnte man ein fremdes
            // Rezept nur blind uebernehmen - was drin ist, sah man erst
            // danach in der eigenen Sammlung.
            <Pressable
              onPress={oeffnePool}
              style={[
                styles.card,
                auswahl?.art === 'pool' && auswahl.id === item.id && quer && { borderColor: gradient[0], borderWidth: 1.5 },
                { backgroundColor: colors.card, borderRadius: radius.md },
              ]}
            >
              {item.cover_image_url ? (
                <Image source={{ uri: item.cover_image_url }} style={[styles.thumb, { borderRadius: radius.sm }]} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty, { borderRadius: radius.sm }]}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={18} color={colors.muted} />
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={2}>{item.title}</Text>
                <Text style={[styles.meta, { color: colors.muted }]} numberOfLines={1}>
                  {[
                    item.prep_time_minutes ? `${item.prep_time_minutes} Min.` : null,
                    item.servings ? `${item.servings} Port.` : null,
                    `${item.download_count}× übernommen`,
                    item.avg_rating ? `★ ${item.avg_rating}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                {!item.is_own && item.owner_display_name && (
                  <Text style={[styles.ownerHint, { color: colors.muted }]} numberOfLines={1}>
                    {t('rezepte.vonMitglied', { name: item.owner_display_name })}
                  </Text>
                )}
              </View>
              {status(false)}
            </Pressable>
          );
        }}
      />
      <ScanFab />
    </View>
    {quer && (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {auswahl?.art === 'pool' ? (
          <PoolRecipeDetailScreen
            navigation={navigation as never}
            route={{ key: `embedded-pool-${auswahl.id}`, name: 'PoolRecipeDetail', params: { publicRecipeId: auswahl.id, title: auswahl.titel } } as never}
            onClose={() => setAuswahl(null)}
            onOpenLocal={(id, titel) => setAuswahl({ art: 'lokal', id, titel })}
          />
        ) : auswahl?.art === 'lokal' ? (
          <RecipeDetailScreen
            navigation={navigation as never}
            route={{ key: `embedded-lokal-${auswahl.id}`, name: 'RecipeDetail', params: { recipeId: auswahl.id, title: auswahl.titel } } as never}
            onClose={() => setAuswahl(null)}
          />
        ) : (
          <View style={styles.leereAuswahl}>
            <MaterialCommunityIcons name="account-group-outline" size={36} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>{t('rezepte.keineAuswahl')}</Text>
          </View>
        )}
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 54, height: 54, marginRight: 12 },
  // Feste Breite fuer die rechte Spalte (Knopf oder Status-Hinweis),
  // flexShrink:0 explizit statt sich nur auf die feste Breite zu
  // verlassen - React Native schrumpft Geschwister in einer Reihe NICHT
  // automatisch wie im Web. textAlign:right, damit ein zweizeiliger
  // Status (z.B. Ordnername) nicht mittig, sondern zur Titel-Spalte hin
  // ausgerichtet steht.
  statusBox: { width: 92, flexShrink: 0, alignItems: 'center', justifyContent: 'center' },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(128,128,128,0.15)' },
  header: { fontSize: 19, fontWeight: '700', marginBottom: 4 },
  headerSub: { fontSize: 11.5, lineHeight: 17, marginBottom: 16 },
  poolUmschalterBar: { height: 42, marginBottom: 14, flexGrow: 0, flexShrink: 0 },
  poolChip: { flexDirection: 'row', alignItems: 'center', height: 34, paddingHorizontal: 12, justifyContent: 'center' },
  // alignItems:'flex-start' statt 'center': bei einem zweizeiligen Titel
  // sollen Thumbnail und Status-Spalte oben ausgerichtet bleiben, statt
  // sich an der Zeilenmitte zu orientieren.
  card: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, marginBottom: 9 },
  // Portrait-Raster (hoch, 3 Spalten): Karte mit grossem Bild oben,
  // Status als schmale Zeile darunter statt der breiten Spalte rechts.
  karte: { flex: 1, overflow: 'hidden', marginBottom: 9 },
  karteBild: { width: '100%', aspectRatio: 1.3 },
  statusKompakt: { paddingHorizontal: 10, paddingVertical: 5 },
  leereAuswahl: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  title: { fontSize: 14, fontWeight: '700', flex: 1, minWidth: 0 },
  meta: { fontSize: 10.5, marginTop: 3 },
  ownerHint: { fontSize: 10, marginTop: 2 },
  forkButton: { paddingHorizontal: 14, paddingVertical: 9 },
  forkButtonText: { color: '#fff', fontWeight: '700', fontSize: 11.5, textAlign: 'right' },
  besitzText: { fontSize: 11, fontWeight: '600', textAlign: 'right' },
  folderHintText: { fontSize: 10, marginTop: 2, textAlign: 'right' },
});
