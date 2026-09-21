import { describe, it, expect } from 'vitest'
import { looksLikeUrl, toNavUrl } from './Omnibox'

const SEARCH = 'https://duckduckgo.com/?q=%s'

describe('is this a url or something to search for', () => {
  it('treats explicit schemes and hosts as urls', () => {
    for (const s of [
      'https://example.com',
      'http://example.com/path',
      'example.com',
      'sub.example.co.uk/path',
      'localhost:5173',
      'localhost',
    ]) {
      expect(looksLikeUrl(s), s).toBe(true)
    }
  })

  it('treats anything with a space as a search', () => {
    // The single most common case, and the one a naive dot-check gets wrong:
    // "acme.com pricing" is a search, not a host.
    for (const s of ['how to fix a leak', 'acme.com pricing', 'what is 2 + 2']) {
      expect(looksLikeUrl(s), s).toBe(false)
    }
  })

  it('treats a bare word as a search, not a host', () => {
    for (const s of ['linkedin', 'react', 'q']) {
      expect(looksLikeUrl(s), s).toBe(false)
    }
  })

  it('is not fooled by a trailing dot or an empty box', () => {
    expect(looksLikeUrl('')).toBe(false)
    expect(looksLikeUrl('   ')).toBe(false)
    expect(looksLikeUrl('example.')).toBe(false)
  })
})

describe('turning input into something navigable', () => {
  it('leaves a full url alone', () => {
    expect(toNavUrl('https://a.com/x?y=1', SEARCH)).toBe('https://a.com/x?y=1')
  })

  it('upgrades a bare host to https', () => {
    expect(toNavUrl('example.com', SEARCH)).toBe('https://example.com')
  })

  it('sends a phrase to search, encoded', () => {
    expect(toNavUrl('how to fix a leak', SEARCH)).toBe('https://duckduckgo.com/?q=how%20to%20fix%20a%20leak')
  })

  it('encodes characters that would otherwise break the query', () => {
    // A search containing & or # must not be able to smuggle extra query
    // parameters into the search url.
    expect(toNavUrl('a&b=c#d', SEARCH)).toBe('https://duckduckgo.com/?q=a%26b%3Dc%23d')
  })

  it('trims surrounding whitespace before deciding', () => {
    expect(toNavUrl('  example.com  ', SEARCH)).toBe('https://example.com')
  })
})
