import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Folder,
  FileText,
  FileSpreadsheet,
  Presentation,
  FileType2,
  Image as ImageIcon,
  File as FileIcon,
  X,
  List,
  LayoutGrid,
  GalleryHorizontal,
  Columns3,
} from 'lucide-react'
import type { FileEntry } from '../../types/fs'
import {
  breadcrumbs,
  canGoBack,
  canGoForward,
  currentPath,
  EMPTY_FILTER,
  filterEntries,
  formatModified,
  formatSize,
  goBack,
  goForward,
  isFilterActive,
  KIND_LABEL,
  kindOf,
  navigate,
  newHistory,
  sortEntries,
  isViewMode,
  type BrowserFilter,
  type FileKind,
  type SortDir,
  type SortKey,
  type ViewMode,
} from './fileBrowserModel'
import { IconView, GalleryView, ColumnView } from './FileViews'
import styles from './FileBrowser.module.css'

/**
 * WOS-013 — the Files surface as a browsable location, not just a tree.
 *
 * The tree stays where it is on the left; this is the right pane. It shows ONE
 * folder at a time with sortable columns, a breadcrumb, back/forward, and
 * filters by name, kind and age — the things the report asked for and the tree
 * structurally cannot offer (its order was hardcoded, and its filter flattened
 * matches away from the folders that gave them meaning).
 *
 * All the ordering, bucketing and history rules live in `fileBrowserModel` and
 * are tested there. This file renders them.
 */

const KIND_ICON: Record<FileKind, typeof FileIcon> = {
  folder: Folder,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  pdf: FileType2,
  image: ImageIcon,
  text: FileText,
  other: FileIcon,
}

/** Kinds offered in the filter bar, in the order an office user meets them. */
const FILTERABLE: FileKind[] = ['document', 'spreadsheet', 'presentation', 'pdf', 'image', 'text']

/** Persisted separately from the browser session — it is a way of working,
 *  not a place, and should survive restarts. */
const VIEW_KEY = 'workspace-os:files-view'

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return isViewMode(v) ? v : 'list'
  } catch {
    return 'list'
  }
}

const VIEW_BUTTONS: { mode: ViewMode; label: string; Icon: typeof FileIcon }[] = [
  { mode: 'list', label: 'List', Icon: List },
  { mode: 'icon', label: 'Icons', Icon: LayoutGrid },
  { mode: 'gallery', label: 'Gallery', Icon: GalleryHorizontal },
  { mode: 'column', label: 'Columns', Icon: Columns3 },
]

const AGES: { label: string; days: number }[] = [
  { label: 'Any time', days: 0 },
  { label: 'Today', days: 1 },
  { label: 'This week', days: 7 },
  { label: 'This month', days: 30 },
]

