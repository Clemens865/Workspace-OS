/**
 * CSV import sniffing — the headless answer to desktop LibreOffice's CSV
 * import dialog. LOK loads a CSV with whatever FilterOptions it is handed and
 * asks nothing; with none, it guesses commas — which silently mis-splits the
 * semicolon-separated files German-locale Excel exports (and their decimal
 * commas). So we read the head of the file, detect the delimiter (and the
 * decimal-comma dialect), and hand the engine an explicit import token.
 *
 * Token positions (Calc CSV import): separator code(s), text delimiter code,
 * charset, first row, column formats, language id, quoted-field-as-text,
 * detect-special-numbers. 34 = '"', 76 = UTF-8. Language 1031 (de-DE) makes
 * "1,5" parse as one-and-a-half instead of text.
 */

const CANDIDATES: { ch: string; code: number }[] = [
  { ch: ';', code: 59 },
  { ch: ',', code: 44 },
  { ch: '\t', code: 9 },
  { ch: '|', code: 124 },
]

/** Counts occurrences of `ch` in `line` OUTSIDE double-quoted spans. */
function countOutsideQuotes(line: string, ch: string): number {
  let n = 0
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') inQ = !inQ
    else if (c === ch && !inQ) n++
  }
  return n
}

/**
 * Picks the delimiter: the candidate with the highest CONSISTENT per-line count
 * (minimum across sampled lines × 1000 + total). Consistency beats raw count —
 * a comma inside prose appears often but unevenly; the real delimiter appears
 * the same number of times on every row.
 */
export function sniffDelimiter(head: string): { ch: string; code: number } {
  const lines = head
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20)
  if (lines.length === 0) return CANDIDATES[1] // empty file → comma default
  let best = CANDIDATES[1]
  let bestScore = 0
  for (const cand of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, cand.ch))
    const min = Math.min(...counts)
    const total = counts.reduce((a, b) => a + b, 0)
    const score = min * 1000 + total
    if (min > 0 && score > bestScore) {
      bestScore = score
      best = cand
    }
  }
  return best
}

/**
 * True when the file speaks decimal-comma (German-locale numbers): digits
 * comma digits sitting alone between separators/line edges. Only meaningful
 * when the delimiter itself is NOT the comma.
 */
export function looksDecimalComma(head: string, delimiter: string): boolean {
  if (delimiter === ',') return false
  const d = delimiter === '\t' ? '\\t' : delimiter.replace(/[|;]/g, '\\$&')
  const re = new RegExp(`(?:^|${d})"?\\d{1,3}(?:\\.\\d{3})*,\\d+"?(?:${d}|\\r?$)`, 'm')
  return re.test(head)
}

/**
 * The full import token for LOK's CSV filter, or null when the file should be
 * loaded with default options (non-CSV callers).
 */
export function sniffCsvFilterOptions(head: string, ext: string): string | null {
  const e = ext.toLowerCase()
  if (e !== 'csv' && e !== 'tsv') return null
  const sep = e === 'tsv' ? { ch: '\t', code: 9 } : sniffDelimiter(head)
  const lang = looksDecimalComma(head, sep.ch) ? 1031 : 0
  // sep, text-delim ("), charset (UTF-8), first row, formats, language,
  // quoted-as-text false, detect special numbers true.
  return `${sep.code},34,76,1,,${lang},false,true`
}
