import { describe, it, expect } from 'vitest'
import { sniffDelimiter, looksDecimalComma, sniffCsvFilterOptions } from './csvSniff'

/**
 * The delimiter sniff — the piece that decides whether a German-locale
 * semicolon CSV opens as columns or as one mangled column. Consistency beats
 * raw count: prose commas are frequent but uneven; the delimiter is even.
 */

describe('sniffDelimiter', () => {
  it('detects plain comma CSV', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n4,5,6').ch).toBe(',')
  })

  it('detects semicolon CSV even when prose contains commas', () => {
    const head = 'Name;Kommentar;Betrag\nMiete;gross, hell, ruhig;1200\nStrom;ok;89'
    expect(sniffDelimiter(head).ch).toBe(';')
  })

  it('detects tab-separated data', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3').ch).toBe('\t')
  })

  it('ignores delimiters inside quoted fields', () => {
    const head = '"a;x";"b;y";c\n"1;1";"2;2";3'
    // Two UNQUOTED semicolons per line — quoted ones don't count.
    expect(sniffDelimiter(head).ch).toBe(';')
  })

  it('falls back to comma for an empty/one-column file', () => {
    expect(sniffDelimiter('').ch).toBe(',')
    expect(sniffDelimiter('justoneword\nanother').ch).toBe(',')
  })
})

describe('looksDecimalComma', () => {
  it('spots German-locale amounts in a semicolon file', () => {
    expect(looksDecimalComma('Miete;1.234,56\nStrom;89,10', ';')).toBe(true)
  })

  it('does not fire on prose commas', () => {
    expect(looksDecimalComma('Note;gross, hell und ruhig\nMehr;text, hier', ';')).toBe(false)
  })

  it('is never claimed for comma-delimited files', () => {
    expect(looksDecimalComma('a,1,5\nb,2,7', ',')).toBe(false)
  })
})

describe('sniffCsvFilterOptions', () => {
  it('builds the semicolon + de-locale token for a German export', () => {
    expect(sniffCsvFilterOptions('Name;Betrag\nMiete;1.234,56', 'csv')).toBe('59,34,76,1,,1031,false,true')
  })

  it('builds the plain comma token for a standard CSV', () => {
    expect(sniffCsvFilterOptions('a,b\n1,2', 'csv')).toBe('44,34,76,1,,0,false,true')
  })

  it('forces tab for .tsv', () => {
    expect(sniffCsvFilterOptions('a\tb\n1\t2', 'tsv')).toBe('9,34,76,1,,0,false,true')
  })

  it('.tsv with decimal-comma fields gets the de-locale language too', () => {
    expect(sniffCsvFilterOptions('Posten\tBetrag\nMiete\t1.234,56', 'tsv')).toBe('9,34,76,1,,1031,false,true')
  })

  it('returns null for non-CSV extensions (no options → normal load)', () => {
    expect(sniffCsvFilterOptions('a,b', 'xlsx')).toBeNull()
  })
})
