import { describe, it, expect } from 'vitest'
import { parseQuery, tokenize, isEmptyQuery } from './search-query'

/**
 * The governing rule under test: an unrecognised operator searches LITERALLY.
 * Silently dropping `foo:bar` returns the wrong set with no way for the user to
 * tell; keeping it as text at worst finds nothing, which is visible.
 */

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('a b  c')).toEqual(['a', 'b', 'c'])
  })

  it('keeps quoted phrases together', () => {
    expect(tokenize('subject:"Q3 budget" ana')).toEqual(['subject:Q3 budget', 'ana'])
    expect(tokenize("from:'Ana Meier'")).toEqual(['from:Ana Meier'])
  })

  it('survives an unterminated quote instead of losing the rest', () => {
    expect(tokenize('subject:"unfinished')).toEqual(['subject:unfinished'])
  })

  it('is empty for empty input', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('   ')).toEqual([])
  })
})

describe('parseQuery — operators', () => {
  it('parses from/to/subject', () => {
    const q = parseQuery('from:ana to:bo subject:budget')
    expect(q).toMatchObject({ from: 'ana', to: 'bo', subject: 'budget', text: '' })
  })

  it('parses in: and folder: as the same thing', () => {
    expect(parseQuery('in:Archive').folder).toBe('Archive')
    expect(parseQuery('folder:Archive').folder).toBe('Archive')
  })

  it('parses is:unread and is:read as opposite sides of one flag', () => {
    expect(parseQuery('is:unread').unread).toBe(true)
    expect(parseQuery('is:read').unread).toBe(false)
    expect(parseQuery('is:seen').unread).toBe(false)
  })

  it('parses is:flagged and its synonym', () => {
    expect(parseQuery('is:flagged').flagged).toBe(true)
    expect(parseQuery('is:starred').flagged).toBe(true)
  })

  it('parses has:attachment and its synonyms', () => {
    expect(parseQuery('has:attachment').hasAttachment).toBe(true)
    expect(parseQuery('has:attachments').hasAttachment).toBe(true)
    expect(parseQuery('has:file').hasAttachment).toBe(true)
  })

  it('is case-insensitive on the operator and its value', () => {
    expect(parseQuery('IS:UNREAD').unread).toBe(true)
    expect(parseQuery('Has:Attachment').hasAttachment).toBe(true)
  })

  it('mixes operators with free text', () => {
    const q = parseQuery('from:ana quarterly budget is:unread')
    expect(q.from).toBe('ana')
    expect(q.unread).toBe(true)
    expect(q.text).toBe('quarterly budget')
  })
})

describe('parseQuery — unrecognised input stays literal', () => {
  it('keeps an unknown operator as text rather than dropping it', () => {
    // The dangerous alternative: silently ignoring it and returning results for
    // a query the user did not type.
    expect(parseQuery('foo:bar').text).toBe('foo:bar')
  })

  it('keeps an unknown VALUE of a known operator as text', () => {
    // "is:banana" is not a filter we understand; searching for it literally is
    // honest, quietly ignoring it is not.
    expect(parseQuery('is:banana').text).toBe('is:banana')
    expect(parseQuery('is:banana').unread).toBeUndefined()
  })

  it('does not mangle a URL', () => {
    expect(parseQuery('https://example.com/x').text).toBe('https://example.com/x')
  })

  it('does not mangle a time', () => {
    expect(parseQuery('meeting 14:30').text).toBe('meeting 14:30')
  })

  it('treats a trailing colon as text, not an empty operator', () => {
    expect(parseQuery('from:').text).toBe('from:')
    expect(parseQuery('from:').from).toBeUndefined()
  })

  it('treats a leading colon as text', () => {
    expect(parseQuery(':oops').text).toBe(':oops')
  })
})

describe('isEmptyQuery', () => {
  it('is true for nothing', () => {
    expect(isEmptyQuery(parseQuery(''))).toBe(true)
    expect(isEmptyQuery(parseQuery('   '))).toBe(true)
  })

  it('is false when only an operator is given', () => {
    // "is:unread" alone is a legitimate search — show me unread mail.
    expect(isEmptyQuery(parseQuery('is:unread'))).toBe(false)
    expect(isEmptyQuery(parseQuery('from:ana'))).toBe(false)
  })

  it('is false for plain text', () => {
    expect(isEmptyQuery(parseQuery('budget'))).toBe(false)
  })
})
