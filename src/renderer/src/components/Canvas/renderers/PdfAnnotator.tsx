import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import {
  decodeAnnotationDoc, forPage, mergeLineRects, toPdfPoint, toPdfRect, toScreenRect,
  type Annotation, type PageViewport,
} from '../../../lib/pdfAnnotations'
import { PdfPageOps } from './PdfPageOps'
import { useFilePrint } from '../../../hooks/useFilePrint'
import styles from './PdfAnnotator.module.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

type Tool = 'select' | 'highlight' | 'note' | 'ink'

const COLORS = ['#ffd400', '#7ee787', '#79c0ff', '#ff7b72', '#d2a8ff']

interface Props {
  filePath: string
}

/**
 * The PDF annotation surface: highlight, sticky note and freehand ink over a
 * pdf.js render, plus page operations, form filling and signing.
 *
 * Editing is NON-DESTRUCTIVE. Marks live in a sidecar next to the file and the
 * PDF itself is untouched until you export — so annotating a contract can never
 * damage the contract. Export writes REAL PDF annotations, which is what makes
 * the markup visible in Preview and Acrobat rather than only here.
 *
 * The selectable text layer pdf.js provides is what makes highlighting possible
 * at all; without it there is nothing to select. Scanned PDFs have no text layer
 * and no OCR here, so highlighting does nothing on them — the toolbar says so
 * rather than leaving the user clicking at an image.
 */
