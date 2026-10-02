/**
 * Sub-projects (docs/landscape/PLAN.md §5a): a workspace is the folder being
 * worked in; a sub-project is a subfolder marked with
 * `.workspace-os/project.json`. Opening one makes it the workspace, so its
 * cases, runs and memory are its own (everything in the app is already scoped
 * per workspace root); the parent stays one click away.
 *
 * Bounded and read-only except for `createProject`, which only writes under a
 * folder the app already has open (the workspace or one of its ancestors).
 */
import fs from 'fs'
import path from 'path'

export interface ProjectInfo {
  path: string
  name: string
  color: string | null
  /** True for the folder the list was taken from (the "all projects" home). */
  home: boolean
}

const MARKER = path.join('.workspace-os', 'project.json')
const SKIP = new Set(['node_modules', 'Cases', 'Work', 'dist', 'out', 'build', 'release'])
const MAX_DEPTH = 2
const MAX_DIRS = 400

export function readMarker(dir: string): { name?: string; color?: string } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object') return {}
    const r = raw as { name?: unknown; color?: unknown }
    return { name: typeof r.name === 'string' ? r.name.slice(0, 80) : undefined, color: typeof r.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : undefined }
  } catch {
    return null
  }
}

/** The home folder and every marked sub-project below it (depth ≤ 2), home first, then by name. */
export function listProjects(home: string): ProjectInfo[] {
  const out: ProjectInfo[] = []
  const homeMarker = readMarker(home)
  out.push({ path: home, name: homeMarker?.name ?? path.basename(home), color: homeMarker?.color ?? null, home: true })
  let seen = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH || seen > MAX_DIRS) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name)) continue
      seen++
      const p = path.join(dir, e.name)
      const m = readMarker(p)
      if (m) out.push({ path: p, name: m.name ?? e.name, color: m.color ?? null, home: false })
      walk(p, depth + 1)
    }
  }
  walk(home, 1)
  const [first, ...rest] = out
  return [first, ...rest.sort((a, b) => a.name.localeCompare(b.name))]
}

/** A folder name for a project name: readable, safe, never empty. */
export function folderName(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _-]+/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 60)
  if (!s) throw new Error('Give the project a name.')
  return s
}

/** True when `dir` is `root` or one of its ancestors (the folders the app may treat as a home). */
export function isHomeOf(dir: string, root: string): boolean {
  const d = path.resolve(dir)
  const r = path.resolve(root)
  return r === d || r.startsWith(d + path.sep)
}

/** Create `<home>/<name>/` with its marker, Cases/ and Work/. */
export function createProject(home: string, name: string, color?: string): ProjectInfo {
  const dir = path.join(home, folderName(name))
  if (fs.existsSync(path.join(dir, MARKER))) throw new Error('That project already exists.')
  fs.mkdirSync(path.join(dir, '.workspace-os'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Cases'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'Work'), { recursive: true })
  const marker = { name: name.trim().slice(0, 80), ...(color && /^#[0-9a-f]{3,8}$/i.test(color) ? { color } : {}), created: new Date().toISOString() }
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify(marker, null, 2))
  return { path: dir, name: marker.name, color: marker.color ?? null, home: false }
}
