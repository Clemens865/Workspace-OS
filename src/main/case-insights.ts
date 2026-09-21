/**
 * A case rendered from its own artifacts — the "sixth layer".
 *
 * A case already holds the why (description), the where (stage), the story
 * (notes), the what (artifacts) and the next (offers). The missing layer is the
 * live computed truth of those artifacts: the numbers actually IN the CSVs a
 * case carries. This module turns a CSV artifact into KPIs, a category chart
 * and a table preview — generically, so it works for a tax year, a research
 * project or a client engagement without any per-case dashboard code.
 *
 * Pure on purpose: the handler does the fs read and hands the text here, so the
 * derivation is unit-testable against a real CSV without touching disk.
 */

export interface Kpi {
  label: string
  value: string
  /** 'neg' | 'pos' tints the number; undefined = neutral. */
  sign?: 'neg' | 'pos'
}
export interface ChartBar {
  label: string
  value: number
  /** Formatted for display (German grouping). */
  text: string
}
export interface ArtifactInsight {
  /** Basename of the artifact. */
  file: string
  kind: 'csv' | 'other'
  rows: number
  columns: string[]
  kpis: Kpi[]
  /** The category breakdown, when a label+value pair was found. */
  chart: { byColumn: string; valueColumn: string; bars: ChartBar[] } | null
  /** First rows, capped, for an at-a-glance table. */
  preview: string[][]
}

const MAX_ROWS = 20000
const PREVIEW_ROWS = 8
const PREVIEW_COLS = 6

/**
 * A curated view a case DECLARES for itself (Layer 2). The agent that did the
 * work writes this into the case body as a ```json block under `## View`; the
 * app renders it deterministically — offline, no LLM at view-time. When absent,
 * the auto-derived per-artifact cards (Layer 1) are the fallback.
 */
export interface ViewSpec {
  title?: string
  kpis?: { label: string; source: string; column?: string; agg?: 'sum' | 'count' | 'avg'; sign?: 'neg' | 'pos'; money?: boolean }[]
  chart?: { source: string; x: string; y?: string }
  table?: { source: string } | string
}
export interface ViewResult {
  title?: string
  kpis: Kpi[]
  chart: ArtifactInsight['chart']
  table: { file: string; preview: string[][] } | null
}

/** ISO (2025-01-31), German (31.01.2025) and slash dates — NOT amounts. */
const DATE_RE = /^\s*(\d{4}-\d{1,2}(-\d{1,2})?|\d{1,2}[./]\d{1,2}[./]\d{2,4})\s*$/

/**
 * Parse a CLEAN monetary/number cell — German (1.234,56 / −EUR 31,40) or
 * English (1,234.56). Strict on purpose: a cell with stray letters (a
 * reference like "SLR1149…", an IBAN, "Kontoführung") is NOT a number, so we
 * do not silently strip the letters and sum the digits. That leniency turned a
 * text description column into a €793-quadrillion "total".
 */
export function parseNumber(raw: string): number | null {
  if (raw == null) return null
  const t = String(raw).trim()
  if (DATE_RE.test(t)) return null // a date is not a measurement to sum
  // Remove only currency/percent tokens and spaces — never letters in general.
  const s0 = t.replace(/\s/g, '').replace(/(eur|gbp|usd|chf|€|\$|%)/gi, '')
  // What remains must be a pure number: optional sign, digits, , . separators.
  if (!/^[−-]?[\d.,]+$/.test(s0) || !/\d/.test(s0)) return null
  let s = s0.replace('−', '-')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.') // German decimal
  else s = s.replace(/,/g, '') // English (or no) grouping
  const v = parseFloat(s)
  return Number.isFinite(v) ? v : null
}

