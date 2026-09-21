import { useState, useEffect, useRef, useCallback } from 'react'
import { Search } from 'lucide-react'
import { FileIcon } from '../FilePanel/fileIcons'
import type { SearchResult } from '../../types/workspace-api'
import styles from './CommandBar.module.css'

interface CommandBarProps {
  onClose: () => void
  onOpenFile: (path: string) => void
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

export function CommandBar({ onClose, onOpenFile }: CommandBarProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selected, setSelected] = useState(0)
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // The office menu bar's commands (empty when no document is active): the
  // palette runs them exactly like a menu click, so "double underline" or
  // "goal seek" is one keystroke away without hunting through menus.
  const [commands, setCommands] = useState<{ id: string; label: string; path: string; accel?: string }[]>([])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    let alive = true
    window.workspace.menu.officeCommands?.().then((c) => { if (alive) setCommands(c ?? []) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const q = query.trim().toLowerCase()
  const hits = q
    ? commands.filter((c) => c.label.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
      .sort((x, y) => (x.label.toLowerCase().startsWith(q) ? 0 : 1) - (y.label.toLowerCase().startsWith(q) ? 0 : 1))
      .slice(0, 8)
    : []

  // Debounced query — search runs 150ms after the user stops typing.
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      return
    }
    setSearching(true)
    const handle = setTimeout(async () => {
      const r = await window.workspace.search.query(query)
      setResults(r)
      setSelected(0)
      setSearching(false)
    }, 150)
    return () => clearTimeout(handle)
  }, [query])

  const choose = useCallback((result: SearchResult) => {
    onOpenFile(result.path)
    onClose()
  }, [onOpenFile, onClose])
  const runCommand = useCallback((id: string) => {
    void window.workspace.menu.runAction(id)
    onClose()
  }, [onClose])
  // Commands are listed first; the selection index runs across both lists.
  const total = hits.length + results.length

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(total - 1, s + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(0, s - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (selected < hits.length) runCommand(hits[selected].id)
      else if (results[selected - hits.length]) choose(results[selected - hits.length])
    }
  }, [results, hits, total, selected, choose, runCommand, onClose])

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.bar} onClick={(e) => e.stopPropagation()}>
        <div className={styles.inputRow}>
          <Search size={18} strokeWidth={1.75} className={styles.icon} />
          <input
            ref={inputRef}
            className={styles.input}
            placeholder="Search files and document contents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
          />
        </div>

        {query.trim() && (
          <div className={styles.results}>
            {hits.map((c, i) => (
              <button
                key={c.id}
                className={`${styles.result} ${i === selected ? styles.active : ''}`}
                data-testid="palette-command"
                onMouseEnter={() => setSelected(i)}
                onClick={() => runCommand(c.id)}
              >
                <span className={styles.resultIcon}>›</span>
                <div className={styles.resultBody}>
                  <div className={styles.resultMain}>
                    <span className={styles.resultName}>{c.label}</span>
                    <span className={styles.badge}>command</span>
                    {c.accel && <span className={styles.badge}>{c.accel.replace('CmdOrCtrl', '⌘').replace('Shift', '⇧').replace('Alt', '⌥').replace(/\+/g, '')}</span>}
                  </div>
                  <div className={styles.path}>{c.path}</div>
                </div>
              </button>
            ))}
            {searching && results.length === 0 && hits.length === 0 ? (
              <div className={styles.empty}>Searching…</div>
            ) : results.length === 0 && hits.length === 0 ? (
              <div className={styles.empty}>No matches</div>
            ) : (
              results.map((r, i) => (
                <button
                  key={r.path}
                  className={`${styles.result} ${i + hits.length === selected ? styles.active : ''}`}
                  onMouseEnter={() => setSelected(i + hits.length)}
                  onClick={() => choose(r)}
                >
                  <span className={styles.resultIcon}>
                    <FileIcon name={basename(r.path)} isDirectory={false} size={16} />
                  </span>
                  <div className={styles.resultBody}>
                    <div className={styles.resultMain}>
                      <span className={styles.resultName}>{basename(r.path)}</span>
                      <span className={`${styles.badge} ${r.matchType === 'content' ? styles.contentBadge : ''}`}>
                        {r.matchType}
                      </span>
                    </div>
                    {r.snippet && <div className={styles.snippet}>{r.snippet}</div>}
                    <div className={styles.path}>{r.path}</div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        <div className={styles.footer}>
          <span className={styles.hint}><kbd className={styles.kbd}>↑↓</kbd> navigate</span>
          <span className={styles.hint}><kbd className={styles.kbd}>↵</kbd> open</span>
          <span className={styles.hint}><kbd className={styles.kbd}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
