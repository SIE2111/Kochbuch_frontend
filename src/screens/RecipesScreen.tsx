import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Image,
  ScrollView,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import ScanFab from '../components/ScanFab';
import { api, ApiError } from '../api/client';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList, MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';
import RecipeDetailScreen from './RecipeDetailScreen';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Rezepte'>,
  NativeStackScreenProps<MainStackParamList>
>;

interface RecipeSummary {
  id: string;
  title: string;
  tags: string[] | null;
  updated_at: string;
  created_at: string;
  cover_image_url: string | null;
  folder_id: string | null;
  source_type: string;
  is_favorite: boolean;
  is_modified: boolean;
  // Nur gesetzt, wenn das Rezept einem ANDEREN Haushaltsmitglied gehört.
  owner_display_name: string | null;
}

// Zustand des Schalters "Nur meine Rezepte" bleibt ueber App-Starts hinweg
// erhalten, bis er umgestellt wird (siehe Auftrag Punkt 5) - anders als
// favoritesOnly/sortOption, die bewusst bei jedem Start zuruecksetzen.
const ONLY_MINE_KEY = 'rezepte_nur_meine';

const SOURCE_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  manual: 'pencil-outline',
  web_import: 'web',
  ai_generated: 'robot-outline',
  photo_scan: 'camera-outline',
  starter_pack: 'star-outline',
  pool_fork: 'account-group-outline',
};

interface FolderSummary {
  id: string;
  name: string;
  parent_folder_id: string | null;
  icon: string | null;
  recipe_count: number;
}

