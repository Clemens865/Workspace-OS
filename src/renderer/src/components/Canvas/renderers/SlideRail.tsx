import { memo, useEffect, useRef, useState } from 'react'
import type { DeckSvg } from '../../../lib/svgSlides'
import styles from './SlideRail.module.css'

interface SlideRailProps {
  count: number
  current: number
  /** Slide dimensions in twips (for thumbnail aspect ratio). */
  slideW: number
  slideH: number
  /** Bump to re-render thumbnails (after edits / structural changes). */
  refreshKey: number
  /** Vector deck → crisp <img> thumbnails; null → bitmap-tile fallback. */
  deck: DeckSvg | null
  onGoTo: (i: number) => void
  /** Reorder a slide from one position to another (drag). */
  onReorder: (from: number, to: number) => void
  /** Index-aligned; a hidden slide is drawn dimmed with a struck number. */
  visible?: boolean[]
  /** Right-click on a thumbnail (client coordinates). */
  onContextMenu?: (index: number, x: number, y: number) => void
  /** Parent asks for the inline rename field on this slide (from the context menu). */
  renameIndex?: number | null
  onRename?: (index: number, name: string) => void
  onRenameHandled?: () => void
  /** Slide names (for the rename field's initial value). */
  names?: string[]
}

const THUMB_W = 150

/** BGRA tile → canvas. */
function blit(canvas: HTMLCanvasElement, tile: { cw: number; ch: number; bgra: Uint8Array }): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { cw, ch, bgra } = tile
  if (cw <= 0 || ch <= 0 || bgra.length < cw * ch * 4) return
  canvas.width = cw
  canvas.height = ch
  const img = ctx.createImageData(cw, ch)
  const dst = img.data
  for (let i = 0; i < dst.length; i += 4) {
    dst[i] = bgra[i + 2]; dst[i + 1] = bgra[i + 1]; dst[i + 2] = bgra[i]; dst[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// Memoized: thumbnails only change on slide edits (refreshKey) or navigation,
// not on the parent's per-keystroke re-renders.
export const SlideRail = memo(function SlideRail({ count, current, slideW, slideH, refreshKey, deck, onGoTo, onReorder, visible, onContextMenu, renameIndex, onRename, onRenameHandled, names }: SlideRailProps): JSX.Element {
  const refs = useRef<(HTMLCanvasElement | null)[]>([])
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  useEffect(() => {
    if (renameIndex !== null && renameIndex !== undefined) {
      setDraft(names?.[renameIndex] ?? `Slide ${renameIndex + 1}`)
      setEditing(renameIndex)
      onRenameHandled?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameIndex])
  const commitRename = (): void => {
    const name = draft.trim()
    if (editing !== null && name && onRename) onRename(editing, name)
    setEditing(null)
  }
  const railRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const thumbH = slideW > 0 ? Math.round((THUMB_W * slideH) / slideW) : Math.round((THUMB_W * 9) / 16)
  const prevCount = useRef(-1)
  const currentRef = useRef(current)
  currentRef.current = current
  // Vector deck → crisp <img> thumbnails, no per-slide engine render at all.
  const vector = deck && deck.slideCount >= count

  // Bitmap fallback (no vector deck): render thumbnails via partTile. Each is a
  // full slide render, so on an *edit* (refreshKey bump) we render ONLY the slide
  // you changed; a structural change (count changes) re-renders all.
  useEffect(() => {
    if (vector || slideW <= 0 || slideH <= 0 || count <= 0) return
    let cancelled = false
    const structural = count !== prevCount.current
    prevCount.current = count
    const targets = structural
      ? Array.from({ length: count }, (_, i) => i)
      : [currentRef.current].filter((i) => i >= 0 && i < count)
    ;(async () => {
      for (const i of targets) {
        try {
          const t = await window.workspace.lok.partTile({ part: i, cw: THUMB_W, ch: thumbH, tx: 0, ty: 0, tw: slideW, th: slideH })
          if (cancelled) return
          const c = refs.current[i]
          if (c) blit(c, t)
        } catch { /* skip */ }
      }
    })()
    return () => { cancelled = true }
  }, [vector, count, refreshKey, slideW, slideH, thumbH])

  // Mouse-based drag reorder. HTML5 drag-and-drop (draggable + dragstart/drop)
  // proved unreliable for real pointer drags inside the Electron canvas app, so
  // the rail tracks mousedown → move → up itself: past a small threshold the
  // press becomes a drag, the item under the pointer highlights as the drop
  // target, and releasing over another item reorders.
  const onItemMouseDown = (from: number, e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const startX = e.clientX, startY = e.clientY
    let target: number | null = null
    const indexAt = (clientY: number): number | null => {
      const rail = railRef.current
      if (!rail) return null
      const items = Array.from(rail.querySelectorAll('button'))
      for (let k = 0; k < items.length; k++) {
        const r = items[k].getBoundingClientRect()
        if (clientY >= r.top - 4 && clientY <= r.bottom + 4) return k
      }
      return null
    }
    const onMove = (ev: MouseEvent): void => {
      if (!draggingRef.current && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return
      draggingRef.current = true
      target = indexAt(ev.clientY)
      setDropTarget(target !== null && target !== from ? target : null)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDropTarget(null)
      const wasDrag = draggingRef.current
      draggingRef.current = false
      if (wasDrag && target !== null && target !== from) onReorder(from, target)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className={styles.rail} ref={railRef}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          data-slide-tab={i}
          data-hidden={visible && visible[i] === false ? 'true' : undefined}
          className={`${styles.item} ${i === current ? styles.active : ''} ${dropTarget === i ? styles.dropTarget : ''} ${visible && visible[i] === false ? styles.hidden : ''}`}
          onClick={() => onGoTo(i)}
          title={`${names?.[i] || `Slide ${i + 1}`}${visible && visible[i] === false ? ' (hidden)' : ''} — right-click for more`}
          onMouseDown={(e) => onItemMouseDown(i, e)}
          onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); e.stopPropagation(); onContextMenu(i, e.clientX, e.clientY) } }}
        >
          <span className={styles.num}>{i + 1}</span>
          {editing === i && (
            <input
              autoFocus
              className={styles.rename}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') setEditing(null) }}
            />
          )}
          {vector ? (
            <img
              src={deck.slideUrl(i)}
              className={styles.thumb}
              style={{ width: THUMB_W, height: thumbH }}
              alt={`Slide ${i + 1}`}
              draggable={false}
            />
          ) : (
            <canvas
              ref={(el) => { refs.current[i] = el }}
              className={styles.thumb}
              style={{ width: THUMB_W, height: thumbH }}
            />
          )}
        </button>
      ))}
    </div>
  )
})
