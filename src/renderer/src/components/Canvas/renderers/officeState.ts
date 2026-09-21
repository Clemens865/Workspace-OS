/**
 * What the engine says about a command right now.
 *
 * LOK_CALLBACK_STATE_CHANGED arrives as `.uno:Bold=true`, `.uno:Cut=disabled`,
 * `.uno:Paste=enabled`, `.uno:StyleApply=Heading 1`, `.uno:FontHeight=12`,
 * … — one string per command, accumulated by the renderer into a flat record.
 * This module is the one place that knows how to read those strings, so the
 * ribbon, the native menu and the context menu all agree on what "checked" and
 * "disabled" mean.
 */

export interface CommandState {
  /** False only when the engine explicitly said `disabled`. Unknown = enabled. */
  enabled: boolean
  /** True/false for toggles and radio states; null when the command has no check state. */
  checked: boolean | null
  /** The raw value for string-valued commands (style name, font, size, …). */
  value: string | null
}

export function commandState(active: Record<string, string>, cmd: string): CommandState {
  const v = active[cmd]
  if (v === undefined) return { enabled: true, checked: null, value: null }
  if (v === 'disabled') return { enabled: false, checked: null, value: null }
  if (v === 'enabled') return { enabled: true, checked: null, value: null }
  if (v === 'true') return { enabled: true, checked: true, value: null }
  if (v === 'false') return { enabled: true, checked: false, value: null }
  return { enabled: true, checked: null, value: v }
}

/**
 * The commands the native menu bar shows a check mark or greys out. Kept
 * short on purpose: every change to one of these rebuilds the macOS menu.
 */
export const MENU_STATE_COMMANDS = [
  '.uno:Undo', '.uno:Redo', '.uno:Cut', '.uno:Copy', '.uno:Paste',
  '.uno:Bold', '.uno:Italic', '.uno:Underline', '.uno:Strikeout', '.uno:SubScript', '.uno:SuperScript',
  '.uno:LeftPara', '.uno:CenterPara', '.uno:RightPara', '.uno:JustifyPara',
  '.uno:AlignLeft', '.uno:AlignHorizontalCenter', '.uno:AlignRight',
  '.uno:DefaultBullet', '.uno:DefaultNumbering',
  '.uno:ControlCodes', '.uno:ToggleSheetGrid', '.uno:ViewRowColumnHeaders', '.uno:GridVisible',
  '.uno:TrackChanges', '.uno:FreezePanes', '.uno:DataFilterAutoFilter',
] as const

export interface MenuStateSnapshot {
  checked: Record<string, boolean>
  disabled: string[]
}

/** The compact subset the main process needs for the menu bar. Deterministic key order, so snapshots compare by JSON. */
export function menuStateSnapshot(active: Record<string, string>): MenuStateSnapshot {
  const checked: Record<string, boolean> = {}
  const disabled: string[] = []
  // Every boolean or disabled state the engine reported, in a stable order:
  // the menu bar is built from a data table with many toggles, and this side
  // does not know which ones it shows.
  for (const cmd of Object.keys(active).sort()) {
    const s = commandState(active, cmd)
    if (s.checked !== null) checked[cmd] = s.checked
    if (!s.enabled) disabled.push(cmd)
  }
  return { checked, disabled }
}

export function sameSnapshot(a: MenuStateSnapshot | null, b: MenuStateSnapshot): boolean {
  if (!a) return false
  if (a.disabled.length !== b.disabled.length || a.disabled.some((c, i) => c !== b.disabled[i])) return false
  const ak = Object.keys(a.checked), bk = Object.keys(b.checked)
  if (ak.length !== bk.length) return false
  return ak.every((k) => a.checked[k] === b.checked[k])
}