export default function RecipesScreen({ navigation, route }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { istTablet, quer, hoch, inhaltsBreiteZweispaltig } = useLayout();
  const { t } = useUebersetzung();
  // iPad quer: eingebettetes Detail statt Vollbild-Navigation (siehe
  // RecipeDetailScreen "onClose"). Bei Verlassen des Querformats oder
  // Tabs bleibt die Auswahl bestehen, wird aber ohnehin nicht mehr
  // gerendert, solange quer nicht (mehr) zutrifft.
  const [ausgewaehlteId, setAusgewaehlteId] = useState<string | null>(null);
  const [ausgewaehlterTitel, setAusgewaehlterTitel] = useState('');
  const oeffneRezept = (id: string, title: string) => {
    if (quer) {
      setAusgewaehlteId(id);
      setAusgewaehlterTitel(title);
    } else {
      navigation.navigate('RecipeDetail', { recipeId: id, title });
    }
  };
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);

  const toggleFavorit = async (id: string) => {
    const vorher = recipes.find((r) => r.id === id);
    if (!vorher) return;
    const neu = !vorher.is_favorite;
    setRecipes((liste) => liste.map((r) => (r.id === id ? { ...r, is_favorite: neu } : r)));
    try {
      await api.patch(`/recipes/${id}`, { is_favorite: neu });
    } catch (err) {
      setRecipes((liste) => liste.map((r) => (r.id === id ? { ...r, is_favorite: !neu } : r)));
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('rezepte.nichtGeladen'));
    }
  };
  const [folders, setFolders] = useState<FolderSummary[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [sortOption, setSortOption] = useState<'newest' | 'oldest' | 'az'>('newest');

  useEffect(() => {
    AsyncStorage.getItem(ONLY_MINE_KEY)
      .then((raw) => setOnlyMine(raw === '1'))
      .catch(() => {});
  }, []);

  const handleToggleOnlyMine = () => {
    setOnlyMine((prev) => {
      const next = !prev;
      AsyncStorage.setItem(ONLY_MINE_KEY, next ? '1' : '0').catch(() => {});
      return next;
    });
  };
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [searchText, setSearchText] = useState('');

  // Optionaler Tag-Filter, den das Dashboard beim Antippen einer Kategorie
  // mitgibt (siehe DashboardScreen) - rein clientseitig gefiltert, da das
  // Backend aktuell keinen eigenen Tag-Filter-Parameter anbietet.
  const filterTag = route.params?.filterTag;

  // Kommt vom Dashboard mit favoritesOnly=true an (Lieblingsgerichte-Kachel) -
  // uebernimmt das als Startzustand, bleibt danach aber normal ueber den
  // Chip lokal umschaltbar.
  useEffect(() => {
    if (route.params?.favoritesOnly) {
      setFavoritesOnly(true);
    }
  }, [route.params?.favoritesOnly]);

  const loadAll = useCallback(async () => {
    try {
      const recipesUrl = searchText.trim()
        ? `/recipes/?q=${encodeURIComponent(searchText.trim())}`
        : '/recipes/';
      const [recipeData, folderData] = await Promise.all([
        api.get<RecipeSummary[]>(recipesUrl),
        api.get<FolderSummary[]>('/folders/'),
      ]);
      setRecipes(recipeData);
      setFolders(folderData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t('rezepte.nichtGeladen'));
    }
  }, [searchText]);

  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      loadAll().finally(() => setIsLoading(false));
      return;
    }
    // Nur Suchänderungen entprellen - der Erstaufruf oben laeuft sofort
    const timer = setTimeout(() => {
      loadAll();
    }, 350);
    return () => clearTimeout(timer);
  }, [loadAll]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => loadAll());
    return unsubscribe;
  }, [navigation, loadAll]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await loadAll();
    setIsRefreshing(false);
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setIsSavingFolder(true);
    try {
      await api.post('/folders/', { name });
      setNewFolderName('');
      setIsCreatingFolder(false);
      await loadAll();
    } catch (err) {
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('rezepte.ordnerNichtAngelegt'));
    } finally {
      setIsSavingFolder(false);
    }
  };

  // Erst Ordner/Favoriten/"Meine" anwenden, DANN erst den Kategorie-Filter: Die Kategorie-Chips
  // zeigen nur Kategorien, die in dieser Auswahl auch Rezepte haben. Vorher standen auch Kategorien
  // da, die unter dem (gemerkten) Filter "Meine" leer waren - z.B. "Vegetarisch", dessen Rezepte
  // meist aus den Starter-Paketen stammen: Antippen = leere Liste.
  let scoped = selectedFolderId ? recipes.filter((r) => r.folder_id === selectedFolderId) : recipes;
  if (favoritesOnly) {
    scoped = scoped.filter((r) => r.is_favorite);
  }
  if (onlyMine) {
    // Eigene Rezepte, aber ohne unveraenderte Starter-Pack-Importe -
    // fremde Haushalts-Rezepte (owner_display_name gesetzt) sind ohnehin
    // nie "meine" (siehe Auftrag Punkt 5).
    scoped = scoped.filter(
      (r) => !r.owner_display_name && !(r.source_type === 'starter_pack' && !r.is_modified),
    );
  }
  let visibleRecipes = filterTag ? scoped.filter((r) => r.tags?.includes(filterTag)) : scoped;

  // Fuer die Kategorie-Auswahl direkt hier auf dem Screen. Die gerade gewaehlte Kategorie bleibt
  // immer sichtbar (zum Abwaehlen), auch wenn sie in der Auswahl leer ist.
  const availableCategories = Array.from(new Set([
    ...scoped.flatMap((r) => r.tags ?? []),
    ...(filterTag ? [filterTag] : []),
  ])).sort((a, b) => a.localeCompare(b, 'de'));
  visibleRecipes = [...visibleRecipes].sort((a, b) => {
    if (sortOption === 'az') return a.title.localeCompare(b.title, 'de');
    // Starter-Rezepte stehen bei der Datumssortierung immer hinten. Ein
    // Starter-Import legt ueber hundert Rezepte in derselben Sekunde an und
    // schiebt sich damit als Block vor alles, was der Nutzer selbst erfasst
    // hat - sein eben fotografiertes Rezept landet dann mitten in der Liste.
    // Bei A-Z bleibt es bei reiner Alphabetsortierung.
    const aStarter = a.source_type === 'starter_pack';
    const bStarter = b.source_type === 'starter_pack';
    if (aStarter !== bStarter) return aStarter ? 1 : -1;
    const diff = +new Date(b.created_at) - +new Date(a.created_at);
    return sortOption === 'newest' ? diff : -diff;
  });

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  return (
    // "quer": Liste links in fester Breite, Detail rechts eingebettet.
    // Sonst (Handy, iPad hoch) bleibt es bei der einen, vollen Spalte -
    // "container" behaelt dafuer sein flex:1 und wird nicht extra breit.
    <View style={{ flex: 1, flexDirection: quer ? 'row' : 'column' }}>
    <View
      style={[
        styles.container,
        { backgroundColor: colors.bg },
        quer && { flex: undefined, width: 400, borderRightWidth: 1, borderRightColor: colors.cardBorder },
      ]}
    >
      <View style={[styles.searchBar, { backgroundColor: colors.card, borderRadius: radius.md }]}>
        <MaterialCommunityIcons name="magnify" size={17} color={colors.muted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder={t('rezepte.suchen')}
          placeholderTextColor={colors.muted}
          value={searchText}
          onChangeText={setSearchText}
          autoCapitalize="none"
        />
        {searchText.length > 0 && (
          <Pressable onPress={() => setSearchText('')} hitSlop={8}>
            <MaterialCommunityIcons name="close-circle" size={16} color={colors.muted} />
          </Pressable>
        )}
      </View>

      {error && <Text style={[styles.errorText, { color: '#DC2626' }]}>{error}</Text>}

      {filterTag && (
        <Pressable
          onPress={() => navigation.setParams({ filterTag: undefined })}
          style={[styles.filterPill, { backgroundColor: gradient[0], borderRadius: radius.sm }]}
        >
          <Text style={styles.filterPillText}>{filterTag} ✕</Text>
        </Pressable>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, marginBottom: 12 }} contentContainerStyle={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => setFavoritesOnly((prev) => !prev)}
          style={[
            styles.favoritesChip,
            { backgroundColor: favoritesOnly ? gradient[0] : colors.card, borderRadius: radius.sm, marginBottom: 0 },
          ]}
        >
          <MaterialCommunityIcons name={favoritesOnly ? 'heart' : 'heart-outline'} size={14} color={favoritesOnly ? '#fff' : colors.text} />
          <Text style={{ color: favoritesOnly ? '#fff' : colors.text, fontSize: 12, fontWeight: '600', marginLeft: 5 }}>
            {t('rezepte.nurFavoriten')}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleToggleOnlyMine}
          style={[
            styles.favoritesChip,
            { backgroundColor: onlyMine ? gradient[0] : colors.card, borderRadius: radius.sm, marginBottom: 0 },
          ]}
        >
          <MaterialCommunityIcons name={onlyMine ? 'account-check' : 'account-check-outline'} size={14} color={onlyMine ? '#fff' : colors.text} />
          <Text style={{ color: onlyMine ? '#fff' : colors.text, fontSize: 12, fontWeight: '600', marginLeft: 5 }}>
            {t('rezepte.nurMeineRezepte')}
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            setSortOption((prev) => (prev === 'newest' ? 'oldest' : prev === 'oldest' ? 'az' : 'newest'))
          }
          style={[styles.favoritesChip, { backgroundColor: colors.card, borderRadius: radius.sm, marginBottom: 0 }]}
        >
          <MaterialCommunityIcons
            name={sortOption === 'az' ? 'sort-alphabetical-variant' : sortOption === 'newest' ? 'sort-clock-descending-outline' : 'sort-clock-ascending-outline'}
            size={14}
            color={colors.text}
          />
          <Text style={{ color: colors.text, fontSize: 12, fontWeight: '600', marginLeft: 5 }}>
            {sortOption === 'az' ? t('rezepte.az') : sortOption === 'newest' ? t('rezepte.neuesteZuerst') : t('rezepte.aeltesteZuerst')}
          </Text>
        </Pressable>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderBar} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
        <Pressable
          onPress={() => setSelectedFolderId(null)}
          style={[
            styles.folderChip,
            { backgroundColor: selectedFolderId === null ? gradient[0] : colors.card, borderRadius: radius.sm },
          ]}
        >
          <Text allowFontScaling={false} style={[styles.folderChipText, { color: selectedFolderId === null ? '#fff' : colors.text }]}>
            Alle ({recipes.length})
          </Text>
        </Pressable>
        {folders.map((folder) => {
          const isSelected = selectedFolderId === folder.id;
          return (
            <Pressable
              key={folder.id}
              onPress={() => setSelectedFolderId(isSelected ? null : folder.id)}
              onLongPress={() => {
                Alert.alert(
                  'Ordner löschen?',
                  `"${folder.name}" wird entfernt. Die ${folder.recipe_count} Rezepte darin bleiben erhalten, landen aber ohne Ordner.`,
                  [
                    { text: t('allgemein.abbrechen'), style: 'cancel' },
                    {
                      text: t('allgemein.loeschen'),
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await api.delete(`/folders/${folder.id}`);
                          if (selectedFolderId === folder.id) setSelectedFolderId(null);
                          loadAll();
                        } catch (err) {
                          Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('rezepte.ordnerNichtGeloescht'));
                        }
                      },
                    },
                  ],
                );
              }}
              style={[styles.folderChip, { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm }]}
            >
              <Text allowFontScaling={false} style={[styles.folderChipText, { color: isSelected ? '#fff' : colors.text }]}>
                {folder.name} ({folder.recipe_count})
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setIsCreatingFolder(true)}
          style={[styles.folderChip, styles.newFolderChip, { borderColor: colors.muted, borderRadius: radius.sm }]}
        >
          <MaterialCommunityIcons name="plus" size={15} color={colors.muted} />
        </Pressable>
      </ScrollView>

      {availableCategories.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryBar}
          contentContainerStyle={{ gap: 8, alignItems: 'center' }}
        >
          {availableCategories.map((cat) => {
            const isSelected = filterTag === cat;
            return (
              <Pressable
                key={cat}
                onPress={() => navigation.setParams({ filterTag: isSelected ? undefined : cat })}
                style={[styles.folderChip, { backgroundColor: isSelected ? gradient[0] : colors.card, borderRadius: radius.sm }]}
              >
                <Text allowFontScaling={false} style={[styles.folderChipText, { color: isSelected ? '#fff' : colors.text }]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <FlatList
        data={visibleRecipes}
        keyExtractor={(item) => item.id}
        // key MUSS sich mit der Spaltenzahl aendern: React Native lehnt es
        // ab, numColumns an einer bestehenden Liste zu aendern, und wirft
        // beim Drehen des Tablets sonst einen Fehler. Nur "hoch" bekommt
        // das 3-spaltige Raster - "quer" bleibt einspaltig, weil dort die
        // Liste nur die linke Haelfte einnimmt (Detail rechts daneben).
        key={`spalten-${hoch ? 3 : 1}`}
        numColumns={hoch ? 3 : 1}
        columnWrapperStyle={hoch ? { gap: 9 } : undefined}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
        // Nimmt den restlichen Platz auf, damit er nicht an die
        // Filterleisten darueber verteilt wird (siehe styles.folderBar).
        style={{ flex: 1 }}
        contentContainerStyle={[{ paddingBottom: 100 }, inhaltsBreiteZweispaltig]}
        ListEmptyComponent={
          !error ? (
            <Text style={[styles.emptyText, { color: colors.muted }]}>
              {searchText.trim()
                ? t('rezepte.keineTreffer', { suche: searchText.trim() })
                : filterTag
                  ? t('rezepte.keineMitTag', { tag: filterTag })
                  : favoritesOnly
                    ? t('rezepte.keineFavoriten')
                    : onlyMine
                      ? t('rezepte.keineEigenen')
                      : selectedFolderId
                        ? t('rezepte.ordnerLeer')
                        : t('rezepte.nochKeine')}
            </Text>
          ) : null
        }
        renderItem={({ item }) =>
          hoch ? (
            <Pressable
              onPress={() => oeffneRezept(item.id, item.title)}
              style={[styles.recipeKarte, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder }]}
            >
              <View>
                {item.cover_image_url ? (
                  <Image source={{ uri: item.cover_image_url }} style={styles.karteBild} />
                ) : (
                  <View style={[styles.karteBild, styles.karteBildPlatzhalter, { backgroundColor: colors.bg }]}>
                    <MaterialCommunityIcons name="silverware-fork-knife" size={22} color={colors.muted} />
                  </View>
                )}
                <Pressable
                  onPress={() => toggleFavorit(item.id)}
                  hitSlop={10}
                  style={[styles.karteHerz, { backgroundColor: colors.bg }]}
                >
                  <MaterialCommunityIcons
                    name={item.is_favorite ? 'heart' : 'heart-outline'}
                    size={16}
                    color={item.is_favorite ? gradient[0] : colors.muted}
                  />
                </Pressable>
              </View>
              <View style={{ padding: 10 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                  <Text style={[styles.recipeTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                  <MaterialCommunityIcons name={SOURCE_ICONS[item.source_type] ?? 'file-outline'} size={12} color={colors.muted} />
                </View>
                {item.tags && item.tags.length > 0 && (
                  <Text style={[styles.recipeTags, { color: colors.muted }]} numberOfLines={1}>{item.tags.join(' · ')}</Text>
                )}
              </View>
            </Pressable>
          ) : (
          <Pressable
            onPress={() => oeffneRezept(item.id, item.title)}
            style={[
              styles.recipeRow,
              ausgewaehlteId === item.id && quer && { borderColor: gradient[0], borderWidth: 1.5 },
              { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder },
            ]}
          >
            {item.cover_image_url ? (
              <Image source={{ uri: item.cover_image_url }} style={[styles.thumbnail, { borderRadius: radius.sm }]} />
            ) : (
              <View style={[styles.thumbnailPlaceholder, { borderRadius: radius.sm, backgroundColor: colors.bg }]} />
            )}
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <Text style={[styles.recipeTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                <MaterialCommunityIcons
                  name={SOURCE_ICONS[item.source_type] ?? 'file-outline'}
                  size={12}
                  color={colors.muted}
                />
              </View>
              {item.tags && item.tags.length > 0 && (
                <Text style={[styles.recipeTags, { color: colors.muted }]}>{item.tags.join(' · ')}</Text>
              )}
              {item.owner_display_name && (
                <Text style={[styles.ownerHint, { color: colors.muted }]} numberOfLines={1}>
                  {t('rezepte.vonMitglied', { name: item.owner_display_name })}
                </Text>
              )}
            </View>
            {/* Rechts das Herz: Favorit direkt aus der Liste setzen. Hier
                stand das Pool-Symbol - beim Durchblättern ist aber viel
                haeufiger gefragt, ob man ein Rezept wieder kochen will, als
                ob man es veroeffentlicht. Das geht weiter in der Rezeptansicht. */}
            <Pressable
              onPress={() => toggleFavorit(item.id)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('dashboard.favoriten')}
              style={{ paddingHorizontal: 4 }}
            >
              <MaterialCommunityIcons
                name={item.is_favorite ? 'heart' : 'heart-outline'}
                size={20}
                color={item.is_favorite ? gradient[0] : colors.muted}
              />
            </Pressable>
          </Pressable>
          )
        }
      />

      <ScanFab />

      <Modal visible={isCreatingFolder} transparent animationType="fade" onRequestClose={() => setIsCreatingFolder(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.bg, borderRadius: radius.lg }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('rezepte.neuerOrdner')}</Text>
            <TextInput
              style={[styles.modalInput, { backgroundColor: colors.card, color: colors.text, borderRadius: radius.md }]}
              placeholder={t('rezepte.ordnerPlatzhalter')}
              placeholderTextColor={colors.muted}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              onSubmitEditing={handleCreateFolder}
            />
            <View style={styles.modalButtonRow}>
              <Pressable onPress={() => { setIsCreatingFolder(false); setNewFolderName(''); }} style={styles.modalCancelButton}>
                <Text style={[styles.modalCancelText, { color: colors.muted }]}>{t('allgemein.abbrechen')}</Text>
              </Pressable>
              <Pressable
                onPress={handleCreateFolder}
                disabled={isSavingFolder || !newFolderName.trim()}
                style={[styles.modalSaveButton, { backgroundColor: gradient[0], borderRadius: radius.sm, opacity: isSavingFolder ? 0.7 : 1 }]}
              >
                {isSavingFolder ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.modalSaveText}>{t('sonstiges.anlegen')}</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    {quer && (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        {ausgewaehlteId ? (
          <RecipeDetailScreen
            // Dieselbe echte navigation wie oben - "Bearbeiten"/"Kochen"
            // aus der eingebetteten Ansicht sollen weiterhin richtig
            // ueber den Stack (Vollbild) oeffnen. Nur route ist ein
            // minimales, selbst gebautes Objekt: RecipeDetailScreen liest
            // ausschliesslich route.params.recipeId, kein Bezug zu einer
            // echten Navigationsposition noetig.
            navigation={navigation as never}
            route={{ key: `embedded-${ausgewaehlteId}`, name: 'RecipeDetail', params: { recipeId: ausgewaehlteId, title: ausgewaehlterTitel } } as never}
            onClose={() => setAusgewaehlteId(null)}
          />
        ) : (
          <View style={styles.leereAuswahl}>
            <MaterialCommunityIcons name="silverware-fork-knife" size={36} color={colors.muted} />
            <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10 }}>{t('rezepte.keineAuswahl')}</Text>
          </View>
        )}
      </View>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 26 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 42, marginBottom: 12, flexGrow: 0, flexShrink: 0 },
  searchInput: { flex: 1, fontSize: 13.5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 12, marginBottom: 12 },
  filterPill: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, marginBottom: 12 },
  filterPillText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  // flexGrow/flexShrink 0 ist hier das Entscheidende, nicht die Hoehe:
  // Der Bildschirm ist eine Flex-Spalte (container: flex 1). Bleibt unten
  // Platz frei - also genau dann, wenn WENIGE Rezepte gefunden wurden -,
  // verteilt Flexbox diesen Rest auf alle Kinder, die wachsen duerfen.
  // Eine horizontale ScrollView darf das standardmaessig, und 'height'
  // wirkt dabei nur als Ausgangsgroesse, nicht als Obergrenze. Ergebnis
  // war die auseinandergezogene Filterleiste bei wenig Ergebnissen.
  // Jetzt bleiben die Leisten fest und die FlatList nimmt den Rest.
  folderBar: { height: 60, marginBottom: 14, flexGrow: 0, flexShrink: 0 },
  categoryBar: { height: 60, marginBottom: 14, flexGrow: 0, flexShrink: 0 },
  favoritesChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, marginBottom: 12 },
  folderChip: { height: 38, paddingHorizontal: 13, justifyContent: 'center', alignItems: 'center' },
  folderChipText: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  newFolderChip: { borderWidth: 1.3, paddingHorizontal: 10 },
  emptyText: { fontSize: 13, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  recipeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, marginBottom: 9 },
  // In der zweispaltigen Ansicht teilen sich die Karten die Zeile.
  // Portrait-Raster (hoch, 3 Spalten): Karte mit grossem Bild oben statt
  // der schmalen Zeile - bei drei nebeneinander waere eine Zeile mit
  // 46x46-Vorschaubild kaum noch als Bild erkennbar.
  recipeKarte: { flex: 1, overflow: 'hidden', marginBottom: 9 },
  karteBild: { width: '100%', aspectRatio: 1.3 },
  karteBildPlatzhalter: { alignItems: 'center', justifyContent: 'center' },
  karteHerz: { position: 'absolute', top: 6, right: 6, padding: 5, borderRadius: 14 },
  leereAuswahl: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  thumbnail: { width: 46, height: 46 },
  thumbnailPlaceholder: { width: 46, height: 46 },
  recipeTitle: { fontSize: 14, fontWeight: '700', flexShrink: 1 },
  recipeTags: { fontSize: 11, marginTop: 3 },
  ownerHint: { fontSize: 10, marginTop: 2, fontStyle: 'italic' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 30 },
  modalCard: { padding: 20 },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 14 },
  modalInput: { height: 44, paddingHorizontal: 14, fontSize: 13.5, marginBottom: 16 },
  modalButtonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  modalCancelButton: { paddingVertical: 8, paddingHorizontal: 4 },
  modalCancelText: { fontSize: 13, fontWeight: '600' },
  modalSaveButton: { paddingHorizontal: 18, paddingVertical: 10, minWidth: 80, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
