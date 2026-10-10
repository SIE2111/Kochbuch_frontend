import React, { useEffect, useState } from 'react';
import { NavigationContainer, createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';
import { Linking } from 'react-native';
import { parseRuecksprung, weinFuerRezeptSpeichern, gemerktenTitelHolen, parseGericht, gleicherTitel, aehnlicherTitel, GerichtAusWeinkeller } from '../utils/weinPairing';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { ActivityIndicator, View, Text, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import { api } from '../api/client';
import LoginScreen from '../screens/LoginScreen';
import ForgotPasswordScreen from '../screens/ForgotPasswordScreen';
import RegisterScreen from '../screens/RegisterScreen';
import ConfirmEmailScreen from '../screens/ConfirmEmailScreen';
import DashboardScreen from '../screens/DashboardScreen';
import RecipesScreen from '../screens/RecipesScreen';
import ShoppingListScreen from '../screens/ShoppingListScreen';
import RecipeDetailScreen from '../screens/RecipeDetailScreen';
import RecipeSourceMenuScreen from '../screens/RecipeSourceMenuScreen';
import ManualRecipeScreen from '../screens/ManualRecipeScreen';
import WebImportScreen from '../screens/WebImportScreen';
import RezeptSucheScreen from '../screens/RezeptSucheScreen';
import WebBrowseScreen from '../screens/WebBrowseScreen';
import AIGenerateScreen from '../screens/AIGenerateScreen';
import WeeklyPlanScreen from '../screens/WeeklyPlanScreen';
import CookModeScreen from '../screens/CookModeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import CommunityPoolScreen from '../screens/CommunityPoolScreen';
import PoolRecipeDetailScreen from '../screens/PoolRecipeDetailScreen';
import ModerationScreen from '../screens/ModerationScreen';
import VoiceSettingsScreen from '../screens/VoiceSettingsScreen';
import SupportScreen from '../screens/SupportScreen';
import HouseholdScreen from '../screens/HouseholdScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import StarterPacksScreen from '../screens/StarterPacksScreen';
import LanguageSettingsScreen from '../screens/LanguageSettingsScreen';
import AppSettingsScreen from '../screens/AppSettingsScreen';
import MyPoolsScreen from '../screens/MyPoolsScreen';
import StorageSettingsScreen from '../screens/StorageSettingsScreen';
import PhotoCaptureScreen from '../screens/PhotoCaptureScreen';
import MarketingHost from '../components/MarketingHost';
import ManageCategoriesScreen from '../screens/ManageCategoriesScreen';
import ZutatenWaehlenScreen from '../screens/ZutatenWaehlenScreen';

export type AuthStackParamList = {
  ForgotPassword: undefined;
  Login: undefined;
  Register: undefined;
  ConfirmEmail: { email: string };
};

// Die 5 dauerhaft sichtbaren Bereiche (Bottom-Tab-Leiste).
//
// Frueher stand hier "Scan" - ein Tab ohne eigenen Inhalt, der nur das
// RecipeSourceMenu oeffnete, also eine Aktion im Gewand eines Ortes. Der
// Platz gehoert einem echten Bereich: dem Community-Pool. Das Erfassen
// uebernimmt jetzt der schwebende Knopf (components/ScanFab.tsx), der auf
// allen Hauptscreens sitzt.
export type MainTabParamList = {
  Home: undefined;
  Rezepte: { filterTag?: string; favoritesOnly?: boolean } | undefined;
  Pool: undefined;
  Einkauf: undefined;
  Profil: undefined;
};

// Alles, was als volle Seite ÜBER der Tab-Leiste geoeffnet wird (Rezept-
// Details, Koch-Modus, Formulare, ...). MainTabs ist selbst nur einer der
// Screens hier drin.
export type MainStackParamList = {
  // Parametrisiert, damit von einem Stack-Screen aus gezielt ein Tab
  // angesprungen werden kann (z.B. nach dem Kochen zurueck aufs Dashboard).
  MainTabs: NavigatorScreenParams<MainTabParamList> | undefined;
  RecipeDetail: { recipeId: string; title: string; weinAktualisiert?: number };
  RecipeSourceMenu: undefined;
  ManualRecipe: { recipeId?: string } | undefined;
  WebImport: { pickedUrl?: string } | undefined;
  WebBrowse: { initialQuery?: string; initialUrl?: string } | undefined;
  RezeptSuche: { initialQuery?: string } | undefined;
  AIGenerate: { wunsch?: string } | undefined;
  WeeklyPlan: undefined;
  // discardAfterId: Rezept, das nach dem Kochvorgang wieder geloescht wird.
  // Fuer "nur kochen, nicht behalten" - der Koch-Modus braucht ein
  // gespeichertes Rezept (Timer, Tipps, Stufen, Notizen haengen an der ID),
  // also wird es angelegt und danach wieder entfernt.
  CookMode: { recipeIds: string[]; discardAfterId?: string; sessionNote?: string; sessionServings?: number; sessionOverrides?: { ingredients?: { name: string; amount: number | null; unit: string | null }[]; steps?: { order: number; text: string; timer_seconds?: number | null; user_note?: string | null; technique_tag?: string | null }[] } };
  // Derselbe Screen ist auch ein Tab. Der Stack-Eintrag bleibt, weil das
  // RecipeSourceMenu ihn als Quelle anbietet und dann als Seite ueber den
  // Tabs oeffnen soll - der Tab ist der Bereich, dieser hier der gezielte
  // Aufruf aus dem Erfassen-Menue.
  CommunityPool: undefined;
  PoolRecipeDetail: { publicRecipeId: string; title?: string };
  Moderation: undefined;
  VoiceSettings: undefined;
  Support: undefined;
  Household: undefined;
  Onboarding: undefined;
  StarterPacks: undefined;
  ManageCategories: undefined;
  ZutatenWaehlen: { liste?: string | null } | undefined;
  LanguageSettings: undefined;
  StorageSettings: undefined;
  AppSettings: undefined;
  MyPools: undefined;
  PhotoCapture: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const MainStack = createNativeStackNavigator<MainStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="Register" component={RegisterScreen} />
      <AuthStack.Screen name="ConfirmEmail" component={ConfirmEmailScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
    </AuthStack.Navigator>
  );
}

const TAB_ICONS: Record<keyof MainTabParamList, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Home: 'home-variant-outline',
  Rezepte: 'book-open-variant',
  Pool: 'account-group-outline',
  Einkauf: 'cart-outline',
  Profil: 'account-circle-outline',
};

function MainTabs() {
  const { colors, gradient } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      // Alle Tab-Screens haben bewusst headerShown:false (eigenes Design
      // statt nativer Navigationsleiste) - dadurch uebernimmt aber auch
      // niemand automatisch den Sicherheitsabstand zur Notch/Statusleiste.
      // Zentral hier am Navigator geloest statt in jedem einzelnen Screen,
      // damit kuenftige neue Tabs das automatisch mitbekommen. In v7 heisst
      // die Option 'sceneStyle' (Teil von screenOptions), nicht mehr das
      // veraltete 'sceneContainerStyle' vom Navigator selbst.
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: { paddingTop: insets.top },
        tabBarActiveTintColor: gradient[0],
        tabBarInactiveTintColor: colors.muted,
        // Android edge-to-edge (app.json: edgeToEdgeEnabled) zeichnet den
        // Inhalt hinter der System-Navigationsleiste (Geste/3-Tasten) -
        // ohne expliziten Abstand landet die Tab-Leiste dahinter/darunter.
        // Hoehe + unteres Padding daher manuell um insets.bottom erweitern,
        // statt uns auf die automatische Erkennung der Bibliothek zu verlassen.
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.bg,
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
          paddingTop: 8,
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons name={TAB_ICONS[route.name as keyof MainTabParamList]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} options={{ title: 'Home' }} />
      <Tab.Screen name="Rezepte" component={RecipesScreen} />
      <Tab.Screen name="Pool" component={CommunityPoolScreen} options={{ title: 'Community Pool' }} />
      <Tab.Screen name="Einkauf" component={ShoppingListScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} options={{ title: 'Profil' }} />
    </Tab.Navigator>
  );
}

