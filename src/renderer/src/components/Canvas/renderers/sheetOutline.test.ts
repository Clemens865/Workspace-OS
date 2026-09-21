import { describe, expect, it } from 'vitest'
import { outlineDepth, outlineStripSize, outlineToggleArgs, parseOutlineGroups } from './sheetOutline'

describe('sheetOutline', () => {
  it('parses one level of groups', () => {
    const g = parseOutlineGroups('1:3:0:1, ')
    expect(g).toEqual([{ level: 1, start: 1, size: 3, collapsed: false }])
  })

  it('parses nested levels and collapsed state', () => {
    const g = parseOutlineGroups('0:10:0:1,12:2:1:1, 2:3:1:1, ')
    expect(g).toHaveLength(3)
    expect(g[1]).toMatchObject({ level: 1, start: 12, size: 2, collapsed: true })
    expect(g[2]).toMatchObject({ level: 2, start: 2, size: 3, collapsed: true })
    expect(outlineDepth(g)).toBe(2)
  })

  it('is empty for no groups or malformed text', () => {
    expect(parseOutlineGroups(undefined)).toEqual([])
    expect(parseOutlineGroups('')).toEqual([])
    expect(parseOutlineGroups('x:y')).toEqual([])
    expect(outlineDepth([])).toBe(0)
    expect(outlineStripSize(0)).toBe(0)
    expect(outlineStripSize(2)).toBeGreaterThan(outlineStripSize(1))
  })

  it('builds the hide / show op for a group', () => {
    expect(outlineToggleArgs('row', { level: 1, start: 1, size: 3, collapsed: false })).toBe('hide|row|1|3')
    expect(outlineToggleArgs('col', { level: 1, start: 2, size: 3, collapsed: true })).toBe('show|col|2|4')
  })
})
