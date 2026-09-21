import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { SlideText } from './slideText'
import styles from './OfficeViews.module.css'

/** BGRA tile → canvas (same as the slide rail / present mode). */
function blit(canvas: HTMLCanvasElement, tile: { cw: number; ch: number; bgra: Uint8Array }): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { cw, ch, bgra } = tile
  if (cw <= 0 || ch <= 0 || bgra.length < cw * ch * 4) return
  canvas.width = cw
  canvas.height = ch
  const img = ctx.createImageData(cw, ch)
  const dst = img.data
  for (let i = 0; i < dst.length; i += 4) { dst[i] = bgra[i + 2]; dst[i + 1] = bgra[i + 1]; dst[i + 2] = bgra[i]; dst[i + 3] = 255 }
  ctx.putImageData(img, 0, 0)
}

/** One engine-rendered tile of a part region, sized to `w` px wide. */
function Tile({ part, tx, ty, tw, th, w, refreshKey }: { part: number; tx: number; ty: number; tw: number; th: number; w: number; refreshKey: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const h = Math.max(1, Math.round((w * th) / Math.max(1, tw)))
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // A part that is not the engine's current one can come back blank on the
      // first paint (the view switches part for the tile); retry a couple of times.
      for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
        try {
          const t = await window.workspace.lok.partTile({ part, cw: w, ch: h, tx, ty, tw, th })
          if (cancelled || !ref.current) return
          blit(ref.current, t)
          // The host prefills the tile white, so "blank" means one flat colour.
          let any = false
          for (let i = 4; i < t.bgra.length && !any; i += 64) if (t.bgra[i] !== t.bgra[0] || t.bgra[i + 1] !== t.bgra[1] || t.bgra[i + 2] !== t.bgra[2]) any = true
          if (any) return
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)))
      }
    })()
    return () => { cancelled = true }
  }, [part, tx, ty, tw, th, w, h, refreshKey])
  return <canvas ref={ref} className={styles.tile} style={{ width: w, height: h }} />
}

// ── Impress: slide sorter ────────────────────────────────────────────────────

interface SorterProps {
  count: number
  current: number
  slideW: number
  slideH: number
  visible: boolean[]
  names: string[]
  refreshKey: number
  onGoTo: (index: number) => void
  onReorder: (from: number, to: number) => void
  onContextMenu: (index: number, x: number, y: number) => void
  onClose: () => void
}

