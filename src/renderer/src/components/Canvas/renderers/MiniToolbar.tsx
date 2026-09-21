import { memo } from 'react'
import { AlignCenter, AlignLeft, AlignRight, Baseline, Bold, Highlighter, Italic, PaintBucket, Underline, WrapText } from 'lucide-react'
import styles from './MiniToolbar.module.css'

export type MiniContext = 'text' | 'cells' | 'shape'

interface Props {
  /** Anchor rect in docWrap pixels — the toolbar floats just above it. */
  anchor: { x: number; y: number; w: number; h: number }
  context: MiniContext
  /** Engine state for the toggle buttons (`.uno:Bold` → 'true'). */
  active: Record<string, string>
  onUno: (cmd: string) => void
  /** Impress/Draw shape design ops (office.shapefill:…), routed like the ribbon. */
  onDesign: (id: string) => void
}

function hexToUno(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}

/**
 * The floating toolbar that appears above a fresh selection: the six things
 * people do to selected text (bold, italic, underline, colour, highlight,
 * alignment), the four they do to selected cells (bold, italic, fill, wrap),
 * and the two they do to a selected shape (fill, outline). Everything else
 * stays on the ribbon; this is the fast path, not a second ribbon.
 *
 * Clamped to the document's left edge and flipped below the selection when
 * there is no room above, so it never covers what was just selected.
 */
export const MiniToolbar = memo(function MiniToolbar({ anchor, context, active, onUno, onDesign }: Props): JSX.Element {
  const H = 34
  const above = anchor.y - H - 8 >= 0
  const top = above ? anchor.y - H - 8 : anchor.y + anchor.h + 8
  const left = Math.max(4, anchor.x)
  const on = (cmd: string): string => (active[cmd] === 'true' ? `${styles.btn} ${styles.on}` : styles.btn)
  const color = (cmd: string, key: string, hex: string): void =>
    onUno(`${cmd} {"${key}":{"type":"long","value":${hexToUno(hex)}}}`)

  return (
    <div
      className={styles.bar}
      data-testid="mini-toolbar"
      style={{ left, top }}
      // Clicks here must not reach the canvas (which would clear the selection).
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation() }}
      onContextMenu={(e) => e.preventDefault()}
      role="toolbar"
    >
      {context !== 'shape' && (
        <>
          <button className={on('.uno:Bold')} title="Bold" onClick={() => onUno('.uno:Bold')}><Bold size={14} strokeWidth={2.5} /></button>
          <button className={on('.uno:Italic')} title="Italic" onClick={() => onUno('.uno:Italic')}><Italic size={14} strokeWidth={2.5} /></button>
        </>
      )}
      {context === 'text' && (
        <>
          <button className={on('.uno:Underline')} title="Underline" onClick={() => onUno('.uno:Underline')}><Underline size={14} strokeWidth={2.5} /></button>
          <span className={styles.sep} />
          <label className={styles.color} title="Text colour"><Baseline size={14} strokeWidth={2.2} /><input type="color" defaultValue="#c00000" onChange={(e) => color('.uno:Color', 'Color', e.target.value)} /></label>
          <label className={styles.color} title="Highlight"><Highlighter size={14} strokeWidth={2.2} /><input type="color" defaultValue="#ffff00" onChange={(e) => color('.uno:CharBackColor', 'CharBackColor', e.target.value)} /></label>
          <span className={styles.sep} />
          <button className={on('.uno:LeftPara')} title="Align left" onClick={() => onUno('.uno:LeftPara')}><AlignLeft size={14} strokeWidth={2.2} /></button>
          <button className={on('.uno:CenterPara')} title="Center" onClick={() => onUno('.uno:CenterPara')}><AlignCenter size={14} strokeWidth={2.2} /></button>
          <button className={on('.uno:RightPara')} title="Align right" onClick={() => onUno('.uno:RightPara')}><AlignRight size={14} strokeWidth={2.2} /></button>
        </>
      )}
      {context === 'cells' && (
        <>
          <span className={styles.sep} />
          <label className={styles.color} title="Cell fill"><PaintBucket size={14} strokeWidth={2.2} /><input type="color" defaultValue="#fff2cc" onChange={(e) => color('.uno:BackgroundColor', 'BackgroundColor', e.target.value)} /></label>
          <label className={styles.color} title="Text colour"><Baseline size={14} strokeWidth={2.2} /><input type="color" defaultValue="#c00000" onChange={(e) => color('.uno:Color', 'Color', e.target.value)} /></label>
          <span className={styles.sep} />
          <button className={on('.uno:AlignLeft')} title="Align left" onClick={() => onUno('.uno:AlignLeft')}><AlignLeft size={14} strokeWidth={2.2} /></button>
          <button className={on('.uno:AlignHorizontalCenter')} title="Center" onClick={() => onUno('.uno:AlignHorizontalCenter')}><AlignCenter size={14} strokeWidth={2.2} /></button>
          <button className={on('.uno:AlignRight')} title="Align right" onClick={() => onUno('.uno:AlignRight')}><AlignRight size={14} strokeWidth={2.2} /></button>
          <button className={on('.uno:WrapText')} title="Wrap text" onClick={() => onUno('.uno:WrapText')}><WrapText size={14} strokeWidth={2.2} /></button>
        </>
      )}
      {context === 'shape' && (
        <>
          <label className={styles.color} title="Shape fill"><PaintBucket size={14} strokeWidth={2.2} /><input type="color" defaultValue="#5b9bd5" onChange={(e) => onDesign(`office.shapefill:${hexToUno(e.target.value)}`)} /></label>
          <label className={styles.color} title="Shape outline"><Baseline size={14} strokeWidth={2.2} /><input type="color" defaultValue="#1f3864" onChange={(e) => onDesign(`office.shapeline:${hexToUno(e.target.value)}`)} /></label>
          <span className={styles.sep} />
          <button className={styles.btn} title="Bring to front" onClick={() => onDesign('office.arrange:front')}>⤒</button>
          <button className={styles.btn} title="Send to back" onClick={() => onDesign('office.arrange:back')}>⤓</button>
        </>
      )}
    </div>
  )
})
