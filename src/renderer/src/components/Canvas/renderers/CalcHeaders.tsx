import { memo, useEffect, useMemo, useRef, useCallback } from 'react'
import type { SheetGeometry } from '../../../types/workspace-api'
import styles from './CalcHeaders.module.css'
import { OUTLINE_LEVEL_PX, outlineDepth, outlineStripSize, outlineToggleArgs, parseOutlineGroups, type OutlineGroup } from './sheetOutline'

/** Header strip sizes (CSS px). */
export const COL_HEADER_H = 22
export const ROW_HEADER_W = 46

/** twips → 1/100 mm (UNO Column.Width / Row.Height unit). */
const TWIP_TO_MM100 = 2540 / 1440
/** Pixels of slop around a boundary that arms a resize. */
const HANDLE = 7
/** Smallest size a drag may set (twips ≈ 0.7mm). */
const MIN_TWIP = 40

interface Run {
  size: number
  last: number
}

/** Parses a SheetGeometryData run-length string ("size:lastIndex …", twips). */
function parseRuns(s?: string): Run[] {
  if (!s) return [{ size: 0, last: 0 }]
  const runs: Run[] = []
  for (const tok of s.trim().split(/\s+/)) {
    const [sz, last] = tok.split(':').map(Number)
    if (Number.isFinite(sz) && Number.isFinite(last)) runs.push({ size: sz, last })
  }
  return runs.length ? runs : [{ size: 0, last: 0 }]
}

function sizeAt(runs: Run[], i: number): number {
  for (const r of runs) if (i <= r.last) return r.size
  return runs[runs.length - 1]?.size ?? 0
}

/** Spreadsheet column label: 0→A, 25→Z, 26→AA … */
function colLabel(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** A drawn header cell with its pixel span and source index. */
interface Cell {
  index: number
  start: number
  end: number
  label: string
}

interface CalcHeadersProps {
  geometry: SheetGeometry | null
  pxPerTwip: number
  /** Used-range size in twips (bounds how many headers are drawn). */
  docW: number
  docH: number
  /** Selected cell range in document px (for highlighting), or null. */
  selPx: { x: number; y: number; w: number; h: number } | null
  onResize: (kind: 'col' | 'row', index: number, sizeMm100: number) => void
  onAutofit: (kind: 'col' | 'row', index: number) => void
  /**
   * Clicking a header BODY (not a boundary) selects that whole column/row —
   * what every spreadsheet does, and the prerequisite for "delete this column"
   * meaning anything. `index` is 0-based; the doc-space centre of the band is
   * given so the caller can place the cell cursor there first.
   */
  onSelectBand?: (kind: 'col' | 'row', index: number, centreTwip: number) => void
  /** Right-click on a header band — opens the row/column menu at the pointer. */
  onBandContextMenu?: (kind: 'col' | 'row', index: number, centreTwip: number, x: number, y: number) => void
  /** Outline +/− click: the WosOutline op to run ('hide|row|1|3'). */
  onOutline?: (args: string) => void
}

/** Outline strip sizes for a geometry (0 when the sheet has no groups). */
export function outlineSizes(geometry: SheetGeometry | null): { rowW: number; colH: number } {
  return {
    rowW: outlineStripSize(outlineDepth(parseOutlineGroups(geometry?.rows?.groups))),
    colH: outlineStripSize(outlineDepth(parseOutlineGroups(geometry?.columns?.groups))),
  }
}

/** The −/+ brackets beside the headers, one per group (Data ▸ Group). */
function OutlineStrip({ axis, cells, groups, size, onToggle }: { axis: 'row' | 'col'; cells: Cell[]; groups: OutlineGroup[]; size: number; onToggle?: (g: OutlineGroup) => void }): JSX.Element | null {
  if (size <= 0) return null
  const at = (i: number): number => cells[i]?.start ?? cells.at(-1)?.end ?? 0
  const endAt = (i: number): number => cells[i]?.end ?? cells.at(-1)?.end ?? 0
  return (
    <>
      {groups.map((g, k) => {
        const lane = (g.level - 1) * OUTLINE_LEVEL_PX + 2
        const a = at(g.start), b = g.collapsed ? a : endAt(g.start + g.size - 1)
        const btn = (
          <button key={`b${k}`} className={styles.outlineBtn} data-testid={`outline-${axis}-${g.start}`} title={g.collapsed ? 'Show detail' : 'Hide detail'}
            style={axis === 'row' ? { left: lane - 1, top: Math.max(0, a - 6) } : { top: lane - 1, left: Math.max(0, a - 6) }}
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onToggle?.(g) }}>{g.collapsed ? '+' : '−'}</button>
        )
        return (
          <span key={k}>
            {!g.collapsed && <span className={styles.outlineLine} style={axis === 'row' ? { left: lane + 4, top: a + 6, height: Math.max(0, b - a - 6) } : { top: lane + 4, left: a + 6, width: Math.max(0, b - a - 6) }} />}
            {btn}
          </span>
        )
      })}
    </>
  )
}

