import { useEffect, useState, useRef, useCallback } from 'react'
import { bytesToBlob } from '../../../lib/bytesToBlob'
import styles from './ImageRenderer.module.css'

interface ImageRendererProps {
  filePath: string
}

export function ImageRenderer({ filePath }: ImageRendererProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const offsetStart = useRef({ x: 0, y: 0 })

  useEffect(() => {
    setSrc(null)
    setError(null)
    setScale(1)
    setOffset({ x: 0, y: 0 })

    window.workspace.fs.readFileBytes(filePath)
      .then((bytes: Uint8Array) => {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
          gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
          ico: 'image/x-icon', bmp: 'image/bmp',
        }
        setSrc(URL.createObjectURL(bytesToBlob(bytes, mimeMap[ext] ?? 'image/png')))
      })
      .catch((e: Error) => setError(e.message))

    return () => { if (src) URL.revokeObjectURL(src) }
  }, [filePath])

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    setScale((s) => Math.max(0.1, Math.min(10, s * (e.deltaY < 0 ? 1.1 : 0.9))))
  }, [])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStart.current = { x: e.clientX, y: e.clientY }
    offsetStart.current = offset
  }, [offset])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return
    setOffset({
      x: offsetStart.current.x + (e.clientX - dragStart.current.x),
      y: offsetStart.current.y + (e.clientY - dragStart.current.y),
    })
  }, [])

  const onMouseUp = useCallback(() => { dragging.current = false }, [])

  if (error) return <div className={styles.error}>Cannot open image: {error}</div>
  if (!src) return <div className={styles.loading}>Loading…</div>

  return (
    <div
      className={styles.root}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <div className={styles.toolbar}>
        <button onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}>Reset</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(10, s * 1.25))}>+</button>
        <button onClick={() => setScale((s) => Math.max(0.1, s * 0.8))}>−</button>
      </div>
      <div className={styles.canvas}>
        <img
          src={src}
          className={styles.image}
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            cursor: dragging.current ? 'grabbing' : 'grab',
          }}
          draggable={false}
          alt={filePath.split('/').pop()}
        />
      </div>
    </div>
  )
}
