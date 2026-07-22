// Theme and color-mode helpers for diffwiki.
// localStorage keys intentionally use the diffwiki: namespace.
// All document/localStorage access is guarded for SSR safety.
import { THEME_NAMES } from './themes';

export const COLOR_MODE_KEY = 'diffwiki:color-mode' as const;
export const THEME_KEY = 'diffwiki:theme' as const;
export type ColorMode = 'light' | 'dark';
export type ThemeName = string; // any diffbook theme name — see src/lib/themes.ts

const THEME_PREFIX = 'theme-';

// ── Color mode ───────────────────────────────────────────────────────────

/**
 * Read the persisted color mode from localStorage.
 * Falls back to 'light' when storage is unavailable or unset.
 */
export function getInitialColorMode(): ColorMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = localStorage.getItem(COLOR_MODE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* storage unavailable */
  }
  return 'light';
}

/**
 * Apply a color mode by toggling the `.dark` class on <html>.
 * Also persists the choice to localStorage.
 */
export function applyColorMode(mode: ColorMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (mode === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Toggle between light and dark and return the new mode.
 */
export function toggleColorMode(): ColorMode {
  if (typeof document === 'undefined') return 'light';
  const isDark = document.documentElement.classList.toggle('dark');
  const mode: ColorMode = isDark ? 'dark' : 'light';
  try {
    localStorage.setItem(COLOR_MODE_KEY, mode);
  } catch {
    /* storage unavailable */
  }
  return mode;
}

// ── Theme ────────────────────────────────────────────────────────────────

/**
 * Read the persisted theme from localStorage.
 * Falls back to 'default'.
 */
export function getInitialTheme(): ThemeName {
  if (typeof window === 'undefined') return 'default';
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved && THEME_NAMES.includes(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return 'default';
}

/**
 * Apply a theme by swapping the `theme-*` class on <html>. Every theme (including
 * 'default') has a `.theme-{name}` block from its copied file, so we always set
 * the class. Also persists the choice to localStorage.
 */
export function applyTheme(name: ThemeName): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const toRemove: string[] = [];
  root.classList.forEach((cls) => {
    if (cls.startsWith(THEME_PREFIX)) toRemove.push(cls);
  });
  for (const cls of toRemove) root.classList.remove(cls);
  root.classList.add(`${THEME_PREFIX}${name}`);
  try {
    localStorage.setItem(THEME_KEY, name);
  } catch {
    /* storage unavailable */
  }
}
