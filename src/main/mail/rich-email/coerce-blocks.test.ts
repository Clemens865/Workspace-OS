import { describe, it, expect } from 'vitest'
import { toBlock, toBuildInput } from './coerce-blocks'

describe('toBlock', () => {
  it('coerces each known block kind, bounding strings', () => {
    expect(toBlock({ kind: 'text', text: 'hi' })).toEqual({ kind: 'text', text: 'hi' })
    expect(toBlock({ kind: 'metric', label: 'MRR', value: '5' })).toEqual({ kind: 'metric', label: 'MRR', value: '5' })
    expect(toBlock({ kind: 'cta', label: 'Go', href: 'https://x' })).toEqual({ kind: 'cta', label: 'Go', href: 'https://x' })
    expect(toBlock({ kind: 'hosted-link', label: 'Open', target: 't' })).toEqual({ kind: 'hosted-link', label: 'Open', target: 't' })
  })

  it('coerces a table, stringifying and capping rows/cols', () => {
    const block = toBlock({ kind: 'table', rows: [['a', 1], ['b', 2]] })
    expect(block).toEqual({ kind: 'table', rows: [['a', ''], ['b', '']] }) // non-strings → ''
  })

  it('rejects unknown / malformed blocks (null)', () => {
    expect(toBlock({ kind: 'bogus' })).toBeNull()
    expect(toBlock(undefined)).toBeNull()
    expect(toBlock({ kind: 'table' })).toBeNull() // no rows array
  })
})

describe('toBuildInput', () => {
  it('drops invalid blocks and keeps valid ones, defaulting a missing theme', () => {
    const input = toBuildInput({ blocks: [{ kind: 'text', text: 'ok' }, { kind: 'bogus' }] })
    expect(input.themeId).toBeUndefined()
    expect(input.blocks).toEqual([{ kind: 'text', text: 'ok' }])
  })

  it('passes a chosen theme id through', () => {
    expect(toBuildInput({ themeId: 'editorial', blocks: [] }).themeId).toBe('editorial')
  })

  it('coerces a non-object payload to an empty build input', () => {
    expect(toBuildInput(undefined)).toEqual({ themeId: undefined, blocks: [] })
  })

  it('caps the block count', () => {
    const many = Array.from({ length: 100 }, () => ({ kind: 'text', text: 'x' }))
    expect(toBuildInput({ blocks: many }).blocks.length).toBeLessThanOrEqual(40)
  })
})

/*
 * The standard-editor blocks (heading / divider / image). The image case is the
 * one with teeth: only the cid REFERENCE may cross the build boundary — the
 * bytes stay renderer-side — and a hostile cid must not survive into `cid:…`.
 */
describe('toBlock — standard editor blocks', () => {
  it('coerces heading and divider', () => {
    expect(toBlock({ kind: 'heading', text: 'Update' })).toEqual({ kind: 'heading', text: 'Update' })
    expect(toBlock({ kind: 'divider' })).toEqual({ kind: 'divider' })
  })

  it('keeps only the image reference, never the bytes', () => {
    const b = toBlock({ kind: 'image', cid: 'img-1', alt: 'Team photo', data: 'AAAA', contentType: 'image/png' })
    expect(b).toEqual({ kind: 'image', cid: 'img-1', alt: 'Team photo' })
  })

  it('sanitizes a hostile cid and rejects an empty one', () => {
    expect(toBlock({ kind: 'image', cid: 'a"b<c>d e', alt: '' })).toEqual({ kind: 'image', cid: 'abcde', alt: '' })
    expect(toBlock({ kind: 'image', cid: '"<>', alt: 'x' })).toBeNull()
  })
})
