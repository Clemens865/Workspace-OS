import { describe, expect, it } from 'vitest'
import { parseRulerInfo, rulerDragOp, rulerMarkers, tabsAfter } from './rulerModel'

describe('rulerModel', () => {
  const info = parseRulerInfo('21590|2000|2000|2000|0|499|3000,6001')!

  it('parses the engine line', () => {
    expect(info).toEqual({ pageW: 21590, left: 2000, right: 2000, paraLeft: 2000, paraRight: 0, firstLine: 499, tabs: [3000, 6001] })
    expect(parseRulerInfo('garbage')).toBeNull()
    expect(parseRulerInfo('21590|2000|2000|0|0|0|')!.tabs).toEqual([])
  })

  it('places markers on the page', () => {
    expect(rulerMarkers(info)).toEqual({ leftIndent: 4000, firstLine: 4499, rightIndent: 19590, tabs: [7000, 10001] })
  })

  it('drags the left indent and keeps the first line put', () => {
    expect(rulerDragOp(info, 'leftIndent', 3000)).toEqual({ macro: 'WosParaFmt', args: 'indent|1000|-1|1499' })
  })

  it('drags first line, right indent and margins', () => {
    expect(rulerDragOp(info, 'firstLine', 5000)).toEqual({ macro: 'WosParaFmt', args: 'indent|-1|-1|1000' })
    expect(rulerDragOp(info, 'rightIndent', 18590)).toEqual({ macro: 'WosParaFmt', args: 'indent|-1|1000|' })
    expect(rulerDragOp(info, 'leftMargin', 2500)).toEqual({ macro: 'WosPageMargins', args: 'left|2500' })
    expect(rulerDragOp(info, 'rightMargin', 18590)).toEqual({ macro: 'WosPageMargins', args: 'right|3000' })
  })

  it('adds and removes tab stops relative to the indent', () => {
    expect(tabsAfter(info, { add: 9000 })).toBe('tabs|3000,5000,6001')
    expect(tabsAfter(info, { remove: 0 })).toBe('tabs|6001')
  })
})
