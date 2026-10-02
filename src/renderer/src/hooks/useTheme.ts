import { useSyncExternalStore, useCallback } from 'react'

/** What the app shows. */
export type Theme = 'light' | 'dark'
/** What the person chose: a theme, or whatever macOS shows. */
export type ThemePref = Theme | 'system'

const KEY = 'workspace-os:theme'

const systemDark = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'dark' || v === 'system' ? v : 'light'
  } catch {
    return 'light'
  }
}

/** The theme a preference shows right now. */
export function resolveTheme(pref: ThemePref, dark = systemDark()): Theme {
  return pref === 'system' ? (dark ? 'dark' : 'light') : pref
}

// One shared store: Settings, the View ▸ Appearance menu and the landscape's
// WebGL backdrop must all see the same theme and update live.
let pref: ThemePref = readPref()
let theme: Theme = resolveTheme(pref)
const listeners = new Set<() => void>()

function apply(): void {
  const next = resolveTheme(pref)
  const changed = next !== theme
  theme = next
  if (typeof document !== 'undefined') document.documentElement.setAttribute('data-theme', theme)
  if (changed) listeners.forEach((l) => l())
}

/** Set the preference ('system' follows macOS from then on). */
export function setThemePref(next: ThemePref): void {
  pref = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* private mode: for this session only */
  }
  apply()
  listeners.forEach((l) => l())
}

/** Set a theme outright (the View ▸ Appearance menu). */
export function setTheme(next: Theme): void {
  setThemePref(next)
}

// "Match macOS" follows the system switch while the app runs.
if (typeof window !== 'undefined') {
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (pref === 'system') apply()
  })
}

/** The theme shown, the preference behind it, and setters. */
export function useTheme(): { theme: Theme; pref: ThemePref; toggle: () => void; set: (t: Theme) => void; setPref: (p: ThemePref) => void } {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => theme,
  )
  const p = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => pref,
  )
  const toggle = useCallback(() => setThemePref(theme === 'light' ? 'dark' : 'light'), [])
  return { theme: t, pref: p, toggle, set: setTheme, setPref: setThemePref }
}

/** Subscribe outside React (the WebGL backdrop). */
export function onThemeChange(l: (t: Theme) => void): () => void {
  const f = (): void => l(theme)
  listeners.add(f)
  return () => listeners.delete(f)
}
export const currentTheme = (): Theme => theme
