/**
 * The Calc right-click menu — pure model.
 *
 * Kept out of the component so the item sets are unit-tested rather than
 * eyeballed: every entry dispatches a real `.uno:` command, and a wrong or
 * renamed command dispatches SILENTLY (the item looks fine and does nothing).
 * The names here are verified against the live engine by
 * e2e/office/AC-calc-uno.mjs — change one and re-run that.
 */

export type MenuTarget = 'cell' | 'column' | 'row'

export interface MenuItem {
  /** Stable id, also the test hook. */
  id: string
  label: string
  /** True for a command that ARMS a mode rather than acting once (the format
   *  painter). The caller keeps it visibly active until the next click. */
  mode?: boolean
  /** The command to dispatch. Absent for a separator. */
  uno?: string
  /** A non-uno action the component handles (e.g. opening a dialog). */
  action?: MenuAction
  separator?: boolean
  /** Shown right-aligned; purely informational. */
  shortcut?: string
  /** Engine says this cannot run right now — shown greyed, not clickable. */
  disabled?: boolean
  /** Checkable item state (a toggle or a radio choice), when the engine reports one. */
  checked?: boolean
  /** A submenu. Items with children never dispatch themselves. */
  children?: MenuItem[]
  /** Argument for an action (a sheet index, a slide op, a layout number …). */
  arg?: string
}

/** Dialogs, modes and part operations the renderer owns instead of the engine. */
export type MenuAction =
  | 'formatCells' | 'borders' | 'hyperlink' | 'table' | 'condformat' | 'datavalidation' | 'find' | 'symbol' | 'image'
  | 'sheetop' | 'slideop' | 'present'

const SEP = (id: string): MenuItem => ({ id, label: '', separator: true })

/**
 * Clipboard + editing items common to every target.
 *
 * `.uno:Delete` clears the CONTENTS of the selection — it does not remove cells.
 * That distinction matters: users reach for "delete" expecting the content gone,
 * and removing cells would shift the sheet under them.
 */
const CLIPBOARD: MenuItem[] = [
  { id: 'cut', label: 'Cut', uno: '.uno:Cut', shortcut: '⌘X' },
  { id: 'copy', label: 'Copy', uno: '.uno:Copy', shortcut: '⌘C' },
  { id: 'paste', label: 'Paste', uno: '.uno:Paste', shortcut: '⌘V' },
  { id: 'paste-special', label: 'Paste special…', uno: '.uno:PasteSpecial' },
]

const FORMAT: MenuItem[] = [
  { id: 'wrap', label: 'Wrap text', uno: '.uno:WrapText' },
  { id: 'merge', label: 'Merge cells', uno: '.uno:ToggleMergeCells' },
  // The format painter is a MODE, not an action: it arms, and the NEXT click
  // applies the style. The component tracks that so the UI can show it armed —
  // a button that looks like it did nothing is how people conclude it's broken.
  { id: 'paintbrush', label: 'Copy formatting', uno: '.uno:FormatPaintbrush', mode: true },
  { id: 'clear-format', label: 'Clear formatting', uno: '.uno:ResetAttributes' },
  { id: 'format-cells', label: 'Format cells…', action: 'formatCells' },
  { id: 'borders', label: 'Borders…', action: 'borders' },
]

/** Fill + vertical alignment — everyday shaping that had no home before. */
const FILL_ALIGN: MenuItem[] = [
  { id: 'fill-down', label: 'Fill down', uno: '.uno:FillDown', shortcut: '⌘D' },
  { id: 'fill-right', label: 'Fill right', uno: '.uno:FillRight', shortcut: '⌘R' },
  { id: 'align-top', label: 'Align top', uno: '.uno:AlignTop' },
  { id: 'align-middle', label: 'Align middle', uno: '.uno:AlignVCenter' },
  { id: 'align-bottom', label: 'Align bottom', uno: '.uno:AlignBottom' },
]

/**
 * The menu for a right-click target.
 *
 * Row and column menus deliberately differ from the cell menu: "Insert row
 * above" belongs on a row header, while a cell click offers both axes. Offering
 * every operation everywhere reads as clutter and makes the destructive ones
 * easier to hit by accident.
 */
