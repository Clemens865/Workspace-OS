import { describe, it, expect } from 'vitest'
import {
  normalizeMaxPages,
  sameSite,
  hostOf,
  selectSubpages,
  harvestEmails,
  harvestPhones,
  harvestSocials,
  toExcerpt,
  DEEP_READ,
  type MappedLink,
} from './deepRead'

describe('normalizeMaxPages (clamp 1..8, default 4)', () => {
  it('defaults for missing/bad input', () => {
    expect(normalizeMaxPages(undefined)).toBe(4)
    expect(normalizeMaxPages('x')).toBe(4)
    expect(normalizeMaxPages(NaN)).toBe(4)
  })
  it('clamps to [1,8]', () => {
    expect(normalizeMaxPages(0)).toBe(1)
    expect(normalizeMaxPages(-5)).toBe(1)
    expect(normalizeMaxPages(3)).toBe(3)
    expect(normalizeMaxPages(99)).toBe(8)
    expect(normalizeMaxPages(4.9)).toBe(4)
  })
})

describe('same-origin gating', () => {
  it('strips www and compares hosts', () => {
    expect(hostOf('https://www.acme.com/x')).toBe('acme.com')
    expect(sameSite('https://acme.com', 'https://www.acme.com/team')).toBe(true)
    expect(sameSite('https://acme.com', 'https://other.com/team')).toBe(false)
    expect(sameSite('https://acme.com', 'not-a-url')).toBe(false)
  })
})

const links = (arr: [string, string, MappedLink['category']][]): MappedLink[] =>
  arr.map(([text, href, category]) => ({ text, href, category }))

describe('selectSubpages', () => {
  const home = 'https://acme.com'
  const sample = links([
    ['Home', 'https://acme.com/', 'other'],
    ['Contact', 'https://acme.com/contact', 'contact'],
    ['Products', 'https://acme.com/products', 'products'],
    ['About', 'https://acme.com/about', 'about'],
    ['Team', 'https://acme.com/team', 'team'],
    ['Careers', 'https://acme.com/jobs', 'careers'],
    ['Blog', 'https://acme.com/blog', 'other'],
    ['Partner', 'https://partner.com/x', 'about'], // off-site — excluded
  ])

  it('picks same-origin subpages ranked by category priority, capped', () => {
    const picked = selectSubpages(home, sample, 4)
    // contact ranks before team so a default 4-page read still captures contact info.
    expect(picked.map((l) => l.category)).toEqual(['about', 'products', 'contact', 'team'])
  })

  it('caps per category so many products cannot crowd out contact', () => {
    const many = links([
      ['About', 'https://acme.com/about', 'about'],
      ['P1', 'https://acme.com/p1', 'products'],
      ['P2', 'https://acme.com/p2', 'products'],
      ['P3', 'https://acme.com/p3', 'products'],
      ['P4', 'https://acme.com/p4', 'products'],
      ['Contact', 'https://acme.com/kontakt', 'contact'],
    ])
    const picked = selectSubpages(home, many, 4)
    expect(picked.map((l) => l.category)).toEqual(['about', 'products', 'products', 'contact'])
  })

  it('excludes the homepage and off-site links, dedups by url (ignoring hash)', () => {
    const withDupes = [...sample, { text: 'About#x', href: 'https://acme.com/about#section', category: 'about' as const }]
    const picked = selectSubpages(home, withDupes, 8)
    const urls = picked.map((l) => l.href)
    expect(urls).not.toContain('https://acme.com/')
    expect(urls.every((u) => u.startsWith('https://acme.com'))).toBe(true)
    // about appears once (hash variant deduped against base)
    expect(urls.filter((u) => u.startsWith('https://acme.com/about')).length).toBe(1)
  })

  it('focus biases a matching link to the front', () => {
    const picked = selectSubpages(home, sample, 2, 'team')
    expect(picked[0].category).toBe('team')
  })
})

describe('harvesters', () => {
  it('extracts + dedups emails', () => {
    const t = 'Reach us at info@acme.com or info@acme.com and sales@acme.com.'
    expect(harvestEmails(t)).toEqual(['info@acme.com', 'sales@acme.com'])
  })
  it('extracts plausible phones and drops junk', () => {
    const t = 'Call +43 1 234 5678 or 0043-664-1234567. Not: 12 (too short).'
    const phones = harvestPhones(t)
    expect(phones.length).toBeGreaterThanOrEqual(1)
    expect(phones.some((p) => p.replace(/\D/g, '').length >= 7)).toBe(true)
  })
  it('picks social links by host', () => {
    const socials = harvestSocials(
      links([
        ['LI', 'https://www.linkedin.com/company/acme', 'other'],
        ['X', 'https://twitter.com/acme', 'other'],
        ['YT', 'https://youtube.com/@acme', 'other'],
        ['home', 'https://acme.com', 'other'],
      ]),
    )
    expect(socials).toContain('https://www.linkedin.com/company/acme')
    expect(socials).toContain('https://twitter.com/acme')
    expect(socials).not.toContain('https://acme.com')
  })
  it('excerpt is capped + whitespace-collapsed', () => {
    const long = 'a  b\n\nc '.repeat(1000)
    const ex = toExcerpt(long)
    expect(ex.length).toBeLessThanOrEqual(DEEP_READ.excerptChars)
    expect(ex).not.toContain('\n')
  })
})
