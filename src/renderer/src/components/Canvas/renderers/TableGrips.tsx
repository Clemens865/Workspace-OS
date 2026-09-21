import { useRef, useState } from 'react'
import type { TableGeometry } from './tableGeometry'
import { bands, borderAt, resizedSizeMm100, tableBox } from './tableGripsModel'
import styles from './TableGrips.module.css'

interface Props {
  geometry: TableGeometry
  pxPerTwip: number
  /** Select cells row r0..r1 × col c0..c1 (engine click + shift-click). */
  onSelect: (r0: number, c0: number, r1: number, c1: number) => void
  /** Insert a row/column next to `index` ('before' | 'after'). */
  onInsert: (kind: 'row' | 'col', index: number, where: 'before' | 'after') => void
  /** Resize band `index` to `sizeMm100`. */
  onResize: (kind: 'row' | 'col', index: number, sizeMm100: number) => void
}

const GRIP = 12
const HANDLE_TOL_PX = 5

/**
 * Grips around the selected table: a strip above it with one grip per column
 * (click selects the column, the small + between grips inserts one) and a strip
 * to its left for rows; the corner selects the whole table. Inner borders are
 * draggable to resize a row or column; the geometry is the engine's own
 * TABLE_SELECTED, so the grips land exactly on the table.
 */
export function TableGrips({ geometry, pxPerTwip, onSelect, onInsert, onResize }: Props): JSX.Element {
  const [drag, setDrag] = useState<{ kind: 'row' | 'col'; index: number; pos: number } | null>(null)
  const startRef = useRef<{ kind: 'row' | 'col'; index: number; origin: number; screen: number } | null>(null)
  const p = pxPerTwip
  const box = tableBox(geometry)
  const cols = bands(geometry.columns), rows = bands(geometry.rows)
  const px = (tw: number): number => tw * p

  const beginResize = (kind: 'row' | 'col', index: number, e: React.MouseEvent): void => {
    e.preventDefault(); e.stopPropagation()
    const axis = kind === 'col' ? geometry.columns : geometry.rows
    const edge = axis.offset + axis.inner[index]
    startRef.current = { kind, index, origin: edge, screen: kind === 'col' ? e.clientX : e.clientY }
    setDrag({ kind, index, pos: edge })
    const move = (ev: MouseEvent): void => {
      const s = startRef.current
      if (!s) return
      const d = ((kind === 'col' ? ev.clientX : ev.clientY) - s.screen) / p
      setDrag({ kind, index, pos: s.origin + d })
    }
    const up = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      const s = startRef.current
      startRef.current = null
      setDrag(null)
      if (!s) return
      const d = ((kind === 'col' ? ev.clientX : ev.clientY) - s.screen) / p
      if (Math.abs(d) < 20) return
      onResize(kind, index, resizedSizeMm100(axis, index, s.origin + d))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  // Inner-border hit areas for resize drags (thin strips on the borders).
  const borders: JSX.Element[] = []
  geometry.columns.inner.forEach((e, i) => {
    const x = px(geometry.columns.offset + e)
    borders.push(<div key={`cb${i}`} className={styles.vBorder} style={{ left: x - HANDLE_TOL_PX, top: px(box.y), width: HANDLE_TOL_PX * 2, height: px(box.h) }} onMouseDown={(ev) => beginResize('col', i, ev)} title="Drag to resize column" />)
  })
  geometry.rows.inner.forEach((e, i) => {
    const y = px(geometry.rows.offset + e)
    borders.push(<div key={`rb${i}`} className={styles.hBorder} style={{ top: y - HANDLE_TOL_PX, left: px(box.x), height: HANDLE_TOL_PX * 2, width: px(box.w) }} onMouseDown={(ev) => beginResize('row', i, ev)} title="Drag to resize row" />)
  })

  return (
    <div className={styles.root} data-testid="table-grips">
      {/* Corner: whole table */}
      <button className={styles.corner} style={{ left: px(box.x) - GRIP, top: px(box.y) - GRIP, width: GRIP, height: GRIP }} title="Select table" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(0, 0, rows.length - 1, cols.length - 1) }} />
      {/* Column grips */}
      {cols.map((c) => (
        <div key={`c${c.index}`} className={styles.colGrip} data-testid="table-col-grip" style={{ left: px(c.start), top: px(box.y) - GRIP, width: Math.max(2, px(c.end - c.start)), height: GRIP }}
          title={`Select column ${c.index + 1}`}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(0, c.index, rows.length - 1, c.index) }}
        >
          <button className={styles.plus} data-testid="table-col-insert" title="Insert column after" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onInsert('col', c.index, 'after') }}>+</button>
        </div>
      ))}
      {/* Row grips */}
      {rows.map((r) => (
        <div key={`r${r.index}`} className={styles.rowGrip} data-testid="table-row-grip" style={{ top: px(r.start), left: px(box.x) - GRIP, height: Math.max(2, px(r.end - r.start)), width: GRIP }}
          title={`Select row ${r.index + 1}`}
          onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onSelect(r.index, 0, r.index, cols.length - 1) }}
        >
          <button className={styles.plus} data-testid="table-row-insert" title="Insert row below" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onInsert('row', r.index, 'after') }}>+</button>
        </div>
      ))}
      {borders}
      {drag && (drag.kind === 'col'
        ? <div className={styles.guideV} style={{ left: px(drag.pos), top: px(box.y), height: px(box.h) }} />
        : <div className={styles.guideH} style={{ top: px(drag.pos), left: px(box.x), width: px(box.w) }} />)}
    </div>
  )
}

export { borderAt }
