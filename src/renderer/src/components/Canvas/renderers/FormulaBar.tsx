import { memo, useState, useEffect, useRef, useCallback } from 'react'
import { applySuggestion, suggestFunctions, tokenAt, type CalcFunction } from './calcFunctions'
import styles from './FormulaBar.module.css'

interface FormulaBarProps {
  /** Active cell address, e.g. "A1". */
  cellRef: string
  /** The active cell's content/formula from the engine. */
  value: string
  /** Commit the edited content to the active cell. */
  onCommit: (text: string) => void
}

/**
 * Excel-style formula bar for Calc: shows the active cell address + its
 * content/formula, and commits edits back to the cell (Enter) or reverts (Esc).
 *
 * WOS-004: typing "=" used to offer nothing — no function list, no signature —
 * so you had to already know both the name and the argument order. It now
 * suggests functions as you type, with the arguments spelled out in plain
 * language. Arrow keys move, Tab or Enter accepts, Escape dismisses the list
 * without discarding what you typed.
 */
export const FormulaBar = memo(function FormulaBar({ cellRef, value, onCommit }: FormulaBarProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  const [caret, setCaret] = useState(0)
  const [picked, setPicked] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const editing = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep in sync with the engine when not actively editing (e.g. on cell move).
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value, cellRef])

  const token = tokenAt(draft, caret)
  const matches = dismissed ? [] : suggestFunctions(token.word)
  const open = matches.length > 0

  const accept = useCallback(
    (fn: CalcFunction) => {
      const next = applySuggestion(draft, token, fn, caret)
      setDraft(next.text)
      setDismissed(true)
      // Restore the caret after React writes the value, or it jumps to the end.
      requestAnimationFrame(() => {
        const el = inputRef.current
        if (!el) return
        el.setSelectionRange(next.caret, next.caret)
        setCaret(next.caret)
      })
    },
    [draft, token, caret],
  )

  const sync = (e: React.SyntheticEvent<HTMLInputElement>): void =>
    setCaret(e.currentTarget.selectionStart ?? 0)

  return (
    <div className={styles.bar}>
      <div className={styles.ref} title="Active cell" data-testid="cell-addr">{cellRef || ' '}</div>
      <div className={styles.fx}>fx</div>
      <div className={styles.inputWrap}>
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          spellCheck={false}
          placeholder="Enter a value or = formula"
          autoComplete="off"
          onChange={(e) => {
            setDraft(e.target.value)
            setCaret(e.target.selectionStart ?? 0)
            setPicked(0)
            setDismissed(false)
          }}
          onSelect={sync}
          onClick={sync}
          onFocus={() => { editing.current = true }}
          onBlur={() => {
            editing.current = false
            setDismissed(true)
            setDraft(value)
          }}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setPicked((i) => (i + 1) % matches.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setPicked((i) => (i - 1 + matches.length) % matches.length)
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && matches[picked])) {
                e.preventDefault()
                accept(matches[picked])
                return
              }
              if (e.key === 'Escape') {
                // Dismiss the list only — Escape a second time reverts the cell,
                // so a stray keypress can't silently discard a long formula.
                e.preventDefault()
                setDismissed(true)
                return
              }
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              editing.current = false
              onCommit(draft)
              e.currentTarget.blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(value)
              editing.current = false
              e.currentTarget.blur()
            }
          }}
        />
        {open && (
          <ul className={styles.suggestions} role="listbox" aria-label="Functions">
            {matches.map((f, i) => (
              <li
                key={f.name}
                role="option"
                aria-selected={i === picked}
                className={i === picked ? `${styles.suggestion} ${styles.picked}` : styles.suggestion}
                // mousedown, not click: the input's onBlur fires first on click
                // and would revert the draft before the pick lands.
                onMouseDown={(e) => { e.preventDefault(); accept(f) }}
                onMouseEnter={() => setPicked(i)}
              >
                <span className={styles.sName}>{f.name}</span>
                <span className={styles.sArgs}>({f.args})</span>
                <span className={styles.sDesc}>{f.desc}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
})
