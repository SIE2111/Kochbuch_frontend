// Google-Client-IDs fuer "Mit Google anmelden" (Google Cloud Console -> APIs & Dienste -> Anmeldedaten).
// Das sind KEINE Geheimnisse - sie stehen in jeder App. Leer = der Google-Knopf wird nicht angezeigt.
//  - webClientId: OAuth-Client vom Typ "Webanwendung" (dieselbe ID steht in Supabase beim Google-Anbieter)
//  - iosClientId: OAuth-Client vom Typ "iOS" (Bundle-ID at.homearchive.meinkochbuch)
// Zusaetzlich muss in app.json beim Plugin @react-native-google-signin/google-signin die umgedrehte
// iOS-Client-ID als iosUrlScheme stehen (com.googleusercontent.apps....).
// Vorerst AUS (Wunsch 02.11.2026: erst nur der Gast-Zugang). true = Apple-/Google-Knoepfe wieder anzeigen
// (fuer Apple braucht es dann zusaetzlich das Plugin expo-apple-authentication in app.json und einen vollen Build).
export const SOCIAL_LOGIN_AKTIV = false;

export const GOOGLE_WEB_CLIENT_ID = '';
export const GOOGLE_IOS_CLIENT_ID = '';
