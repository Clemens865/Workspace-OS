import { useRef, useState } from 'react'
import styles from './RotateHandle.module.css'

interface Props {
  /** The selected shape's box in docWrap px. */
  box: { x: number; y: number; w: number; h: number }
  docWrapRef: React.MutableRefObject<HTMLDivElement | null>
  /** Absolute rotation, hundredths of a degree, counter-clockwise (LibreOffice's RotateAngle). */
  onCommit: (angle100: number) => void
}

/**
 * The rotate handle above a selected shape. Dragging it turns the shape about
 * its centre; Shift snaps to 15° steps. The angle is committed through the
 * model API on release (WosShapeRotate), like move and resize — the engine's
 * own rotate mode wants a mouse drag it never gets from a headless view.
 */
export function RotateHandle({ box, docWrapRef, onCommit }: Props): JSX.Element {
  const [preview, setPreview] = useState<number | null>(null)
  const angleRef = useRef(0)
  const cx = box.x + box.w / 2
  const cy = box.y + box.h / 2
  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const host = docWrapRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const move = (ev: MouseEvent): void => {
      const dx = ev.clientX - r.left - cx, dy = ev.clientY - r.top - cy
      // 0° = handle straight up; positive = counter-clockwise (LibreOffice's convention).
      let deg = (Math.atan2(dx, -dy) * 180) / Math.PI
      deg = -deg
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15
      deg = ((deg % 360) + 360) % 360
      angleRef.current = deg
      setPreview(deg)
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setPreview(null)
      onCommit(Math.round(angleRef.current * 100))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  return (
    <>
      {preview !== null && (
        <div className={styles.ghost} style={{ left: box.x, top: box.y, width: box.w, height: box.h, transform: `rotate(${-preview}deg)` }}>
          <span className={styles.deg}>{Math.round(preview)}°</span>
        </div>
      )}
      <div className={styles.stem} style={{ left: cx - 0.5, top: box.y - 26, height: 26 }} />
      <div className={styles.handle} data-testid="rotate-handle" title="Drag to rotate (Shift snaps to 15°)" style={{ left: cx - 7, top: box.y - 36 }} onMouseDown={onMouseDown} />
    </>
  )
}
