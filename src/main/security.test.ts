import { describe, it, expect } from 'vitest'
import {
  browserRequestHeaders,
  referrerFor,
  brandList,
  brandsToHeader,
} from './security'

/**
 * Headers the in-app browser sends on the guest's behalf.
 *
 * The rule worth protecting: we may add our own identity headers, and we may
 * not remove the page's.
 *
 * `X-Requested-With` was deleted here for months to "drop the webview-
 * identifying header" — reasoning imported from Android WebView, which stamps
 * the app's package name onto every request. Desktop Chromium never sets it, so
 * nothing was being hidden; the only source is the page's own JavaScript, where
 * jQuery and every Rails app use it to mark an XHR. Removing it made servers
 * answer polls with a full HTML document instead of JSON, and GitHub's
 * two-factor page waited forever for a response that could not arrive.
 */
const UA = 'Mozilla/5.0 (Macintosh) Chrome/151 Safari/537.36'
const CH = '"Chromium";v="151"'

describe('browserRequestHeaders', () => {
  it('keeps X-Requested-With when the page set it', () => {
    const out = browserRequestHeaders({ 'X-Requested-With': 'XMLHttpRequest' }, UA, CH)
    expect(out['X-Requested-With']).toBe('XMLHttpRequest')
  })

  it('does not invent X-Requested-With when the page did not set it', () => {
    expect(browserRequestHeaders({}, UA, CH)['X-Requested-With']).toBeUndefined()
  })

  it('stamps a consistent desktop-Chrome identity', () => {
    const out = browserRequestHeaders({}, UA, CH)
    expect(out['User-Agent']).toBe(UA)
    expect(out['sec-ch-ua']).toBe(CH)
    expect(out['sec-ch-ua-mobile']).toBe('?0')
    expect(out['sec-ch-ua-platform']).toBe('"macOS"')
  })

  it('overrides an identity header the page tried to set itself', () => {
    const out = browserRequestHeaders({ 'User-Agent': 'Evil/1.0' }, UA, CH)
    expect(out['User-Agent']).toBe(UA)
  })

  it('passes every other header through untouched', () => {
    const out = browserRequestHeaders(
      { Accept: 'application/json', Cookie: 'a=1', 'X-CSRF-Token': 'tok' },
      UA,
      CH,
    )
    expect(out.Accept).toBe('application/json')
    expect(out.Cookie).toBe('a=1')
    expect(out['X-CSRF-Token']).toBe('tok')
  })

  it('does not mutate the object it was given', () => {
    const input = { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'old' }
    browserRequestHeaders(input, UA, CH)
    expect(input['User-Agent']).toBe('old')
  })
})

/**
 * The Referer a routed tab carries.
 *
 * Denying a popup and re-opening the url as a fresh tab loses the opener, so no
 * Referer is sent at all — measured as `referer: null` against a local server.
 * Sites that gate outbound links then discard the destination: LinkedIn's
 * /safety/go drops you on a bare "leaving LinkedIn" page and the job link looks
 * broken.
 *
 * This mirrors Chromium's default `strict-origin-when-cross-origin`. Sending
 * MORE than a real browser would is a privacy regression wearing a bug fix's
 * clothes, so the cross-origin and downgrade cases matter as much as the happy
 * one.
 */
describe('referrerFor', () => {
  it('sends the full url within one origin', () => {
    expect(referrerFor('https://www.linkedin.com/jobs/view/123', 'https://www.linkedin.com/safety/go?url=x'))
      .toBe('https://www.linkedin.com/jobs/view/123')
  })

  it('sends only the origin when leaving it', () => {
    expect(referrerFor('https://www.linkedin.com/jobs/view/123?secret=1', 'https://acme.example/careers'))
      .toBe('https://www.linkedin.com/')
  })

  it('sends nothing when downgrading https to http', () => {
    expect(referrerFor('https://secure.example/page', 'http://plain.example/')).toBe('')
  })

  it('sends nothing from a non-web opener', () => {
    // The host window is a file:// — the first version of the fix passed that
    // by mistake and silently produced an empty referrer.
    expect(referrerFor('file:///Applications/App.app/index.html', 'https://acme.example/')).toBe('')
    expect(referrerFor('about:blank', 'https://acme.example/')).toBe('')
  })

  it('treats a different port or scheme as a different origin', () => {
    expect(referrerFor('http://127.0.0.1:1/a', 'http://127.0.0.1:2/b')).toBe('http://127.0.0.1:1/')
  })

  it('returns empty rather than throwing on a malformed url', () => {
    expect(referrerFor('not a url', 'https://acme.example/')).toBe('')
    expect(referrerFor('https://acme.example/', 'not a url')).toBe('')
  })
})

/**
 * The browser's identity, and why it stays honest.
 *
 * Claiming Google Chrome was built and measured working — header and
 * `navigator.userAgentData` together — then removed, because Google documents
 * the rule it evades and tells app developers to use browser-based OAuth
 * instead. These now pin the honest identity so it cannot drift back by
 * accident, which is the failure this file's history is made of: headers once
 * claimed Google Chrome while the page said Chromium, and LinkedIn accepted the
 * password, ran 2FA, then refused to issue a session.
 */
describe('browser identity', () => {
  it('says Chromium, and says it the same way to everyone', () => {
    expect(brandsToHeader(brandList('148.0.1'))).toBe('"Not/A)Brand";v="99", "Chromium";v="148"')
  })

  it('never claims Google Chrome', () => {
    const header = brandsToHeader(brandList('148.0.1'))
    expect(header).not.toContain('Google Chrome')
    expect(brandList('148.0.1').some((b) => /google/i.test(b.brand))).toBe(false)
  })

  it('carries the major version the user agent claims', () => {
    expect(brandsToHeader(brandList('131.0.6778.86'))).toContain('"Chromium";v="131"')
  })

  it('keeps the Not/A)Brand entry Chromium really sends', () => {
    expect(brandList('148.0.1')[0]).toEqual({ brand: 'Not/A)Brand', version: '99' })
  })
})
