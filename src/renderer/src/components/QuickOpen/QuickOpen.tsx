import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { FileSearch } from 'lucide-react'
import { FileIcon } from '../FilePanel/fileIcons'
import { rankFiles } from '../../lib/fuzzy'
import type { RecentEntry } from '../../hooks/useWorkspaceLibrary'
import styles from './QuickOpen.module.css'

interface QuickOpenProps {
  onClose: () => void
  onOpenFile: (path: string) => void
  /** Per-workspace recent files (most recent first) — boosts ranking. */
  recent: RecentEntry[]
  root: string
}

const MAX_RESULTS = 50

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/**
 * ⌘P quick-open: fuzzy file palette over the whole workspace, most-recent-first.
 * Filename navigation only — content search lives in ⌘K and the Search panel.
 */
export function QuickOpen({ onClose, onOpenFile, recent, root }: QuickOpenProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [loaded, setLoaded] = useState(false)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // One bounded walk per palette open — fresh enough, and cheap to re-run.
  useEffect(() => {
    let alive = true
    window.workspace.fs.listFiles()
      .then((f) => { if (alive) { setFiles(f); setLoaded(true) } })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [])

  const recentPaths = useMemo(() => recent.map((r) => r.path), [recent])

  const results = useMemo(
    () => rankFiles(query, files, recentPaths).slice(0, MAX_RESULTS),
    [query, files, recentPaths],
  )

  useEffect(() => { setSelected(0) }, [query])

  const choose = useCallback((path: string) => {
    onOpenFile(path)
    onClose()
  }, [onOpenFile, onClose])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(results.length - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault()
      choose(results[selected].path)
    }
  }, [results, selected, choose, onClose])

  // Keep the active row in view while arrowing through the list.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const relative = useCallback((p: string): string => {
    const rel = root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
    const dir = rel.slice(0, rel.lastIndexOf('/'))
    return dir
  }, [root])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.bar} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <FileSearch size={18} strokeWidth={1.75} className={styles.icon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Go to file…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            data-testid="quick-open-input"
          />
        </div>

        <div className={styles.results} ref={listRef}>
          {!loaded ? (
            <div className={styles.empty}>Loading files…</div>
          ) : results.length === 0 ? (
            <div className={styles.empty}>{files.length === 0 ? 'No files in workspace' : 'No matches'}</div>
          ) : (
            results.map((r, i) => (
              <button
                key={r.path}
                data-index={i}
                className={`${styles.result} ${i === selected ? styles.active : ''}`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => choose(r.path)}
              >
                <span className={styles.resultIcon}>
                  <FileIcon name={basename(r.path)} isDirectory={false} size={16} />
                </span>
                <span className={styles.resultName}>{basename(r.path)}</span>
                {!query.trim() && recentPaths.includes(r.path) && (
                  <span className={styles.badge}>recent</span>
                )}
                <span className={styles.resultDir}>{relative(r.path)}</span>
              </button>
            ))
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}><kbd className={styles.kbd}>↑↓</kbd> navigate</span>
          <span className={styles.hint}><kbd className={styles.kbd}>↵</kbd> open</span>
          <span className={styles.hint}><kbd className={styles.kbd}>esc</kbd> close</span>
          <span className={styles.hintRight}><kbd className={styles.kbd}>⌘K</kbd> content search</span>
        </div>
      </div>
    </div>
  )
}
