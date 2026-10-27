/**
 * The platform the renderer runs on, for labels. Shortcuts are written in Mac
 * notation throughout the app (⌘J, ⌥⌘A, ⇧Enter); on Windows and Linux the keys
 * are Ctrl, Alt and Shift, so labels go through keyLabel / keysIn before they are
 * shown. Without a navigator (unit tests in Node) the Mac notation is kept.
 */
const platform = typeof navigator !== 'undefined' ? navigator.platform || '' : 'MacIntel'

export const IS_MAC = /^Mac/i.test(platform)
export const IS_WINDOWS = /^Win/i.test(platform)

/** "Finder", "Explorer" or "the file manager", for Reveal/Show-in labels. */
export const FILE_MANAGER = IS_MAC ? 'Finder' : IS_WINDOWS ? 'Explorer' : 'the file manager'

/** "macOS", "Windows" or "the system", for "match the system" labels. */
export const SYSTEM_NAME = IS_MAC ? 'macOS' : IS_WINDOWS ? 'Windows' : 'the system'

const MODS: Record<string, string> = { '⌃': 'Ctrl', '⌘': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift' }
const ORDER = ['Ctrl', 'Alt', 'Shift']
const KEY_NAMES: Record<string, string> = { '⏎': 'Enter', '−': '-' }

/** One Mac shortcut ('⌘⇧A', '⌥⌘J', '⇧Enter') as this platform writes it ('Ctrl+Shift+A'). */
export function keyLabel(mac: string, isMac = IS_MAC): string {
  if (isMac) return mac
  const mods = new Set<string>()
  let key = ''
  for (const ch of mac) {
    if (MODS[ch]) mods.add(MODS[ch])
    else key += ch
  }
  if (!mods.size) return mac
  return [...ORDER.filter((m) => mods.has(m)), KEY_NAMES[key] ?? key].join('+')
}

const SEQUENCE = /[⌃⌥⇧⌘]+(?:F\d{1,2}|Enter|⏎|[A-Za-z0-9+−\-=,.[\]\\/])/g

/** Every Mac shortcut inside a text ("Hide (⌘J)") rewritten for this platform ("Hide (Ctrl+J)"). */
export function keysIn(text: string, isMac = IS_MAC): string {
  return isMac ? text : text.replace(SEQUENCE, (m) => keyLabel(m, false))
}
