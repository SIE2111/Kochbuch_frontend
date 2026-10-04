import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, RefreshControl, Image, Alert } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useTheme } from '../theme/ThemeContext';
import { useUebersetzung } from '../i18n';
import ScanFab from '../components/ScanFab';
import IncomingSharesCard from '../components/IncomingSharesCard';
import BrutzelGreetingOverlay from '../components/BrutzelGreetingOverlay';
import BrutzelFaqBubble from '../components/BrutzelFaqBubble';
import { useAuth } from '../context/AuthContext';
import { api, ApiError } from '../api/client';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { MainTabParamList, MainStackParamList } from '../navigation/AppNavigator';
import { useLayout } from '../utils/layout';
import KochplanKarte from '../components/KochplanKarte';
import { TippBlase } from '../components/TippBlase';
import { TIPPS } from '../utils/tippListe';
import BrutzelAvatar from '../components/BrutzelAvatar';

type Props = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, 'Home'>,
  NativeStackScreenProps<MainStackParamList>
>;

interface RecipeSummary {
  id: string;
  title: string;
  folder_id: string | null;
  tags: string[] | null;
  prep_time_minutes: number | null;
  servings: number | null;
  cover_image_url: string | null;
  created_at: string;
  last_cooked_at: string | null;
  is_favorite?: boolean;
}


// Modul-weites Flag statt Component-State - die Begruessung soll nur EINMAL
// pro App-Start erscheinen, nicht bei jedem Zurueckwechseln zum Dashboard-
// Tab (das wuerde staendig neu ausgeloest werden, wenn es Teil des
// Komponenten-States waere, der bei jedem Mount/Unmount zurueckgesetzt wird).
let hasShownGreetingThisSession = false;

