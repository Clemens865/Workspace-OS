import { describe, it, expect } from 'vitest'
import { runAssist, buildAssistPrompt, stripCommentary, type AssistFn } from './assist-drafter'

describe('runAssist (injected fake assistFn)', () => {
  it('passes the draft + action through and returns the revised body', async () => {
    let seen: { action: string; draft: string } | null = null
    const fake: AssistFn = async (input) => {
      seen = { action: input.action, draft: input.draft }
      return 'Tightened body.'
    }
    const out = await runAssist(fake, { action: 'tighten', draft: 'A long draft.' })
    expect(out).toBe('Tightened body.')
    expect(seen).toEqual({ action: 'tighten', draft: 'A long draft.' })
  })

  it('trims and strips a leading meta/preamble line from the model output', async () => {
    const fake: AssistFn = async () => "Here's the revised email:\nThe actual body."
    const out = await runAssist(fake, { action: 'clearer', draft: 'x' })
    expect(out).toBe('The actual body.')
  })

  it('propagates the assist error path (handler maps it to a typed error)', async () => {
    const failing: AssistFn = async () => { throw new Error('assistant unavailable') }
    await expect(runAssist(failing, { action: 'warmer', draft: 'x' })).rejects.toThrow('assistant unavailable')
  })

  it('coerces a non-string result to empty (boundary safety)', async () => {
    const fake = (async () => 123 as unknown) as AssistFn
    expect(await runAssist(fake, { action: 'tighten', draft: 'x' })).toBe('')
  })
})

describe('buildAssistPrompt', () => {
  it('emits body-only guidance and embeds the current draft', () => {
    const p = buildAssistPrompt({ action: 'warmer', draft: 'Cold draft here.' })
    expect(p).toMatch(/body only|ONLY the email body/i)
    expect(p).toContain('Cold draft here.')
    expect(p).toContain('warmer')
  })

  it('keeps {{metric:id}} tokens verbatim in the instruction for add-numbers', () => {
    const p = buildAssistPrompt({ action: 'add-numbers', draft: 'MRR is {{metric:mrr}}.' })
    expect(p).toContain('{{metric:id}}')
    expect(p).toContain('{{metric:mrr}}')
  })

  it('includes the user instruction when provided', () => {
    const p = buildAssistPrompt({ action: 'tighten', draft: 'x', instruction: 'keep it under 3 sentences' })
    expect(p).toContain('keep it under 3 sentences')
  })

  it('falls back to a safe action for an unknown action', () => {
    // @ts-expect-error deliberately invalid action
    const p = buildAssistPrompt({ action: 'nonsense', draft: 'x' })
    expect(p).toContain('Tighten')
  })

  it('injects the brand brief (name + voice) when a brandKit is set', () => {
    const p = buildAssistPrompt({
      action: 'warmer',
      draft: 'Cold draft.',
      brandKit: { name: 'Acme Robotics', voice: 'Warm, plain-spoken.' },
    })
    expect(p).toContain('--- Brand ---')
    expect(p).toContain('Acme Robotics')
    expect(p).toContain('Warm, plain-spoken.')
  })

  it('is unchanged (no brand brief) when no brandKit is provided', () => {
    const p = buildAssistPrompt({ action: 'warmer', draft: 'Cold draft.' })
    expect(p).not.toContain('--- Brand ---')
  })
})

describe('stripCommentary', () => {
  it('drops a single leading preamble line ending in a colon', () => {
    expect(stripCommentary('Sure, here is the revised version:\nBody.')).toBe('Body.')
  })
  it('leaves real content untouched', () => {
    expect(stripCommentary('Dear Sam,\nThanks for the note.')).toBe('Dear Sam,\nThanks for the note.')
  })
})
