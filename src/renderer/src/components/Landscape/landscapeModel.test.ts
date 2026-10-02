import { describe, it, expect } from 'vitest'
import { DOCK, MENU_EXTRAS, menuGroups, unreachableRails } from './landscapeModel'
import { RAIL_ITEMS } from '../Shell/shellModel'

describe('landscape menu', () => {
  it('reaches every real rail surface (phase 1 parity: two actions, Menu → item)', () => {
    expect(unreachableRails()).toEqual([])
  })

  it('lists no placeholder surface', () => {
    const placeholders = new Set(RAIL_ITEMS.filter((r) => r.placeholder).map((r) => r.id))
    const listed = menuGroups().flatMap((g) => g.items.map((i) => i.rail))
    expect(listed.filter((r) => placeholders.has(r))).toEqual([])
  })

  it('lists each surface once, with a label and a hint', () => {
    const items = menuGroups().flatMap((g) => g.items)
    expect(new Set(items.map((i) => i.rail)).size).toBe(items.length)
    for (const i of items) {
      expect(i.label).not.toBe('')
      expect(i.hint).not.toBe('')
    }
  })
})

describe('menu extras', () => {
  it('sit in an existing group, each with a label and a hint', () => {
    const groups = new Set(menuGroups().map((g) => g.title))
    for (const e of MENU_EXTRAS) {
      expect(groups.has(e.group)).toBe(true)
      expect(e.label && e.hint).toBeTruthy()
    }
  })
})

describe('landscape dock', () => {
  it('follows the design order', () => {
    expect(DOCK.map((d) => d.id)).toEqual(['overview', 'inbox', 'cases', 'library', 'menu'])
  })

  it('points stage items at real surfaces', () => {
    const real = new Set(RAIL_ITEMS.filter((r) => !r.placeholder).map((r) => r.id))
    for (const d of DOCK) if (d.stage) expect(real.has(d.stage)).toBe(true)
  })
})