export default function DashboardScreen({ navigation }: Props) {
  const { colors, gradient, radius } = useTheme();
  const { istTablet, inhaltsBreite, inhaltsBreiteZweispaltig } = useLayout();
  const { t } = useUebersetzung();
  const { session } = useAuth();
  const [recipes, setRecipes] = useState<RecipeSummary[]>([]);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [stats, setStats] = useState<{ total_recipes: number; cooked_this_week: number; cooked_total: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  const [brutzelTipps, setBrutzelTipps] = useState(false);   // erst nach dem Laden der Einstellungen
  const [showGreeting, setShowGreeting] = useState(false);
  const [greetingMitVideo, setGreetingMitVideo] = useState(true);
  // "Schritte automatisch vorlesen" - steuert, ob die Begruessung
  // gesprochen wird (Auftrag Punkt 3), unabhaengig von der Animation.
  const [greetingSprechen, setGreetingSprechen] = useState(false);
  const [greetingMitMusik, setGreetingMitMusik] = useState(true);
  // Kategorien-Reihenfolge/Ausblendungen aus dem Profil (siehe
  // ManageCategoriesScreen). null = noch nicht geladen, dann greift
  // vorlaeufig die reine Haeufigkeitssortierung, bis die Antwort da ist -
  // sonst wuerde die Zeile kurz aufblitzen und dann springen.
  const [categoryOrder, setCategoryOrder] = useState<string[] | null>(null);
  const [hiddenCategories, setHiddenCategories] = useState<string[]>([]);

  // Derselbe Name wie im Profil editierbar (tbl_users.display_name ueber
  // /preferences/) - vorher las die Begruessung stattdessen aus den
  // Supabase-Auth-user_metadata, einer komplett getrennten Ablage, die
  // eine Aenderung im Profil nie mitbekam.
  const loadDisplayName = useCallback(() => {
    api
      .get<{
        display_name: string | null; show_greeting_animation: boolean; show_brutzel: boolean;
        category_order: string[] | null; hidden_categories: string[] | null; auto_read_steps: boolean;
        play_animation_music: boolean;
      }>('/preferences/')
      .then((prefs) => {
        setProfileDisplayName(prefs.display_name);
        setBrutzelTipps(prefs.show_brutzel !== false);
        setCategoryOrder(prefs.category_order ?? []);
        setHiddenCategories(prefs.hidden_categories ?? []);
        // Auch show_brutzel pruefen: Wer Brutzel ganz abgeschaltet hat,
        // soll ihn nicht ausgerechnet beim Oeffnen der App ueber den
        // Bildschirm laufen sehen.
        // Nur noch show_brutzel entscheidet, OB die Begruessung kommt.
        // show_greeting_animation entscheidet, ob sie sich bewegt,
        // auto_read_steps ob sie gesprochen wird (Auftrag Punkt 3) -
        // vorher schaltete show_greeting_animation den ganzen Bildschirm ab.
        if (prefs.show_brutzel && !hasShownGreetingThisSession) {
          hasShownGreetingThisSession = true;
          setGreetingMitVideo(prefs.show_greeting_animation);
          setGreetingSprechen(prefs.auto_read_steps);
          setGreetingMitMusik(prefs.play_animation_music);
          setShowGreeting(true);
        }
      })
      .catch(() => {
        // Faellt unten einfach auf E-Mail/"da" zurueck, wenn das Laden scheitert
      });
  }, []);

  const displayName = profileDisplayName || session?.user.email?.split('@')[0] || 'da';

  const load = useCallback(async () => {
    try {
      const [recipeData, folderData] = await Promise.all([
        api.get<RecipeSummary[]>('/recipes/'),
        // Ordnernamen, nicht nur die Anzahl: Sie entscheiden, welche
        // Rezepte als Hauptspeise fuer das Rezept des Tages in Frage
        // kommen (siehe mainCourseCandidates).
        api.get<{ id: string; name: string }[]>('/folders/'),
      ]);
      // Eigener Aufruf statt aus der Rezeptliste gerechnet: Wie oft
      // gekocht wurde, steht im Kochprotokoll und nicht am Rezept - ein
      // dreimal gekochtes Rezept ist ein Rezept, aber drei Kochvorgaenge.
      api.get<{ total_recipes: number; cooked_this_week: number; cooked_total: number }>('/recipes/stats')
        .then(setStats)
        .catch(() => {
          // Zahlen sind Beiwerk - faellt der Aufruf aus, bleibt die Zeile
          // eben leer statt das ganze Dashboard scheitern zu lassen.
        });
      setRecipes(recipeData);
      setFolders(folderData);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : t('dashboard.nichtGeladen'));
    }
  }, []);

  useEffect(() => {
    load().finally(() => setIsLoading(false));
    loadDisplayName();
  }, [load, loadDisplayName]);

  // Bei Rueckkehr von einem anderen Screen (z.B. nach einer Namensaenderung
  // im Profil oder dem Anlegen eines neuen Rezepts) neu laden, damit
  // Begruessung/Zahlen/Listen aktuell bleiben.
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      load();
      loadDisplayName();
    });
    return unsubscribe;
  }, [navigation, load, loadDisplayName]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  };

  // "Rezept des Tages" - deterministisch nach Kalendertag, damit es sich
  // nicht bei jedem App-Start aendert, aber trotzdem taeglich wechselt.
  // Rezept des Tages: NUR Hauptspeisen. Vorher wurde aus allen Rezepten
  // gewaehlt, weshalb hier auch schon mal ein Kaiserschmarrn, eine Suppe
  // oder ein Cocktail als Vorschlag fuers Abendessen stand.
  //
  // Die Zuordnung laeuft ueber den ORDNER, nicht ueber die Kategorien:
  // Ein Kaiserschmarrn traegt oft nur "Klassiker", liegt aber in
  // "Backen & Desserts". Umbenannte oder eigene Ordner faengt der
  // zweistufige Rueckfall ab.
  const mainCourseCandidates = useMemo(() => {
    const folderName = (id: string | null) =>
      (folders.find((f) => f.id === id)?.name ?? '').toLowerCase();

    const primary = recipes.filter((r) => folderName(r.folder_id).includes('hauptgericht'));
    if (primary.length > 0) return primary;

    // Kein Ordner heisst "Hauptgerichte" (umbenannt oder eigene Struktur):
    // dann wenigstens alles ausschliessen, was sicher keine Hauptspeise ist.
    const notMain = ['dessert', 'backen', 'getränk', 'getraenk', 'vorspeise', 'suppe', 'beilage'];
    const fallback = recipes.filter((r) => {
      const name = folderName(r.folder_id);
      return name === '' ? false : !notMain.some((n) => name.includes(n));
    });
    return fallback.length > 0 ? fallback : recipes;
  }, [recipes, folders]);

  const recipeOfTheDay = useMemo(() => {
    if (mainCourseCandidates.length === 0) return null;
    const dayOfYear = Math.floor(
      (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / (24 * 60 * 60 * 1000),
    );
    return mainCourseCandidates[dayOfYear % mainCourseCandidates.length];
  }, [mainCourseCandidates]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    recipes.forEach((r) => (r.tags ?? []).forEach((t) => counts.set(t, (counts.get(t) ?? 0) + 1)));

    const versteckt = new Set(hiddenCategories);
    // Erst die Tags, fuer die der Nutzer eine Reihenfolge festgelegt hat
    // (siehe ManageCategoriesScreen), in genau dieser Reihenfolge - nur
    // wenn sie ueberhaupt noch vorkommen und nicht ausgeblendet sind.
    const eingeordnet = new Set(categoryOrder ?? []);
    const feste_reihenfolge = (categoryOrder ?? []).filter((tag) => counts.has(tag) && !versteckt.has(tag));

    // Alles Uebrige, das (noch) keine feste Position hat: nach Haeufigkeit
    // sortiert, haeufigste Kategorie zuerst (22.09.2026, ersetzt eine rein
    // alphabetische Sortierung). Bei einem frisch registrierten Nutzer ist
    // categoryOrder noch leer, er sieht also gleich diese Reihenfolge: die
    // nuetzlichsten Filter ("Vegetarisch", "Schnell", ...) zuerst, seltene
    // wie "Weihnachten" (oft nur 1 Rezept) weiter hinten - vorher standen
    // beide rein alphabetisch nebeneinander, ohne Bezug zur tatsaechlichen
    // Nuetzlichkeit. Bei gleicher Haeufigkeit alphabetisch, fuer eine
    // stabile Reihenfolge.
    const restKandidaten = Array.from(counts.keys()).filter((tag) => !eingeordnet.has(tag) && !versteckt.has(tag));
    const nachHaeufigkeit = restKandidaten.sort((a, b) => {
      const diff = (counts.get(b) ?? 0) - (counts.get(a) ?? 0);
      return diff !== 0 ? diff : a.localeCompare(b, 'de');
    });

    return [...feste_reihenfolge, ...nachHaeufigkeit];
  }, [recipes, categoryOrder, hiddenCategories]);

  // Eine Kategorie per Fingerdruck-halten ausblenden - reversibel, siehe
  // ManageCategoriesScreen zum Zuruecksetzen. Optimistisch im lokalen
  // State, damit der Chip sofort verschwindet statt erst nach der
  // Serverantwort.
  const handleHideCategory = useCallback((tag: string) => {
    Alert.alert(
      t('dashboard.kategorieAusblendenFrage'),
      t('dashboard.kategorieAusblendenText', { kategorie: tag }),
      [
        { text: t('allgemein.abbrechen'), style: 'cancel' },
        {
          text: t('dashboard.ausblenden'),
          onPress: () => {
            setHiddenCategories((vorher) => {
              const neu = vorher.includes(tag) ? vorher : [...vorher, tag];
              api.patch('/preferences/', { hidden_categories: neu }).catch(() => {
                // Naechster Fokuswechsel laedt den echten Stand nach -
                // kein Alarm noetig fuer ein rein kosmetisches Ausblenden.
              });
              return neu;
            });
          },
        },
      ],
    );
  }, [t]);

  // Favorit direkt aus "Zuletzt zubereitet" setzen - frueher sass hier das
  // Pool-Symbol. Wer etwas gerade gekocht hat, entscheidet eher, ob er es
  // wieder kochen will, als ob es die Welt sehen soll.
  const toggleFavorit = async (id: string) => {
    const vorher = recipes.find((r) => r.id === id);
    if (!vorher) return;
    const neu = !vorher.is_favorite;
    setRecipes((liste) => liste.map((r) => (r.id === id ? { ...r, is_favorite: neu } : r)));
    try {
      await api.patch(`/recipes/${id}`, { is_favorite: neu });
    } catch (err) {
      setRecipes((liste) => liste.map((r) => (r.id === id ? { ...r, is_favorite: !neu } : r)));
      Alert.alert(t('allgemein.fehler'), err instanceof ApiError ? err.detail : t('detail.nichtGespeichert'));
    }
  };

  const recentlyCooked = useMemo(
    () =>
      recipes
        .filter((r) => r.last_cooked_at)
        .sort((a, b) => +new Date(b.last_cooked_at!) - +new Date(a.last_cooked_at!))
        .slice(0, 10),
    [recipes],
  );

  // Kategorien-Zeile: zeigt eingeklappt nur EINE Zeile, mit "Mehr anzeigen"
  // aufklappbar. Vorher waren es drei Zeilen - das schob bei vielen Tags
  // die eigentlichen Rezepte weit nach unten, obwohl das Dashboard als
  // Einstieg die Rezepte zeigen soll, nicht die Filterleiste.
  // Die tatsaechliche Hoehe wird per onLayout gemessen (der innere
  // Container ist NIE selbst hoehenbegrenzt, nur der aeussere clippt
  // visuell) - so weiss man, ob ueberhaupt etwas verborgen ist,
  // unabhaengig von Chip-Anzahl/-Breite.
  const CATEGORIES_COLLAPSED_HEIGHT = 36; // eine Zeile bei dieser Chip-Groesse
  const [categoriesExpanded, setCategoriesExpanded] = useState(false);
  const [categoriesNaturalHeight, setCategoriesNaturalHeight] = useState(0);
  const categoriesOverflow = categoriesNaturalHeight > CATEGORIES_COLLAPSED_HEIGHT + 4;

  if (isLoading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.bg }]}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  // Als Konstanten statt direkt im JSX: am Handy in genau dieser
  // Reihenfolge untereinander (wie bisher, unveraendert), am Tablet auf
  // zwei Spalten verteilt (siehe Rueckgabe unten). Jeder Block bleibt
  // dieselbe JSX wie vorher, nur eben benannt statt inline.
  const blockStats = (
    <View style={styles.statsRow}>
      <View style={[styles.statCard, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder }]}>
        <Text style={[styles.statValue, { color: colors.text }]}>{recipes.length}</Text>
        <Text style={[styles.statLabel, { color: colors.muted }]}>{t('dashboard.rezepte')}</Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder }]}>
        <Text style={[styles.statValue, { color: colors.text }]}>{stats?.cooked_this_week ?? '–'}</Text>
        <Text style={[styles.statLabel, { color: colors.muted }]}>{t('dashboard.dieseWocheGekocht')}</Text>
      </View>
      <View style={[styles.statCard, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder }]}>
        <Text style={[styles.statValue, { color: colors.text }]}>{stats?.cooked_total ?? '–'}</Text>
        <Text style={[styles.statLabel, { color: colors.muted }]}>{t('dashboard.insgesamtGekocht')}</Text>
      </View>
    </View>
  );

  const blockDaily = recipeOfTheDay && (
    <Pressable
      onPress={() =>
        navigation.navigate('RecipeDetail', { recipeId: recipeOfTheDay.id, title: recipeOfTheDay.title })
      }
      style={[styles.dailyCard, { borderRadius: radius.lg }]}
    >
      <View style={[styles.dailyBadge, { backgroundColor: gradient[0] }]}>
        <Text style={styles.dailyBadgeText}>{t('dashboard.rezeptDesTages')}</Text>
      </View>
      {recipeOfTheDay.cover_image_url ? (
        <Image source={{ uri: recipeOfTheDay.cover_image_url }} style={[styles.dailyImage, istTablet && styles.dailyImageTablet]} />
      ) : (
        <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.dailyImage, istTablet && styles.dailyImageTablet]} />
      )}
      <View style={styles.dailyInfo}>
        <Text style={[styles.dailyTitle, { color: colors.text }]} numberOfLines={1}>
          {recipeOfTheDay.title}
        </Text>
        <Text style={[styles.dailyMeta, { color: colors.muted }]}>
          {recipeOfTheDay.prep_time_minutes ? `⏱ ${recipeOfTheDay.prep_time_minutes} Min.` : ''}
          {recipeOfTheDay.servings ? `  ·  🍽 ${recipeOfTheDay.servings} ${t('dashboard.portionenKurz')}` : ''}
        </Text>
      </View>
    </Pressable>
  );

  const blockActions = (
    <View style={styles.actionsRow}>
      <Pressable
        onPress={() => navigation.navigate('Einkauf')}
        style={[styles.actionButton, { backgroundColor: gradient[0], borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="cart-outline" size={18} color="#fff" />
        <Text style={styles.actionText}>{t('dashboard.einkaufszettel')}</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate('WeeklyPlan')}
        style={[styles.actionButton, { backgroundColor: colors.card, borderRadius: radius.md }]}
      >
        <MaterialCommunityIcons name="calendar-week-outline" size={18} color={colors.text} />
        <Text style={[styles.actionText, { color: colors.text }]}>{t('dashboard.wochenplaner')}</Text>
      </Pressable>
    </View>
  );

  // Ganz oben, weil eine Sendung von einer echten Person kommt und
  // untergeht, wenn sie unter Listen und Kategorien liegt. Die Karte
  // blendet sich selbst aus, wenn nichts offen ist.
  const blockShares = <IncomingSharesCard />;

  const blockKategorien = (
    <>
      <View style={styles.categoriesHeaderRow}>
        <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('dashboard.kategorien')}</Text>
        <Pressable
          onPress={() => navigation.navigate('ManageCategories')}
          hitSlop={8}
          accessibilityLabel={t('dashboard.kategorienVerwalten')}
        >
          <MaterialCommunityIcons name="tune-variant" size={18} color={colors.muted} />
        </Pressable>
      </View>
      <View
        style={[
          styles.categoriesClip,
          !categoriesOverflow && { marginBottom: 14 },
          !categoriesExpanded && { maxHeight: CATEGORIES_COLLAPSED_HEIGHT, overflow: 'hidden' },
        ]}
      >
        <View style={styles.categoriesRow} onLayout={(e) => setCategoriesNaturalHeight(e.nativeEvent.layout.height)}>
          <Pressable
            onPress={() => navigation.navigate('Rezepte', { favoritesOnly: true })}
            style={[styles.categoryChip, { backgroundColor: colors.card, borderRadius: radius.sm }]}
          >
            <MaterialCommunityIcons name="heart" size={13} color={gradient[0]} style={{ marginRight: 5 }} />
            <Text style={[styles.categoryText, { color: colors.text }]}>{t('dashboard.favoriten')}</Text>
          </Pressable>
          {categories.map((tag) => (
            <Pressable
              key={tag}
              onPress={() => navigation.navigate('Rezepte', { filterTag: tag })}
              onLongPress={() => handleHideCategory(tag)}
              style={[styles.categoryChip, { backgroundColor: colors.card, borderRadius: radius.sm }]}
            >
              <Text style={[styles.categoryText, { color: colors.text }]}>{tag}</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {categoriesOverflow && (
        <Pressable onPress={() => setCategoriesExpanded((prev) => !prev)} style={styles.categoriesToggle}>
          <Text style={[styles.categoriesToggleText, { color: gradient[0] }]}>
            {categoriesExpanded ? t('dashboard.wenigerAnzeigen') : t('dashboard.mehrAnzeigen')}
          </Text>
        </Pressable>
      )}
    </>
  );

  // Zuletzt zubereitet (nur Hauptgerichte, keine mitgekochten Beilagen -
  // siehe CookModeScreen.tsx, ruft mark-cooked nur fuer recipeIds[0] auf)
  const blockZuletzt = (
    <>
      <Text style={[styles.sectionLabel, { color: colors.text }]}>{t('dashboard.zuletztZubereitet')}</Text>
      {recentlyCooked.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.muted }]}>
          Noch nichts zubereitet – starte die Zubereitung eines Rezepts, dann erscheint es hier.
        </Text>
      ) : (
        <View style={[styles.recentCard, { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.cardBorder }]}>
          {recentlyCooked.map((r, i) => (
            <Pressable
              key={r.id}
              onPress={() => navigation.navigate('RecipeDetail', { recipeId: r.id, title: r.title })}
              style={[styles.recentRow, i < recentlyCooked.length - 1 && styles.recentRowBorder, { borderColor: colors.bg }]}
            >
              {r.cover_image_url ? (
                <Image source={{ uri: r.cover_image_url }} style={styles.recentThumb} />
              ) : (
                <View style={[styles.recentThumb, styles.recentThumbPlaceholder, { backgroundColor: gradient[i % 2 === 0 ? 0 : 1] }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.recentTitle, { color: colors.text }]} numberOfLines={1}>
                  {r.title}
                </Text>
                <Text style={[styles.recentMeta, { color: colors.muted }]}>
                  {(r.tags && r.tags[0]) || t('dashboard.rezept')}
                  {r.prep_time_minutes ? ` · ${r.prep_time_minutes} Min.` : ''}
                </Text>
              </View>
              <Pressable
                onPress={() => toggleFavorit(r.id)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('dashboard.favoriten')}
              >
                <MaterialCommunityIcons
                  name={r.is_favorite ? 'heart' : 'heart-outline'}
                  size={19}
                  color={r.is_favorite ? gradient[0] : colors.muted}
                />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );

  return (
    <>
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={[styles.container, istTablet ? inhaltsBreiteZweispaltig : inhaltsBreite]}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
    >
      {/* "Powered by HomeArchive AI" + App-Titel oben - wie bei Buerroablage,
          fehlte hier bisher komplett (nicht zu verwechseln mit der bewusst
          entfernten Begruessung "Hallo...Was kochen wir heute" weiter
          unten - das ist eine andere, statische Kopfzeile). */}
      <View style={styles.brandRow}>
        <Text style={[styles.brandText, { color: colors.muted }]}>Powered by</Text>
        <Text style={[styles.brandName, { color: colors.text }]}>HomeArchive</Text>
        <View style={[styles.brandBadge, { backgroundColor: gradient[0] }]}><Text style={styles.brandBadgeText}>AI</Text></View>
      </View>
      <View style={styles.titleRow}>
        <Text style={[styles.appTitle, { color: colors.text }]}>Mein Kochbuch</Text>
        {/* Brutzel jederzeit antippbar - oeffnet vorgefertigte Fragen +
            Antworten, siehe BrutzelFaqBubble.tsx (Wunsch 29.09.2026,
            gleiches Muster wie Klammi/Blitzi in Buerroablage/Medienablage). */}
        <BrutzelFaqBubble />
      </View>

      {/* Ein Tipp je Start, der Reihe nach, jeder nur einmal - abschaltbar über
          "Brutzel anzeigen" (show_brutzel), siehe utils/tipps.ts */}
      <TippBlase tipps={TIPPS} erlaubt={brutzelTipps}
        avatar={<BrutzelAvatar size={44} variant="head" />}
        farben={{ flaeche: colors.card, text: colors.text, gedaempft: colors.muted, akzent: gradient[0] }} />

      {/* Nach dem Einkaufen direkt in die Zubereitung (Kochplan) */}
      <KochplanKarte />

      {/* Begruessung ("Hallo …! 👋" / "Was kochen wir heute?") bewusst
          entfernt: Sie kostete zwei Zeilen fuer eine Information, die man
          nach dem ersten Oeffnen kennt, und schob die Rezepte nach unten.
          Die animierte Brutzel-Begruessung beim Start bleibt - dort ist
          sie ein Moment, hier war sie Dauermoebel. displayName wird
          weiterhin fuer diese Animation gebraucht. */}

      {error && <Text style={[styles.errorText, { color: '#DC2626' }]}>{error}</Text>}

      {istTablet ? (
        // Zwei Spalten (links ~7/12, rechts ~5/12): links alles rund ums
        // "was koche ich heute" (Zahlen, Rezept des Tages, Schnellaktionen,
        // eingehende Freigaben), rechts zum Stoebern (Kategorien,
        // zuletzt Gekochtes). Am Handy bleibt die alte, einspaltige
        // Reihenfolge unveraendert - siehe else-Zweig.
        <View style={styles.zweiSpalten}>
          <View style={styles.spalteLinks}>
            {blockStats}
            {blockDaily}
            {blockActions}
            {blockShares}
          </View>
          <View style={styles.spalteRechts}>
            {blockKategorien}
            {blockZuletzt}
          </View>
        </View>
      ) : (
        <>
          {blockStats}
          {blockDaily}
          {blockActions}
          {blockShares}
          {blockKategorien}
          {blockZuletzt}
        </>
      )}
    </ScrollView>
    <ScanFab />
    {showGreeting && <BrutzelGreetingOverlay name={displayName} mitVideo={greetingMitVideo} sprechen={greetingSprechen} mitMusik={greetingMitMusik} onDismiss={() => setShowGreeting(false)} />}
    </>
  );
}

// Die Abstaende sind bewusst knapp gehalten: Das Dashboard soll auf einem
// Handy-Bildschirm bis in die Liste "Zuletzt zubereitet" reichen. Vorher
// endete der sichtbare Bereich genau ueber der Ueberschrift, die Liste
// selbst sah man erst nach dem Scrollen - und damit wirkte das Dashboard
// leerer als es ist. Wer hier Abstaende wieder vergroessert, schiebt die
// Liste erneut aus dem Bild.
const styles = StyleSheet.create({
  container: { padding: 18, paddingBottom: 40 },
  brandRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  brandText:      { fontSize: 11 },
  brandName:      { fontSize: 11, fontWeight: '500' },
  brandBadge:     { borderRadius: 5, paddingHorizontal: 5, paddingVertical: 2 },
  brandBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.3, color: '#fff' },
  appTitle:       { fontSize: 18, fontWeight: '500' },
  titleRow:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  // Zwei Spalten am Tablet: links ~7/12, rechts ~5/12 (Auftrag Punkt 4).
  // gap statt Raendern an den Kindern, damit sich die Blockabstaende
  // innerhalb einer Spalte nicht mit dem Spaltenabstand vermischen.
  zweiSpalten: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
  spalteLinks: { flex: 7 },
  spalteRechts: { flex: 5 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { fontSize: 12, marginBottom: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12, marginTop: 4 },
  statCard: { flex: 1, paddingVertical: 11, paddingHorizontal: 10, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: '700' },
  statLabel: { fontSize: 10.5, marginTop: 2, textAlign: 'center' },
  dailyCard: { overflow: 'hidden', marginBottom: 12 },
  dailyBadge: { position: 'absolute', top: 12, left: 12, zIndex: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  dailyBadgeText: { color: '#fff', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  dailyImage: { width: '100%', height: 118 },
  // Auf Tablet ist die Karte (inhaltsBreiteZweispaltig, bis 980pt statt
  // 620pt) deutlich breiter - bei unveraenderter Hoehe wirkt das Foto
  // gestaucht/zu schmal im Verhaeltnis zur Kartenbreite. Skaliert grob
  // proportional mit (Breitenverhaeltnis ca. 1,6x).
  dailyImageTablet: { height: 240 },
  dailyInfo: { paddingHorizontal: 14, paddingVertical: 11 },
  dailyTitle: { fontSize: 15.5, fontWeight: '700' },
  dailyMeta: { fontSize: 11.5, marginTop: 4 },
  actionsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  actionButton: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', height: 46 },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 12.5 },
  sectionLabel: { fontSize: 15, fontWeight: '700', marginBottom: 8 },
  categoriesClip: { marginBottom: 6 },
  categoriesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoriesHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 4 },
  categoryChip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8 },
  categoryText: { fontSize: 12, fontWeight: '600' },
  categoriesToggle: { alignSelf: 'flex-start', marginBottom: 14, paddingVertical: 4 },
  categoriesToggleText: { fontSize: 12, fontWeight: '700' },
  emptyText: { fontSize: 12.5, lineHeight: 19 },
  recentCard: { paddingHorizontal: 4 },
  recentRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10, paddingHorizontal: 10 },
  recentRowBorder: { borderBottomWidth: 1 },
  recentThumb: { width: 40, height: 40, borderRadius: 8 },
  recentThumbPlaceholder: {},
  recentTitle: { fontSize: 13, fontWeight: '600' },
  recentMeta: { fontSize: 10.5, marginTop: 2 },
});