export function menuFor(target: MenuTarget): MenuItem[] {
  if (target === 'column') {
    return [
      ...CLIPBOARD,
      SEP('s1'),
      { id: 'ins-col-left', label: 'Insert column left', uno: '.uno:InsertColumnsBefore' },
      { id: 'ins-col-right', label: 'Insert column right', uno: '.uno:InsertColumnsAfter' },
      { id: 'del-col', label: 'Delete column', uno: '.uno:DeleteColumns' },
      { id: 'clear', label: 'Clear contents', uno: '.uno:Delete', shortcut: '⌫' },
      SEP('s2'),
      { id: 'hide-col', label: 'Hide columns', uno: '.uno:HideColumn' },
      { id: 'show-col', label: 'Show columns', uno: '.uno:ShowColumn' },
      { id: 'col-width', label: 'Column width…', uno: '.uno:ColumnWidth' },
      { id: 'opt-width', label: 'Optimal width', uno: '.uno:SetOptimalColumnWidth' },
      SEP('s3'),
      ...FORMAT,
    ]
  }
  if (target === 'row') {
    return [
      ...CLIPBOARD,
      SEP('s1'),
      { id: 'ins-row-above', label: 'Insert row above', uno: '.uno:InsertRowsBefore' },
      { id: 'ins-row-below', label: 'Insert row below', uno: '.uno:InsertRowsAfter' },
      { id: 'del-row', label: 'Delete row', uno: '.uno:DeleteRows' },
      { id: 'clear', label: 'Clear contents', uno: '.uno:Delete', shortcut: '⌫' },
      SEP('s2'),
      { id: 'hide-row', label: 'Hide rows', uno: '.uno:HideRow' },
      { id: 'show-row', label: 'Show rows', uno: '.uno:ShowRow' },
      { id: 'row-height', label: 'Row height…', uno: '.uno:RowHeight' },
      { id: 'opt-height', label: 'Optimal height', uno: '.uno:SetOptimalRowHeight' },
      SEP('s3'),
      ...FORMAT,
    ]
  }
  return [
    ...CLIPBOARD,
    SEP('s1'),
    { id: 'ins-row-above', label: 'Insert row above', uno: '.uno:InsertRowsBefore' },
    { id: 'ins-row-below', label: 'Insert row below', uno: '.uno:InsertRowsAfter' },
    { id: 'ins-col-left', label: 'Insert column left', uno: '.uno:InsertColumnsBefore' },
    { id: 'ins-col-right', label: 'Insert column right', uno: '.uno:InsertColumnsAfter' },
    SEP('s2'),
    { id: 'ins-cells', label: 'Insert cells…', uno: '.uno:InsertCell' },
    { id: 'del-cells', label: 'Delete cells…', uno: '.uno:DeleteCell' },
    { id: 'del-row', label: 'Delete row', uno: '.uno:DeleteRows' },
    { id: 'del-col', label: 'Delete column', uno: '.uno:DeleteColumns' },
    { id: 'clear', label: 'Clear contents', uno: '.uno:Delete', shortcut: '⌫' },
    SEP('s3'),
    ...FILL_ALIGN,
    SEP('s4'),
    ...FORMAT,
  ]
}

/**
 * Keep the menu on screen.
 *
 * A right-click near the right or bottom edge would otherwise open a menu that
 * runs off the viewport with its items unreachable — the flip is what makes the
 * menu usable in the last column, which is exactly where "insert column right"
 * gets used.
 */
export function placeMenu(
  x: number,
  y: number,
  menu: { w: number; h: number },
  view: { w: number; h: number },
  margin = 8,
): { x: number; y: number } {
  let left = x
  let top = y
  if (left + menu.w + margin > view.w) left = Math.max(margin, x - menu.w)
  if (top + menu.h + margin > view.h) top = Math.max(margin, y - menu.h)
  // Still too tall for the viewport (a long menu on a short window): pin to the
  // top margin so the first items are reachable rather than clipped off-screen.
  if (top + menu.h + margin > view.h) top = margin
  return { x: Math.max(margin, left), y: Math.max(margin, top) }
}
