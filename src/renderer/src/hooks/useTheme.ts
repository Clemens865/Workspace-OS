import { useSyncExternalStore, useCallback } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'workspace-os:theme'

function current(): Theme {
  return (document.documentElement.getAttribute('data-theme') as Theme) ?? 'light'
}

// Shared store — the TitleBar toggle and the View ▸ Appearance menu both set
// the theme, so every consumer must see the same value and update live.
let theme: Theme = current()
const listeners = new Set<() => void>()

export function setTheme(next: Theme): void {
  if (next === theme) return
  theme = next
  document.documentElement.setAttribute('data-theme', next)
  localStorage.setItem(KEY, next)
  listeners.forEach((l) => l())
}

/** Reads/sets the app theme, persisting the choice and updating the <html> attribute. */
export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const t = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => theme,
  )
  const toggle = useCallback(() => setTheme(theme === 'light' ? 'dark' : 'light'), [])
  return { theme: t, toggle, set: setTheme }
}
