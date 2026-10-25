"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { safeStorage } from "./storage";
import { useMediaQuery } from "./use-media-query";

export type ThemePreference = "system" | "dark" | "light";
export type ResolvedTheme = "dark" | "light";

import { THEME_STORAGE_KEY as STORAGE_KEY } from "./theme-script";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// Preference lives in localStorage; a tiny external store keeps every
// provider in sync and gives SSR a stable snapshot ("system" / dark), so
// hydration never mismatches.
const prefListeners = new Set<() => void>();
const readPreference = () => safeStorage.get<ThemePreference>(STORAGE_KEY, "system");
const subscribePreference = (cb: () => void) => {
  prefListeners.add(cb);
  return () => prefListeners.delete(cb);
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const preference = useSyncExternalStore(subscribePreference, readPreference, () => "system" as const);
  const prefersLight = useMediaQuery("(prefers-color-scheme: light)", false);
  const resolved: ResolvedTheme = preference === "system" ? (prefersLight ? "light" : "dark") : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    safeStorage.set(STORAGE_KEY, next);
    prefListeners.forEach((l) => l());
  }, []);

  const value = useMemo(() => ({ preference, resolved, setPreference }), [preference, resolved, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");
  return value;
}