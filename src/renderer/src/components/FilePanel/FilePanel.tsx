import { useState, useMemo, useCallback, useEffect } from 'react'
import { Trash2, FolderX, FolderOpen, Search, X, Star, FilePlus, Loader2 } from 'lucide-react'
import { FileTree } from './FileTree'
import { FileIcon } from './fileIcons'
import { useFileTree } from '../../hooks/useFileTree'
import { useSettings } from '../../hooks/useSettings'
import { relativeShort, type WorkspaceLibrary } from '../../hooks/useWorkspaceLibrary'
import type { TreeNode } from '../../types/fs'
import styles from './FilePanel.module.css'

interface FilePanelProps {
  onFileOpen: (filePath: string) => void
  /** A freshly created office document; defaults to onFileOpen. The new shell opens it on the stage (full editor) rather than the tree's preview pane. */
  onFileCreate?: (filePath: string) => void
  onShowTrash: () => void
  refreshSignal: number
  library: WorkspaceLibrary
}

function basename(p: string): string {
  return p.split('/').pop() ?? p
}

export function FilePanel({ onFileOpen, onFileCreate, onShowTrash, refreshSignal, library: lib }: FilePanelProps): JSX.Element {
  const { nodes, expandedPaths, setRoot, toggle, refresh, root, revealPath } = useFileTree()
  const settings = useSettings()

  // Breadcrumb navigation: a document's path crumb can ask the tree to reveal a folder.
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent<string>).detail
      if (typeof path === 'string') void revealPath(path)
    }
    window.addEventListener('wos:reveal-path', handler)
    return () => window.removeEventListener('wos:reveal-path', handler)
  }, [revealPath])
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  // Recently opened workspace roots — the no-folder empty state offers them.
  const [recentWs, setRecentWs] = useState<string[]>([])
  useEffect(() => {
    if (root) return
    void window.workspace.fs.recentWorkspaces().then(setRecentWs).catch(() => {})
  }, [root])
  // Background search-indexing status (polled while a folder is open).
  const [idx, setIdx] = useState<{ running: boolean; done: number; total: number } | null>(null)
  useEffect(() => {
    if (!root) { setIdx(null); return }
    let alive = true
    const tick = (): void => { void window.workspace.search.indexStatus().then((s) => { if (alive) setIdx(s) }).catch(() => {}) }
    tick()
    const t = setInterval(tick, 1200)
    return () => { alive = false; clearInterval(t) }
  }, [root])

  const existingNames = useMemo(() => new Set(nodes.map((n) => basename(n.path))), [nodes])

  // Create a new office document in the workspace root, then open it.
  const handleNew = useCallback(
    async (ext: 'docx' | 'xlsx' | 'pptx', base: string) => {
      setShowNew(false)
      let name = `${base}.${ext}`
      for (let i = 2; existingNames.has(name); i++) name = `${base} ${i}.${ext}`
      try {
        const res = await window.workspace.lok.newDoc(ext, name)
        if (res.ok && res.path) {
          refresh()
          ;(onFileCreate ?? onFileOpen)(res.path)
        }
      } catch {
        /* engine unavailable — ignore */
      }
    },
    [existingNames, refresh, onFileOpen, onFileCreate],
  )

  // Create a new plain-text file (Markdown, CSV, …) seeded with an optional
  // template, then open it. Unlike office docs these don't use the LOK engine.
  const handleNewText = useCallback(
    async (ext: string, base: string, template: string) => {
      setShowNew(false)
      if (!root) return
      let name = `${base}.${ext}`
      for (let i = 2; existingNames.has(name); i++) name = `${base} ${i}.${ext}`
      const filePath = `${root}/${name}`
      try {
        await window.workspace.fs.writeFile(filePath, template)
        refresh()
        onFileOpen(filePath)
      } catch {
        /* write failed — ignore */
      }
    },
    [root, existingNames, refresh, onFileOpen],
  )

  // ⌘N creates a new file of the default format (Settings → new-file format).
  const createDefault = useCallback(() => {
    const f = settings.newFileFormat
    if (f === 'md') handleNewText('md', 'Untitled', '# Untitled\n\n')
    else if (f === 'csv') handleNewText('csv', 'Untitled', '')
    else if (f === 'docx') handleNew('docx', 'New Document')
    else if (f === 'xlsx') handleNew('xlsx', 'New Spreadsheet')
    else if (f === 'pptx') handleNew('pptx', 'New Presentation')
  }, [settings.newFileFormat, handleNew, handleNewText])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'n' && root) {
        e.preventDefault()
        createDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [createDefault, root])

  // Recents are recorded centrally in the layout; opening here just forwards.
  const handleFileOpen = onFileOpen

  const handleOpenFolder = useCallback(async () => {
    // The dialog records the root in the main process and returns it.
    const path = await window.workspace.fs.openFolderDialog()
    if (path) setRoot(path)
  }, [setRoot])

  // Re-read the tree when an external action (e.g. trash restore) changed disk.
  useEffect(() => {
    if (refreshSignal > 0) refresh()
  }, [refreshSignal, refresh])

  const filteredNodes = useMemo(() => {
    if (!search.trim()) return nodes
    const q = search.toLowerCase()
    return flatFilter(nodes, q)
  }, [nodes, search])

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.heading}>
          {root ? root.split('/').pop() : 'No folder'}
        </span>
        <div className={styles.headerBtns}>
          {root && (
            <div className={styles.newWrap}>
              <button className={styles.iconBtn} onClick={() => setShowNew((v) => !v)} title="New document">
                <FilePlus size={15} strokeWidth={1.75} />
              </button>
              {showNew && (
                <>
                  <div className={styles.newBackdrop} onClick={() => setShowNew(false)} />
                  <div className={styles.newMenu}>
                    <button onClick={() => handleNewText('md', 'Untitled', '# Untitled\n\n')}>Markdown (.md)</button>
                    <button onClick={() => handleNewText('csv', 'Untitled', '')}>CSV (.csv)</button>
                    <button onClick={() => handleNewText('wcanvas', 'Untitled Canvas', '')}>Canvas (.wcanvas)</button>
                    <div className={styles.newDivider} />
                    <button onClick={() => handleNew('docx', 'New Document')}>Word document</button>
                    <button onClick={() => handleNew('xlsx', 'New Spreadsheet')}>Excel spreadsheet</button>
                    <button onClick={() => handleNew('pptx', 'New Presentation')}>PowerPoint</button>
                  </div>
                </>
              )}
            </div>
          )}
          <button className={styles.iconBtn} onClick={onShowTrash} title="Trash">
            <Trash2 size={15} strokeWidth={1.75} />
          </button>
          {root && (
            <button
              className={styles.iconBtn}
              onClick={() => window.workspace.fs.closeWorkspace()}
              title="Close folder"
            >
              <FolderX size={15} strokeWidth={1.75} />
            </button>
          )}
          <button className={styles.iconBtn} onClick={handleOpenFolder} title="Open folder (⌘O)">
            <FolderOpen size={15} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      {idx?.running && idx.total > 0 && (
        <div className={styles.indexing} title="Building the search index (content of documents) in the background">
          <Loader2 size={12} strokeWidth={2} className={styles.indexingSpin} />
          <span>Indexing {Math.min(idx.done, idx.total)}/{idx.total}…</span>
        </div>
      )}

      <div className={styles.searchBar}>
        <Search size={14} strokeWidth={1.75} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Filter files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          spellCheck={false}
        />
        {search && (
          <button className={styles.clearSearch} onClick={() => setSearch('')} title="Clear">
            <X size={13} strokeWidth={2} />
          </button>
        )}
      </div>

      <div className={styles.body}>
        {!root ? (
          <div className={styles.empty}>
            <FolderOpen size={32} strokeWidth={1.25} className={styles.emptyIcon} />
            <p className={styles.emptyHeading}>No folder open</p>
            <p className={styles.emptyHint}>Open a folder to start working</p>
            <button className={styles.openFolderBtn} onClick={handleOpenFolder}>
              Open Folder
            </button>
            {recentWs.length > 0 && (
              <div className={styles.recentWs}>
                <div className={styles.sectionLabel}>Recent</div>
                {recentWs.map((dir) => (
                  <button
                    key={dir}
                    className={styles.recentWsRow}
                    onClick={() => void window.workspace.fs.openWorkspace(dir)}
                    title={dir}
                  >
                    <FolderOpen size={14} strokeWidth={1.75} />
                    <span className={styles.recentWsName}>{basename(dir)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {!search && lib.starred.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>Starred</div>
                {lib.starred.map((path) => (
                  <div
                    key={path}
                    className={styles.libRow}
                    onClick={() => handleFileOpen(path)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', path)
                      e.dataTransfer.setData('application/x-wos-path', path)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <FileIcon name={basename(path)} isDirectory={false} size={17} />
                    <span className={styles.libName}>{basename(path)}</span>
                    <button
                      className={styles.starBtn}
                      title="Unstar"
                      onClick={(e) => { e.stopPropagation(); lib.toggleStar(path) }}
                    >
                      <Star size={13} fill="var(--type-media)" color="var(--type-media)" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {!search && lib.recent.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionLabel}>Recent</div>
                {lib.recent.map((entry) => (
                  <div
                    key={entry.path}
                    className={styles.libRow}
                    onClick={() => handleFileOpen(entry.path)}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', entry.path)
                      e.dataTransfer.setData('application/x-wos-path', entry.path)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                  >
                    <FileIcon name={basename(entry.path)} isDirectory={false} size={17} />
                    <span className={styles.libName}>{basename(entry.path)}</span>
                    <span className={styles.libTime}>{relativeShort(entry.ts)}</span>
                  </div>
                ))}
              </div>
            )}

            {!search && (lib.starred.length > 0 || lib.recent.length > 0) && (
              <div className={styles.sectionLabel}>Files</div>
            )}

            <FileTree
              nodes={filteredNodes}
              expandedPaths={search ? new Set(flatPaths(filteredNodes)) : expandedPaths}
              onToggle={toggle}
              onFileOpen={handleFileOpen}
              onRefresh={refresh}
              isStarred={lib.isStarred}
              onToggleStar={lib.toggleStar}
            />
          </>
        )}
      </div>
    </div>
  )
}

function flatFilter(nodes: TreeNode[], query: string): TreeNode[] {
  const results: TreeNode[] = []
  for (const node of nodes) {
    if (node.name.toLowerCase().includes(query)) results.push({ ...node, children: undefined })
    if (node.children) results.push(...flatFilter(node.children, query))
  }
  return results
}

function flatPaths(nodes: TreeNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...(n.children ? flatPaths(n.children) : [])])
}
