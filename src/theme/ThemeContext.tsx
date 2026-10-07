import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Die 4 unabhaengigen Theme-Parameter (siehe Projektkonzept, Design-System).
// Bewusst getrennt von funktionalen Einstellungen wie "Brutzel anzeigen"
// oder "Grosse Schrift" - Theme ist rein visuell (siehe Architekturprinzip
// im Umsetzungskonzept Abschnitt 5).

export type AccentColor = 'gruen' | 'orange' | 'tuerkis' | 'pink' | 'gelb' | 'bernstein';
export type BackgroundStyle = 'warm-hell' | 'kuehl-hell' | 'dunkel';
export type TypographyStyle = 'weich' | 'clean';
export type RadiusStyle = 'weich' | 'clean'; // grosse vs. kleine Ecken (FAB bleibt immer rund)

export interface ThemeConfig {
  accent: AccentColor;
  background: BackgroundStyle;
  typography: TypographyStyle;
  radius: RadiusStyle;
}

const DEFAULT_THEME: ThemeConfig = {
  accent: 'bernstein',
  background: 'warm-hell',
  typography: 'weich',
  radius: 'weich',
};

// Farbwerte je Accent - Gradient-Paar fuer Buttons/FAB/Badges
const ACCENT_GRADIENTS: Record<AccentColor, [string, string]> = {
  gruen: ['#16A34A', '#65A30D'],
  orange: ['#EA580C', '#FB923C'],
  tuerkis: ['#0D9488', '#0891B2'],
  pink: ['#DB2777', '#F472B6'],
  gelb: ['#EAB308', '#F59E0B'],
  bernstein: ['#B07A12', '#D99A2B'],
};

const BACKGROUND_COLORS: Record<BackgroundStyle, { bg: string; card: string; text: string; muted: string; cardBorder: string }> = {
  'warm-hell': { bg: '#FBF7EF', card: '#FFFFFF', text: '#2A241C', muted: '#78716C', cardBorder: '#EDE6D8' },
  'kuehl-hell': { bg: '#F5F8F9', card: '#FFFFFF', text: '#1A2226', muted: '#5B6B6E', cardBorder: '#E1E8EA' },
  dunkel: { bg: '#121212', card: '#1F1F1F', text: '#FAFAF9', muted: '#A8A29E', cardBorder: '#333333' },
};

const RADIUS_VALUES: Record<RadiusStyle, { sm: number; md: number; lg: number }> = {
  weich: { sm: 10, md: 16, lg: 26 },
  clean: { sm: 4, md: 6, lg: 10 },
};

interface ThemeContextValue {
  theme: ThemeConfig;
  setTheme: (partial: Partial<ThemeConfig>) => void;
  colors: (typeof BACKGROUND_COLORS)[BackgroundStyle];
  gradient: [string, string];
  radius: (typeof RADIUS_VALUES)[RadiusStyle];
  isLoaded: boolean;
}

const STORAGE_KEY = 'meinkochbuch:theme';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeConfig>(DEFAULT_THEME);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          setThemeState({ ...DEFAULT_THEME, ...JSON.parse(raw) });
        }
      })
      .catch(() => {
        // Beim ersten Start oder falls Storage nicht lesbar: Default behalten
      })
      .finally(() => setIsLoaded(true));
  }, []);

  const setTheme = (partial: Partial<ThemeConfig>) => {
    setThemeState((prev) => {
      const next = { ...prev, ...partial };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {
        // Persistenz-Fehler ignorieren wir bewusst - Theme bleibt fuer die
        // laufende Session trotzdem korrekt, nur nicht dauerhaft gespeichert
      });
      return next;
    });
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      colors: BACKGROUND_COLORS[theme.background],
      gradient: ACCENT_GRADIENTS[theme.accent],
      radius: RADIUS_VALUES[theme.radius],
      isLoaded,
    }),
    [theme, isLoaded],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() muss innerhalb eines <ThemeProvider> aufgerufen werden');
  }
  return ctx;
}