/** Sniff the delimiter of a CSV/TSV line: semicolon, tab, or comma. */
function sniffDelimiter(headerLine: string): string {
  const counts: Record<string, number> = {
    ';': (headerLine.match(/;/g) || []).length,
    '\t': (headerLine.match(/\t/g) || []).length,
    ',': (headerLine.match(/,/g) || []).length,
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

/** Minimal quote-aware CSV row splitter (handles "a;b" quoted fields). */
function splitRow(line: string, delim: string): string[] {
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

const fmt = (n: number): string => {
  const r = Math.round(n)
  return r.toLocaleString('de-DE')
}

/** Short form so long sums don't collide on a bar: 30485 → "30,5k", 4.1e6 → "4,1 Mio". */
const fmtCompact = (n: number): string => {
  const a = Math.abs(n)
  if (a >= 1e9) return (n / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mrd'
  if (a >= 1e6) return (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' Mio'
  if (a >= 1e4) return (n / 1e3).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + 'k'
  return fmt(n)
}

/**
 * Turn one CSV's text into an insight. Returns null when there is nothing
 * table-shaped to show (never throws — a broken artifact must not break a case).
 */
export function computeCsvInsight(file: string, text: string): ArtifactInsight | null {
  try {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '')
    if (lines.length < 2) return null
    const delim = sniffDelimiter(lines[0])
    const columns = splitRow(lines[0], delim).map((h) => h.replace(/^﻿/, ''))
    const rows = lines.slice(1, MAX_ROWS + 1).map((l) => splitRow(l, delim))

    // Classify columns. numeric = ≥60% clean-number cells. But an amount is a
    // narrower thing than a number: an ID column (Lfd_Nr) and an account number
    // are numeric yet meaningless to sum. A MEASURE is a numeric column that
    // either is money-named or actually carries decimals (real amounts do).
    const MONEY = /(betrag|amount|summe|eur|preis|price|wert|value|kosten|cost|total|umsatz|netto|brutto|gebühr|saldo|absetzbar)/i
    const IDLIKE = /(^|[_\s])(nr|id|lfd|nummer|no|index|zeile|konto|iban|bic)([_\s]|$)/i
    const numeric: Record<number, { sum: number; n: number; dec: number }> = {}
    const distinct: Record<number, Set<string>> = {}
    columns.forEach((_, ci) => (distinct[ci] = new Set()))
    for (const r of rows) {
      columns.forEach((_, ci) => {
        const cell = r[ci] ?? ''
        if (cell !== '') distinct[ci].add(cell)
        const v = parseNumber(cell)
        if (v != null) {
          numeric[ci] = numeric[ci] || { sum: 0, n: 0, dec: 0 }
          numeric[ci].sum += v
          numeric[ci].n++
          if (!Number.isInteger(v)) numeric[ci].dec++
        }
      })
    }
    const filled = (ci: number): number => rows.filter((r) => (r[ci] ?? '') !== '').length
    const isNumeric = (ci: number): boolean => {
      const f = filled(ci)
      return f > 0 && (numeric[ci]?.n ?? 0) / f >= 0.6
    }
    const isMeasure = (ci: number): boolean => {
      if (!isNumeric(ci) || IDLIKE.test(columns[ci])) return false
      const decRatio = (numeric[ci].dec || 0) / (numeric[ci].n || 1)
      return MONEY.test(columns[ci]) || decRatio >= 0.3
    }
    const measureCols = columns.map((_, ci) => ci).filter(isMeasure)

    // KPIs: row count, then the biggest-magnitude MEASURE columns (up to 3).
    const kpis: Kpi[] = [{ label: 'Zeilen', value: fmt(rows.length) }]
    const byMag = [...measureCols].sort((a, b) => Math.abs(numeric[b].sum) - Math.abs(numeric[a].sum))
    const shown: number[] = []
    for (const ci of byMag) {
      if (kpis.length >= 4) break
      const sum = numeric[ci].sum
      if (Math.abs(sum) < 0.005) continue // an all-zero column is not a headline
      // Skip a near-duplicate of a KPI already shown (Betrag_Original vs Betrag_EUR).
      if (shown.some((v) => Math.abs(v) > 0 && Math.abs((v - sum) / v) < 0.02)) continue
      shown.push(sum)
      kpis.push({
        label: columns[ci],
        value: (sum < 0 ? '−' : '') + '€' + fmtCompact(Math.abs(sum)),
        sign: sum < 0 ? 'neg' : 'pos',
      })
    }

    // Category chart: a low-cardinality text column × the top measure column.
    // With no measure at all, fall back to counting rows per category.
    let chart: ArtifactInsight['chart'] = null
    const valueCol = byMag[0] ?? null
    {
      // Pick the most informative category column: a name that reads like a
      // category wins outright (Typ/Kategorie/Status/Art/…), otherwise the one
      // with the richer — but still bounded — set of values. Sorting by FEWEST
      // distinct picked "Währung" (EUR/GBP) over the meaningful "Typ".
      const CAT_HINT = /(typ|type|kategorie|category|art|class|status|land|country|gruppe|group|konto|account)/i
      const labelCol = columns
        .map((_, ci) => ci)
        .filter((ci) => !isNumeric(ci))
        .map((ci) => ({ ci, d: distinct[ci].size }))
        .filter((x) => x.d >= 2 && x.d <= 30 && x.d < rows.length * 0.95)
        .map((x) => ({ ...x, score: (CAT_HINT.test(columns[x.ci]) ? 1000 : 0) + Math.min(x.d, 12) }))
        .sort((a, b) => b.score - a.score)[0]
      if (labelCol) {
        const groups: Record<string, number> = {}
        for (const r of rows) {
          const key = (r[labelCol.ci] ?? '').trim() || '—'
          if (valueCol != null) {
            const v = parseNumber(r[valueCol] ?? '')
            if (v != null) groups[key] = (groups[key] || 0) + v
          } else {
            groups[key] = (groups[key] || 0) + 1 // no amount column → count rows
          }
        }
        const bars = Object.entries(groups)
          .map(([label, value]) => ({ label, value, text: valueCol != null ? fmtCompact(value) : fmt(value) }))
          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          .slice(0, 8)
        if (bars.length >= 2)
          chart = { byColumn: columns[labelCol.ci], valueColumn: valueCol != null ? columns[valueCol] : 'Anzahl', bars }
      }
    }

    const preview = [columns.slice(0, PREVIEW_COLS), ...rows.slice(0, PREVIEW_ROWS).map((r) => r.slice(0, PREVIEW_COLS))]
    return { file, kind: 'csv', rows: rows.length, columns, kpis, chart, preview }
  } catch {
    return null
  }
}

/** Parse a CSV/TSV into columns + rows (delimiter sniffed, quote-aware). */
export function readCsv(text: string): { columns: string[]; rows: string[][] } {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== '')
  if (!lines.length) return { columns: [], rows: [] }
  const delim = sniffDelimiter(lines[0])
  const columns = splitRow(lines[0], delim).map((h) => h.replace(/^﻿/, ''))
  const rows = lines.slice(1, MAX_ROWS + 1).map((l) => splitRow(l, delim))
  return { columns, rows }
}

/** Pull a case's declared view from its markdown body — the first ```json block. */
export function extractViewSpec(md: string): ViewSpec | null {
  const m = /```json\s*([\s\S]*?)```/.exec(String(md ?? ''))
  if (!m) return null
  try {
    const o = JSON.parse(m[1])
    return o && typeof o === 'object' ? (o as ViewSpec) : null
  } catch {
    return null
  }
}

/**
 * Render a declared view against the case's artifacts. `read(source)` returns a
 * CSV artifact's text (or null if missing) — the handler resolves paths and does
 * the fs read, keeping this pure and testable. Any broken piece is skipped, not
 * thrown: a curated view degrades to whatever parts still resolve.
 */
export function computeView(spec: ViewSpec, read: (source: string) => string | null): ViewResult | null {
  if (!spec || typeof spec !== 'object') return null
  const cache = new Map<string, { columns: string[]; rows: string[][] } | null>()
  const get = (src: string): { columns: string[]; rows: string[][] } | null => {
    if (!cache.has(src)) {
      const t = read(src)
      cache.set(src, t == null ? null : readCsv(t))
    }
    return cache.get(src) ?? null
  }

  const kpis: Kpi[] = []
  for (const k of spec.kpis ?? []) {
    const data = get(k.source)
    if (!data) continue
    const agg = k.agg ?? (k.column ? 'sum' : 'count')
    let value: number
    if (agg === 'count') {
      value = data.rows.length
    } else {
      const ci = data.columns.indexOf(k.column ?? '')
      if (ci < 0) continue
      const nums = data.rows.map((r) => parseNumber(r[ci] ?? '')).filter((v): v is number => v != null)
      if (!nums.length) continue
      const sum = nums.reduce((a, b) => a + b, 0)
      value = agg === 'avg' ? sum / nums.length : sum
    }
    const money = k.money ?? agg !== 'count'
    const num = money ? (value < 0 ? '−' : '') + '€' + fmtCompact(Math.abs(value)) : fmt(value)
    kpis.push({ label: k.label, value: num, sign: k.sign ?? (agg === 'count' ? undefined : value < 0 ? 'neg' : 'pos') })
  }

  let chart: ViewResult['chart'] = null
  if (spec.chart) {
    const data = get(spec.chart.source)
    if (data) {
      const xi = data.columns.indexOf(spec.chart.x)
      const yi = spec.chart.y ? data.columns.indexOf(spec.chart.y) : -1
      if (xi >= 0) {
        const groups: Record<string, number> = {}
        for (const r of data.rows) {
          const key = (r[xi] ?? '').trim() || '—'
          if (yi >= 0) {
            const v = parseNumber(r[yi] ?? '')
            if (v != null) groups[key] = (groups[key] || 0) + v
          } else groups[key] = (groups[key] || 0) + 1
        }
        const bars = Object.entries(groups)
          .map(([label, value]) => ({ label, value, text: yi >= 0 ? fmtCompact(value) : fmt(value) }))
          .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
          .slice(0, 10)
        if (bars.length) chart = { byColumn: spec.chart.x, valueColumn: spec.chart.y ?? 'Anzahl', bars }
      }
    }
  }

  let table: ViewResult['table'] = null
  const tsrc = typeof spec.table === 'string' ? spec.table : spec.table?.source
  if (tsrc) {
    const data = get(tsrc)
    if (data)
      table = {
        file: tsrc,
        preview: [data.columns.slice(0, PREVIEW_COLS), ...data.rows.slice(0, PREVIEW_ROWS).map((r) => r.slice(0, PREVIEW_COLS))],
      }
  }

  if (!kpis.length && !chart && !table) return null
  return { title: spec.title, kpis, chart, table }
}