function MainNavigator({ startOnOnboarding }: { startOnOnboarding: boolean }) {
  const { colors } = useTheme();
  // Neu registrierte Nutzer starten im Onboarding (Ordner/Starter-Pack-Wahl),
  // ebenso ein Konto, das zum ersten Mal HIER in Kochbuch auftaucht, auch
  // wenn es laengst in Buerroablage/Medienablage eingerichtet ist (siehe
  // startOnOnboarding-Berechnung in AppNavigator unten).
  const initialRouteName = startOnOnboarding ? 'Onboarding' : 'MainTabs';
  return (
    <MainStack.Navigator
      initialRouteName={initialRouteName}
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        // Ohne das zeigt iOS den ROUTENNAMEN des vorherigen Screens neben
        // dem Pfeil - beim Sprung von den Tabs also woertlich "MainTabs".
        // Ein interner Bezeichner hat in der Oberflaeche nichts verloren.
        headerBackTitle: 'Zurück',
      }}
    >
      <MainStack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
      <MainStack.Screen
        name="RecipeDetail"
        component={RecipeDetailScreen}
        options={({ route }) => ({ title: route.params.title })}
      />
      <MainStack.Screen
        name="RecipeSourceMenu"
        component={RecipeSourceMenuScreen}
        options={{ presentation: 'transparentModal', headerShown: false, animation: 'fade' }}
      />
      <MainStack.Screen
        name="ManualRecipe"
        component={ManualRecipeScreen}
        options={({ route }) => ({ title: route.params?.recipeId ? 'Rezept bearbeiten' : 'Selbst erstellen' })}
      />
      <MainStack.Screen
        name="WebImport"
        component={WebImportScreen}
        options={{ title: 'Aus dem Internet' }}
      />
      <MainStack.Screen name="RezeptSuche" component={RezeptSucheScreen} options={{ title: 'Rezeptsuche' }} />
      <MainStack.Screen
        name="WebBrowse"
        component={WebBrowseScreen}
        options={{ title: 'Rezept suchen' }}
      />
      <MainStack.Screen
        name="AIGenerate"
        component={AIGenerateScreen}
        options={{ title: 'KI-Rezept' }}
      />
      <MainStack.Screen
        name="WeeklyPlan"
        component={WeeklyPlanScreen}
        options={{ title: 'Wochenplan' }}
      />
      <MainStack.Screen
        name="CookMode"
        component={CookModeScreen}
        options={{ title: 'Kochen', headerBackTitle: 'Abbrechen' }}
      />
      <MainStack.Screen name="CommunityPool" component={CommunityPoolScreen} options={{ title: 'Community-Pool' }} />
      <MainStack.Screen
        name="PoolRecipeDetail"
        component={PoolRecipeDetailScreen}
        options={({ route }) => ({ title: route.params?.title ?? 'Rezept' })}
      />
      <MainStack.Screen name="Moderation" component={ModerationScreen} options={{ title: 'Moderation' }} />
      <MainStack.Screen name="VoiceSettings" component={VoiceSettingsScreen} options={{ title: 'Vorlesen & Stimme' }} />
      <MainStack.Screen name="Support" component={SupportScreen} options={{ title: 'Support kontaktieren' }} />
      <MainStack.Screen name="Household" component={HouseholdScreen} options={{ title: 'Haushalt' }} />
      <MainStack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false, gestureEnabled: false }} />
      <MainStack.Screen name="StarterPacks" component={StarterPacksScreen} options={{ headerShown: false }} />
      <MainStack.Screen name="ManageCategories" component={ManageCategoriesScreen} options={{ headerShown: false }} />
      <MainStack.Screen name="ZutatenWaehlen" component={ZutatenWaehlenScreen} options={{ title: 'Zutaten wählen' }} />
      <MainStack.Screen name="LanguageSettings" component={LanguageSettingsScreen} options={{ headerShown: false }} />
      <MainStack.Screen name="AppSettings" component={AppSettingsScreen} options={{ title: 'Einstellungen' }} />
      <MainStack.Screen name="MyPools" component={MyPoolsScreen} options={{ title: 'Meine Pools' }} />
      <MainStack.Screen name="StorageSettings" component={StorageSettingsScreen} options={{ title: 'Speicherort' }} />
      <MainStack.Screen name="PhotoCapture" component={PhotoCaptureScreen} options={{ title: 'Foto erfassen' }} />
    </MainStack.Navigator>
  );
}

