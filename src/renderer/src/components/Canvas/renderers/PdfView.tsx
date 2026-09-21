import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as pdfjs from 'pdfjs-dist'
import styles from './PdfRenderer.module.css'

// Point worker at the bundled worker — avoids CDN dependency (sovereignty).
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

interface PdfViewProps {
  /** Loads the PDF bytes (from a file, or a LibreOffice conversion). */
  load: () => Promise<Uint8Array>
  /** Re-runs the loader when this changes. */
  reloadKey: string
  /** Extra controls rendered on the left of the toolbar (e.g. an Edit button). */
  toolbarLeft?: ReactNode
  loadingLabel?: string
}

/** Renders a PDF (from any byte source) page-by-page with zoom. */
export function PdfView({ load, reloadKey, toolbarLeft, loadingLabel }: PdfViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.4)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setError(null)
    setPageCount(0)
    setLoading(true)

    async function render() {
      try {
        const bytes = await load()
        if (cancelled) return
        // Copy into a fresh ArrayBuffer — pdf.js transfers/detaches the buffer.
        const data = new Uint8Array(bytes.byteLength)
        data.set(bytes)
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return

        setPageCount(doc.numPages)
        setLoading(false)
        const container = containerRef.current
        if (!container) return
        container.innerHTML = ''

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) break
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = styles.page
          const ctx = canvas.getContext('2d')!
          await page.render({ canvas, canvasContext: ctx, viewport }).promise
          if (!cancelled) container.appendChild(canvas)
        }
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false) }
      }
    }

    render()
    return () => { cancelled = true }
  }, [reloadKey, scale])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <span className={styles.info}>
          {toolbarLeft}
          {pageCount > 0 ? `${pageCount} pages` : ''}
        </span>
        <div className={styles.zoomControls}>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
        </div>
      </div>
      {/* The container is always mounted so the ref is available when the async
          render loop appends page canvases. Loading/error show as overlays. */}
      <div className={styles.viewport}>
        {error && <div className={styles.overlay}>Cannot render: {error}</div>}
        {loading && !error && <div className={styles.overlay} style={{ color: 'var(--fg-muted)' }}>{loadingLabel ?? 'Loading…'}</div>}
        <div ref={containerRef} className={styles.pages} style={{ visibility: loading || error ? 'hidden' : 'visible' }} />
      </div>
    </div>
  )
}
