import { describe, expect, it } from 'vitest'
import {
  ANIMATION_PRESETS, TRANSITIONS, advanceSeconds, orderArgs, parseEffects, parseTransitions,
  presetLabel, transitionOf, transitionSetArgs, triggerArgs,
} from './animationModel'

describe('animationModel', () => {
  it('parses the transition lines the macro writes', () => {
    const t = parseTransitions('0|37|101|1.00|1|5\n1|0|0|0.00|0|0\n')
    expect(t).toHaveLength(2)
    expect(t[0]).toMatchObject({ index: 0, type: 37, subtype: 101, duration: 1, change: 1, advance: 5 })
    expect(transitionOf(t[0])?.id).toBe('fade')
    expect(transitionOf(t[1])?.id).toBe('none')
  })

  it('drops lines that are out of order or malformed', () => {
    expect(parseTransitions('garbage\n5|1|1|1|0|0')).toEqual([])
  })

  it('parses effect lines and keeps the engine order', () => {
    const e = parseEffects('0|Shape 4|ooo-emphasis-spin|3|1|2.00|0.00\n1|Shape 3|ooo-entrance-fly-in|1|2|0.50|0.50\n')
    expect(e.map((x) => x.presetId)).toEqual(['ooo-emphasis-spin', 'ooo-entrance-fly-in'])
    expect(e[1]).toMatchObject({ shape: 'Shape 3', presetClass: 1, nodeType: 2, duration: 0.5, delay: 0.5 })
  })

  it('builds the set line, clamping duration and advance', () => {
    expect(transitionSetArgs(2, { type: 37, subtype: 101, duration: 1, change: 1, advance: 5 })).toBe('set|2|37|101|1|1|5|0')
    expect(transitionSetArgs(0, { type: 0, subtype: 0, duration: 99, change: 0, advance: -3 }, true)).toBe('set|0|0|0|10|0|0|1')
  })

  it('turns automatic advances into per-slide seconds for the slideshow', () => {
    const slides = parseTransitions('0|37|101|1|1|3\n1|0|0|0|0|9\n2|1|1|1|1|0')
    expect(advanceSeconds(slides)).toEqual([3, 0, 0])
  })

  it('reorders effects by index while keeping every node type', () => {
    const e = parseEffects('0|a|x|1|1|1|0\n1|b|y|1|2|1|0\n2|c|z|1|3|1|0')
    expect(orderArgs(e, 2, 0)).toBe('order|2:3,0:1,1:2')
    expect(orderArgs(e, 0, 2)).toBe('order|1:2,2:3,0:1')
    expect(orderArgs(e, 5, 0)).toBe('order|0:1,1:2,2:3')
  })

  it('changes one trigger and leaves the rest', () => {
    const e = parseEffects('0|a|x|1|1|1|0\n1|b|y|1|1|1|0')
    expect(triggerArgs(e, 1, 3)).toBe('order|0:1,1:3')
  })

  it('labels known presets and humanises unknown ones', () => {
    expect(presetLabel('ooo-entrance-fly-in')).toBe('Fly in')
    expect(presetLabel('ooo-entrance-venetian-blinds')).toBe('venetian blinds')
  })

  it('keeps the preset tables unique', () => {
    expect(new Set(TRANSITIONS.map((t) => t.id)).size).toBe(TRANSITIONS.length)
    expect(new Set(ANIMATION_PRESETS.map((t) => t.id)).size).toBe(ANIMATION_PRESETS.length)
    // Every non-None transition is a distinct engine pair.
    const pairs = TRANSITIONS.slice(1).map((t) => `${t.type}/${t.subtype}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })
})