// Für den Rücksprung aus Mein Weinkeller ("Passender Wein") - Navigation
// außerhalb eines Screens heraus.
const navigationRef = createNavigationContainerRef<MainStackParamList>();

export default function AppNavigator() {
  const { session, isLoading, trialExpired, signOut, justRegistered } = useAuth();
  const { colors, isLoaded: themeLoaded } = useTheme();

  // 2026-09-29: Prueft, ob dieses (ggf. laengst in Buerroablage/Medienablage
  // bestehende) Konto zum ERSTEN MAL in Kochbuch auftaucht - dann soll der
  // Einrichtungsbildschirm auch ohne frische Kochbuch-Registrierung
  // erscheinen (justRegistered allein deckte das bisher nicht ab, siehe
  // AuthContext.tsx: wird nur bei einer echten Neuregistrierung gesetzt).
  // Bewusst HIER (vor MainNavigator), nicht in einem einzelnen Tab-Screen -
  // andere Screens feuern beim Start eigene Requests, die die Registrierung
  // ueber die normale JWT-Pruefung sonst zuerst ausloesen wuerden (siehe
  // GET /account/app-status Docstring im Backend).
  const [firstLoginThisApp, setFirstLoginThisApp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!session) { setFirstLoginThisApp(null); return; }
    let cancelled = false;
    api.get<{ first_login_this_app: boolean }>('/account/app-status')
      .then(res => { if (!cancelled) setFirstLoginThisApp(!!res.first_login_this_app); })
      .catch(() => { if (!cancelled) setFirstLoginThisApp(false); }); // im Zweifel nicht blockieren
    return () => { cancelled = true; };
  }, [session]);

  // Rücksprung aus Mein Weinkeller: meinkochbuch://recipe/<id>?wine=…
  // Der gewählte Wein wird sofort lokal am Rezept gemerkt; geöffnet wird das
  // Rezept, sobald Login und Navigation bereit sind (Link kann auch beim
  // Kaltstart oder ausgeloggt ankommen).
  // Diese Hooks MÜSSEN vor den frühen returns unten stehen.
  const [offenerRuecksprung, setOffenerRuecksprung] = useState<string | null>(null);
  const [navBereit, setNavBereit] = useState(false);
  const [offenesGericht, setOffenesGericht] = useState<GerichtAusWeinkeller | null>(null);
  useEffect(() => {
    async function verarbeiten(url: string | null) {
      const g = parseGericht(url);
      if (g) { setOffenesGericht(g); return; }
      const r = parseRuecksprung(url);
      if (!r) return;
      if (r.wein) await weinFuerRezeptSpeichern(r.recipeId, r.wein);
      setOffenerRuecksprung(r.recipeId);
    }
    Linking.getInitialURL().then(verarbeiten);
    const sub = Linking.addEventListener('url', ({ url }) => { verarbeiten(url); });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!offenerRuecksprung || !session || !navBereit || !navigationRef.isReady()) return;
    const recipeId = offenerRuecksprung;
    gemerktenTitelHolen(recipeId).then((title) => {
      navigationRef.navigate('RecipeDetail', { recipeId, title, weinAktualisiert: Date.now() });
      setOffenerRuecksprung(null);
    });
  }, [offenerRuecksprung, session, navBereit]);

  // Gericht aus Mein Weinkeller: eigenes Rezept mit dem Namen öffnen, sonst KI-Rezept vorausgefüllt
  useEffect(() => {
    if (!offenesGericht || !session || !navBereit || !navigationRef.isReady()) return;
    const g = offenesGericht;
    setOffenesGericht(null);
    api.get<{ id: string; title: string }[]>('/recipes/')
      .then((liste) => liste.find((r) => gleicherTitel(r.title, g.name))
        ?? liste.find((r) => aehnlicherTitel(r.title, g.name)) ?? null)
      .catch(() => null)
      .then((treffer) => {
        if (treffer) navigationRef.navigate('RecipeDetail', { recipeId: treffer.id, title: treffer.title });
        else navigationRef.navigate('AIGenerate', { wunsch: g.wein ? `${g.name} – passend zu ${g.wein}` : g.name });
      });
  }, [offenesGericht, session, navBereit]);

  if (isLoading || !themeLoaded || (!!session && firstLoginThisApp === null)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  // 3-Monats-Testphase abgelaufen (siehe AuthContext.tsx/client.ts) -
  // blockiert VOR Main/AuthNavigator, unabhaengig davon, welcher Request
  // das 402 ausgeloest hat.
  if (trialExpired) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 32 }}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>⏳</Text>
        <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text, textAlign: 'center', marginBottom: 10 }}>
          Testphase abgelaufen
        </Text>
        <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center', lineHeight: 20 }}>
          {trialExpired}
        </Text>
        <Pressable
          onPress={() => signOut()}
          style={{ marginTop: 28, paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder }}
        >
          <Text style={{ color: colors.muted, fontSize: 14, fontWeight: '600' }}>Abmelden</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} onReady={() => setNavBereit(true)}>
      {session
        ? (
          <>
            <MainNavigator startOnOnboarding={!!justRegistered || !!firstLoginThisApp} />
            {/* Marketing-Hinweise des Maskottchens (erster Eintrag, Bewertung, Plus vormerken) */}
            <MarketingHost navigationRef={navigationRef} />
          </>
        )
        : <AuthNavigator />}
    </NavigationContainer>
  );
}