export function FileBrowser({
  root,
  startPath,
  onOpenFile,
  refreshSignal,
}: {
  root: string
  /** Folder to show first — the tree's selection, when there is one. */
  startPath?: string
  /** Single click on a file: open it in the peek pane (which is the preview). */
  onOpenFile: (path: string) => void
  refreshSignal?: number
}): JSX.Element {
  const [history, setHistory] = useState(() => newHistory(startPath || root))
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState<BrowserFilter>(EMPTY_FILTER)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>(readViewMode)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* a full or blocked localStorage must not break browsing */
    }
  }, [view])

  const here = currentPath(history)

  /**
   * The workspace root is resolved from main AFTER the first render, so it is
   * '' on mount. Without this the history is seeded with an empty path, the
   * listing reads '' forever, and the browser renders an empty folder that
   * never recovers — it looked like a styling problem and was not.
   */
  useEffect(() => {
    if (!root) return
    setHistory((h) => (currentPath(h).startsWith(root) ? h : newHistory(startPath || root)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root])

  // Follow the tree when it reveals a different folder, without losing history.
  useEffect(() => {
    if (startPath && startPath !== here) setHistory((h) => navigate(h, startPath))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startPath])

  useEffect(() => {
    if (!here) return // root not resolved yet — see the effect above
    let cancelled = false
    setLoading(true)
    setError(null)
    window.workspace.fs
      .readDir(here)
      .then((list: FileEntry[]) => {
        if (cancelled) return
        // Dotfiles stay hidden here for the same reason the tree hides them —
        // `.workspace-os` holds the trash and config, and nobody is browsing for it.
        setEntries(list.filter((e) => !e.name.startsWith('.')))
        setLoading(false)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setEntries([])
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [here, refreshSignal])

  const rows = useMemo(
    () => sortEntries(filterEntries(entries, filter), sortKey, sortDir),
    [entries, filter, sortKey, sortDir],
  )

  const crumbs = useMemo(() => breadcrumbs(root, here), [root, here])

  const go = useCallback((to: string) => {
    setHistory((h) => navigate(h, to))
    setSelected(null)
  }, [])

  /** Click a column header: same key flips the direction, a new key starts ascending. */
  const sortBy = useCallback(
    (key: SortKey) => {
      if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      else {
        setSortKey(key)
        // Dates and sizes are almost always wanted biggest/newest first.
        setSortDir(key === 'modified' || key === 'size' ? 'desc' : 'asc')
      }
    },
    [sortKey],
  )

  const activate = useCallback(
    (entry: FileEntry) => {
      if (entry.isDirectory) go(entry.path)
      else {
        setSelected(entry.path)
        onOpenFile(entry.path)
      }
    },
    [go, onOpenFile],
  )

  const toggleKind = useCallback((k: FileKind) => {
    setFilter((f) => ({
      ...f,
      kinds: f.kinds.includes(k) ? f.kinds.filter((x) => x !== k) : [...f.kinds, k],
    }))
  }, [])

  const SortMark = ({ col }: { col: SortKey }): JSX.Element | null => {
    if (col !== sortKey) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  return (
    <div className={styles.browser} data-testid="file-browser">
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.navBtn}
          disabled={!canGoBack(history)}
          onClick={() => setHistory(goBack)}
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft size={15} />
        </button>
        <button
          type="button"
          className={styles.navBtn}
          disabled={!canGoForward(history)}
          onClick={() => setHistory(goForward)}
          title="Forward"
          aria-label="Forward"
        >
          <ArrowRight size={15} />
        </button>

        <nav className={styles.crumbs} aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={c.path} className={styles.crumbWrap}>
              {i > 0 && <ChevronRight size={13} className={styles.crumbSep} />}
              <button
                type="button"
                className={i === crumbs.length - 1 ? styles.crumbOn : styles.crumb}
                onClick={() => go(c.path)}
              >
                {c.label}
              </button>
            </span>
          ))}
        </nav>

        <div className={styles.views} role="group" aria-label="View mode">
          {VIEW_BUTTONS.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              className={view === mode ? styles.viewOn : styles.view}
              onClick={() => setView(mode)}
              title={`${label} view`}
              aria-label={`${label} view`}
              aria-pressed={view === mode}
            >
              <Icon size={14} strokeWidth={1.9} />
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterbar}>
        <input
          className={styles.search}
          value={filter.text}
          onChange={(e) => setFilter((f) => ({ ...f, text: e.target.value }))}
          placeholder="Filter this folder…"
          aria-label="Filter this folder"
          spellCheck={false}
        />
        <div className={styles.chips}>
          {FILTERABLE.map((k) => (
            <button
              key={k}
              type="button"
              className={filter.kinds.includes(k) ? styles.chipOn : styles.chip}
              onClick={() => toggleKind(k)}
              aria-pressed={filter.kinds.includes(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <select
          className={styles.age}
          value={filter.withinDays}
          onChange={(e) => setFilter((f) => ({ ...f, withinDays: Number(e.target.value) }))}
          aria-label="Filter by date modified"
        >
          {AGES.map((a) => (
            <option key={a.days} value={a.days}>
              {a.label}
            </option>
          ))}
        </select>
        {isFilterActive(filter) && (
          <button
            type="button"
            className={styles.clear}
            onClick={() => setFilter(EMPTY_FILTER)}
            title="Clear filters"
            aria-label="Clear filters"
          >
            <X size={13} /> Clear
          </button>
        )}
      </div>

      {/* Sortable column headers belong to the list view. The other modes keep
          the SAME ordering — the sort menu below the filter bar drives them —
          but a row of column titles over a grid of tiles means nothing. */}
      {view === 'list' && (
      <div className={styles.head} role="row">
        <button type="button" className={styles.hName} onClick={() => sortBy('name')} aria-label="Sort by name">
          Name <SortMark col="name" />
        </button>
        <button type="button" className={styles.hCol} onClick={() => sortBy('kind')} aria-label="Sort by kind">
          Kind <SortMark col="kind" />
        </button>
        <button
          type="button"
          className={styles.hCol}
          onClick={() => sortBy('modified')}
          aria-label="Sort by date modified"
        >
          Date modified <SortMark col="modified" />
        </button>
        <button type="button" className={styles.hColR} onClick={() => sortBy('size')} aria-label="Sort by size">
          Size <SortMark col="size" />
        </button>
      </div>
      )}

      {view !== 'list' && (
        <div className={styles.sortRow}>
          <span className={styles.sortLabel}>Sort</span>
          {(['name', 'kind', 'modified', 'size'] as SortKey[]).map((k) => (
            <button
              key={k}
              type="button"
              className={sortKey === k ? styles.sortOn : styles.sort}
              onClick={() => sortBy(k)}
              aria-pressed={sortKey === k}
            >
              {k === 'modified' ? 'Date' : k[0].toUpperCase() + k.slice(1)}
              {sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          ))}
        </div>
      )}

      {view === 'icon' && <IconView entries={rows} selected={selected} onActivate={activate} />}

      {view === 'gallery' && <GalleryView entries={rows} selected={selected} onActivate={activate} />}

      {view === 'column' && (
        <ColumnView
          root={root}
          current={here}
          selected={selected}
          filter={filter}
          sortKey={sortKey}
          sortDir={sortDir}
          refreshSignal={refreshSignal}
          onActivate={activate}
        />
      )}

      {view === 'list' && (
      <div className={styles.rows}>
        {loading && <div className={styles.note}>Reading this folder…</div>}
        {error && <div className={styles.note}>Cannot read this folder — {error}</div>}
        {!loading && !error && rows.length === 0 && (
          <div className={styles.note}>
            {isFilterActive(filter) ? 'Nothing here matches those filters.' : 'This folder is empty.'}
          </div>
        )}
        {rows.map((e) => {
          const kind = kindOf(e)
          const Icon = KIND_ICON[kind]
          return (
            <div
              key={e.path}
              role="row"
              tabIndex={0}
              className={`${styles.row} ${selected === e.path ? styles.rowOn : ''}`}
              onClick={() => activate(e)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  activate(e)
                }
              }}
              title={e.isDirectory ? `Open ${e.name}` : `Preview ${e.name}`}
            >
              <span className={styles.cName}>
                <Icon size={15} className={styles.icon} strokeWidth={1.8} />
                <span className={styles.nameText}>{e.name}</span>
              </span>
              <span className={styles.cCol}>{KIND_LABEL[kind]}</span>
              <span className={styles.cCol}>{formatModified(e)}</span>
              <span className={styles.cColR}>{formatSize(e)}</span>
            </div>
          )
        })}
      </div>
      )}

      <div className={styles.status}>
        {rows.length} {rows.length === 1 ? 'item' : 'items'}
        {isFilterActive(filter) && entries.length !== rows.length ? ` of ${entries.length}` : ''}
      </div>
    </div>
  )
}
