import { IpcMain, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'

/** A reusable design component (Framer-style asset) with exposed variables. */
export interface Component {
  id: string
  name: string
  /** shapes; captured; block (Word text); range (Excel cell template). */
  type: 'shape' | 'card' | 'media' | 'captured' | 'block' | 'range'
  /** Word content-block kind (type 'block'). */
  blockKind: 'heading' | 'callout' | 'signature' | 'quote'
  /** Excel range-template kind (type 'range'). */
  rangeKind: 'kpi' | 'header' | 'table'
  /** Named alternate looks (Framer-style variants) for shape/composite instances. */
  variants: { name: string; fill: number; fontColor: number }[]
  base: 'rect' | 'roundrect' | 'ellipse' | 'text'
  fill: number // decimal RGB
  fillKind: 'solid' | 'gradient' | 'pattern'
  gradTo: number // gradient end color (start = fill)
  line: number // outline color
  lineWidth: number // 1/100 mm
  dash: 'solid' | 'dashed' | 'dotted' | 'dashdot'
  fontColor: number
  text: string
  body: string // block body text
  image: string // default image path (media)
  w: number // 1/100 mm
  h: number // 1/100 mm
  /** Serialized element lines for type 'captured'. */
  elements?: string[]
}

function storePath(): string {
  return path.join(app.getPath('userData'), 'components.json')
}

function readAll(): Component[] {
  try {
    const raw = fs.readFileSync(storePath(), 'utf8')
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeAll(list: Component[]): void {
  fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), 'utf8')
}

function sanitize(input: unknown): Component {
  const c = (input ?? {}) as Record<string, unknown>
  const pick = <T extends string>(v: unknown, opts: readonly T[], d: T): T => (typeof v === 'string' && (opts as readonly string[]).includes(v) ? (v as T) : d)
  const id = typeof c.id === 'string' && /^[a-z0-9]+$/i.test(c.id) ? c.id : Math.random().toString(36).slice(2, 10)
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  return {
    id,
    name: (typeof c.name === 'string' ? c.name : 'Component').slice(0, 60),
    type: pick(c.type, ['shape', 'card', 'media', 'captured', 'block', 'range'] as const, 'shape'),
    blockKind: pick(c.blockKind, ['heading', 'callout', 'signature', 'quote'] as const, 'heading'),
    rangeKind: pick(c.rangeKind, ['kpi', 'header', 'table'] as const, 'kpi'),
    variants: Array.isArray(c.variants)
      ? c.variants.slice(0, 6).map((v) => { const o = (v ?? {}) as Record<string, unknown>; return { name: (typeof o.name === 'string' ? o.name : 'Variant').slice(0, 30), fill: num(o.fill, 5806300), fontColor: num(o.fontColor, 0) } })
      : [],
    base: pick(c.base, ['rect', 'roundrect', 'ellipse', 'text'] as const, 'rect'),
    fill: num(c.fill, 5806300),
    fillKind: pick(c.fillKind, ['solid', 'gradient', 'pattern'] as const, 'solid'),
    gradTo: num(c.gradTo, 14543051),
    line: num(c.line, 2050940),
    lineWidth: Math.max(0, Math.min(2000, num(c.lineWidth, 0))),
    dash: pick(c.dash, ['solid', 'dashed', 'dotted', 'dashdot'] as const, 'solid'),
    fontColor: num(c.fontColor, 0),
    text: (typeof c.text === 'string' ? c.text : '').slice(0, 200),
    body: (typeof c.body === 'string' ? c.body : '').slice(0, 500),
    image: (typeof c.image === 'string' ? c.image : '').slice(0, 1000),
    w: Math.max(100, Math.min(60000, num(c.w, 7000))),
    h: Math.max(100, Math.min(45000, num(c.h, 4500))),
    elements: Array.isArray(c.elements) ? c.elements.filter((e): e is string => typeof e === 'string').slice(0, 60).map((e) => e.slice(0, 400)) : undefined,
  }
}

export function registerComponentsHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, 'components:list', () => readAll())

  ipcHandle(ipcMain, 'components:save', (_e, input: unknown) => {
    const c = sanitize(input)
    const list = readAll()
    const i = list.findIndex((x) => x.id === c.id)
    if (i >= 0) list[i] = c
    else list.push(c)
    writeAll(list)
    return c
  })

  ipcHandle(ipcMain, 'components:delete', (_e, id: unknown) => {
    if (typeof id !== 'string') throw new IpcValidationError('Invalid component id')
    writeAll(readAll().filter((c) => c.id !== id))
  })
}
