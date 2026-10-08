import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { spracheZumServer, getSprache } from '../i18n';
import { einwilligungAnfragen } from '../api/marketing';
import { supabase } from '../api/supabaseClient';
import { api, setOnTrialExpired } from '../api/client';

/**
 * Kochbuch nutzt bewusst Pflicht-Login (kein Kein-Kontozwang-Prinzip wie
 * beim portablen HomeArchive-Auth-Modul aus dem Weinkeller-Projekt) - der
 * Community-Pool erfordert ohnehin ein echtes Konto. Siehe Umsetzungs-
 * konzept Abschnitt 7b fuer die Begruendung.
 *
 * REGISTRIERUNG laeuft NICHT mehr ueber supabase.auth.signUp(), sondern
 * ueber das eigene Backend (/auth/register + /auth/verify):
 *
 *   Grund 1 - Supabase verschickt Bestaetigungsmails ueber SMTP; dieser
 *   Weg war ueber Stunden nicht zum Laufen zu bringen (535-Fehler durch
 *   ungueltige Keys). Das Backend verschickt stattdessen direkt ueber die
 *   Resend-HTTP-API.
 *
 *   Grund 2 - und das ist der eigentliche: Supabases Bestaetigungs-MAIL
 *   enthaelt einen LINK. Ein Link braucht ein Ziel, das zurueck in die App
 *   fuehrt - in Expo Go mit wechselnder Entwicklungs-IP ein Dauerthema,
 *   und beim ersten Versuch landete der Nutzer prompt auf einer
 *   Fehlerseite (Site URL zeigte auf localhost:3000). Ein 4-stelliger
 *   Code braucht kein Ziel: er wird abgetippt, fertig.
 *
 * LOGIN laeuft unveraendert direkt ueber Supabase.
 */

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  justRegistered: boolean;
  clearJustRegistered: () => void;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /** Legt das Konto an und schickt den 4-stelligen Code per Mail. */
  registerWithCode: (email: string, password: string, marketingOptIn?: boolean) => Promise<void>;
  /** Prueft den Code und loggt den Nutzer direkt ein. */
  verifyCode: (email: string, code: string) => Promise<void>;
  /** Fordert einen neuen Code an. */
  resendCode: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** 3-Monats-Testphase abgelaufen (Backend antwortet 402 auf JEDEM
   * authentifizierten Request, siehe deps.py/client.ts) - gesetzt sobald
   * irgendein API-Call das meldet, unabhaengig davon welcher Screen gerade
   * aktiv war. null = nicht abgelaufen. */
  trialExpired: string | null;
  clearTrialExpired: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [justRegistered, setJustRegistered] = useState(false);
  const [trialExpired, setTrialExpired] = useState<string | null>(null);

  // Das bei der Registrierung eingegebene Passwort, damit nach der
  // Code-Bestaetigung sofort eingeloggt werden kann, ohne es erneut
  // abzufragen. Bewusst als useRef und NICHT als Navigations-Parameter:
  // Navigations-State kann von React Navigation persistiert und in
  // Entwickler-Werkzeugen angezeigt werden, ein Ref lebt nur im
  // Arbeitsspeicher und ist beim naechsten App-Start weg.
  const pendingPassword = useRef<{ email: string; password: string; marketingOptIn: boolean } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      // Die Sprachwahl vor dem Login kam nie beim Server an - da gab es
      // noch kein Konto. Jetzt nachholen, sonst verschickt der Server
      // deutsche Mails an jemanden, der die App auf Englisch gestellt hat.
      if (newSession) spracheZumServer();
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // Registriert sich einmalig als Ziel fuer den globalen 402-Hook aus
  // client.ts (siehe dort) - so faengt AuthContext jeden abgelaufenen
  // Request ab, egal welcher Screen ihn ausgeloest hat.
  useEffect(() => {
    setOnTrialExpired((detail) => setTrialExpired(detail));
    return () => setOnTrialExpired(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isLoading,
      justRegistered,
      clearJustRegistered: () => setJustRegistered(false),
      trialExpired,
      clearTrialExpired: () => setTrialExpired(null),
      signInWithPassword: async (email, password) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      },
      registerWithCode: async (email, password, marketingOptIn = false) => {
        const normalized = email.trim().toLowerCase();
        await api.post('/auth/register', { email: normalized, password });
        pendingPassword.current = { email: normalized, password, marketingOptIn };
      },
      verifyCode: async (email, code) => {
        const normalized = email.trim().toLowerCase();
        await api.post('/auth/verify', { email: normalized, code: code.trim() });

        // Konto ist jetzt freigeschaltet - direkt einloggen, damit der
        // Nutzer nicht sein gerade vergebenes Passwort noch einmal
        // eintippen muss. Nur moeglich, wenn die Registrierung in dieser
        // App-Sitzung passiert ist (siehe pendingPassword); wurde die App
        // zwischendurch neu gestartet, fuehrt der Aufrufer zum Login.
        const pending = pendingPassword.current;
        if (!pending || pending.email !== normalized) {
          throw new Error('BESTAETIGT_BITTE_ANMELDEN');
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: normalized,
          password: pending.password,
        });
        if (error) throw error;
        const mitEinwilligung = pending.marketingOptIn;
        pendingPassword.current = null;
        setJustRegistered(true);
        // Haekchen "Tipps und Angebote per E-Mail": jetzt (eingeloggt) die Bestaetigungs-Mail
        // anfordern. Scheitert das, bleibt die Registrierung unberuehrt - in den Einstellungen
        // laesst sich die Einwilligung jederzeit nachholen.
        if (mitEinwilligung) void einwilligungAnfragen(true, getSprache()).catch(() => undefined);
      },
      resendCode: async (email) => {
        await api.post('/auth/resend-code', { email: email.trim().toLowerCase() });
      },
      signOut: async () => {
        pendingPassword.current = null;
        setTrialExpired(null);
        await supabase.auth.signOut();
      },
    }),
    [session, isLoading, justRegistered, trialExpired],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth() muss innerhalb eines <AuthProvider> aufgerufen werden');
  }
  return ctx;
}
