import { describe, it, expect } from 'vitest'
import fs from 'fs'
import { computeCsvInsight, parseNumber, extractViewSpec, computeView } from './case-insights'

/** A private fixture counts only when it can actually be read — macOS may deny
 *  Documents access to a sandboxed shell even though the file exists. */
function readable(file: string): boolean {
  try { fs.accessSync(file, fs.constants.R_OK); fs.openSync(file, 'r'); return true } catch { return false }
}

describe('parseNumber', () => {
  it('reads German, English and plain forms', () => {
    expect(parseNumber('1.234,56')).toBe(1234.56)
    expect(parseNumber('1,234.56')).toBe(1234.56)
    expect(parseNumber('97,35 EUR')).toBe(97.35)
    expect(parseNumber('−EUR 31,40'.replace('−', '-'))).toBe(-31.4)
    expect(parseNumber('30485.35')).toBe(30485.35)
    expect(parseNumber('')).toBeNull()
    expect(parseNumber('nichts')).toBeNull()
  })
})

describe('computeCsvInsight — hermetic fixture', () => {
  const csv = [
    'Typ;Betrag_EUR;Konfidenz',
    'FBA;100,00;hoch',
    'FBA;50,00;hoch',
    'Ads;30,00;hoch',
    'Gutschrift;-10,00;hoch',
  ].join('\n')
  const ins = computeCsvInsight('test.csv', csv)!

  it('counts rows and finds the numeric column', () => {
    expect(ins.rows).toBe(4)
    expect(ins.kpis[0]).toEqual({ label: 'Zeilen', value: '4' })
    expect(ins.kpis.some((k) => k.label === 'Betrag_EUR')).toBe(true)
  })
  it('groups the category chart by Typ, summing Betrag_EUR', () => {
    expect(ins.chart?.byColumn).toBe('Typ')
    const fba = ins.chart!.bars.find((b) => b.label === 'FBA')
    expect(fba?.value).toBe(150) // 100 + 50
    const gut = ins.chart!.bars.find((b) => b.label === 'Gutschrift')
    expect(gut?.value).toBe(-10)
  })
})

describe('parseNumber — rejects non-amounts', () => {
  it('treats reference codes, IBANs and text as NOT numbers', () => {
    expect(parseNumber('SLR1149CIMFUPD43BVQ5')).toBeNull()
    expect(parseNumber('AT652081500044015238')).toBeNull() // IBAN has letters
    expect(parseNumber('Kontoführung')).toBeNull()
    expect(parseNumber('AMAZON PAYMENTS SLR1149')).toBeNull()
  })
  it('still reads genuine amounts', () => {
    expect(parseNumber('669,69')).toBe(669.69)
    expect(parseNumber('-EUR 12,00')).toBe(-12)
  })
})

describe('computeCsvInsight — ID and text columns are not money', () => {
  const csv = [
    'Lfd_Nr;Buchungstext;Kategorie;Betrag_EUR',
    '1;AMAZON PAYMENTS SLR1149CIMF;Einnahmen;669,69',
    '2;Kontoführung;Betriebsausgaben;-12,00',
    '3;WERBUNG REF 88123456;Werbungskosten;-50,00',
    '4;AMAZON PAYMENTS SLR2250XY;Einnahmen;800,64',
    '5;GEBUEHR REF 771;Betriebsausgaben;-9,00',
    '6;WERBUNG REF 99;Werbungskosten;-34,00',
  ].join('\n')
  const ins = computeCsvInsight('phase1.csv', csv)!
  it('never turns Lfd_Nr or Buchungstext into a euro KPI', () => {
    expect(ins.kpis.some((k) => k.label === 'Lfd_Nr')).toBe(false)
    expect(ins.kpis.some((k) => k.label === 'Buchungstext')).toBe(false)
    expect(ins.kpis.some((k) => k.label === 'Betrag_EUR')).toBe(true)
  })
  it('charts Betrag_EUR by Kategorie, not a reference-number sum', () => {
    expect(ins.chart?.valueColumn).toBe('Betrag_EUR')
    expect(ins.chart?.byColumn).toBe('Kategorie')
  })
})

