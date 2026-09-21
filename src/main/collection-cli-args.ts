/*
 * Pure argument parsers for the wos-collection CLI — split out so they're
 * unit-testable WITHOUT importing collection-cli.ts (whose top-level `main()`
 * runs on import, mirroring metric-cli.ts). No I/O, no store access.
 */
import { isValidA1 } from './transclusions'
import type {
  CollectionView,
  ViewFilter,
  ViewSort,
  ViewOp,
  FieldColumn,
  CollectionLinkTarget,
} from './collectionLinks'

export interface Args {
  _: string[]
  json: boolean
  help: boolean
  source?: string
  file?: string
  target?: string
  columns?: string
  filters: string[]
  sorts: string[]
  limit?: number
}

export function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], json: false, help: false, filters: [], sorts: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--json') a.json = true
    else if (t === '--help' || t === '-h') a.help = true
    else if (t === '--source') a.source = argv[++i]
    else if (t === '--file') a.file = argv[++i]
    else if (t === '--target') a.target = argv[++i]
    else if (t === '--columns') a.columns = argv[++i]
    else if (t === '--filter') a.filters.push(argv[++i] ?? '')
    else if (t === '--sort') a.sorts.push(argv[++i] ?? '')
    else if (t === '--limit') a.limit = Number(argv[++i])
    else a._.push(t)
  }
  return a
}

/** Parses "file.xlsx!Sheet!A1:C20" (sheet optional: "file.xlsx!A1:C20"). */
export function parseSourceSpec(spec: string): { filePath: string; sheet: string; ref: string } | null {
  const parts = spec.split('!')
  if (parts.length === 3) return { filePath: parts[0], sheet: parts[1], ref: parts[2] }
  if (parts.length === 2) return { filePath: parts[0], sheet: '', ref: parts[1] }
  return null
}

const FILTER_OPS: Record<string, ViewOp> = {
  '=': 'eq', '==': 'eq', 'eq': 'eq',
  '!=': 'neq', 'neq': 'neq',
  'contains': 'contains', '~': 'contains',
  '>': 'gt', 'gt': 'gt',
  '>=': 'gte', 'gte': 'gte',
  '<': 'lt', 'lt': 'lt',
  '<=': 'lte', 'lte': 'lte',
}

/** Parses one `--filter "field op value"` into a ViewFilter (or null). */
export function parseFilter(spec: string): ViewFilter | null {
  const m = spec.trim().match(/^(\S+)\s+(\S+)\s+(.+)$/)
  if (!m) return null
  const [, field, opRaw, valueRaw] = m
  const op = FILTER_OPS[opRaw.toLowerCase()]
  if (!op) return null
  const num = Number(valueRaw)
  const value: string | number = valueRaw !== '' && Number.isFinite(num) ? num : valueRaw
  return { field, op, value }
}

/** Parses one `--sort "field:desc"` (dir optional, defaults asc) into a ViewSort. */
export function parseSort(spec: string): ViewSort | null {
  const t = spec.trim()
  if (!t) return null
  const idx = t.lastIndexOf(':')
  if (idx < 0) return { field: t, dir: 'asc' }
  const field = t.slice(0, idx)
  const dir = t.slice(idx + 1).toLowerCase() === 'desc' ? 'desc' : 'asc'
  if (!field) return null
  return { field, dir }
}

/** Parses `--columns "field:Header,field2:Header2"` into ordered FieldColumns. */
export function parseColumns(spec: string): FieldColumn[] {
  const out: FieldColumn[] = []
  for (const part of spec.split(',')) {
    const t = part.trim()
    if (!t) continue
    const idx = t.indexOf(':')
    if (idx < 0) out.push({ field: t, header: t })
    else {
      const field = t.slice(0, idx).trim()
      const header = t.slice(idx + 1).trim() || field
      if (field) out.push({ field, header })
    }
  }
  return out
}

/**
 * Parses `--target <xlsx:Sheet!A1 | Sheet!A1 | A1 | anchorTag>` into a target.
 * A table anchor returns kind:'docx-table' — the caller overrides to 'pptx-table'
 * when the linked file is a .pptx (the tag alone can't distinguish them).
 */
export function parseTarget(spec: string): CollectionLinkTarget | null {
  let s = spec.trim()
  if (!s) return null
  const isXlsx = s.startsWith('xlsx:')
  if (isXlsx) s = s.slice('xlsx:'.length)
  const bang = s.lastIndexOf('!')
  const sheet = bang >= 0 ? s.slice(0, bang) : ''
  const cell = bang >= 0 ? s.slice(bang + 1) : s
  if (isXlsx || bang >= 0) {
    if (isValidA1(cell)) return { kind: 'xlsx-block', sheet, cell }
    return null // an explicit sheet-qualified / xlsx: target must be a valid cell
  }
  if (isValidA1(s)) return { kind: 'xlsx-block', sheet: '', cell: s }
  // Otherwise a docx/pptx anchor tag; normalize to wos-collection-<...>.
  const tag = /^wos-collection-/.test(s) ? s : `wos-collection-${s}`
  if (!/^wos-collection-[\w-]+$/.test(tag)) return null
  return { kind: 'docx-table', tag }
}

/** Builds a CollectionView from parsed filters/sorts/limit, or undefined. */
export function buildView(filters: ViewFilter[], sorts: ViewSort[], limit?: number): CollectionView | undefined {
  const view: CollectionView = {}
  if (filters.length) view.filters = filters
  if (sorts.length) view.sort = sorts
  if (limit !== undefined && Number.isFinite(limit) && limit >= 0) view.limit = Math.floor(limit)
  return view.filters || view.sort || view.limit !== undefined ? view : undefined
}