/** A grid of every slide; click selects, double-click opens it, drag reorders. */
export function SlideSorter({ count, current, slideW, slideH, visible, names, refreshKey, onGoTo, onReorder, onContextMenu, onClose }: SorterProps): JSX.Element {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  const W = 200
  return (
    <div className={styles.view} data-testid="slide-sorter">
      <div className={styles.head}><span>Slide sorter · {count} slide{count === 1 ? '' : 's'}</span><button className={styles.x} title="Back to normal view" data-testid="view-close" onClick={onClose}><X size={14} /></button></div>
      <div className={styles.grid}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`${styles.card} ${i === current ? styles.cardOn : ''} ${over === i && dragFrom !== null && dragFrom !== i ? styles.cardOver : ''} ${visible[i] === false ? styles.cardHidden : ''}`}
            data-testid="sorter-slide" draggable
            onClick={() => onGoTo(i)} onDoubleClick={() => { onGoTo(i); onClose() }}
            onContextMenu={(e) => { e.preventDefault(); onGoTo(i); onContextMenu(i, e.clientX, e.clientY) }}
            onDragStart={() => setDragFrom(i)} onDragOver={(e) => { e.preventDefault(); setOver(i) }} onDragLeave={() => setOver(null)}
            onDrop={(e) => { e.preventDefault(); if (dragFrom !== null && dragFrom !== i) onReorder(dragFrom, i); setDragFrom(null); setOver(null) }}
            onDragEnd={() => { setDragFrom(null); setOver(null) }}
          >
            <Tile part={i} tx={0} ty={0} tw={slideW} th={slideH} w={W} refreshKey={refreshKey} />
            <div className={styles.cardLabel}><span className={styles.num}>{i + 1}</span>{names[i] ?? ''}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Impress: outline view ────────────────────────────────────────────────────

interface OutlineProps {
  slides: SlideText[]
  current: number
  onChange: (index: number, title: string, body: string[]) => void
  onGoTo: (index: number) => void
  onClose: () => void
}

/** One slide's title + bullets; local state so a blur commits the pair without racing a re-read. */
function SlideRow({ s, on, onChange, onGoTo }: { s: SlideText; on: boolean; onChange: OutlineProps['onChange']; onGoTo: (i: number) => void }): JSX.Element {
  const [title, setTitle] = useState(s.title)
  const [body, setBody] = useState(s.body.join('\n'))
  useEffect(() => { setTitle(s.title); setBody(s.body.join('\n')) }, [s.title, s.body])
  const commit = (): void => {
    const b = body.split('\n').map((x) => x.trim()).filter(Boolean)
    if (title !== s.title || b.join('\n') !== s.body.join('\n')) onChange(s.index, title, b)
  }
  return (
    <div className={`${styles.slideText} ${on ? styles.slideTextOn : ''}`} data-testid="outline-slide" onFocus={() => onGoTo(s.index)}>
      <div className={styles.outlineRow}>
        <span className={styles.num}>{s.index + 1}</span>
        <input className={styles.title} data-testid="outline-title" value={title} placeholder="Slide title"
          onChange={(e) => setTitle(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
      </div>
      <textarea className={styles.body} data-testid="outline-body" value={body} placeholder="Bullet points, one per line" rows={Math.max(2, body.split('\n').length + 1)}
        onChange={(e) => setBody(e.target.value)} onBlur={commit} />
    </div>
  )
}

/** Every slide's title and bullet text as editable text; edits land in the model on blur. */
export function OutlineView({ slides, current, onChange, onGoTo, onClose }: OutlineProps): JSX.Element {
  return (
    <div className={styles.view} data-testid="outline-view">
      <div className={styles.head}><span>Outline</span><button className={styles.x} title="Back to normal view" data-testid="view-close" onClick={onClose}><X size={14} /></button></div>
      <div className={styles.outline}>
        {slides.map((s) => <SlideRow key={s.index} s={s} on={s.index === current} onChange={onChange} onGoTo={onGoTo} />)}
        {slides.length === 0 && <div className={styles.empty}>No slides.</div>}
      </div>
    </div>
  )
}

// ── Writer: print preview ────────────────────────────────────────────────────

interface PreviewProps {
  pages: number
  /** Document size in twips (all pages stacked, engine borders included). */
  docW: number
  docH: number
  refreshKey: number
  onExportPdf: () => void
  onClose: () => void
}

/** Every page of the document side by side, rendered by the engine at reduced size. */
export function PrintPreview({ pages, docW, docH, refreshKey, onExportPdf, onClose }: PreviewProps): JSX.Element {
  const n = Math.max(1, pages)
  const stride = docH / n
  const W = 260
  return (
    <div className={styles.view} data-testid="print-preview">
      <div className={styles.head}>
        <span>Print preview · {n} page{n === 1 ? '' : 's'}</span>
        <span className={styles.headActions}>
          <button className={styles.action} onClick={onExportPdf}>Export PDF</button>
          <button className={styles.x} title="Back to the document" data-testid="view-close" onClick={onClose}><X size={14} /></button>
        </span>
      </div>
      <div className={styles.grid}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className={styles.page} data-testid="preview-page">
            <Tile part={0} tx={0} ty={Math.round(i * stride)} tw={docW} th={Math.round(stride)} w={W} refreshKey={refreshKey} />
            <div className={styles.cardLabel}>Page {i + 1}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
