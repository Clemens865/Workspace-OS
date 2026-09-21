import { memo } from 'react'
import styles from './StatusBar.module.css'

interface Props {
  app: 'w' | 'c' | 'p'
  /** Writer: from WosDocStatus. */
  doc: { page: number; pages: number; words: number; chars: number } | null
  /** Calc/Impress: current part and count. */
  part: { cur: number; count: number; name: string }
  /** Calc: the engine's selection summary ("Average: 3; Sum: 9"). */
  cellStatus: string
  /** Writer: "Page 1 of 2" style state from the engine, when it arrives. */
  pageState: string
  zoom: number
  onZoom: (z: number) => void
}

/**
 * The status line under the document: where you are (page / sheet / slide),
 * what is selected (Calc's sum and average), how much there is (words), and
 * the zoom. The Calc summary and Impress position come from the engine's own
 * state; Writer's counts come from the model (the engine's status-bar states
 * have no listener in headless mode).
 */
export const StatusBar = memo(function StatusBar({ app, doc, part, cellStatus, pageState, zoom, onZoom }: Props): JSX.Element {
  const pct = Math.round(zoom * 100)
  return (
    <div className={styles.bar} data-testid="status-bar">
      {app === 'w' && (
        <>
          <span className={styles.cell} data-testid="status-page">{doc ? `Page ${doc.page} of ${doc.pages}` : pageState || 'Page –'}</span>
          <span className={styles.cell} data-testid="status-words">{doc ? `${doc.words.toLocaleString()} words, ${doc.chars.toLocaleString()} characters` : ''}</span>
        </>
      )}
      {app === 'c' && (
        <>
          <span className={styles.cell}>{part.name ? `${part.name} (${part.cur + 1} of ${part.count})` : `Sheet ${part.cur + 1} of ${part.count}`}</span>
          <span className={styles.cell} data-testid="status-cells">{cellStatus}</span>
        </>
      )}
      {app === 'p' && <span className={styles.cell}>Slide {part.cur + 1} of {part.count}</span>}
      <span className={styles.spacer} />
      <div className={styles.zoom}>
        <button className={styles.zoomBtn} title="Zoom out" onClick={() => onZoom(zoom - 0.1)}>−</button>
        <input className={styles.slider} type="range" min={50} max={300} step={5} value={pct} aria-label="Zoom" onChange={(e) => onZoom(Number(e.target.value) / 100)} />
        <button className={styles.zoomBtn} title="Zoom in" onClick={() => onZoom(zoom + 0.1)}>+</button>
        <button className={styles.pct} title="Reset zoom" onClick={() => onZoom(1)}>{pct}%</button>
      </div>
    </div>
  )
})
