import { describe, expect, it } from 'vitest'
import { SLIDE_LAYOUTS, sheetTabMenu, slideThumbMenu } from './partMenu'

describe('sheetTabMenu', () => {
  it('targets the clicked tab, not the current sheet', () => {
    const m = sheetTabMenu({ names: ['Data', 'Q3', 'Notes'], visible: [true, true, true], index: 1 })
    expect(m.find((i) => i.id === 'sheet-duplicate')?.arg).toBe('duplicate|1')
    expect(m.find((i) => i.id === 'sheet-delete')?.label).toBe('Delete "Q3"')
  })
  it('greys out what cannot happen: delete the last sheet, move past the ends, hide the last visible', () => {
    const one = sheetTabMenu({ names: ['Only'], visible: [true], index: 0 })
    expect(one.find((i) => i.id === 'sheet-delete')?.disabled).toBe(true)
    expect(one.find((i) => i.id === 'sheet-left')?.disabled).toBe(true)
    expect(one.find((i) => i.id === 'sheet-right')?.disabled).toBe(true)
    expect(one.find((i) => i.id === 'sheet-hide')?.disabled).toBe(true)
    const three = sheetTabMenu({ names: ['A', 'B', 'C'], visible: [true, true, true], index: 2 })
    expect(three.find((i) => i.id === 'sheet-right')?.disabled).toBe(true)
    expect(three.find((i) => i.id === 'sheet-left')?.disabled).toBe(false)
  })
  it('lists hidden sheets under Show, by name', () => {
    const m = sheetTabMenu({ names: ['A', 'Secret', 'C'], visible: [true, false, true], index: 0 })
    const show = m.find((i) => i.id === 'sheet-show')
    expect(show?.children?.map((c) => c.label)).toEqual(['Secret'])
    expect(show?.children?.[0].arg).toBe('show|0|Secret')
    expect(sheetTabMenu({ names: ['A'], visible: [true], index: 0 }).find((i) => i.id === 'sheet-show')).toBeUndefined()
  })
  it('offers tab colours as a submenu with the model colour in the argument', () => {
    const m = sheetTabMenu({ names: ['A'], visible: [true], index: 0 })
    const colour = m.find((i) => i.id === 'sheet-color')
    expect(colour?.children?.[0]).toMatchObject({ label: 'None', arg: 'color|0|-1' })
    expect(colour?.children?.some((c) => c.label === 'Blue')).toBe(true)
  })
})

describe('slideThumbMenu', () => {
  it('carries the clicked index into every operation', () => {
    const m = slideThumbMenu({ count: 5, index: 2, visible: [true, true, true, true, true] })
    expect(m.find((i) => i.id === 'slide-duplicate')?.arg).toBe('duplicate|2')
    expect(m.find((i) => i.id === 'slide-present')?.arg).toBe('2')
  })
  it('lists all sixteen layouts with their AssignLayout numbers', () => {
    const m = slideThumbMenu({ count: 1, index: 0, visible: [true] })
    const layout = m.find((i) => i.id === 'slide-layout')
    expect(layout?.children?.length).toBe(16)
    expect(SLIDE_LAYOUTS.length).toBe(16)
    expect(layout?.children?.find((c) => c.label === 'Title Only')?.arg).toBe('layout|0|19')
  })
  it('flips Hide/Show for a hidden slide and bounds the move items', () => {
    const hidden = slideThumbMenu({ count: 3, index: 2, visible: [true, true, false] })
    expect(hidden.find((i) => i.id === 'slide-show')).toBeDefined()
    expect(hidden.find((i) => i.id === 'slide-hide')).toBeUndefined()
    const move = hidden.find((i) => i.id === 'slide-move')
    expect(move?.children?.find((c) => c.id === 'slide-move-down')?.disabled).toBe(true)
    expect(move?.children?.find((c) => c.id === 'slide-move-up')?.disabled).toBe(false)
    expect(move?.children?.find((c) => c.id === 'slide-move-up')?.arg).toBe('moveto|2|1')
  })
  it('will not delete the only slide', () => {
    expect(slideThumbMenu({ count: 1, index: 0, visible: [true] }).find((i) => i.id === 'slide-delete')?.disabled).toBe(true)
  })

  it('slide menu opens the transition tab for the clicked slide', () => {
    const items = slideThumbMenu({ count: 3, index: 1, visible: [true, true, true] })
    const t = items.find((i) => i.id === 'slide-transition')
    expect(t).toMatchObject({ action: 'slideop', arg: 'transition|1' })
  })
})
