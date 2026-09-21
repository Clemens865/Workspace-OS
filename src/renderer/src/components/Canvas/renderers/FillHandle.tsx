import { useRef, useState, type MutableRefObject } from 'react'
import type { SheetGeometry } from '../../../types/workspace-api'
import { cellAtTwips } from '../../../lib/calcCellRect'
import { planFill, type CellSpan, type FillPlan } from './fillPlan'
import styles from './FillHandle.module.css'

interface Props {
  /** The selection's bounding box in docWrap pixels (the handle sits at its corner). */
  box: { x: number; y: number; w: number; h: number }
  /** The same selection as cells. */
  source: CellSpan
  geometry: SheetGeometry | null
  pxPerTwipRef: MutableRefObject<number>
  docWrapRef: MutableRefObject<HTMLDivElement | null>
  onCommit: (plan: FillPlan) => void
  /** The drag began — the parent hides anything that could cover the preview. */
  onDragStart?: () => void
}

/**
 * The fill handle and its drag: the little square at the selection's corner,
 * a dashed preview of the range it will fill while dragging, and the fill
 * itself on release (through the model API — see fillHandle.ts).
 */
export function FillHandle({ box, source, geometry, pxPerTwipRef, docWrapRef, onCommit, onDragStart }: Props): JSX.Element {
  const [preview, setPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const planRef = useRef<FillPlan | null>(null)

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const host = docWrapRef.current
    if (!host) return
    onDragStart?.()
    const rect = host.getBoundingClientRect()
    const p = pxPerTwipRef.current
    const move = (ev: MouseEvent): void => {
      const tx = (ev.clientX - rect.left) / p, ty = (ev.clientY - rect.top) / p
      const target = cellAtTwips(geometry, tx, ty)
      const plan = target ? planFill(source, target) : null
      planRef.current = plan
      if (!plan) { setPreview(null); return }
      // Preview = the union span, scaled with the source box's per-cell size
      // along the extended axis (uniform enough for a preview; the engine
      // decides the real fill on release).
      const cellW = box.w / source.cols, cellH = box.h / source.rows
      const dx = (plan.span.col - source.col) * cellW, dy = (plan.span.row - source.row) * cellH
      setPreview({ x: box.x + dx, y: box.y + dy, w: plan.span.cols * cellW, h: plan.span.rows * cellH })
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setPreview(null)
      const plan = planRef.current
      planRef.current = null
      if (plan) onCommit(plan)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  return (
    <>
      {preview && <div className={styles.preview} data-testid="fill-preview" style={{ left: preview.x, top: preview.y, width: preview.w, height: preview.h }} />}
      <div
        className={styles.handle}
        data-testid="fill-handle"
        title="Drag to fill"
        style={{ left: box.x + box.w - 4, top: box.y + box.h - 4 }}
        onMouseDown={onMouseDown}
      />
    </>
  )
}