export function PdfAnnotator({ filePath }: Props): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1.4)
  const [pageCount, setPageCount] = useState(0)
  const [tool, setTool] = useState<Tool>('select')
  const [color, setColor] = useState(COLORS[0])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [viewports, setViewports] = useState<Map<number, PageViewport>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState<string | null>(null)
  const [hasText, setHasText] = useState(true)
  const [showPages, setShowPages] = useState(false)
  const inkRef = useRef<{ page: number; points: { x: number; y: number }[] } | null>(null)
  const [inkPreview, setInkPreview] = useState<{ page: number; points: { x: number; y: number }[] } | null>(null)

  useFilePrint(filePath, async () => {
    if (loading || error) throw new Error(error || 'The document is still loading')
    await window.workspace.pdf.print(filePath, annotations)
    setStatus('Opened for printing')
  })

  // ── Load existing marks ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    window.workspace.pdf.readAnnotations(filePath)
      .then((doc) => { if (!cancelled) setAnnotations(decodeAnnotationDoc(doc, filePath).annotations) })
      .catch(() => { /* no sidecar yet — start clean */ })
    return () => { cancelled = true }
  }, [filePath])

  /** Persist to the sidecar. Debounced by the caller's natural pacing (one
   *  write per completed mark), which is cheap and keeps edits crash-safe. */
  const persist = useCallback(async (next: Annotation[]) => {
    setAnnotations(next)
    try {
      await window.workspace.pdf.writeAnnotations(filePath, { version: 1, file: filePath, annotations: next })
    } catch (e) {
      setStatus(`Could not save markup: ${(e as Error).message}`)
    }
  }, [filePath])

  // ── Render pages + text layers ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)

    async function render(): Promise<void> {
      try {
        const bytes = await window.workspace.fs.readFileBytes(filePath)
        if (cancelled) return
        const data = new Uint8Array(bytes.byteLength)
        data.set(bytes)
        const doc = await pdfjs.getDocument({ data }).promise
        if (cancelled) return
        setPageCount(doc.numPages)
        const host = hostRef.current
        if (!host) return
        host.innerHTML = ''
        const vps = new Map<number, PageViewport>()
        let sawText = false

        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) break
          const page = await doc.getPage(i)
          const viewport = page.getViewport({ scale })

          const wrap = document.createElement('div')
          wrap.className = styles.pageWrap
          wrap.style.width = `${viewport.width}px`
          wrap.style.height = `${viewport.height}px`
          wrap.dataset.page = String(i)

          const canvas = document.createElement('canvas')
          canvas.width = viewport.width
          canvas.height = viewport.height
          canvas.className = styles.pageCanvas
          await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise

          // The text layer is what makes text selectable — the prerequisite for
          // anchored highlights. Positioned absolutely over the canvas.
          const textLayer = document.createElement('div')
          textLayer.className = styles.textLayer
          const textContent = await page.getTextContent()
          if (textContent.items.length > 0) sawText = true
          // Current pdf.js exposes a TextLayer CLASS (the older
          // renderTextLayer function is gone), so construct and render.
          await new pdfjs.TextLayer({
            textContentSource: textContent,
            container: textLayer,
            viewport,
          }).render()

          wrap.appendChild(canvas)
          wrap.appendChild(textLayer)
          if (!cancelled) host.appendChild(wrap)
          vps.set(i, { width: viewport.width, height: viewport.height, scale })
        }
        if (!cancelled) { setViewports(vps); setHasText(sawText); setLoading(false) }
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false) }
      }
    }

    void render()
    return () => { cancelled = true }
  }, [filePath, scale])

  /** Which page element (and its geometry) a DOM node belongs to. */
  const pageOf = (node: Node | null): { page: number; el: HTMLElement } | null => {
    let el = node instanceof HTMLElement ? node : node?.parentElement ?? null
    while (el && !el.dataset?.page) el = el.parentElement
    return el?.dataset.page ? { page: Number(el.dataset.page), el } : null
  }

  // ── Highlight from a text selection ────────────────────────────────────────
  const highlightSelection = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    const found = pageOf(range.startContainer)
    if (!found) return
    const vp = viewports.get(found.page)
    if (!vp) return

    const host = found.el.getBoundingClientRect()
    const rects = [...range.getClientRects()].map((r) => ({
      x: r.left - host.left, y: r.top - host.top, w: r.width, h: r.height,
    }))
    // One rect per text node would paint as a row of boxes with seams; merge to
    // one quad per line.
    const quads = mergeLineRects(rects).map((r) => toPdfRect(r, vp))
    if (quads.length === 0) return

    void persist([...annotations, {
      id: crypto.randomUUID(), kind: 'highlight', page: found.page,
      color, createdAt: Date.now(), quads,
    }])
    sel.removeAllRanges()
  }, [annotations, color, persist, viewports])

  useEffect(() => {
    if (tool !== 'highlight') return
    const onUp = (): void => highlightSelection()
    document.addEventListener('mouseup', onUp)
    return () => document.removeEventListener('mouseup', onUp)
  }, [tool, highlightSelection])

  // ── Note + ink ─────────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (tool !== 'note' && tool !== 'ink') return
    const found = pageOf(e.target as Node)
    if (!found) return
    const vp = viewports.get(found.page)
    if (!vp) return
    const host = found.el.getBoundingClientRect()
    const local = { x: e.clientX - host.left, y: e.clientY - host.top }

    if (tool === 'note') {
      const text = window.prompt('Note')
      if (text === null) return
      const p = toPdfPoint(local.x, local.y, vp)
      void persist([...annotations, {
        id: crypto.randomUUID(), kind: 'note', page: found.page,
        color, createdAt: Date.now(), x: p.x, y: p.y, text,
      }])
      return
    }
    inkRef.current = { page: found.page, points: [local] }
    setInkPreview({ page: found.page, points: [local] })
  }, [tool, viewports, annotations, color, persist])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const ink = inkRef.current
    if (!ink || tool !== 'ink') return
    const wrap = hostRef.current?.querySelector<HTMLElement>(`[data-page="${ink.page}"]`)
    if (!wrap) return
    const host = wrap.getBoundingClientRect()
    ink.points.push({ x: e.clientX - host.left, y: e.clientY - host.top })
    setInkPreview({ page: ink.page, points: [...ink.points] })
  }, [tool])

  const onPointerUp = useCallback(() => {
    const ink = inkRef.current
    inkRef.current = null
    setInkPreview(null)
    if (!ink || ink.points.length < 2) return
    const vp = viewports.get(ink.page)
    if (!vp) return
    void persist([...annotations, {
      id: crypto.randomUUID(), kind: 'ink', page: ink.page, color, createdAt: Date.now(),
      width: 2, strokes: [ink.points.map((p) => toPdfPoint(p.x, p.y, vp))],
    }])
  }, [annotations, color, persist, viewports])

  const remove = useCallback((id: string) => {
    void persist(annotations.filter((a) => a.id !== id))
  }, [annotations, persist])

  const exportAnnotated = useCallback(async () => {
    setStatus('Exporting…')
    try {
      const res = await window.workspace.pdf.exportAnnotated(filePath, annotations)
      setStatus(`Saved ${res.path.split('/').pop()}`)
    } catch (e) {
      setStatus(`Export failed: ${(e as Error).message}`)
    }
  }, [filePath, annotations])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.tools}>
          {(['select', 'highlight', 'note', 'ink'] as Tool[]).map((t) => (
            <button
              key={t}
              className={tool === t ? styles.toolOn : styles.toolOff}
              onClick={() => setTool(t)}
              title={t === 'highlight' && !hasText ? 'This PDF has no text layer (it is probably a scan)' : undefined}
              disabled={t === 'highlight' && !hasText}
            >
              {t === 'select' ? 'Read' : t === 'highlight' ? 'Highlight' : t === 'note' ? 'Note' : 'Draw'}
            </button>
          ))}
        </div>
        <div className={styles.colors}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={`${styles.swatch} ${color === c ? styles.swatchOn : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Colour ${c}`}
            />
          ))}
        </div>
        <span className={styles.spacer} />
        {!hasText && <span className={styles.note}>No text layer — highlighting needs OCR</span>}
        <span className={styles.count}>{annotations.length} marks</span>
        <button className={styles.btn} onClick={() => setShowPages((v) => !v)}>Pages</button>
        <button className={styles.btn} onClick={() => void exportAnnotated()} disabled={annotations.length === 0}>
          Export annotated
        </button>
        <div className={styles.zoom}>
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))}>−</button>
          <span>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.2))}>+</button>
        </div>
      </div>

      {status && <div className={styles.status} onClick={() => setStatus(null)}>{status}</div>}

      {showPages && (
        <PdfPageOps
          filePath={filePath}
          pageCount={pageCount}
          onClose={() => setShowPages(false)}
          onChanged={() => { setShowPages(false); setScale((s) => s) }}
        />
      )}

      <div className={styles.viewport}>
        {error && <div className={styles.overlay}>Cannot render: {error}</div>}
        {loading && !error && <div className={styles.overlayMuted}>Loading…</div>}
        <div
          className={`${styles.pages} ${tool !== 'select' ? styles.marking : ''} ${tool === 'highlight' ? styles.selecting : ''}`}
          ref={hostRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ visibility: loading || error ? 'hidden' : 'visible' }}
        />
        {/* Marks are painted as an overlay ABOVE the page wrappers, positioned
            from PDF space so they stay put across zoom. */}
        <AnnotationLayer
          hostRef={hostRef}
          annotations={annotations}
          viewports={viewports}
          inkPreview={inkPreview}
          color={color}
          onRemove={remove}
        />
      </div>
    </div>
  )
}

