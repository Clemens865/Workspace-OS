import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, X, FileSearch, Hash } from 'lucide-react'
import { FileIcon } from '../FilePanel/fileIcons'
import type { SearchResult, SymbolResult } from '../../types/workspace-api'
import styles from './SearchPanel.module.css'

interface SearchPanelProps {
  onFileOpen: (filePath: string) => void
  /** Workspace root, for compact relative paths under each hit. */
  root: string
  /** True while this view is the visible sidebar tab — focuses the input. */
  active: boolean
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

/**
 * Sidebar Search view — the FTS5 content index's proper home (⌘⇧F). Debounced
 * full-text query over filenames *and* document contents, results grouped per
 * file with the match snippet; click opens the file in the canvas.
 */
export function SearchPanel({ onFileOpen, root, active }: SearchPanelProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [symbols, setSymbols] = useState<SymbolResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // The panel stays mounted while hidden — focus each time it becomes the view.
  useEffect(() => { if (active) inputRef.current?.focus() }, [active])

  // Debounced query — search runs 250ms after the user stops typing.
  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setSymbols([])
      setSearching(false)
      return
    }
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const [r, s] = await Promise.all([
          window.workspace.search.query(query),
          window.workspace.search.symbols(query),
        ])
        setResults(r)
        setSymbols(s)
      } catch {
        setResults([])
        setSymbols([])
      }
      setSearching(false)
    }, 250)
    return () => clearTimeout(handle)
  }, [query])

  const relative = useCallback((p: string): string => {
    return root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p
  }, [root])

  return (
    <div className={styles.root}>
      <div className={styles.searchBar}>
        <Search size={14} strokeWidth={1.75} className={styles.searchIcon} />
        <input
          ref={inputRef}
          className={styles.searchInput}
          placeholder="Search file contents…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
          data-testid="search-panel-input"
        />
        {query && (
          <button className={styles.clearSearch} onClick={() => setQuery('')} title="Clear">
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className={styles.body}>
        {!query.trim() ? (
          <div className={styles.empty}>
            <FileSearch size={28} strokeWidth={1.25} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Search the workspace</p>
            <p className={styles.emptyHint}>Filenames and document contents — docx, xlsx, pdf, text</p>
          </div>
        ) : searching && results.length === 0 && symbols.length === 0 ? (
          <div className={styles.status}>Searching…</div>
        ) : results.length === 0 && symbols.length === 0 ? (
          <div className={styles.status}>No matches</div>
        ) : (
          <>
            {symbols.length > 0 && (
              <>
                <div className={styles.sectionLabel}>Symbols</div>
                {symbols.map((s) => (
                  <button
                    key={`${s.path}:${s.line}:${s.name}`}
                    className={styles.hit}
                    onClick={() => onFileOpen(s.path)}
                    title={`${relative(s.path)}:${s.line}`}
                  >
                    <div className={styles.hitHead}>
                      <Hash size={14} strokeWidth={1.75} className={styles.symIcon} />
                      <span className={styles.hitName}>{s.name}</span>
                      <span className={styles.badge}>{s.kind}</span>
                    </div>
                    <div className={styles.hitPath}>
                      {relative(s.path)}:{s.line}
                    </div>
                  </button>
                ))}
              </>
            )}
            {results.length > 0 && (
              <>
                {symbols.length > 0 && <div className={styles.sectionLabel}>Files</div>}
                {results.map((r) => (
                  <button key={r.path} className={styles.hit} onClick={() => onFileOpen(r.path)}>
                    <div className={styles.hitHead}>
                      <FileIcon name={basename(r.path)} isDirectory={false} size={15} />
                      <span className={styles.hitName}>{basename(r.path)}</span>
                      <span className={`${styles.badge} ${r.matchType === 'content' ? styles.contentBadge : ''}`}>
                        {r.matchType}
                      </span>
                    </div>
                    {r.snippet && <div className={styles.snippet}>{r.snippet}</div>}
                    <div className={styles.hitPath}>{relative(r.path)}</div>
                  </button>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
