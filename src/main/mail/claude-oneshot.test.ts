import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { __test } from './claude-oneshot'

const { assistantTexts } = __test

/**
 * The stream parser.
 *
 * The fixture is a REAL capture from a machine whose Stop hook returns
 * `{decision:"block"}` and forces a session summary. That hook turned every
 * drafting feature in this app into a description of the answer instead of the
 * answer, and plain stdout could not tell the difference. Keeping the real
 * capture means a future change is checked against what actually happened
 * rather than against a fixture written from memory of it.
 */
const HIJACKED = fs.readFileSync(
  path.join(__dirname, '__fixtures__/hook-hijacked-stream.ndjson'),
  'utf8',
)

describe('assistantTexts', () => {
  it('recovers the real answer from a stream a Stop hook hijacked', () => {
    const texts = assistantTexts(HIJACKED)
    // Two messages: the answer, then the hook's forced summary.
    expect(texts.length).toBeGreaterThanOrEqual(2)
    expect(texts[0]).toContain('"kind":"text"')
    expect(texts[1]).toMatch(/^PROGRESS:/)
  })

  it('puts the answer FIRST, which is the rule the runner relies on', () => {
    expect(assistantTexts(HIJACKED)[0]).not.toMatch(/^PROGRESS:/)
  })

  it('reads a single clean response', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello' }] },
    })
    expect(assistantTexts(line)).toEqual(['hello'])
  })

  it('ignores non-assistant events', () => {
    const stream = [
      JSON.stringify({ type: 'system', subtype: 'hook_started' }),
      JSON.stringify({ type: 'result', result: 'PROGRESS: nope' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'real' }] } }),
    ].join('\n')
    expect(assistantTexts(stream)).toEqual(['real'])
  })

  it('ignores non-text content parts such as tool calls', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Read' }, { type: 'text', text: 'answer' }] },
    })
    expect(assistantTexts(line)).toEqual(['answer'])
  })

  it('skips whitespace-only text rather than returning it as the answer', () => {
    const stream = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '   ' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'real' }] } }),
    ].join('\n')
    expect(assistantTexts(stream)).toEqual(['real'])
  })

  it('survives a truncated final line', () => {
    const stream =
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'ok' }] } }) +
      '\n{"type":"assist'
    expect(assistantTexts(stream)).toEqual(['ok'])
  })

  it('returns nothing for an empty stream rather than throwing', () => {
    expect(assistantTexts('')).toEqual([])
    expect(assistantTexts('not json at all')).toEqual([])
  })
})
