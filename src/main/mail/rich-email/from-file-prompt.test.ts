import { describe, it, expect } from 'vitest'
import { buildFromFilePrompt, parseBlocksReply, INTENTS } from './from-file-prompt'
import { sheetsToPromptText, type SheetExtract } from './sheet-extract'

/**
 * The prompt and the reply parser.
 *
 * The rule these guard is the one that separates this from a newsletter
 * generator: the model may only use figures that are in the data. If the
 * "do not invent" instruction or the truncation warning ever falls out of the
 * prompt, the feature still appears to work — it just starts inventing — which
 * is exactly the failure a test has to catch.
 */

const SHEET: SheetExtract = {
  name: 'Q3',
  rows: 3,
  cols: 2,
  truncated: false,
  grid: [
    ['Berth', 'Throughput'],
    ['Berth 4', 5150],
    ['Berth 5', 3120],
  ],
}

describe('buildFromFilePrompt', () => {
  it('carries the data as tab-delimited rows', () => {
    const p = buildFromFilePrompt({ intent: 'summary', fileName: 'ops.xlsx', sheets: [SHEET] })
    expect(p).toContain('Berth\tThroughput')
    expect(p).toContain('Berth 4\t5150')
    expect(p).toContain('ops.xlsx')
  })

  it('forbids inventing figures', () => {
    const p = buildFromFilePrompt({ intent: 'summary', fileName: 'ops.xlsx', sheets: [SHEET] })
    expect(p).toMatch(/never invent/i)
    expect(p).toMatch(/MUST appear in the data/i)
  })

  it('warns the model when the sheet was truncated', () => {
    const p = buildFromFilePrompt({
      intent: 'summary',
      fileName: 'ops.xlsx',
      sheets: [{ ...SHEET, truncated: true }],
    })
    expect(p).toMatch(/TRUNCATED/)
    // Specifically: it must not be allowed to claim a total it cannot see.
    expect(p).toMatch(/Do not present a total/i)
  })

  it('does not warn about truncation when nothing was truncated', () => {
    const p = buildFromFilePrompt({ intent: 'summary', fileName: 'ops.xlsx', sheets: [SHEET] })
    expect(p).not.toMatch(/Do not present a total/i)
  })

  it('changes its guidance with the intent', () => {
    const viz = buildFromFilePrompt({ intent: 'visualize', fileName: 'f.xlsx', sheets: [SHEET] })
    const dig = buildFromFilePrompt({ intent: 'digest', fileName: 'f.xlsx', sheets: [SHEET] })
    expect(viz).toContain(INTENTS.visualize.guidance)
    expect(dig).toContain(INTENTS.digest.guidance)
    expect(viz).not.toContain(INTENTS.digest.guidance)
  })

  it('falls back to a summary for an unknown intent rather than emitting no guidance', () => {
    const p = buildFromFilePrompt({
      intent: 'nonsense' as 'summary',
      fileName: 'f.xlsx',
      sheets: [SHEET],
    })
    expect(p).toContain(INTENTS.summary.guidance)
  })

  it('includes the sender instruction when given', () => {
    const p = buildFromFilePrompt({
      intent: 'summary',
      fileName: 'f.xlsx',
      sheets: [SHEET],
      instruction: 'focus on Berth 5',
    })
    expect(p).toContain('focus on Berth 5')
  })
})

describe('sheetsToPromptText', () => {
  it('keeps empty cells as empty fields so columns stay aligned', () => {
    const ragged: SheetExtract = {
      name: 'S',
      rows: 2,
      cols: 3,
      truncated: false,
      grid: [
        ['A', 'B', 'C'],
        ['1', null, '3'],
      ],
    }
    // A dropped empty cell would shift "3" under column B and mis-attribute it.
    expect(sheetsToPromptText([ragged])).toContain('1\t\t3')
  })
})

describe('parseBlocksReply', () => {
  it('reads a bare JSON array', () => {
    expect(parseBlocksReply('[{"kind":"text","text":"hi"}]')).toHaveLength(1)
  })

  it('reads an array wrapped in a markdown fence', () => {
    const reply = '```json\n[{"kind":"text","text":"hi"}]\n```'
    expect(parseBlocksReply(reply)).toHaveLength(1)
  })

  it('reads an array preceded by chatter', () => {
    const reply = 'Sure! Here is the email:\n[{"kind":"text","text":"hi"}]\nHope that helps.'
    expect(parseBlocksReply(reply)).toHaveLength(1)
  })

  it('returns empty for prose with no array, rather than throwing', () => {
    expect(parseBlocksReply('I cannot do that.')).toEqual([])
  })

  it('returns empty for malformed JSON', () => {
    expect(parseBlocksReply('[{"kind":"text",]')).toEqual([])
  })

  it('returns empty when the model sends an object instead of an array', () => {
    expect(parseBlocksReply('{"blocks":[]}')).toEqual([])
  })
})
