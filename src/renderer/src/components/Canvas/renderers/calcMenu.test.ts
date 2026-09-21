import { describe, it, expect } from 'vitest'
import { menuFor, placeMenu } from './calcMenu'

/** Every uno name below is verified against the live engine by
 *  e2e/office/AC-calc-uno.mjs — these tests pin the wiring, that proves the
 *  commands are real. A silently-wrong name is the failure mode both guard. */
const unosOf = (target: Parameters<typeof menuFor>[0]): string[] =>
  menuFor(target).filter((i) => i.uno).map((i) => i.uno!)

describe('menuFor', () => {
  it('offers clipboard actions on every target', () => {
    for (const t of ['cell', 'column', 'row'] as const) {
      expect(unosOf(t)).toEqual(expect.arrayContaining(['.uno:Cut', '.uno:Copy', '.uno:Paste', '.uno:PasteSpecial']))
    }
  })

  it('gives a row header row operations and NOT column ones', () => {
    const u = unosOf('row')
    expect(u).toContain('.uno:InsertRowsBefore')
    expect(u).toContain('.uno:InsertRowsAfter')
    expect(u).toContain('.uno:DeleteRows')
    // Offering column ops from a row header is clutter and makes destructive
    // items easier to hit by accident.
    expect(u).not.toContain('.uno:DeleteColumns')
  })

  it('gives a column header column operations and NOT row ones', () => {
    const u = unosOf('column')
    expect(u).toContain('.uno:InsertColumnsBefore')
    expect(u).toContain('.uno:InsertColumnsAfter')
    expect(u).toContain('.uno:DeleteColumns')
    expect(u).not.toContain('.uno:DeleteRows')
  })

  it('gives a cell BOTH axes, since either is plausible from a cell', () => {
    const u = unosOf('cell')
    expect(u).toEqual(expect.arrayContaining([
      '.uno:InsertRowsBefore', '.uno:InsertRowsAfter',
      '.uno:InsertColumnsBefore', '.uno:InsertColumnsAfter',
      '.uno:DeleteRows', '.uno:DeleteColumns',
    ]))
  })

  it('offers wrap text (Zeilenumbruch) everywhere', () => {
    for (const t of ['cell', 'column', 'row'] as const) expect(unosOf(t)).toContain('.uno:WrapText')
  })

  it('uses .uno:Delete for "clear contents" — clearing, not removing cells', () => {
    // Removing cells would shift the sheet under the user, which is not what
    // "delete" means to someone who selected a value.
    const clear = menuFor('cell').find((i) => i.id === 'clear')
    expect(clear?.uno).toBe('.uno:Delete')
    expect(clear?.label).toMatch(/clear/i)
  })

  it('routes dialogs through an action rather than a uno command', () => {
    const fmt = menuFor('cell').find((i) => i.id === 'format-cells')
    expect(fmt?.action).toBe('formatCells')
    expect(fmt?.uno).toBeUndefined()
  })

  it('has no separator at the start or end, and never two in a row', () => {
    for (const t of ['cell', 'column', 'row'] as const) {
      const items = menuFor(t)
      expect(items[0].separator).toBeFalsy()
      expect(items[items.length - 1].separator).toBeFalsy()
      for (let i = 1; i < items.length; i++) {
        expect(items[i].separator && items[i - 1].separator).toBeFalsy()
      }
    }
  })

  it('gives every item a unique id', () => {
    for (const t of ['cell', 'column', 'row'] as const) {
      const ids = menuFor(t).map((i) => i.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })
})

describe('placeMenu', () => {
  const view = { w: 1000, h: 800 }
  const menu = { w: 200, h: 300 }

  it('opens at the pointer when there is room', () => {
    expect(placeMenu(100, 100, menu, view)).toEqual({ x: 100, y: 100 })
  })

  it('flips left near the right edge, so the last column is usable', () => {
    // "Insert column right" is used exactly where the menu would overflow.
    expect(placeMenu(950, 100, menu, view).x).toBe(750)
  })

  it('flips up near the bottom edge', () => {
    expect(placeMenu(100, 700, menu, view).y).toBe(400)
  })

  it('flips both at a corner', () => {
    expect(placeMenu(980, 780, menu, view)).toEqual({ x: 780, y: 480 })
  })

  it('pins to the margin when the menu is taller than the window', () => {
    // Better the first items are reachable than the whole menu clipped away.
    expect(placeMenu(100, 500, { w: 200, h: 900 }, view).y).toBe(8)
  })

  it('never places the menu off the top-left', () => {
    const p = placeMenu(2, 2, menu, view)
    expect(p.x).toBeGreaterThanOrEqual(8)
    expect(p.y).toBeGreaterThanOrEqual(8)
  })
})

describe('the feature-gap additions (all engine-verified in AD-calc-gaps)', () => {
  it('offers the format painter as a MODE, not a one-shot action', () => {
    // Marked so the caller keeps it visibly armed until the next click; without
    // that the button looks like it did nothing.
    const brush = menuFor('cell').find((i) => i.id === 'paintbrush')
    expect(brush?.uno).toBe('.uno:FormatPaintbrush')
    expect(brush?.mode).toBe(true)
  })

  it('offers fill down/right and vertical alignment on a cell', () => {
    const u = unosOf('cell')
    expect(u).toEqual(expect.arrayContaining([
      '.uno:FillDown', '.uno:FillRight',
      '.uno:AlignTop', '.uno:AlignVCenter', '.uno:AlignBottom',
    ]))
  })

  it('offers hide/show and sizing on the matching header only', () => {
    const col = unosOf('column')
    expect(col).toEqual(expect.arrayContaining(['.uno:HideColumn', '.uno:ShowColumn', '.uno:ColumnWidth', '.uno:SetOptimalColumnWidth']))
    expect(col).not.toContain('.uno:HideRow')

    const row = unosOf('row')
    expect(row).toEqual(expect.arrayContaining(['.uno:HideRow', '.uno:ShowRow', '.uno:RowHeight', '.uno:SetOptimalRowHeight']))
    expect(row).not.toContain('.uno:HideColumn')
  })

  it('offers insert/delete CELLS (with shift) on a cell, distinct from whole rows', () => {
    const u = unosOf('cell')
    expect(u).toContain('.uno:InsertCell')
    expect(u).toContain('.uno:DeleteCell')
    expect(u).toContain('.uno:DeleteRows') // both, they mean different things
  })

  it('offers clear formatting separately from clear contents', () => {
    // Two different destructive intents; conflating them loses data or styling.
    const items = menuFor('cell')
    expect(items.find((i) => i.id === 'clear')?.uno).toBe('.uno:Delete')
    expect(items.find((i) => i.id === 'clear-format')?.uno).toBe('.uno:ResetAttributes')
  })
})
