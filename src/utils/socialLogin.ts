// Anmelden mit Apple (nur iPhone/iPad) und Google (Android und iPhone) - Version 1.1, Wunsch 02.11.2026.
// Beide laufen direkt ueber Supabase (signInWithIdToken): Kein Passwort, keine Code-Mail. Das Konto wird beim
// ersten Aufruf des Backends automatisch angelegt (deps.get_or_create_user, inkl. Registrierungs-Info-Mail).
//
// Die nativen Module kommen erst mit dem vollen Build 1.1. In aelteren Builds (und in Expo Go) fehlen sie -
// dann bleiben die Knoepfe einfach weg, statt dass die App beim Laden abstuerzt.
import { Platform } from 'react-native';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID, SOCIAL_LOGIN_AKTIV } from '../config/socialLogin';
import { requireOptionalNativeModule } from 'expo';
import { supabase } from '../api/supabaseClient';

export type SocialErgebnis = { neu: boolean; name: string | null } | null;   // null = abgebrochen

const extra = { googleWebClientId: GOOGLE_WEB_CLIENT_ID, googleIosClientId: GOOGLE_IOS_CLIENT_ID };

function apple(): any | null {
  if (!SOCIAL_LOGIN_AKTIV) return null;
  if (Platform.OS !== 'ios' || !requireOptionalNativeModule('ExpoAppleAuthentication')) return null;
  try { return require('expo-apple-authentication'); } catch { return null; }
}

function google(): any | null {
  if (!SOCIAL_LOGIN_AKTIV) return null;
  if (!extra.googleWebClientId || (Platform.OS === 'ios' && !extra.googleIosClientId)) return null;
  if (!requireOptionalNativeModule('RNGoogleSignin')) return null;
  try { return require('@react-native-google-signin/google-signin'); } catch { return null; }
}

export async function appleVerfuegbar(): Promise<boolean> {
  const m = apple();
  if (!m) return false;
  try { return await m.isAvailableAsync(); } catch { return false; }
}

export function googleVerfuegbar(): boolean {
  return !!google();
}

/** Konto gerade erst angelegt? (Supabase legt es beim ersten Social Login an) */
function istNeu(user: { created_at?: string } | null | undefined): boolean {
  const t = user?.created_at ? Date.parse(user.created_at) : NaN;
  return !isNaN(t) && Date.now() - t < 10 * 60 * 1000;
}

function zufallsText(laenge = 32): string {
  const zeichen = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < laenge; i++) s += zeichen[Math.floor(Math.random() * zeichen.length)];
  return s;
}

export async function mitAppleAnmelden(): Promise<SocialErgebnis> {
  const m = apple();
  if (!m) throw new Error('Apple-Anmeldung ist auf diesem Gerät nicht verfügbar.');
  const Crypto = require('expo-crypto');
  // Nonce: Apple bekommt den Hash, Supabase den Klartext - so laesst sich das Token nicht wiederverwenden.
  const nonce = zufallsText();
  const gehasht = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
  let cred: any;
  try {
    cred = await m.signInAsync({
      requestedScopes: [m.AppleAuthenticationScope.FULL_NAME, m.AppleAuthenticationScope.EMAIL],
      nonce: gehasht,
    });
  } catch (e: any) {
    if (e?.code === 'ERR_REQUEST_CANCELED' || e?.code === 'ERR_CANCELED') return null;
    throw e;
  }
  if (!cred?.identityToken) throw new Error('Apple hat keine Anmeldedaten geliefert.');
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: cred.identityToken, nonce });
  if (error) throw error;
  // Den Namen gibt Apple nur beim allerersten Mal heraus
  const n = cred.fullName;
  const name = n ? [n.givenName, n.familyName].filter(Boolean).join(' ').trim() || null : null;
  return { neu: istNeu(data?.user), name };
}

let googleKonfiguriert = false;

export async function mitGoogleAnmelden(): Promise<SocialErgebnis> {
  const m = google();
  if (!m) throw new Error('Google-Anmeldung ist auf diesem Gerät nicht verfügbar.');
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = m;
  if (!googleKonfiguriert) {
    GoogleSignin.configure({ webClientId: extra.googleWebClientId, iosClientId: extra.googleIosClientId });
    googleKonfiguriert = true;
  }
  let antwort: any;
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    antwort = await GoogleSignin.signIn();
  } catch (e: any) {
    if (isErrorWithCode?.(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) return null;
    throw e;
  }
  if (isSuccessResponse && !isSuccessResponse(antwort)) return null;   // abgebrochen
  const idToken = antwort?.data?.idToken ?? antwort?.idToken;
  if (!idToken) throw new Error('Google hat keine Anmeldedaten geliefert.');
  const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
  const u = antwort?.data?.user ?? antwort?.user;
  return { neu: istNeu(data?.user), name: (u?.name || [u?.givenName, u?.familyName].filter(Boolean).join(' ')).trim?.() || null };
}

/** Beim Abmelden auch bei Google abmelden, sonst waehlt das naechste Mal automatisch dasselbe Konto. */
export async function googleAbmelden(): Promise<void> {
  const m = google();
  if (!m) return;
  try { await m.GoogleSignin.signOut(); } catch { /* egal */ }
}
