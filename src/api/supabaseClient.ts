import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Feste öffentliche Ersatzwerte (gemeinsames Projekt, anon-Schlüssel ist öffentlich):
// eas.json-env gilt nur für 'eas build', nicht für 'eas update' (u.ps1) - beim
// Weinkeller stürzte deshalb jedes Update ab (04.10.2026).
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://yahvzxcjthiayfemmrvd.supabase.co';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhaHZ6eGNqdGhpYXlmZW1tcnZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2MTMyNjQsImV4cCI6MjEwNDE4OTI2NH0.91oYK6AvvQUqXjOT-KpSwiNAyNcHVq1BQMrqXgh3f7M';

// Statt stillschweigend mit leeren Strings weiterzumachen (das fuehrt zu
// einem nicht nachvollziehbaren weissen Bildschirm beim Start, siehe
// Weinkeller-Lektion): klarer, sichtbarer Fehler direkt beim Laden.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL/_ANON_KEY fehlen. Lokal: .env pruefen (Datei vorhanden? ' +
    'Terminal neu gestartet nach Aenderung?). Im EAS-Build: eas.json-env oder ' +
    '"eas secret:create" pruefen - Build-Server haben keinen Zugriff auf die lokale .env.'
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
