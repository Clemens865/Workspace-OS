import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './PresentMode.module.css'

interface PresentModeProps {
  count: number
  start: number
  slideW: number
  slideH: number
  /** Seconds each slide waits before advancing on its own (0 or missing = wait for a click). */
  advance?: number[]
  onClose: () => void
}

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

/**
 * Full-screen slideshow. Renders any slide via partTile (independent of the
 * engine's active view), advancing with arrows/space; Esc exits.
 */
export function PresentMode({ count, start, slideW, slideH, advance, onClose }: PresentModeProps): JSX.Element {
  const [idx, setIdx] = useState(start)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Automatic advance (Transitions ▸ "after N s"): the timer restarts on every
  // slide; a manual arrow press simply lands on a slide with its own timer.
  useEffect(() => {
    const secs = advance?.[idx] ?? 0
    if (!(secs > 0) || idx >= count - 1) return
    const t = setTimeout(() => setIdx((i) => Math.min(count - 1, i + 1)), secs * 1000)
    return () => clearTimeout(t)
  }, [idx, advance, count])

  // Render the slide at a large size matched to the viewport aspect.
  useEffect(() => {
    if (slideW <= 0 || slideH <= 0) return
    let cancelled = false
    const aspect = slideW / slideH
    const vw = window.innerWidth
    const vh = window.innerHeight
    let cw = vw, ch = Math.round(vw / aspect)
    if (ch > vh) { ch = vh; cw = Math.round(vh * aspect) }
    ;(async () => {
      try {
        const t = await window.workspace.lok.partTile({ part: idx, cw, ch, tx: 0, ty: 0, tw: slideW, th: slideH })
        if (!cancelled && canvasRef.current) blit(canvasRef.current, t)
      } catch { /* skip */ }
    })()
    return () => { cancelled = true }
  }, [idx, slideW, slideH])

  const next = useCallback(() => setIdx((i) => Math.min(count - 1, i + 1)), [count])
  const prev = useCallback(() => setIdx((i) => Math.max(0, i - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'q') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown' || e.key === 'ArrowDown') { e.preventDefault(); next() }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); prev() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [next, prev, onClose])

  return (
    <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) next() }}>
      <canvas ref={canvasRef} className={styles.slide} />
      <span data-testid="present-index" hidden>{idx}</span>
      <div className={styles.bar}>
        <button onClick={prev} disabled={idx === 0} title="Previous (←)">‹</button>
        <span className={styles.count}>{idx + 1} / {count}</span>
        <button onClick={next} disabled={idx === count - 1} title="Next (→)">›</button>
        <button className={styles.exit} onClick={onClose} title="Exit (Esc)">Exit</button>
      </div>
    </div>
  )
}
