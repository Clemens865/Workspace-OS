import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, FolderOpen, Search } from 'lucide-react'
import type { GraphNode } from '../../../types/workspace-api'
import type { RailId } from '../../Shell/shellModel'
import { FileThumb } from '../../FilePanel/FileThumb'
import { WorkspaceMemoryView } from '../../MemoryPanel/WorkspaceMemory'
import { useCreatedAssets } from '../../../hooks/useCreatedAssets'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { useWorkspaceLibrary } from '../../../hooks/useWorkspaceLibrary'
import { useGlass } from '../backdrop/useBackdrop'
import { relPath, searchFiles, shelves, type LibraryFile } from './libraryModel'
import styles from './LibraryView.module.css'

export type LibraryTab = 'files' | 'notes' | 'memory'

const openFile = (path: string): void => {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

function Tile({ f, root }: { f: LibraryFile; root: string | null }): JSX.Element {
  return (
    <button type="button" className={styles.tile} onClick={() => openFile(f.path)} title={relPath(f.path, root)} data-library-file={f.name}>
      <span className={styles.thumb}>
        <FileThumb entry={{ name: f.name, path: f.path, isDirectory: false }} size={56} />
      </span>
      <span className={styles.name}>{f.name}</span>
      <span className={styles.where}>{f.snippet ?? relPath(f.path, root).split('/').slice(0, -1).join('/') ?? ''}</span>
    </button>
  )
}

/** Files: search everything (names, then contents), or the shelves of new, opened and starred files. */
function FilesTab({ onSurface }: { onSurface: (rail: RailId) => void }): JSX.Element {
  const root = useWorkspaceRoot()
  const library = useWorkspaceLibrary(root)
  const created = useCreatedAssets()
  const [q, setQ] = useState('')
  const [names, setNames] = useState<string[]>([])
  const [content, setContent] = useState<{ path: string; snippet: string }[]>([])

  useEffect(() => {
    let live = true
    void window.workspace.fs
      .listFiles()
      .then((l) => live && setNames(l))
      .catch(() => live && setNames([]))
    return () => {
      live = false
    }
  }, [root])

  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) {
      setContent([])
      return
    }
    let live = true
    const t = window.setTimeout(() => {
      void window.workspace.search
        .query(query)
        .then((r) => live && setContent(r.filter((x) => x.matchType === 'content').map((x) => ({ path: x.path, snippet: x.snippet }))))
        .catch(() => live && setContent([]))
    }, 180)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [q])

  const results = useMemo(() => searchFiles(q, names, content), [q, names, content])
  const shelf = useMemo(() => shelves(created, library.recent, library.starred), [created, library.recent, library.starred])

  if (!root) {
    return (
      <div className={styles.quiet}>
        No folder is open. Choose one from the project menu at the top right.
      </div>
    )
  }

  return (
    <div className={styles.files} data-testid="library-files">
      <div className={styles.bar}>
        <label className={styles.search}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a file by name or what is in it…" aria-label="Find a file" data-testid="library-search" />
        </label>
        <button type="button" className={styles.btn} onClick={() => onSurface('files')} data-testid="library-browse">
          <FolderOpen size={14} /> Browse all files
        </button>
      </div>

      <div className={styles.scroll}>
        {q.trim() ? (
          results.length ? (
            <div className={styles.grid} data-testid="library-results">
              {results.map((f) => (
                <Tile key={f.path} f={f} root={root} />
              ))}
            </div>
          ) : (
            <p className={styles.quiet}>Nothing called that, and nothing that says it.</p>
          )
        ) : shelf.length ? (
          shelf.map((s) => (
            <section key={s.title} className={styles.shelf}>
              <h3 className={styles.label}>{s.title}</h3>
              <div className={styles.grid}>
                {s.files.map((f) => (
                  <Tile key={f.path} f={f} root={root} />
                ))}
              </div>
            </section>
          ))
        ) : (
          <p className={styles.quiet}>Files you open, star or create show up here. Search finds everything else.</p>
        )}
      </div>
    </div>
  )
}

/** Notes: the knowledge base, most-linked first, and the notes that are referenced but not written yet. */
function NotesTab({ onSurface }: { onSurface: (rail: RailId) => void }): JSX.Element {
  const root = useWorkspaceRoot()
  const [nodes, setNodes] = useState<GraphNode[] | null>(null)
  useEffect(() => {
    let live = true
    void window.workspace.links
      .graph()
      .then((g) => live && setNodes(g.nodes))
      .catch(() => live && setNodes([]))
    return () => {
      live = false
    }
  }, [root])
  const notes = (nodes ?? []).filter((n) => n.kind === 'note').sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name))
  const stubs = (nodes ?? []).filter((n) => n.kind === 'stub').sort((a, b) => b.degree - a.degree)

  return (
    <div className={styles.files} data-testid="library-notes">
      <div className={styles.bar}>
        <p className={styles.count}>{nodes === null ? 'Reading your notes…' : `${notes.length} note${notes.length === 1 ? '' : 's'}, linked with [[wikilinks]]`}</p>
        <button type="button" className={styles.btn} onClick={() => onSurface('knowledge')} data-testid="library-graph">
          Open the graph <ArrowUpRight size={13} />
        </button>
      </div>
      <div className={styles.scroll}>
        {notes.length > 0 && (
          <ul className={styles.list}>
            {notes.map((n) => (
              <li key={n.id}>
                <button type="button" className={styles.row} onClick={() => openFile(n.id)} data-note={n.name}>
                  <span className={styles.rowName}>{n.name}</span>
                  <span className={styles.where}>{relPath(n.id, root)}</span>
                  <span className={styles.links}>{n.degree ? `${n.degree} link${n.degree === 1 ? '' : 's'}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {nodes !== null && !notes.length && <p className={styles.quiet}>No notes yet. Markdown files in the workspace become notes; [[links]] between them build the graph.</p>}
        {stubs.length > 0 && (
          <section className={styles.shelf}>
            <h3 className={styles.label}>Referenced, not written yet</h3>
            <div className={styles.chips}>
              {stubs.slice(0, 24).map((s) => (
                <span key={s.id} className={styles.chip}>
                  {s.name}
                </span>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/**
 * Library (ADOPTION.md B4): the workspace's files, notes and memory in the
 * landscape. Finding and choosing happen here; editing opens on the stage.
 */
export function LibraryView({ tab, onSurface }: { tab: LibraryTab; onSurface: (rail: RailId) => void }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  return (
    <div className={styles.library} data-testid="library-view" data-tab={tab}>
      <div ref={panel} className={styles.panel}>
        {tab === 'files' && <FilesTab onSurface={onSurface} />}
        {tab === 'notes' && <NotesTab onSurface={onSurface} />}
        {tab === 'memory' && (
          <div className={styles.scroll} data-testid="library-memory">
            <WorkspaceMemoryView />
          </div>
        )}
      </div>
    </div>
  )
}
