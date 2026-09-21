import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { FileEntry } from '../../types/fs'
import { FileThumb } from './FileThumb'
import {
  columnChain,
  filterEntries,
  formatModified,
  formatSize,
  KIND_LABEL,
  kindOf,
  sortEntries,
  type BrowserFilter,
  type SortDir,
  type SortKey,
} from './fileBrowserModel'
import styles from './FileViews.module.css'

/**
 * The icon, gallery and column views for the Files surface.
 *
 * They share the ordering and filtering rules with the list view — all of it
 * lives in `fileBrowserModel` — and differ only in what they put on screen.
 * Kept out of FileBrowser.tsx so neither file grows past the point where the
 * layout and the data flow can be read together.
 */

interface ViewProps {
  entries: readonly FileEntry[]
  selected: string | null
  onActivate: (entry: FileEntry) => void
}

/* ── icon ─────────────────────────────────────────────────────────────────── */

export function IconView({ entries, selected, onActivate }: ViewProps): JSX.Element {
  return (
    <div className={styles.iconGrid} role="list">
      {entries.map((e) => (
        <button
          key={e.path}
          type="button"
          role="listitem"
          className={`${styles.tile} ${selected === e.path ? styles.tileOn : ''}`}
          onClick={() => onActivate(e)}
          title={e.name}
        >
          <FileThumb entry={e} size={56} />
          <span className={styles.tileName}>{e.name}</span>
          <span className={styles.tileMeta}>{e.isDirectory ? 'Folder' : formatSize(e)}</span>
        </button>
      ))}
    </div>
  )
}

/* ── gallery ──────────────────────────────────────────────────────────────── */

/**
 * One large preview with a filmstrip underneath.
 *
 * The preview follows the SELECTION, not a click-through: this view exists to
 * answer "is this the right file", and making you open each one to find out
 * would defeat it. Arrow keys move through the strip for the same reason.
 */
export function GalleryView({ entries, selected, onActivate }: ViewProps): JSX.Element {
  const [focus, setFocus] = useState<string | null>(selected ?? entries[0]?.path ?? null)

  // Follow the folder when it changes underneath us — a preview of a file that
  // is no longer in the listing is worse than no preview.
  useEffect(() => {
    if (!entries.some((e) => e.path === focus)) setFocus(entries[0]?.path ?? null)
  }, [entries, focus])

  const shown = entries.find((e) => e.path === focus) ?? null

  const step = (delta: number): void => {
    if (entries.length === 0) return
    const i = entries.findIndex((e) => e.path === focus)
    const next = entries[Math.max(0, Math.min(entries.length - 1, (i < 0 ? 0 : i) + delta))]
    if (next) setFocus(next.path)
  }

  return (
    <div
      className={styles.gallery}
      tabIndex={0}
      onKeyDown={(ev) => {
        if (ev.key === 'ArrowRight') {
          ev.preventDefault()
          step(1)
        } else if (ev.key === 'ArrowLeft') {
          ev.preventDefault()
          step(-1)
        } else if (ev.key === 'Enter' && shown) {
          ev.preventDefault()
          onActivate(shown)
        }
      }}
    >
      <div className={styles.galleryStage}>
        {shown ? (
          <>
            <FileThumb entry={shown} size={220} />
            <div className={styles.galleryName}>{shown.name}</div>
            <div className={styles.galleryMeta}>
              {KIND_LABEL[kindOf(shown)]} · {formatSize(shown)} · {formatModified(shown)}
            </div>
            <button type="button" className={styles.galleryOpen} onClick={() => onActivate(shown)}>
              {shown.isDirectory ? 'Open folder' : 'Open file'}
            </button>
          </>
        ) : (
          <div className={styles.note}>Nothing to preview.</div>
        )}
      </div>

      <div className={styles.strip} role="list">
        {entries.map((e) => (
          <button
            key={e.path}
            type="button"
            role="listitem"
            className={`${styles.stripItem} ${focus === e.path ? styles.stripItemOn : ''}`}
            onClick={() => setFocus(e.path)}
            onDoubleClick={() => onActivate(e)}
            title={e.name}
          >
            <FileThumb entry={e} size={40} />
            <span className={styles.stripName}>{e.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── column ───────────────────────────────────────────────────────────────── */

/** One column's listing, read independently so a slow folder blocks only itself. */
function useListing(dirPath: string, refreshSignal?: number): FileEntry[] {
  const [entries, setEntries] = useState<FileEntry[]>([])
  useEffect(() => {
    if (!dirPath) return
    let cancelled = false
    window.workspace.fs
      .readDir(dirPath)
      .then((list: FileEntry[]) => {
        if (!cancelled) setEntries(list.filter((e) => !e.name.startsWith('.')))
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [dirPath, refreshSignal])
  return entries
}

function Column({
  dirPath,
  activeChild,
  selected,
  filter,
  sortKey,
  sortDir,
  refreshSignal,
  onActivate,
}: {
  dirPath: string
  /** The child folder that is open to the right, so it can be marked. */
  activeChild: string | null
  selected: string | null
  filter: BrowserFilter
  sortKey: SortKey
  sortDir: SortDir
  refreshSignal?: number
  onActivate: (entry: FileEntry) => void
}): JSX.Element {
  const raw = useListing(dirPath, refreshSignal)
  const entries = sortEntries(filterEntries(raw, filter), sortKey, sortDir)

  return (
    <div className={styles.column}>
      {entries.length === 0 && <div className={styles.colEmpty}>Empty</div>}
      {entries.map((e) => {
        const isOpen = activeChild === e.path
        return (
          <button
            key={e.path}
            type="button"
            className={`${styles.colRow} ${isOpen ? styles.colRowOpen : ''} ${
              selected === e.path ? styles.colRowOn : ''
            }`}
            onClick={() => onActivate(e)}
            title={e.name}
          >
            <FileThumb entry={e} size={18} />
            <span className={styles.colName}>{e.name}</span>
            {e.isDirectory && <ChevronRight size={13} className={styles.colChevron} />}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Miller columns — the path stays on screen as you drill, which is the whole
 * point of this mode. Each level is its own column; the one you are in is the
 * rightmost, and its parents stay navigable to the left.
 */
export function ColumnView({
  root,
  current,
  selected,
  filter,
  sortKey,
  sortDir,
  refreshSignal,
  onActivate,
}: {
  root: string
  current: string
  selected: string | null
  filter: BrowserFilter
  sortKey: SortKey
  sortDir: SortDir
  refreshSignal?: number
  onActivate: (entry: FileEntry) => void
}): JSX.Element {
  const chain = columnChain(root, current)

  return (
    <div className={styles.columns}>
      {chain.map((dirPath, i) => (
        <Column
          key={dirPath}
          dirPath={dirPath}
          activeChild={chain[i + 1] ?? null}
          selected={selected}
          filter={filter}
          sortKey={sortKey}
          sortDir={sortDir}
          refreshSignal={refreshSignal}
          onActivate={onActivate}
        />
      ))}
    </div>
  )
}