/**
 * Frozen A/B/C and 1/2/3 header strips for the Calc grid. Rendered as the three
 * non-document cells of the parent's sticky CSS grid (corner + column + row).
 * Drawn from .uno:SheetGeometryData; boundaries are draggable to resize.
 */
// Memoized: the parent re-renders on every caret move; headers only need to
// redraw when geometry/zoom/selection actually change.
export const CalcHeaders = memo(function CalcHeaders({ geometry, pxPerTwip, docW, docH, selPx, onResize, onAutofit, onSelectBand, onBandContextMenu, onOutline }: CalcHeadersProps): JSX.Element {
  const colCanvasRef = useRef<HTMLCanvasElement>(null)
  const rowCanvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ kind: 'col' | 'row'; index: number; origin: number } | null>(null)

  // Column / row pixel layouts, recomputed when geometry or scale changes.
  const cols = useMemo<Cell[]>(() => layout(parseRuns(geometry?.columns?.sizes), docW, pxPerTwip, colLabel), [geometry, docW, pxPerTwip])
  const rows = useMemo<Cell[]>(() => layout(parseRuns(geometry?.rows?.sizes), docH, pxPerTwip, (i) => String(i + 1)), [geometry, docH, pxPerTwip])
  const rowGroups = useMemo(() => parseOutlineGroups(geometry?.rows?.groups), [geometry])
  const colGroups = useMemo(() => parseOutlineGroups(geometry?.columns?.groups), [geometry])
  const { rowW: outlineW, colH: outlineH } = outlineSizes(geometry)

  const draw = useCallback(() => {
    const dpr = window.devicePixelRatio || 1
    paintStrip(colCanvasRef.current, 'col', cols, COL_HEADER_H, dpr, selPx, pxPerTwip)
    paintStrip(rowCanvasRef.current, 'row', rows, ROW_HEADER_W, dpr, selPx, pxPerTwip)
  }, [cols, rows, selPx, pxPerTwip])

  useEffect(() => { draw() }, [draw])

  // Which boundary (if any) sits under the pointer, for the resize cursor + drag.
  const boundaryAt = (cells: Cell[], pos: number): number | null => {
    for (const c of cells) if (Math.abs(pos - c.end) <= HANDLE) return c.index
    return null
  }

  const makeHandlers = (kind: 'col' | 'row', cells: Cell[], canvasRef: React.RefObject<HTMLCanvasElement>) => {
    const posOf = (e: React.MouseEvent): number => {
      const r = canvasRef.current!.getBoundingClientRect()
      return kind === 'col' ? e.clientX - r.left : e.clientY - r.top
    }
    return {
      onMouseMove: (e: React.MouseEvent) => {
        const canvas = canvasRef.current
        if (!canvas) return
        if (dragRef.current) return // drag handled on window
        canvas.style.cursor = boundaryAt(cells, posOf(e)) != null ? (kind === 'col' ? 'col-resize' : 'row-resize') : 'default'
      },
      onContextMenu: (e: React.MouseEvent) => {
        const pos = posOf(e)
        const cell = cells.find((c) => pos >= c.start && pos <= c.end)
        if (!cell || !onBandContextMenu) return
        e.preventDefault()
        onBandContextMenu(kind, cell.index, ((cell.start + cell.end) / 2) / pxPerTwip, e.clientX, e.clientY)
      },
      onMouseDown: (e: React.MouseEvent) => {
        const pos = posOf(e)
        const idx = boundaryAt(cells, pos)
        if (idx == null) {
          // Not on a resize boundary → this is a band click, which selects the
          // whole column/row. Previously this returned and the click did
          // nothing, so headers looked interactive but were resize-only.
          const cell = cells.find((c) => pos >= c.start && pos <= c.end)
          if (cell && onSelectBand) {
            e.preventDefault()
            onSelectBand(kind, cell.index, ((cell.start + cell.end) / 2) / pxPerTwip)
          }
          return
        }
        const cell = cells.find((c) => c.index === idx)!
        e.preventDefault()
        dragRef.current = { kind, index: idx, origin: cell.start }
        const onMove = (): void => { /* live guide omitted; resize applies on release */ }
        const onUp = (ev: MouseEvent): void => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
          const d = dragRef.current
          dragRef.current = null
          if (!d) return
          const r = canvasRef.current?.getBoundingClientRect()
          if (!r) return
          const end = kind === 'col' ? ev.clientX - r.left : ev.clientY - r.top
          const sizeTwip = Math.max(MIN_TWIP, (end - d.origin) / pxPerTwip)
          onResize(kind, d.index, Math.round(sizeTwip * TWIP_TO_MM100))
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      },
      onDoubleClick: (e: React.MouseEvent) => {
        const idx = boundaryAt(cells, posOf(e))
        if (idx != null) { e.preventDefault(); onAutofit(kind, idx) }
      },
    }
  }

  // Grid: [outline | row header | sheet] × [outline | column header | sheet];
  // the outline tracks are 0 px wide when the sheet has no groups.
  return (
    <>
      <div className={styles.corner} style={{ gridColumn: '1 / 3', gridRow: '1 / 3', width: outlineW + ROW_HEADER_W, height: outlineH + COL_HEADER_H }} />
      <div className={styles.outlineCol} data-testid="outline-cols" style={{ gridColumn: 3, gridRow: 1, height: outlineH, width: Math.max(1, Math.round(docW * pxPerTwip)) }}>
        <OutlineStrip axis="col" cells={cols} groups={colGroups} size={outlineH} onToggle={(g) => onOutline?.(outlineToggleArgs('col', g))} />
      </div>
      <div className={styles.outlineRow} data-testid="outline-rows" style={{ gridColumn: 1, gridRow: 3, width: outlineW, height: Math.max(1, Math.round(docH * pxPerTwip)) }}>
        <OutlineStrip axis="row" cells={rows} groups={rowGroups} size={outlineW} onToggle={(g) => onOutline?.(outlineToggleArgs('row', g))} />
      </div>
      <canvas
        ref={colCanvasRef}
        className={styles.colHeader}
        style={{ gridColumn: 3, gridRow: 2, top: outlineH, width: Math.max(1, Math.round(docW * pxPerTwip)), height: COL_HEADER_H }}
        {...makeHandlers('col', cols, colCanvasRef)}
      />
      <canvas
        ref={rowCanvasRef}
        className={styles.rowHeader}
        style={{ gridColumn: 2, gridRow: 3, left: outlineW, width: ROW_HEADER_W, height: Math.max(1, Math.round(docH * pxPerTwip)) }}
        {...makeHandlers('row', rows, rowCanvasRef)}
      />
    </>
  )
})

