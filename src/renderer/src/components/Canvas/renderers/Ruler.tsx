import { useRef, useState } from 'react'
import { CM, rulerDragOp, rulerMarkers, tabsAfter, type RulerInfo, type RulerMarker } from './rulerModel'
import styles from './Ruler.module.css'

interface Props {
  info: RulerInfo
  pxPerTwip: number
  /** Where the page's left edge sits inside the ruler's host (px). */
  pageLeftPx: number
  /** Total width of the host (px) so the ruler can span it. */
  widthPx: number
  /** Runs a macro and re-reads the ruler afterwards. */
  onOp: (macro: 'WosParaFmt' | 'WosPageMargins', args: string) => void
}

const MM100_TO_TWIP = 1440 / 2540

/**
 * The Writer ruler: page margins (grey zones), the paragraph's left / first-line
 * / right indent markers and its tab stops, all draggable; a click on the
 * white part adds a tab stop, a double-click on a tab removes it. Built from
 * the model (the engine has no ruler in headless mode).
 */
export function Ruler({ info, pxPerTwip, pageLeftPx, widthPx, onOp }: Props): JSX.Element {
  const [drag, setDrag] = useState<{ marker: RulerMarker; pos: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const toPx = (mm100: number): number => pageLeftPx + mm100 * MM100_TO_TWIP * pxPerTwip
  const toMm = (px: number): number => (px - pageLeftPx) / (MM100_TO_TWIP * pxPerTwip)
  const m = rulerMarkers(info)
  const textLeft = info.left, textRight = info.pageW - info.right

  const start = (marker: RulerMarker, e: React.MouseEvent): void => {
    e.preventDefault(); e.stopPropagation()
    const host = rootRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const at = (ev: MouseEvent): number => toMm(ev.clientX - r.left)
    setDrag({ marker, pos: at(e.nativeEvent) })
    const move = (ev: MouseEvent): void => setDrag({ marker, pos: at(ev) })
    const up = (ev: MouseEvent): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      setDrag(null)
      const op = rulerDragOp(info, marker, at(ev))
      onOp(op.macro, op.args)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }

  const onClick = (e: React.MouseEvent): void => {
    const host = rootRef.current
    if (!host || drag) return
    const pos = toMm(e.clientX - host.getBoundingClientRect().left)
    if (pos <= m.leftIndent + 100 || pos >= m.rightIndent - 100) return
    onOp('WosParaFmt', tabsAfter(info, { add: pos }))
  }

  // Tick marks every 0.5 cm from the left margin, numbers every cm.
  const ticks: JSX.Element[] = []
  for (let v = textLeft; v <= textRight; v += CM / 2) {
    const major = Math.round((v - textLeft) / CM) * CM === Math.round(v - textLeft) && ((v - textLeft) % CM === 0)
    ticks.push(<span key={v} className={major ? styles.major : styles.minor} style={{ left: toPx(v) }}>{major && (v - textLeft) / CM > 0 ? (v - textLeft) / CM : ''}</span>)
  }
  const pos = (marker: RulerMarker, def: number): number => (drag?.marker === marker ? drag.pos : def)

  return (
    <div ref={rootRef} className={styles.ruler} data-testid="ruler" style={{ width: widthPx }} onClick={onClick}>
      <div className={styles.marginL} style={{ left: toPx(0), width: Math.max(0, toPx(pos('leftMargin', textLeft)) - toPx(0)) }} onMouseDown={(e) => { if (Math.abs(e.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0) - toPx(textLeft)) < 6) start('leftMargin', e) }} />
      <div className={styles.marginR} style={{ left: toPx(pos('rightMargin', textRight)), width: Math.max(0, toPx(info.pageW) - toPx(pos('rightMargin', textRight))) }} onMouseDown={(e) => { if (Math.abs(e.clientX - (rootRef.current?.getBoundingClientRect().left ?? 0) - toPx(textRight)) < 6) start('rightMargin', e) }} />
      <div className={styles.ticks}>{ticks}</div>
      {m.tabs.map((t, i) => (
        <span key={`t${i}`} className={styles.tab} data-testid="ruler-tab" style={{ left: toPx(t) }} title="Tab stop (double-click to remove)"
          onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.stopPropagation(); onOp('WosParaFmt', tabsAfter(info, { remove: i })) }} />
      ))}
      <span className={styles.first} data-testid="ruler-first" title="First-line indent" style={{ left: toPx(pos('firstLine', m.firstLine)) }} onMouseDown={(e) => start('firstLine', e)} onClick={(e) => e.stopPropagation()} />
      <span className={styles.left} data-testid="ruler-left" title="Left indent" style={{ left: toPx(pos('leftIndent', m.leftIndent)) }} onMouseDown={(e) => start('leftIndent', e)} onClick={(e) => e.stopPropagation()} />
      <span className={styles.right} data-testid="ruler-right" title="Right indent" style={{ left: toPx(pos('rightIndent', m.rightIndent)) }} onMouseDown={(e) => start('rightIndent', e)} onClick={(e) => e.stopPropagation()} />
      {drag && <span className={styles.dragLine} style={{ left: toPx(drag.pos) }} />}
    </div>
  )
}
