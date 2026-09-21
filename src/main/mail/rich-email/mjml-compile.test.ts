import { describe, it, expect } from 'vitest'
import { compileMjml } from './mjml-compile'

const VALID = `<mjml><mj-body><mj-section><mj-column>
  <mj-text>Hello there — revenue is 12345</mj-text>
  <mj-button href="https://example.com">Read more</mj-button>
</mj-column></mj-section></mj-body></mjml>`

describe('compileMjml', () => {
  it('compiles valid MJML to responsive HTML containing the content', async () => {
    const { html, errors } = await compileMjml(VALID)
    expect(errors).toEqual([])
    expect(html).toContain('12345') // the literal content survives
    expect(html).toContain('Read more')
    expect(html.toLowerCase()).toContain('<!doctype html')
  })

  it('emits responsive markers (a media query) in the compiled HTML', async () => {
    const { html } = await compileMjml(VALID)
    expect(html).toContain('@media') // MJML's responsive breakpoints
  })

  it('reports errors for invalid MJML without throwing, and does not blank silently', async () => {
    // mj-column directly under mj-body + an unknown element → soft validation errors.
    const bad = '<mjml><mj-body><mj-column><mj-bogus>x</mj-bogus></mj-column></mj-body></mjml>'
    const { errors } = await compileMjml(bad)
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some((e) => /mj-bogus/i.test(e.message))).toBe(true)
  })

  it('never leaks a filesystem path in error messages', async () => {
    const bad = '<mjml><mj-body><mj-column><mj-bogus>x</mj-bogus></mj-column></mj-body></mjml>'
    const { errors } = await compileMjml(bad)
    for (const e of errors) {
      expect(e.message).not.toMatch(/\/Users\/|\/home\/|Line \d+ of \//)
    }
  })

  it('returns an error (no throw) for unparseable input', async () => {
    const { html, errors } = await compileMjml('not even xml at all')
    expect(html).toBe('')
    expect(errors.length).toBeGreaterThan(0)
  })

  it('reports empty input as an error rather than compiling', async () => {
    const { html, errors } = await compileMjml('   ')
    expect(html).toBe('')
    expect(errors[0].message).toMatch(/empty/i)
  })
})
