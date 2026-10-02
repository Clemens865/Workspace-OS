import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, FolderOpen, Plus } from 'lucide-react'
import { useWorkspaceRoot } from '../../hooks/useWorkspaceRoot'
import styles from './LandscapeShell.module.css'

const HOME_KEY = 'workspace-os:project-home'

type Project = { path: string; name: string; color: string | null; home: boolean }

/** The folder the project list is taken from: a remembered parent, while the open workspace is inside it. */
export function homeFor(root: string, remembered: string | null): string {
  if (remembered && (root === remembered || root.startsWith(remembered + '/'))) return remembered
  return root
}

/**
 * "All projects ▾" (the design's top-bar filter). Lists the workspace and its
 * sub-projects; choosing one opens it as the workspace, so its cases, runs and
 * memory are its own. The parent stays in the list while you are inside.
 */
export function ProjectSwitcher(): JSX.Element | null {
  const root = useWorkspaceRoot()
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<Project[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Other workspaces opened before, and "Open folder…" (the old Home's switcher).
  const [recents, setRecents] = useState<string[]>([])
  const box = useRef<HTMLDivElement>(null)
  const home = root ? homeFor(root, localStorage.getItem(HOME_KEY)) : null

  const load = useCallback(async () => {
    if (!home) {
      setList([])
      return
    }
    try {
      setList(home ? await window.workspace.projects.list(home) : [])
    } catch {
      setList([])
    }
  }, [home])
  useEffect(() => {
    void load()
  }, [load, root])

  useEffect(() => {
    if (!open) return
    void window.workspace.fs
      .recentWorkspaces()
      .then(setRecents)
      .catch(() => setRecents([]))
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const current = list.find((p) => p.path === root)
  const label = !root ? 'Open a folder' : !current || current.home ? 'All projects' : current.name
  const others = recents.filter((r) => r !== root && !list.some((p) => p.path === r)).slice(0, 6)

  const openRecent = async (dir: string): Promise<void> => {
    setOpen(false)
    await window.workspace.fs.openWorkspace(dir)
  }
  const openFolder = async (): Promise<void> => {
    setOpen(false)
    const dir = await window.workspace.fs.openFolderDialog()
    if (dir) await window.workspace.fs.openWorkspace(dir)
  }

  const go = async (p: Project): Promise<void> => {
    setOpen(false)
    if (p.path === root || !home) return
    try {
      localStorage.setItem(HOME_KEY, home)
    } catch {
      /* best effort */
    }
    await window.workspace.fs.openWorkspace(p.path)
  }

  const create = async (): Promise<void> => {
    setError(null)
    if (!home) return
    try {
      const p = await window.workspace.projects.create(home, name.trim())
      setName('')
      await load()
      await go(p)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  return (
    <div ref={box} className={styles.projects} data-testid="project-switcher">
      <button className={styles.projectPill} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="project-pill">
        {label} <ChevronDown size={14} />
      </button>
      {open && (
        <div className={styles.projectMenu} role="menu" data-testid="project-menu">
          {list.map((p) => (
            <button key={p.path} role="menuitem" className={`${styles.projectItem} ${p.path === root ? styles.projectOn : ''}`} onClick={() => void go(p)} data-project={p.path}>
              <span className={styles.projectDot} style={p.color ? { background: p.color } : undefined} />
              {p.home ? `All projects · ${p.name}` : p.name}
            </button>
          ))}
          {root && (
          <label className={styles.projectNew}>
            <Plus size={14} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) void create()
              }}
              placeholder="New sub-project…"
              data-testid="project-new"
            />
          </label>
          )}
          {error && <div className={styles.projectError}>{error}</div>}
          {others.length > 0 && <div className={styles.projectSection}>Recent workspaces</div>}
          {others.map((dir) => (
            <button key={dir} role="menuitem" className={styles.projectItem} onClick={() => void openRecent(dir)} data-recent={dir} title={dir}>
              <span className={styles.projectDot} />
              {dir.split('/').pop() || dir}
            </button>
          ))}
          <button role="menuitem" className={styles.projectItem} onClick={() => void openFolder()} data-testid="project-open-folder">
            <FolderOpen size={14} /> Open folder…
          </button>
        </div>
      )}
    </div>
  )
}
