import { useEffect, useRef, useState, useCallback } from 'react'
import { X } from 'lucide-react'
import styles from './DialogOverlay.module.css'

const CB_WINDOW = 36

// awt key codes for special keys forwarded to the dialog.
const WKEY: Record<string, { char: number; code: number }> = {
  Enter: { char: 13, code: 1280 },
  Backspace: { char: 8, code: 1283 },
  Tab: { char: 9, code: 1282 },
  Delete: { char: 0, code: 1286 },
  ArrowLeft: { char: 0, code: 1026 },
  ArrowRight: { char: 0, code: 1027 },
  ArrowUp: { char: 0, code: 1025 },
  ArrowDown: { char: 0, code: 1024 },
  Escape: { char: 0, code: 1281 },
}

interface DialogOverlayProps {
  id: number
  title: string
  w: number
  h: number
  onClose: () => void
}

/**
 * Renders a LibreOffice dialog (Phase F) as a bitmap via paintWindow and
 * forwards mouse/keyboard to the engine window. Driven by LOK_CALLBACK_WINDOW.
 */
export function DialogOverlay({ id, title, w: w0, h: h0, onClose }: DialogOverlayProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: w0, h: h0 })
  const repaintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const paint = useCallback(async (w: number, h: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const tile = await window.workspace.lok.windowPaint({ id, w, h })
    if (!canvasRef.current) return
    canvas.width = tile.cw
    canvas.height = tile.ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(tile.cw, tile.ch)
    const s = tile.bgra
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      d[i] = s[i + 2]
      d[i + 1] = s[i + 1]
      d[i + 2] = s[i]
      d[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }, [id])

  const scheduleRepaint = useCallback((w: number, h: number) => {
    if (repaintTimer.current) clearTimeout(repaintTimer.current)
    repaintTimer.current = setTimeout(() => void paint(w, h), 40)
  }, [paint])

  // Initial paint + react to the engine's window callbacks for this dialog.
  useEffect(() => {
    dialogRef.current?.focus() // keyboard-ready immediately
    void paint(size.w, size.h)
    const off = window.workspace.lok.onCallback((cb) => {
      if (cb.type !== CB_WINDOW) return
      let p: Record<string, string>
      try { p = JSON.parse(cb.payload) } catch { return }
      if (Number(p.id) !== id) return
      if (p.action === 'close' || p.action === 'hide') {
        onClose()
      } else if (p.action === 'size_changed' && p.size) {
        const [nw, nh] = p.size.split(',').map((n) => parseInt(n.trim(), 10))
        if (nw && nh) { setSize({ w: nw, h: nh }); scheduleRepaint(nw, nh) }
      } else if (p.action === 'invalidate') {
        scheduleRepaint(size.w, size.h)
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dialogRef.current?.focus() // keep keyboard input on the dialog
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const x = Math.round(e.clientX - rect.left)
    const y = Math.round(e.clientY - rect.top)
    void window.workspace.lok.windowMouse({ id, type: 0, x, y, count: 1, buttons: 1, modifier: 0 })
    void window.workspace.lok.windowMouse({ id, type: 1, x, y, count: 1, buttons: 1, modifier: 0 })
  }, [id])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const sp = WKEY[e.key]
    if (sp) {
      e.preventDefault()
      void window.workspace.lok.windowKey({ id, type: 0, charCode: sp.char, keyCode: sp.code })
      void window.workspace.lok.windowKey({ id, type: 1, charCode: sp.char, keyCode: sp.code })
    } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const cc = e.key.charCodeAt(0)
      void window.workspace.lok.windowKey({ id, type: 0, charCode: cc, keyCode: 0 })
      void window.workspace.lok.windowKey({ id, type: 1, charCode: cc, keyCode: 0 })
    }
  }, [id])

  const close = useCallback(() => {
    void window.workspace.lok.windowClose(id)
    onClose()
  }, [id, onClose])

  return (
    <div className={styles.backdrop}>
      <div ref={dialogRef} className={styles.dialog} tabIndex={0} onKeyDown={onKeyDown}>
        <div className={styles.titleBar}>
          <span className={styles.title}>{title || 'Dialog'}</span>
          <button className={styles.close} onClick={close} title="Close"><X size={15} strokeWidth={2.2} /></button>
        </div>
        <canvas ref={canvasRef} className={styles.canvas} style={{ width: size.w, height: size.h }} onMouseDown={onMouseDown} />
      </div>
    </div>
  )
}