describe('computeCsvInsight — real Phase1 bookings (if present)', () => {
  // Optional local fixture (a real bookkeeping export); point WOS_CSV_FIXTURE_BOOKINGS at one to run.
  const p = process.env['WOS_CSV_FIXTURE_BOOKINGS'] ?? ''
  it.skipIf(!readable(p))('yields a sane amount chart, no quadrillion KPI', () => {
    const ins = computeCsvInsight('Phase1_Buchungen_2025.csv', fs.readFileSync(p, 'utf-8'))!
    // eslint-disable-next-line no-console
    console.log('Phase1 KPIs:', ins.kpis, '| chart:', ins.chart?.valueColumn, 'by', ins.chart?.byColumn)
    // No KPI may be astronomically large (the Buchungstext bug summed to 1e23).
    for (const k of ins.kpis) {
      const n = Math.abs(Number(k.value.replace(/[^0-9]/g, '')) || 0)
      expect(n).toBeLessThan(1e12)
    }
    // Any monetary column is a sane pick (the private file's naming has changed over time).
    expect(ins.chart && /betrag|eur|amount/i.test(ins.chart.valueColumn)).toBeTruthy()
  })
})

describe('computeCsvInsight — real Amazon extract (if present)', () => {
  // Optional local fixture (a real marketplace settlement export); WOS_CSV_FIXTURE_SETTLEMENT.
  const p = process.env['WOS_CSV_FIXTURE_SETTLEMENT'] ?? ''
  it.skipIf(!readable(p))('yields the FBA/Ads/Gutschrift breakdown', () => {
    const ins = computeCsvInsight('00_Amazon_Betraege.csv', fs.readFileSync(p, 'utf-8'))!
    expect(ins.rows).toBe(272)
    const byType = Object.fromEntries(ins.chart!.bars.map((b) => [b.label, Math.round(b.value)]))
    // eslint-disable-next-line no-console
    console.log('real Amazon chart:', byType, '| KPIs:', ins.kpis)
    expect(ins.chart?.byColumn).toBe('Typ')
    // Grouped by the euro amount (dates must NOT be summed): FBA ~31k, Ads ~10k.
    expect(byType['Amazon-Gebühr (FBA)']).toBeGreaterThan(30000)
    expect(byType['Amazon-Gebühr (FBA)']).toBeLessThan(32000)
    expect(byType['Werbung (Amazon Ads)']).toBeGreaterThan(9000)
    expect(byType['Werbung (Amazon Ads)']).toBeLessThan(11000)
    // No KPI should be a summed date (year ~2025 × rows would be >400k).
    expect(ins.kpis.every((k) => !k.label.toLowerCase().includes('datum'))).toBe(true)
  })
})

describe('extractViewSpec + computeView (Layer 2)', () => {
  const md = [
    '# Case', '', '## View', '', '```json',
    '{ "title":"K", "kpis":[',
    '  {"label":"Brutto","source":"sales.csv","column":"Brutto","agg":"sum","sign":"pos"},',
    '  {"label":"Fehlend","source":"missing.csv","agg":"count","sign":"neg"} ],',
    '  "chart":{"source":"amz.csv","x":"Typ","y":"Betrag"},',
    '  "table":{"source":"missing.csv"} }',
    '```', '',
  ].join('\n')
  const files: Record<string, string> = {
    'sales.csv': 'Monat;Brutto\n2025-01;1.000,00\n2025-02;2.500,00',
    'missing.csv': 'Vendor;Betrag\nA;-10,00\nB;-20,00\nC;-30,00',
    'amz.csv': 'Typ;Betrag\nFBA;100,00\nFBA;50,00\nAds;30,00',
  }
  const read = (s: string): string | null => files[s] ?? null

  it('parses the json block from the body', () => {
    const spec = extractViewSpec(md)!
    expect(spec.title).toBe('K')
    expect(spec.kpis?.length).toBe(2)
    expect(spec.chart?.x).toBe('Typ')
  })
  it('computes curated cross-file KPIs, chart and table', () => {
    const v = computeView(extractViewSpec(md)!, read)!
    expect(v.kpis[0]).toEqual({ label: 'Brutto', value: '€3.500', sign: 'pos' })
    expect(v.kpis[1]).toEqual({ label: 'Fehlend', value: '3', sign: 'neg' }) // count
    expect(v.chart?.bars.find((b) => b.label === 'FBA')?.value).toBe(150)
    expect(v.table?.file).toBe('missing.csv')
  })
  it('degrades: a missing source is skipped, not thrown', () => {
    const v = computeView({ kpis: [{ label: 'X', source: 'nope.csv', agg: 'count' }], chart: { source: 'amz.csv', x: 'Typ', y: 'Betrag' } }, read)!
    expect(v.kpis.length).toBe(0)
    expect(v.chart?.bars.length).toBeGreaterThan(0)
  })
})