/** Absolutely-positioned marks, re-anchored to each page wrapper. */
function AnnotationLayer({
  hostRef, annotations, viewports, inkPreview, color, onRemove,
}: {
  hostRef: React.RefObject<HTMLDivElement>
  annotations: Annotation[]
  viewports: Map<number, PageViewport>
  inkPreview: { page: number; points: { x: number; y: number }[] } | null
  color: string
  onRemove: (id: string) => void
}): JSX.Element {
  const [, force] = useState(0)
  // Re-measure after layout changes (zoom, page load) so overlays track pages.
  useEffect(() => { force((n) => n + 1) }, [annotations, viewports])

  const host = hostRef.current
  if (!host) return <></>

  const nodes: JSX.Element[] = []
  for (const [page, vp] of viewports) {
    const wrap = host.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (!wrap) continue
    const offsetTop = wrap.offsetTop
    const offsetLeft = wrap.offsetLeft

    for (const a of forPage(annotations, page)) {
      if (a.kind === 'highlight') {
        a.quads.forEach((q, i) => {
          const r = toScreenRect(q, vp)
          nodes.push(
            <div
              key={`${a.id}-${i}`}
              className={styles.highlight}
              style={{ left: offsetLeft + r.x, top: offsetTop + r.y, width: r.w, height: r.h, background: a.color }}
              onDoubleClick={() => onRemove(a.id)}
              title={a.text || 'Double-click to remove'}
            />,
          )
        })
      } else if (a.kind === 'note') {
        const p = toScreenRect({ x: a.x, y: a.y, w: 0, h: 0 }, vp)
        nodes.push(
          <button
            key={a.id}
            className={styles.noteMark}
            style={{ left: offsetLeft + p.x, top: offsetTop + p.y, background: a.color }}
            title={a.text || 'Note'}
            onDoubleClick={() => onRemove(a.id)}
          >
            ●
          </button>,
        )
      } else if (a.kind === 'ink') {
        const pts = a.strokes[0]?.map((pt) => toScreenRect({ x: pt.x, y: pt.y, w: 0, h: 0 }, vp)) ?? []
        if (pts.length < 2) continue
        const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
        nodes.push(
          <svg key={a.id} className={styles.inkSvg} style={{ left: offsetLeft, top: offsetTop, width: vp.width, height: vp.height }}>
            <path d={d} fill="none" stroke={a.color} strokeWidth={2} strokeLinecap="round" onDoubleClick={() => onRemove(a.id)} />
          </svg>,
        )
      }
    }
  }

  if (inkPreview) {
    const wrap = host.querySelector<HTMLElement>(`[data-page="${inkPreview.page}"]`)
    const vp = viewports.get(inkPreview.page)
    if (wrap && vp && inkPreview.points.length > 1) {
      const d = inkPreview.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
      nodes.push(
        <svg key="ink-preview" className={styles.inkSvg} style={{ left: wrap.offsetLeft, top: wrap.offsetTop, width: vp.width, height: vp.height }}>
          <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" />
        </svg>,
      )
    }
  }

  return <div className={styles.annotLayer}>{nodes}</div>
}
