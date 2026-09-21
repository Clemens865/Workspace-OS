import fs from 'fs/promises'
import path from 'path'

/**
 * Extracts plain text from a file for the search index. Returns null for types
 * we don't index (images, video, audio, binaries). Extraction failures degrade
 * to filename-only indexing rather than throwing.
 */

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
    parts.push(sheet.name)
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
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '))
    if (parts.join(' ').length > MAX_CHARS) break
  }
  return parts.join('\n').slice(0, MAX_CHARS)
}
