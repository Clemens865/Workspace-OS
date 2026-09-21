import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { SearchAddon } from 'xterm-addon-search'
import 'xterm/css/xterm.css'
import styles from './AgentXterm.module.css'

export interface AgentTermHandle {
  /** Writes raw (ANSI-capable) text into the viewport. */
  write: (text: string) => void
  clear: () => void
  focus: () => void
}

interface AgentXtermProps {
  /** Called once with the write/clear/focus handle after the terminal mounts. */
  onReady: (handle: AgentTermHandle) => void
}

/**
 * The agent console's viewport: a real xterm.js terminal (same stack as the
 * shell) rendering the claude stream — ANSI-correct, ring-buffered scrollback,
 * selection/copy, clickable links, and ⌘F search. It is display-only: input
 * comes from the TerminalInput bar docked below, never from xterm's stdin.
 */
export function AgentXterm({ onReady }: AgentXtermProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 10_000,
      convertEol: true, // agent stream uses \n
      disableStdin: true,
      cursorBlink: false,
      theme: {
        background: '#1a1a1f',
        foreground: '#e8e8f0',
        cursor: '#1a1a1f', // effectively hidden — output-only view
        selectionBackground: '#33334080',
      },
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(search)
    term.open(container)
    fit.fit()
    term.write('\x1b[?25l') // hide the block cursor
    searchRef.current = search

    // ⌘F opens search; ⌘C copies the selection (xterm owns key events).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return false
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        return false
      }
      return true
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(container)

    onReady({
      write: (text) => term.write(text),
      clear: () => term.clear(),
      focus: () => term.focus(),
    })

    return () => {
      observer.disconnect()
      searchRef.current = null
      term.dispose()
    }
    // The parent passes a stable onReady; the terminal must mount exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const find = useCallback((q: string, backwards: boolean) => {
    if (!q) return
    if (backwards) searchRef.current?.findPrevious(q)
    else searchRef.current?.findNext(q)
  }, [])

  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') find(query, e.shiftKey)
      else if (e.key === 'Escape') {
        setSearchOpen(false)
        setQuery('')
        searchRef.current?.clearDecorations()
      }
    },
    [find, query]
  )

  return (
    <div className={styles.root}>
      <div ref={containerRef} className={styles.term} />
      {searchOpen && (
        <div className={styles.searchBar}>
          <input
            ref={searchInputRef}
            className={styles.searchInput}
            value={query}
            placeholder="Find… (Enter / ⇧Enter)"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            spellCheck={false}
          />
          <button
            className={styles.searchClose}
            onClick={() => {
              setSearchOpen(false)
              setQuery('')
              searchRef.current?.clearDecorations()
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
