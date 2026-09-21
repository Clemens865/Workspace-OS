/**
 * Right-click menus for the parts strip: Calc sheet tabs and Impress slide
 * thumbnails. Pure models, like calcMenu.ts.
 *
 * These live outside the tile area, so the engine cannot answer a right-click
 * on them (LOK_CALLBACK_CONTEXT_MENU only knows the document surface). The
 * items follow LibreOffice's own sheettab.xml / pagepane.xml, minus what needs
 * a file picker, and dispatch through `sheetop` / `slideop` actions carrying
 * the op and the target index in `arg` — always the part that was clicked,
 * never "the current one".
 */
import type { MenuItem } from './calcMenu'

const SEP = (id: string): MenuItem => ({ id, label: '', separator: true })

/** Tab colours: the palette the ribbon uses, decimal RGB for the model API. */
export const TAB_COLORS: [string, number][] = [
  ['None', -1], ['Red', 12582912], ['Orange', 15564081], ['Yellow', 16760832],
  ['Green', 3046194], ['Teal', 1810836], ['Blue', 2052217], ['Purple', 7352480], ['Gray', 8421504],
]

export interface SheetMenuInput {
  names: string[]
  /** Index-aligned with names; hidden sheets are still parts. */
  visible: boolean[]
  /** The tab that was right-clicked. */
  index: number
}

export function sheetTabMenu({ names, visible, index }: SheetMenuInput): MenuItem[] {
  const name = names[index] || `Sheet${index + 1}`
  const visibleCount = visible.filter(Boolean).length || names.length
  const hidden = names.map((n, i) => ({ n: n || `Sheet${i + 1}`, i })).filter(({ i }) => visible[i] === false)
  const items: MenuItem[] = [
    { id: 'sheet-insert', label: 'Insert sheet', action: 'sheetop', arg: `insert|${index}` },
    { id: 'sheet-duplicate', label: 'Duplicate sheet', action: 'sheetop', arg: `duplicate|${index}` },
    { id: 'sheet-rename', label: 'Rename…', action: 'sheetop', arg: `rename|${index}` },
    { id: 'sheet-delete', label: `Delete "${name}"`, action: 'sheetop', arg: `delete|${index}`, disabled: names.length <= 1 },
    SEP('s1'),
    { id: 'sheet-left', label: 'Move left', action: 'sheetop', arg: `moveleft|${index}`, disabled: index <= 0 },
    { id: 'sheet-right', label: 'Move right', action: 'sheetop', arg: `moveright|${index}`, disabled: index >= names.length - 1 },
    SEP('s2'),
    { id: 'sheet-hide', label: 'Hide sheet', action: 'sheetop', arg: `hide|${index}`, disabled: visibleCount <= 1 },
  ]
  if (hidden.length > 0) {
    items.push({
      id: 'sheet-show',
      label: 'Show sheet',
      children: hidden.map(({ n, i }) => ({ id: `sheet-show-${i}`, label: n, action: 'sheetop', arg: `show|${index}|${n}` })),
    })
  }
  items.push({
    id: 'sheet-color',
    label: 'Tab colour',
    children: TAB_COLORS.map(([label, v]) => ({ id: `sheet-color-${label.toLowerCase()}`, label, action: 'sheetop', arg: `color|${index}|${v}` })),
  })
  return items
}

/** The 16 Impress auto-layouts, in LibreOffice's own order (AssignLayout WhatLayout). */
export const SLIDE_LAYOUTS: [string, number][] = [
  ['Blank Slide', 20], ['Title Only', 19], ['Title and Subtitle', 0], ['Title, Content', 1], ['Centered Text', 32],
  ['Two Content', 3], ['Three Content (1 Left, 2 Right)', 12], ['Three Content (2 Left, 1 Right)', 15],
  ['Two Content (1 over 1)', 14], ['Three Content (2 on Top over 1)', 16], ['Four Content', 18], ['Six Content', 34],
  ['Vertical Title, Vertical Text', 28], ['Vertical Title, Text, Chart', 27], ['Title, Vertical Text', 29], ['Title, Two Vertical Boxes', 30],
]

export interface SlideMenuInput {
  count: number
  index: number
  /** Index-aligned; a hidden slide is skipped in the show. */
  visible: boolean[]
}

export function slideThumbMenu({ count, index, visible }: SlideMenuInput): MenuItem[] {
  const hidden = visible[index] === false
  return [
    { id: 'slide-new', label: 'New slide', action: 'slideop', arg: `new|${index}` },
    { id: 'slide-duplicate', label: 'Duplicate slide', action: 'slideop', arg: `duplicate|${index}` },
    { id: 'slide-rename', label: 'Rename…', action: 'slideop', arg: `rename|${index}` },
    { id: 'slide-delete', label: 'Delete slide', action: 'slideop', arg: `delete|${index}`, disabled: count <= 1 },
    SEP('s1'),
    hidden
      ? { id: 'slide-show', label: 'Show slide', action: 'slideop', arg: `show|${index}` }
      : { id: 'slide-hide', label: 'Hide slide', action: 'slideop', arg: `hide|${index}` },
    {
      id: 'slide-layout',
      label: 'Layout',
      children: SLIDE_LAYOUTS.map(([label, n]) => ({ id: `slide-layout-${n}`, label, action: 'slideop', arg: `layout|${index}|${n}` })),
    },
    {
      id: 'slide-move',
      label: 'Move',
      children: [
        { id: 'slide-move-first', label: 'Slide to start', action: 'slideop', arg: `moveto|${index}|0`, disabled: index === 0 },
        { id: 'slide-move-up', label: 'Slide up', action: 'slideop', arg: `moveto|${index}|${index - 1}`, disabled: index === 0 },
        { id: 'slide-move-down', label: 'Slide down', action: 'slideop', arg: `moveto|${index}|${index + 1}`, disabled: index >= count - 1 },
        { id: 'slide-move-last', label: 'Slide to end', action: 'slideop', arg: `moveto|${index}|${count - 1}`, disabled: index >= count - 1 },
      ],
    },
    SEP('s2'),
    { id: 'slide-transition', label: 'Slide transition…', action: 'slideop', arg: `transition|${index}` },
    { id: 'slide-present', label: 'Start slideshow from here', action: 'present', arg: String(index) },
  ]
}
