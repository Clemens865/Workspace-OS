import { describe, it, expect } from 'vitest'
import { classifyLink, mapScript, MAP_CAPS, CATEGORY_NEEDLES } from './mapScript'

describe('link classifier (EN + DE)', () => {
  it('classifies English hrefs/text', () => {
    expect(classifyLink('https://x.com/about-us', 'About us')).toBe('about')
    expect(classifyLink('https://x.com/company', '')).toBe('about')
    expect(classifyLink('https://x.com/team', 'Our People')).toBe('team')
    expect(classifyLink('https://x.com/leadership', 'Management')).toBe('team')
    expect(classifyLink('https://x.com/products', 'Products')).toBe('products')
    expect(classifyLink('https://x.com/services', 'Our services')).toBe('products')
    expect(classifyLink('https://x.com/solutions', 'Solutions')).toBe('products')
    expect(classifyLink('https://x.com/contact', 'Contact')).toBe('contact')
    expect(classifyLink('https://x.com/careers', 'Careers')).toBe('careers')
    expect(classifyLink('https://x.com/jobs', 'Jobs')).toBe('careers')
  })

  it('classifies German hrefs/text', () => {
    expect(classifyLink('https://x.de/ueber-uns', 'Über uns')).toBe('about')
    expect(classifyLink('https://x.de/unternehmen', 'Unternehmen')).toBe('about')
    expect(classifyLink('https://x.de/mitarbeiter', 'Team')).toBe('team')
    expect(classifyLink('https://x.de/fuehrung', 'Führung')).toBe('team')
    expect(classifyLink('https://x.de/produkte', 'Produkte')).toBe('products')
    expect(classifyLink('https://x.de/leistungen', 'Leistungen')).toBe('products')
    expect(classifyLink('https://x.de/loesungen', 'Lösungen')).toBe('products')
    expect(classifyLink('https://x.de/angebote', 'Angebote')).toBe('products')
    expect(classifyLink('https://x.de/kontakt', 'Kontakt')).toBe('contact')
    expect(classifyLink('https://x.de/impressum', 'Impressum')).toBe('contact')
    expect(classifyLink('https://x.de/karriere', 'Karriere')).toBe('careers')
  })

  it('falls back to other for unrelated links', () => {
    expect(classifyLink('https://x.com/blog/2024', 'Latest news')).toBe('other')
    expect(classifyLink('https://x.com/', 'Home')).toBe('other')
  })

  it('prefers more-specific categories (contact/careers before broad)', () => {
    // "kontakt" should win contact even if page mentions products elsewhere.
    expect(classifyLink('https://x.de/kontakt', 'Kontakt & Produkte')).toBe('contact')
    // careers precedes contact in the needle order.
    expect(classifyLink('https://x.de/karriere', 'Jobs')).toBe('careers')
  })
})

describe('mapScript (fixed, read-only, capped)', () => {
  it('is a non-empty fixed string that reads the DOM and caps output', () => {
    const s = mapScript()
    expect(typeof s).toBe('string')
    expect(s).toContain('querySelectorAll')
    expect(s).toContain('classify')
    // caps embedded
    expect(s).toContain(String(MAP_CAPS.links))
    // consent detection present
    expect(s).toContain('consent')
  })

  it('embeds every category needle set (EN + DE coverage)', () => {
    const s = mapScript()
    for (const [, needles] of CATEGORY_NEEDLES) {
      for (const n of needles) expect(s).toContain(n)
    }
  })
})
