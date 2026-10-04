import fs from 'fs/promises'
import path from 'path'

/**
 * Extracts plain text from a file for the search index. Returns null for types
 * we don't index (images, video, audio, binaries). Extraction failures degrade
 * to filename-only indexing rather than throwing.
 *
 * Pages, slides and sheets are marked in the text (`[Page 3]`, `[Slide 2]`,
 * `[Sheet: Budget]`), so a hit can say where in the file it is (see locate()).
 */

/** Bump when the extracted text changes shape, so indexed files are read again. */
export const EXTRACT_VERSION = 2

/** The file types whose text depends on the extractor (re-read when it changes). */
export const EXTRACTED_TYPES = ['docx', 'xlsx', 'pdf', 'pptx'] as const

const PLAIN_TEXT = new Set([
  'txt', 'md', 'csv', 'tsv', 'json', 'yaml', 'yml', 'toml', 'xml', 'html',
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h',
  'css', 'scss', 'sh', 'bash', 'sql', 'ini', 'env',
])

// Cap extracted text so a huge file can't bloat the index or block the indexer.
const MAX_CHARS = 200_000

export async function extractText(filePath: string): Promise<string | null> {
  const ext = path.extname(filePath).slice(1).toLowerCase()

  try {
    if (PLAIN_TEXT.has(ext)) {
      const text = await fs.readFile(filePath, 'utf-8')
      return text.slice(0, MAX_CHARS)
    }
    if (ext === 'docx') return await extractDocx(filePath)
    if (ext === 'xlsx') return await extractSpreadsheet(filePath)
    if (ext === 'pdf') return await extractPdf(filePath)
    if (ext === 'pptx') return await extractPptx(filePath)
  } catch {
    // Extraction failed — fall back to filename-only indexing.
    return null
  }
  return null
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path: filePath })
  return value.slice(0, MAX_CHARS)
}

async function extractSpreadsheet(filePath: string): Promise<string> {
  // exceljs is actively maintained; it replaced SheetJS/xlsx which carried an
  // unpatched prototype-pollution advisory on untrusted parsing.
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)

  const parts: string[] = []
  wb.eachSheet((sheet) => {
    parts.push(`[Sheet: ${sheet.name}]`)
    sheet.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => cells.push(String(cell.text ?? '')))
      if (cells.length) parts.push(cells.join('\t'))
    })
  })
  return parts.join('\n').slice(0, MAX_CHARS)
}

async function extractPdf(filePath: string): Promise<string> {
  // Legacy build runs under Node without a DOM.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(await fs.readFile(filePath))
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise
  const parts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    parts.push(`[Page ${i}]\n` + content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    if (parts.join(' ').length > MAX_CHARS) break
  }
  return parts.join('\n').slice(0, MAX_CHARS)
}

async function extractPptx(filePath: string): Promise<string> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  const slides = Object.keys(zip.files)
    .map((n) => /^ppt\/slides\/slide(\d+)\.xml$/.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
  const parts: string[] = []
  for (const m of slides) {
    const xml = await zip.file(m[0])!.async('string')
    parts.push(`[Slide ${m[1]}]\n` + slideText(xml))
    if (parts.join('\n').length > MAX_CHARS) break
  }
  return parts.join('\n').slice(0, MAX_CHARS)
}

/** The text of one slide's XML: each paragraph (<a:p>) on its own line. */
export function slideText(xml: string): string {
  return xml
    .split(/<\/a:p>/)
    .map((p) => [...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => decodeXml(t[1])).join(''))
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n')
}

const decodeXml = (s: string): string =>
  s.replace(/&(lt|gt|amp|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, (_m, n: string, d?: string, h?: string) =>
    d ? String.fromCodePoint(Number(d)) : h ? String.fromCodePoint(parseInt(h, 16)) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n.toLowerCase()],
  )

const MARK = /\[(Page \d+|Slide \d+|Sheet: [^\]\n]{1,80})\]/g

/**
 * Where in a file a match is: the page, slide or sheet that holds the most of
 * the terms (the first such on a tie). Null when the file has no such marks or
 * no term occurs in a marked part.
 */
export function locate(content: string, terms: string[]): string | null {
  const marks = [...content.matchAll(MARK)]
  if (!marks.length) return null
  const want = terms.map((t) => t.toLowerCase())
  let best: string | null = null
  let bestHits = 0
  marks.forEach((m, i) => {
    const from = (m.index ?? 0) + m[0].length
    const part = content.slice(from, i + 1 < marks.length ? marks[i + 1].index : undefined).toLowerCase()
    const hits = want.filter((t) => part.includes(t)).length
    if (hits > bestHits) {
      bestHits = hits
      best = m[1]
    }
  })
  return best
}
