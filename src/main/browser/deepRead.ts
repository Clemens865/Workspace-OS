/**
 * DEEP-READ orchestration helpers for browser-drive (`browser.deepRead`).
 *
 * The heavy lifting (navigate / clearConsent / map / extract) already exists in
 * browserControl.ts; this module holds the DETERMINISTIC, pure planning + profile
 * assembly so browserControl.ts stays lean and this logic is unit-testable with
 * mocked drive functions. No agent JS is ever produced here — deepRead only
 * chooses WHICH already-mapped, same-origin links to visit.
 *
 * SECURITY: `focus` (the one optional agent string) only BIASES ranking; it is
 * never interpolated into any in-page script. URLs are re-validated (http(s),
 * same-origin) before any navigation.
 */

import type { LinkCategory } from './mapScript'

/** A single mapped link as returned by the map script. */
export interface MappedLink {
  text: string
  href: string
  category: LinkCategory
}

/** One visited subpage in the assembled profile. */
export interface ProfilePage {
  url: string
  category: LinkCategory
  title: string
  excerpt: string
}

/** The clean company/site profile deepRead returns. */
export interface Profile {
  name: string
  homepage: string
  title: string
  pages: ProfilePage[]
  emails: string[]
  phones: string[]
  socials: string[]
}

/** Bounds for a deepRead run. */
export const DEEP_READ = {
  defaultMaxPages: 4,
  minPages: 1,
  maxPages: 8,
  excerptChars: 1200,
  emailCap: 20,
  phoneCap: 20,
  socialCap: 12,
  /** Overall wall-clock budget for the whole loop (ms). */
  timeBudgetMs: 60_000,
} as const

/** Clamp an untrusted maxPages into [min,max], defaulting when absent/bad. */
export function normalizeMaxPages(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : DEEP_READ.defaultMaxPages
  return Math.max(DEEP_READ.minPages, Math.min(DEEP_READ.maxPages, n))
}

/** The registered host of a URL, or '' when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

/** True when `href` shares the homepage's registrable host (same-origin site). */
export function sameSite(homepage: string, href: string): boolean {
  const a = hostOf(homepage)
  const b = hostOf(href)
  return !!a && a === b
}

/** Category visit priority (lower = visited first). */
const CATEGORY_RANK: Record<LinkCategory, number> = {
  about: 0,
  products: 1,
  // Contact/impressum before team: it's where emails + phones live, so a default
  // 4-page read still captures the company's contact info for the dossier.
  contact: 2,
  team: 3,
  careers: 4,
  other: 5,
}

/**
 * Choose up to `maxPages` same-origin subpages to deep-read, ranked by category
 * priority (about → products → team → contact → careers → other). `focus`
 * (optional) lifts links whose category/text/href mention it to the front. Skips
 * the homepage itself and dedups by URL (ignoring the hash).
 */
export function selectSubpages(
  homepage: string,
  links: MappedLink[],
  maxPages: number,
  focus?: string,
): MappedLink[] {
  const home = stripHash(homepage)
  const f = (focus ?? '').trim().toLowerCase()
  const seen = new Set<string>([home])
  const candidates: { link: MappedLink; key: string }[] = []
  for (const link of links) {
    if (!link || typeof link.href !== 'string') continue
    if (!sameSite(homepage, link.href)) continue
    const key = stripHash(link.href)
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ link, key })
  }
  const scored = candidates.map(({ link }, i) => {
    let rank = CATEGORY_RANK[link.category] ?? 5
    // focus bias: a focus hit is promoted ahead of every non-hit category.
    if (f) {
      const hay = `${link.category} ${link.text} ${link.href}`.toLowerCase()
      if (hay.includes(f)) rank -= 100
    }
    return { link, rank, i }
  })
  scored.sort((a, b) => a.rank - b.rank || a.i - b.i)
  // Cap each category so a link-heavy section (e.g. 12 products) can't crowd out
  // contact/team — a well-rounded dossier beats 4 product pages.
  const CAP_PER_CAT = 2
  const perCat = new Map<string, number>()
  const picked: MappedLink[] = []
  for (const s of scored) {
    if (picked.length >= maxPages) break
    const n = perCat.get(s.link.category) ?? 0
    if (n >= CAP_PER_CAT) continue
    perCat.set(s.link.category, n + 1)
    picked.push(s.link)
  }
  // If the cap left us short, backfill with the next best (still ≤ maxPages).
  if (picked.length < maxPages) {
    const chosen = new Set(picked)
    for (const s of scored) {
      if (picked.length >= maxPages) break
      if (!chosen.has(s.link)) picked.push(s.link)
    }
  }
  return picked
}

/**
 * Normalise a URL for dedup: drop the #fragment (keep query) and a bare trailing
 * slash on the path, so `https://x.com` and `https://x.com/` collide. Falls back
 * to a plain hash-strip when the URL is unparseable.
 */
function stripHash(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    if (u.pathname === '/') u.pathname = ''
    else u.pathname = u.pathname.replace(/\/$/, '')
    return u.toString()
  } catch {
    const i = url.indexOf('#')
    return i === -1 ? url : url.slice(0, i)
  }
}

// ── Regex harvesters (run over already-collected text, never in-page) ─────────
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
// Loose international phone: optional +, then 7-15 digits with separators.
const PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?){2,4}\d{2,4}/g

const SOCIAL_HOSTS = ['linkedin', 'twitter', 'x.com', 'facebook', 'instagram', 'youtube']

/** Dedup + cap a list of strings, preserving order. */
function dedupCap(items: string[], cap: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of items) {
    const v = raw.trim()
    if (!v || seen.has(v.toLowerCase())) continue
    seen.add(v.toLowerCase())
    out.push(v)
    if (out.length >= cap) break
  }
  return out
}

/** Emails found across all collected text, deduped + capped. */
export function harvestEmails(text: string): string[] {
  return dedupCap(text.match(EMAIL_RE) ?? [], DEEP_READ.emailCap)
}

/** DD.MM.YYYY / DD-MM-YY etc. — a date, not a phone (the #1 false positive). */
const DATE_RE = /^\s*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}\s*$/

/** Phone-like strings: plausible length, not a date, with a real phone signal. */
export function harvestPhones(text: string): string[] {
  const raw = (text.match(PHONE_RE) ?? []).filter((p) => {
    const digits = p.replace(/\D/g, '')
    if (digits.length < 7 || digits.length > 15) return false
    if (DATE_RE.test(p)) return false
    // Require a genuine phone signal: a country code (+), grouping parens, or a
    // space/slash between digit runs. Dates (DD.MM.YYYY) have only dots → excluded.
    return /[+(]/.test(p) || /\d[\s/]\d/.test(p)
  })
  return dedupCap(raw, DEEP_READ.phoneCap)
}

/** Social-profile links, by host, from the collected map links. */
export function harvestSocials(links: MappedLink[]): string[] {
  const hits = links
    .map((l) => l?.href)
    .filter((h): h is string => typeof h === 'string')
    .filter((h) => {
      const host = hostOf(h)
      return SOCIAL_HOSTS.some((s) => host.includes(s))
    })
  return dedupCap(hits, DEEP_READ.socialCap)
}

/** Cap + tidy a page's text into an excerpt. */
export function toExcerpt(text: unknown): string {
  const s = typeof text === 'string' ? text : ''
  return s.replace(/\s+/g, ' ').trim().slice(0, DEEP_READ.excerptChars)
}
