import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, Star, Clock, X, Trash2 } from 'lucide-react'
import styles from './HistorySearch.module.css'

/**
 * Everything you have read, and everything you kept.
 *
 * Phase 1 built a full-text index over page CONTENT and gave it no way in — the
 * best thing this browser can do was reachable only from an IPC call. This is
 * that way in.
 *
 * It searches the BODY of pages, not their titles, which is the whole point:
 * "that pricing page from last week" is findable by the number that was on it.
 *
 * BOOKMARKS ARE A SCOPE HERE, NOT A SECOND PANEL. Starring worked from the
 * start and `history.bookmarks()` sat in the API unused, so a bookmark was
 * write-only: you could keep a page and never see what you had kept. A separate
 * bookmarks window was the obvious fix and the wrong one — it costs permanent
 * chrome and splits one question ("where was that page?") across two places.
 * Starred pages are a filter on the same list, reachable from the same key.
 *
 * Deleting is offered on every row, and it is real — the index removes the
 * stored text too, not just the listing. A local record of everything you have
 * read has to be as easy to erase as it was to create, or it should not exist.
 */

interface Entry {
  url: string
  title: string
  favicon: string
  lastVisited: number
  visitCount: number
  starred: boolean
  snippet: string
}

export type LibraryScope = 'all' | 'starred'

export function HistorySearch({
  onOpen,
  onClose,
  initialScope = 'all',
}: {
  onOpen: (url: string) => void
  onClose: () => void
  /** Which list to open on. The bookmarks action opens straight to 'starred'. */
  initialScope?: LibraryScope
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<LibraryScope>(initialScope)
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards a slow response for an old query from replacing a newer one.
  const seq = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const load = useCallback(async (q: string, sc: LibraryScope) => {
    const mine = ++seq.current
    setLoading(true)
    try {
      let res: Entry[]
      if (sc === 'starred') {
        // `bookmarks()` takes no query, so typing filters what came back. The
        // set is small by nature — these are pages someone chose to keep — so
        // matching title and host in the renderer is honest rather than lazy.
        // Content search stays on the 'all' scope, where the index is.
        const all = ((await window.workspace.history.bookmarks(200)) ?? []) as Entry[]
        const needle = q.trim().toLowerCase()
        res = needle
          ? all.filter(
              (e) =>
                (e.title ?? '').toLowerCase().includes(needle) ||
                (e.url ?? '').toLowerCase().includes(needle),
            )
          : all
      } else {
        // An empty box shows what you read most recently; typing searches the
        // page text. Two different questions, one field.
        res = ((q.trim()
          ? await window.workspace.history.search(q, 60)
          : await window.workspace.history.recent(60)) ?? []) as Entry[]
      }
      if (mine === seq.current) setRows(res)
    } catch {
      if (mine === seq.current) setRows([])
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(query, scope)
  }, [query, scope, load])

  const forget = async (url: string): Promise<void> => {
    await window.workspace.history.forget(url).catch(() => undefined)
    setRows((r) => r.filter((x) => x.url !== url))
  }

  /**
   * Star and unstar from the list.
   *
   * Without this the starred scope is a dead end: you can see what you kept and
   * have to go back to the page to stop keeping it. The row is updated locally
   * rather than reloading, so the entry does not vanish under the cursor the
   * instant it is unstarred — it greys, and it is gone next time the list opens.
   */
  const toggleStar = async (e: Entry): Promise<void> => {
    const next = !e.starred
    setRows((r) => r.map((x) => (x.url === e.url ? { ...x, starred: next } : x)))
    try {
      if (next) await window.workspace.history.star(e.url, e.title, e.favicon)
      else await window.workspace.history.unstar(e.url)
    } catch {
      setRows((r) => r.map((x) => (x.url === e.url ? { ...x, starred: !next } : x)))
    }
  }

  const emptyText =
    scope === 'starred'
      ? query.trim()
        ? 'None of your bookmarks match that.'
        : 'Pages you bookmark will be kept here.'
      : query.trim()
        ? 'Nothing you have read matches that.'
        : 'Pages you read will appear here.'

  return (
    <div className={styles.overlay} role="dialog" aria-label="Everything you have read">
      <div className={styles.head}>
        <Search size={15} className={styles.lead} />
        <input
          ref={inputRef}
          className={styles.input}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
          placeholder={
            scope === 'starred'
              ? 'Search your bookmarks…'
              : "Search the text of every page you've read…"
          }
          spellCheck={false}
        />
        <div className={styles.scopes} role="tablist" aria-label="Which pages">
          <button
            role="tab"
            aria-selected={scope === 'all'}
            className={`${styles.scope} ${scope === 'all' ? styles.scopeOn : ''}`}
            onClick={() => setScope('all')}
          >
            Everything
          </button>
          <button
            role="tab"
            aria-selected={scope === 'starred'}
            className={`${styles.scope} ${scope === 'starred' ? styles.scopeOn : ''}`}
            onClick={() => setScope('starred')}
          >
            Bookmarks
          </button>
        </div>
        <button className={styles.icon} onClick={onClose} title="Close (Esc)" aria-label="Close">
          <X size={15} />
        </button>
      </div>

      <div className={styles.list}>
        {!loading && rows.length === 0 && <div className={styles.empty}>{emptyText}</div>}
        {rows.map((r) => (
          <div key={r.url} className={`${styles.row} ${r.starred ? '' : styles.rowUnstarred}`}>
            <button className={styles.main} onClick={() => onOpen(r.url)} title={r.url}>
              <span className={styles.rowHead}>
                {r.starred ? (
                  <Star size={13} className={styles.star} fill="currentColor" />
                ) : (
                  <Clock size={13} className={styles.clock} />
                )}
                <span className={styles.title}>{r.title || r.url}</span>
              </span>
              {/* The snippet is why content search is worth having — it shows
                  the words that matched, not just where they were. */}
              {r.snippet && <span className={styles.snippet}>{r.snippet}</span>}
              <span className={styles.host}>{hostOf(r.url)}</span>
            </button>
            <button
              className={styles.icon}
              onClick={() => void toggleStar(r)}
              title={r.starred ? 'Remove this bookmark' : 'Bookmark this page'}
              aria-label={r.starred ? 'Remove this bookmark' : 'Bookmark this page'}
            >
              <Star size={13} fill={r.starred ? 'currentColor' : 'none'} />
            </button>
            <button
              className={styles.icon}
              onClick={() => void forget(r.url)}
              title="Forget this page — removes its indexed text too"
              aria-label="Forget this page"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}
