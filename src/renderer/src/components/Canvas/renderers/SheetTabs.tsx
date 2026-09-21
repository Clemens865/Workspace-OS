import { memo, useEffect, useRef, useState } from 'react'
import styles from './SheetTabs.module.css'

interface Props {
  names: string[]
  current: number
  /** Index-aligned with names; a hidden sheet is still a part but shows no tab. */
  visible?: boolean[]
  /** Tab colours (decimal RGB, -1/undefined = none), index-aligned. */
  colors?: number[]
  onGoTo: (i: number) => void
  /** op ∈ insert | delete | moveleft | moveright | duplicate | hide | color; rename passes the new name. */
  onSheetOp: (op: string, arg?: string) => void
  /** Drop a dragged tab at a new position. */
  onMoveTo?: (from: number, to: number) => void
  /** Right-click on a tab (client coordinates). */
  onContextMenu?: (index: number, x: number, y: number) => void
  /** Parent asks for the inline rename field on this tab (from the context menu). */
  renameIndex?: number | null
  onRenameHandled?: () => void
}

/** Excel-style sheet tab strip: switch, insert (+), rename (double-click or
 *  the menu), delete (×), reorder (◀ ▶ or drag), right-click menu. Drives
 *  the WosSheetOp model-API macro. */
// Memoized: tabs only change on sheet ops/navigation, not per-keystroke.
export const SheetTabs = memo(function SheetTabs({ names, current, visible, colors, onGoTo, onSheetOp, onMoveTo, onContextMenu, renameIndex, onRenameHandled }: Props): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [dropAt, setDropAt] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editing !== null) inputRef.current?.select()
  }, [editing])

  const startRename = (i: number): void => {
    if (i !== current) onGoTo(i)
    setDraft(names[i] || `Sheet${i + 1}`)
    setEditing(i)
  }
  useEffect(() => {
    if (renameIndex !== null && renameIndex !== undefined) { startRename(renameIndex); onRenameHandled?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renameIndex])

  const commitRename = (): void => {
    const name = draft.trim()
    if (editing !== null && name && name !== names[editing]) onSheetOp('rename', name)
    setEditing(null)
  }

  // Drag a tab to reorder: past a 5px threshold the pointer's x picks the drop
  // slot among the visible tabs; the drop marker shows where it will land.
  const onTabMouseDown = (i: number, e: React.MouseEvent): void => {
    if (e.button !== 0 || !onMoveTo) return
    const startX = e.clientX
    let dragging = false
    let target: number | null = null
    const slotAt = (x: number): number | null => {
      const tabs = [...(barRef.current?.querySelectorAll<HTMLElement>('[data-sheet-tab]') ?? [])]
      for (const t of tabs) {
        const r = t.getBoundingClientRect()
        if (x < r.left + r.width / 2) return Number(t.dataset.sheetTab)
      }
      const last = tabs[tabs.length - 1]
      return last ? Number(last.dataset.sheetTab) : null
    }
    const onMove = (ev: MouseEvent): void => {
      if (!dragging && Math.abs(ev.clientX - startX) < 5) return
      dragging = true
      target = slotAt(ev.clientX)
      setDropAt(target !== null && target !== i ? target : null)
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDropAt(null)
      if (dragging && target !== null && target !== i) onMoveTo(i, target)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div className={styles.bar} ref={barRef}>
      {names.map((nm, i) => {
        if (visible && visible[i] === false) return null
        const label = nm || `Sheet${i + 1}`
        const color = colors?.[i]
        const stripe = color !== undefined && color >= 0 ? { boxShadow: `inset 0 -3px 0 #${color.toString(16).padStart(6, '0')}` } : undefined
        return editing === i ? (
          <input
            key={i}
            ref={inputRef}
            className={styles.edit}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              else if (e.key === 'Escape') setEditing(null)
            }}
          />
        ) : (
          <button
            key={i}
            data-sheet-tab={i}
            className={`${i === current ? styles.active : styles.tab} ${dropAt === i ? styles.dropTarget : ''}`}
            style={stripe}
            onClick={() => onGoTo(i)}
            onDoubleClick={() => startRename(i)}
            onMouseDown={(e) => onTabMouseDown(i, e)}
            onContextMenu={(e) => { if (onContextMenu) { e.preventDefault(); onContextMenu(i, e.clientX, e.clientY) } }}
            title={`${label} — double-click to rename, right-click for more`}
          >
            {label}
          </button>
        )
      })}
      <span className={styles.spacer} />
      <button className={styles.icon} title="Move sheet left" disabled={current <= 0} onClick={() => onSheetOp('moveleft')}>◀</button>
      <button className={styles.icon} title="Move sheet right" disabled={current >= names.length - 1} onClick={() => onSheetOp('moveright')}>▶</button>
      <button className={styles.icon} title="Insert sheet" onClick={() => onSheetOp('insert')}>＋</button>
      <button
        className={styles.icon}
        title="Delete sheet"
        disabled={names.length <= 1}
        onClick={() => {
          if (window.confirm(`Delete sheet "${names[current] || `Sheet${current + 1}`}"?`)) onSheetOp('delete')
        }}
      >
        🗑
      </button>
    </div>
  )
})