/** Builds the pixel spans + labels for one axis, bounded by the used range. */
function layout(runs: Run[], extentTwip: number, pxPerTwip: number, label: (i: number) => string): Cell[] {
  const cells: Cell[] = []
  const maxPx = Math.max(1, extentTwip * pxPerTwip)
  let acc = 0
  // Always draw at least to the used range; cap to avoid runaway on huge sheets.
  for (let i = 0; i < 100000; i++) {
    const wTwip = sizeAt(runs, i)
    if (wTwip < 0) break
    if (wTwip === 0 && i > 20000) break // hidden run to the sheet's end
    const start = acc * pxPerTwip
    acc += wTwip
    const end = acc * pxPerTwip
    cells.push({ index: i, start, end, label: label(i) })
    if (end >= maxPx) break
  }
  return cells
}

/** Draws one header strip (theme colors come from the canvas's computed style). */
function paintStrip(
  canvas: HTMLCanvasElement | null,
  kind: 'col' | 'row',
  cells: Cell[],
  thickness: number,
  dpr: number,
  selPx: { x: number; y: number; w: number; h: number } | null,
  pxPerTwip: number,
): void {
  if (!canvas) return
  const lenPx = kind === 'col' ? cells.at(-1)?.end ?? 1 : cells.at(-1)?.end ?? 1
  const cssW = kind === 'col' ? lenPx : thickness
  const cssH = kind === 'col' ? thickness : lenPx
  const devW = Math.max(1, Math.round(cssW * dpr))
  const devH = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== devW) canvas.width = devW
  if (canvas.height !== devH) canvas.height = devH
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const cs = getComputedStyle(canvas)
  const bg = cs.backgroundColor || '#f3f3f3'
  const fg = cs.color || '#444'
  const line = cs.getPropertyValue('--border').trim() || 'rgba(0,0,0,0.18)'
  const accent = cs.getPropertyValue('--accent-soft').trim() || 'rgba(60,120,240,0.18)'

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, cssW, cssH)

  // Highlight the selected band.
  const sel = selPx
    ? kind === 'col'
      ? { a: selPx.x, b: selPx.x + selPx.w }
      : { a: selPx.y, b: selPx.y + selPx.h }
    : null

  ctx.font = '11px -apple-system, system-ui, sans-serif'
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  ctx.lineWidth = 1
  for (const c of cells) {
    if (c.end - c.start < 2) continue // hidden row/column: no band to draw
    if (sel && c.end > sel.a + 1 && c.start < sel.b - 1) {
      ctx.fillStyle = accent
      if (kind === 'col') ctx.fillRect(c.start, 0, c.end - c.start, cssH)
      else ctx.fillRect(0, c.start, cssW, c.end - c.start)
    }
    // boundary line
    ctx.strokeStyle = line
    ctx.beginPath()
    if (kind === 'col') { ctx.moveTo(Math.round(c.end) - 0.5, 0); ctx.lineTo(Math.round(c.end) - 0.5, cssH) }
    else { ctx.moveTo(0, Math.round(c.end) - 0.5); ctx.lineTo(cssW, Math.round(c.end) - 0.5) }
    ctx.stroke()
    // label (skip if the cell is too small to fit)
    ctx.fillStyle = fg
    if (kind === 'col') { if (c.end - c.start > 10) ctx.fillText(c.label, (c.start + c.end) / 2, cssH / 2) }
    else { if (c.end - c.start > 8) ctx.fillText(c.label, cssW / 2, (c.start + c.end) / 2) }
  }
  // outer edge (bottom for col strip, right for row strip)
  ctx.strokeStyle = line
  ctx.beginPath()
  if (kind === 'col') { ctx.moveTo(0, cssH - 0.5); ctx.lineTo(cssW, cssH - 0.5) }
  else { ctx.moveTo(cssW - 0.5, 0); ctx.lineTo(cssW - 0.5, cssH) }
  ctx.stroke()
  void pxPerTwip
}
