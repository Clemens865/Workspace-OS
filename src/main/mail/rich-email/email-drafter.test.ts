import { describe, it, expect } from 'vitest'
import { draftRichEmail, buildEmailDraftPrompt, stripFences, type EmailDraftFn } from './email-drafter'
import type { MetricLookup } from './email-tokens'

function fakeMetrics(map: Record<string, number>): MetricLookup {
  return { get: (id) => (id in map ? { value: map[id] } : undefined) }
}

/** A fake agent that returns a fixed MJML template — no real Claude call. */
function fakeAgent(mjml: string): EmailDraftFn {
  return async () => mjml
}

const GOOD_MJML = `<mjml><mj-body><mj-section><mj-column>
  <mj-text>Monthly update: MRR is {{metric:mrr}}</mj-text>
</mj-column></mj-section></mj-body></mjml>`

describe('draftRichEmail (injected fake draftFn)', () => {
  it('drafts: fake MJML → compiled HTML + subject, with live tokens resolved', async () => {
    const m = fakeMetrics({ mrr: 42000 })
    const out = await draftRichEmail(fakeAgent(GOOD_MJML), 'Write our monthly update.', m)
    expect(out.errors).toEqual([])
    expect(out.html).toContain('42000') // {{metric:mrr}} resolved before compile
    expect(out.mjml).toContain('42000') // resolved in the returned MJML too
    expect(out.mjml).not.toContain('{{metric') // no raw token survives
    expect(out.subject).toBe('Write our monthly update.')
    expect(out.unresolvedTokens).toEqual([])
  })

  it('reports MJML compile errors (never throws) so the agent could retry', async () => {
    const m = fakeMetrics({})
    const badMjml = '<mjml><mj-body><mj-column><mj-bogus>x</mj-bogus></mj-column></mj-body></mjml>'
    const out = await draftRichEmail(fakeAgent(badMjml), 'brief', m)
    expect(out.errors.length).toBeGreaterThan(0)
    expect(out.errors.some((e) => /mj-bogus/i.test(e.message))).toBe(true)
  })

  it('reports unresolved liveness tokens as visible placeholders (never blank)', async () => {
    const m = fakeMetrics({}) // no metrics registered
    const out = await draftRichEmail(fakeAgent(GOOD_MJML), 'brief', m)
    expect(out.unresolvedTokens.map((t) => t.id)).toContain('mrr')
    expect(out.mjml).toContain('[metric mrr unavailable]')
    expect(out.html).toContain('[metric mrr unavailable]')
  })

  it('strips a markdown code fence if the model wrapped the MJML', async () => {
    const m = fakeMetrics({})
    const fenced = '```mjml\n<mjml><mj-body><mj-section><mj-column><mj-text>Hi</mj-text></mj-column></mj-section></mj-body></mjml>\n```'
    const out = await draftRichEmail(fakeAgent(fenced), 'Say hi', m)
    expect(out.errors).toEqual([])
    expect(out.mjml.startsWith('<mjml>')).toBe(true)
    expect(out.html).toContain('Hi')
  })

  it('passes the brand hint into the agent input', async () => {
    const m = fakeMetrics({})
    let seenBrand: string | undefined
    const spy: EmailDraftFn = async (input) => {
      seenBrand = input.brand
      return '<mjml><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>'
    }
    await draftRichEmail(spy, 'brief', m, { brand: 'Acme, blue, playful' })
    expect(seenBrand).toBe('Acme, blue, playful')
  })

  it('derives a subject from MJML content when the brief is empty', async () => {
    const m = fakeMetrics({})
    const mjml = '<mjml><mj-body><mj-section><mj-column><mj-text>Big spring sale</mj-text></mj-column></mj-section></mj-body></mjml>'
    const out = await draftRichEmail(fakeAgent(mjml), '', m)
    expect(out.subject).toBe('Big spring sale')
  })
})

describe('buildEmailDraftPrompt', () => {
  it('instructs MJML-only output and embeds the brief', () => {
    const p = buildEmailDraftPrompt({ brief: 'Announce v2 launch' })
    expect(p).toContain('MJML ONLY')
    expect(p).toContain('Announce v2 launch')
    expect(p).toContain('<mjml>')
  })
  it('includes design/tone hints when provided', () => {
    const p = buildEmailDraftPrompt({ brief: 'x', brand: 'Acme teal' })
    expect(p).toContain('Design/tone hints')
    expect(p).toContain('Acme teal')
  })

  it('injects the brand brief (name + voice + colours) when a brandKit is set', () => {
    const p = buildEmailDraftPrompt({
      brief: 'Announce the release',
      brandKit: {
        name: 'Acme Robotics',
        tagline: 'Machines that care',
        voice: 'Warm, plain-spoken, quietly confident.',
        palette: { primary: '#0a7', accent: '#ff3366' },
      },
    })
    expect(p).toContain('--- Brand ---')
    expect(p).toContain('Acme Robotics')
    expect(p).toContain('Machines that care')
    expect(p).toContain('Warm, plain-spoken, quietly confident.')
    expect(p).toContain('#ff3366')
  })

  it('is unchanged (no brand brief) when no brandKit is provided', () => {
    const p = buildEmailDraftPrompt({ brief: 'Announce the release' })
    expect(p).not.toContain('--- Brand ---')
  })
})

describe('stripFences', () => {
  it('removes surrounding ``` fences', () => {
    expect(stripFences('```\n<mjml></mjml>\n```')).toBe('<mjml></mjml>')
    expect(stripFences('```html\n<mjml></mjml>\n```')).toBe('<mjml></mjml>')
  })
  it('leaves unfenced content unchanged', () => {
    expect(stripFences('<mjml></mjml>')).toBe('<mjml></mjml>')
  })
})
