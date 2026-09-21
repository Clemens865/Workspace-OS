import { useEffect, useRef, useState } from 'react'
import {
  Search, ChevronUp, ChevronDown, Replace, ReplaceAll, X, CaseSensitive, WholeWord, Regex,
} from 'lucide-react'
import styles from './FindReplaceBar.module.css'

export type FindReplaceMode = 'findnext' | 'findprev' | 'replaceall'

export interface FindReplaceRequest {
  mode: FindReplaceMode
  find: string
  replace: string
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
}

interface FindReplaceBarProps {
  /** Runs a find/replace op against the engine; resolves to the match/replace
   *  count (>=0) or -1 when unsupported. */
  onRun: (req: FindReplaceRequest) => Promise<number>
  onClose: () => void
  /** false → the doc type can't search (Impress); the bar shows a note + disables. */
  supported: boolean
}

/**
 * In-app Find & Replace bar for the office renderer (Writer/Calc). Docks at the
 * top-right of the viewport, opens on ⌘F / the ribbon Find button, closes on Esc.
 * Drives the engine's model search API via `onRun` (WosFindReplace) and reports a
 * live status/count. Styled to match the other in-app office dialogs.
 */
export function FindReplaceBar({ onRun, onClose, supported }: FindReplaceBarProps): JSX.Element {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    findRef.current?.focus()
    findRef.current?.select()
  }, [])

  const run = async (mode: FindReplaceMode): Promise<void> => {
    if (!supported || !find || busy) return
    setBusy(true)
    try {
      const count = await onRun({ mode, find, replace, caseSensitive, wholeWord, regex })
      if (count < 0) setStatus('Not supported for this document')
      else if (mode === 'replaceall') setStatus(count === 0 ? 'No matches' : `Replaced ${count}`)
      else setStatus(count === 0 ? 'No matches' : 'Match found')
    } catch {
      setStatus('Search failed')
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'Enter') { e.preventDefault(); void run(e.shiftKey ? 'findprev' : 'findnext') }
  }

  return (
    <div className={styles.bar} onKeyDown={onKey}>
      <div className={styles.row}>
        <Search size={14} strokeWidth={2} className={styles.leadIcon} />
        <input
          ref={findRef}
          className={styles.input}
          placeholder="Find"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          spellCheck={false}
        />
        <div className={styles.opts}>
          <button
            className={caseSensitive ? styles.optOn : styles.opt}
            title="Match case"
            onClick={() => setCaseSensitive((v) => !v)}
          ><CaseSensitive size={15} strokeWidth={2} /></button>
          <button
            className={wholeWord ? styles.optOn : styles.opt}
            title="Whole word"
            onClick={() => setWholeWord((v) => !v)}
          ><WholeWord size={15} strokeWidth={2} /></button>
          <button
            className={regex ? styles.optOn : styles.opt}
            title="Regular expression"
            onClick={() => setRegex((v) => !v)}
          ><Regex size={15} strokeWidth={2} /></button>
        </div>
        <button className={styles.btn} title="Find previous (⇧Enter)" disabled={!supported || !find || busy} onClick={() => void run('findprev')}>
          <ChevronUp size={15} strokeWidth={2} />
        </button>
        <button className={styles.btn} title="Find next (Enter)" disabled={!supported || !find || busy} onClick={() => void run('findnext')}>
          <ChevronDown size={15} strokeWidth={2} />
        </button>
        <button className={styles.close} title="Close (Esc)" onClick={onClose}><X size={15} strokeWidth={2} /></button>
      </div>

      <div className={styles.row}>
        <Replace size={14} strokeWidth={2} className={styles.leadIcon} />
        <input
          className={styles.input}
          placeholder="Replace"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
          spellCheck={false}
        />
        <button className={styles.btn} title="Replace all matches" disabled={!supported || !find || busy} onClick={() => void run('replaceall')}>
          <ReplaceAll size={15} strokeWidth={2} />
        </button>
      </div>

      {!supported && <div className={styles.note}>Find &amp; Replace is available in Writer and Calc.</div>}
      {supported && status && <div className={styles.note}>{status}</div>}
    </div>
  )
}
