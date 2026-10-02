import { WORK_PARTS, promotedPath, workFolderFor, workFolderGuidance } from '../cases-work'
import { IpcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { notify } from '../notify'
import { getWorkspaceRoot } from '../workspace-root'
import { computeCsvInsight, computeView, extractViewSpec, type ArtifactInsight } from '../case-insights'
import { authorizeArtifactPath } from '../artifact-allowlist'
import {
  parseCase,
  serializeCase,
  slugify,
  readNote,
  openSignals,
  signalKey,
  type NoteSignal,
  statusesFor,
  TERMINAL,
  nextStatus,
  type WorkCase,
  type CaseAuthor,
  type CaseScope, WAITING_ON_YOU } from '../cases'

/**
 * Cases on disk, in the workspace.
 *
 * In `<workspace>/Cases/` and NOT in userData, unlike history or mail. The
 * reasoning is the opposite one: a case is the user's own work — the documents
 * it points at live in the workspace, so the thread that binds them belongs
 * beside them, in the folder they back up, sync and can read without this app.
 *
 * Every write is a whole-file write of a markdown document, which means a case
 * survives Workspace OS being uninstalled and can be edited in any editor. That
 * is the same fail-safe the transclusion layer takes: the artefact must outlive
 * the tool.
 */

const DIR = 'Cases'

/**
 * Where GLOBAL cases live: a visible folder in the user's home, not a hidden
 * app directory — cases are meant to be read, backed up and synced without
 * this app, and a life thread (a job hunt) doubly so.
 */
function globalCasesDir(): string {
  return path.join(os.homedir(), 'Workspace-OS', DIR)
}

/**
 * The places cases live, in precedence order: the open workspace first, then
 * the global folder. A slug collision resolves to the workspace copy — the
 * same "project wins" rule the agent Foundry uses, so there is one rule.
 */
function scopeDirs(): { scope: CaseScope; dir: string }[] {
  const out: { scope: CaseScope; dir: string }[] = []
  const root = getWorkspaceRoot()
  if (root) out.push({ scope: 'workspace', dir: path.join(root, DIR) })
  out.push({ scope: 'global', dir: globalCasesDir() })
  return out
}

/** The file for an id inside ONE scope's dir, or null on a crafted id. */
function fileIn(dir: string, id: string): string | null {
  const safe = slugify(String(id ?? ''))
  if (!safe) return null
  const file = path.join(dir, `${safe}.md`)
  if (path.dirname(path.resolve(file)) !== path.resolve(dir)) return null
  return file
}

/** Finds an EXISTING case across scopes, workspace first. */
function resolve(id: string): { file: string; scope: CaseScope } | null {
  for (const { scope, dir } of scopeDirs()) {
    const file = fileIn(dir, id)
    if (file && fs.existsSync(file)) return { file, scope }
  }
  return null
}

/** Where a case of the given scope would be written (existing or not). */
function targetFile(id: string, scope: CaseScope): string | null {
  const entry = scopeDirs().find((d) => d.scope === scope)
  return entry ? fileIn(entry.dir, id) : null
}

function readAll(): WorkCase[] {
  const out: WorkCase[] = []
  const seen = new Set<string>()
  // Workspace first, so on a slug collision the workspace copy wins and the
  // global twin stays invisible rather than confusingly doubled.
  for (const { scope, dir } of scopeDirs()) {
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const id = name.replace(/\.md$/, '')
      if (seen.has(id)) continue
      try {
        out.push({ ...parseCase(id, fs.readFileSync(path.join(dir, name), 'utf8')), scope })
        seen.add(id)
      } catch {
        /* an unreadable case must not hide the others */
      }
    }
  }
  // Most recently touched first: the question a list answers is "what now".
  return out.sort((a, b) => (a.updated < b.updated ? 1 : -1))
}

function write(c: WorkCase): WorkCase {
  // A case keeps the scope it was read with; a fresh one defaults to the
  // workspace when a folder is open, and to global otherwise — so cases work
  // even before any workspace exists.
  const scope: CaseScope = c.scope ?? (getWorkspaceRoot() ? 'workspace' : 'global')
  const file = targetFile(c.id, scope) ?? targetFile(c.id, 'global')
  if (!file) throw new Error('No place to store this case.')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const saved = { ...c, scope, updated: new Date().toISOString() }
  fs.writeFileSync(file, serializeCase(saved))
  return saved
}

function load(id: string): WorkCase | null {
  const hit = resolve(id)
  if (!hit) return null
  return { ...parseCase(path.basename(hit.file, '.md'), fs.readFileSync(hit.file, 'utf8')), scope: hit.scope }
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '')

/**
 * The agent's view of cases, over `wos-action run cases.*`.
 *
 * Same store the UI writes, deliberately: an agent that keeps its own notion of
 * the thread would be a second source of truth, and the whole point is that
 * there is one. What the agent reads is the file the person reads.
 *
 * `cases.get` returns the MARKDOWN, not a JSON object — the agent should see the
 * case exactly as it is written, including anything a human typed into it by
 * hand that no schema of ours anticipated.
 */
export async function runCaseAction(
  actionId: string,
  args: unknown,
): Promise<{ ok: true; result?: unknown } | { ok: false; error: string }> {
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const id = str(a.id, 120)
  try {
    switch (actionId) {
      case 'cases.list':
        return {
          ok: true,
          result: readAll().map((c) => ({ id: c.id, title: c.title, status: c.status, subject: c.subject })),
        }
      case 'cases.get': {
        const hit = resolve(id)
        if (!hit) return { ok: false, error: 'no such case' }
        return { ok: true, result: fs.readFileSync(hit.file, 'utf8') }
      }
      case 'cases.create': {
        const title = str(a.title, 200).trim()
        if (!title) return { ok: false, error: 'cases.create needs a title' }
        const slug = slugify(title)
        const existing = load(slug)
        if (existing) return { ok: true, result: { id: existing.id, reopened: true } }
        const now = new Date().toISOString()
        const made = write({
          id: slug,
          type: str(a.type, 40) || 'task',
          title,
          description: str(a.description, 1000),
          subject: str(a.subject, 2000),
          status: str(a.status, 40) || 'drafted',
          artifacts: [],
          acted: [],
          notes: [],
          created: now,
          updated: now,
        })
        return { ok: true, result: { id: made.id, reopened: false } }
      }
      case 'cases.note': {
        const c = load(id)
        if (!c) return { ok: false, error: 'no such case' }
        const text = str(a.text, 4000).trim()
        if (!text) return { ok: false, error: 'cases.note needs text' }
        write({ ...c, notes: [...c.notes, { at: new Date().toISOString(), author: 'agent', text }] })
        return { ok: true }
      }
      case 'cases.status': {
        const c = load(id)
        if (!c) return { ok: false, error: 'no such case' }
        const next = str(a.status, 40)
        if (!statusesFor(c.type).includes(next)) {
          return { ok: false, error: `unknown status; expected one of ${statusesFor(c.type).join(', ')}` }
        }
        write({ ...c, status: next })
        return { ok: true }
      }
      case 'cases.attach': {
        const c = load(id)
        if (!c) return { ok: false, error: 'no such case' }
        const p = str(a.path, 1000).trim()
        if (!p) return { ok: false, error: 'cases.attach needs a path' }
        if (!c.artifacts.includes(p)) write({ ...c, artifacts: [...c.artifacts, p] })
        return { ok: true }
      }
      default:
        return { ok: false, error: `unknown case action: ${actionId}` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'case action failed' }
  }
}

export function registerCaseHandlers(ipcMain: IpcMain): void {
  /* Each case carries what it is still asking for — see openSignals. */
  ipcHandle(ipcMain, 'cases:list', () =>
    readAll().map((c) => ({ ...c, signals: openSignals(c) })),
  )

  ipcHandle(ipcMain, 'cases:get', (_e, id: unknown) => load(str(id, 120)))

  ipcHandle(ipcMain, 'cases:statuses', (_e, type: unknown) => statusesFor(str(type, 40) || 'application'))

  /**
   * Opens a case. Idempotent on the slug, so starting one twice from the same
   * posting reopens the existing thread instead of forking it — losing the
   * history is exactly the failure a case exists to prevent.
   */
  ipcHandle(ipcMain, 'cases:create', (_e, payload: unknown) => {
    const o = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
    const title = str(o.title, 200).trim()
    if (!title) throw new Error('A case needs a title.')
    const id = slugify(title)
    const existing = load(id)
    if (existing) return existing
    const now = new Date().toISOString()
    // Default the status to the TYPE's own first stage — a manually started
    // 'task' case must begin at 'open', not the application flow's 'drafted'
    // (which isn't even in the task vocabulary, so the status pill would show
    // a stage the case can never move on from).
    const type = str(o.type, 40) || 'application'
    return write({
      id,
      type,
      title,
      description: str(o.description, 1000),
      subject: str(o.subject, 2000),
      status: str(o.status, 40) || statusesFor(type)[0] || 'drafted',
      artifacts: Array.isArray(o.artifacts) ? o.artifacts.filter((a): a is string => typeof a === 'string').slice(0, 50) : [],
      acted: [],
      notes: [],
      created: now,
      updated: now,
    })
  })

  ipcHandle(ipcMain, 'cases:set-status', (_e, id: unknown, status: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const next = str(status, 40)
    if (!statusesFor(c.type).includes(next)) throw new Error('Unknown status.')
    // A status change is itself worth recording — six weeks later "when did I
    // actually apply?" is exactly the question the notes have to answer.
    const notes = [...c.notes, { at: new Date().toISOString(), author: 'system' as CaseAuthor, text: `Status → ${next}` }]
    const saved = write({ ...c, status: next, notes })
    // Off by default: most status changes are the person's own hand. When it
    // is on, an agent moving a case to "waiting on you" is worth hearing.
    if (WAITING_ON_YOU.has(next) && c.status !== next) {
      notify({ source: 'cases', key: c.id, title: c.title, body: `now ${next} — waiting on you.`, rail: 'cockpit' })
    }
    return saved
  })

  ipcHandle(ipcMain, 'cases:add-note', (_e, id: unknown, text: unknown, author: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const body = str(text, 4000).trim()
    if (!body) return c
    const who: CaseAuthor = author === 'agent' ? 'agent' : 'you'
    const saved = write({ ...c, notes: [...c.notes, { at: new Date().toISOString(), author: who, text: body }] })
    // The point of a case is that adding to it MOVES something: hand back what
    // this note implies so the UI can offer it. Suggestions only — nothing runs
    // without the person choosing it.
    return { ...saved, signals: readNote(body) }
  })

  /*
   * Remember that an offer was acted on.
   *
   * Otherwise the same three offers reappear every time the case is opened —
   * including the "put it in the calendar" one, after it is already in the
   * calendar. An offer that outlives its own completion is how a helpful
   * surface turns into a nagging one.
   */
  ipcHandle(ipcMain, 'cases:mark-acted', (_e, id: unknown, signal: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const key = signalKey(signal as NoteSignal)
    const acted = c.acted ?? []
    if (acted.includes(key)) return c
    return write({ ...c, acted: [...acted, key] })
  })

  /* The endings, so a second surface never keeps its own copy of the list. */
  ipcHandle(ipcMain, 'cases:terminal', () => [...TERMINAL])

  ipcHandle(ipcMain, 'cases:set-description', (_e, id: unknown, description: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    return write({ ...c, description: str(description, 1000) })
  })

  /** The case's own folder (Work/<id>/{sources,drafts,outputs}), created on demand. */
  ipcHandle(ipcMain, 'cases:work-folder', (_e, id: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const root = getWorkspaceRoot()
    const base = c.scope === 'global' || !root ? path.join(os.homedir(), 'Workspace-OS') : root
    const folder = workFolderFor(base, c.id)
    for (const part of WORK_PARTS) fs.mkdirSync(path.join(folder, part), { recursive: true })
    return { folder, guidance: workFolderGuidance(folder, root) }
  })

  /** Accept a draft: move it to outputs/ and point the case at its new place. */
  ipcHandle(ipcMain, 'cases:promote', (_e, id: unknown, filePath: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const root = getWorkspaceRoot()
    const base = c.scope === 'global' || !root ? path.join(os.homedir(), 'Workspace-OS') : root
    const folder = workFolderFor(base, c.id)
    const raw = str(filePath, 1000).trim()
    const abs = path.isAbsolute(raw) ? raw : path.join(base, raw)
    const dest = promotedPath(folder, abs)
    if (!dest) throw new Error('Only a draft of this case can be accepted into its outputs.')
    if (!fs.existsSync(abs)) throw new Error('That draft is no longer there.')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(abs, dest)
    const rel = (p: string): string => (root && p.startsWith(root + path.sep) ? path.relative(root, p) : p)
    const artifacts = c.artifacts.map((a) => (a === raw || a === abs || a === rel(abs) ? rel(dest) : a))
    if (!artifacts.includes(rel(dest))) artifacts.push(rel(dest))
    const notes = [...c.notes, { at: new Date().toISOString(), author: 'you' as const, text: `Accepted ${path.basename(dest)} — moved to outputs.` }]
    return write({ ...c, artifacts, notes })
  })

  ipcHandle(ipcMain, 'cases:add-artifact', (_e, id: unknown, filePath: unknown) => {
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    const p = str(filePath, 1000).trim()
    if (!p || c.artifacts.includes(p)) return c
    return write({ ...c, artifacts: [...c.artifacts, p] })
  })

  /**
   * The whole case as text, for an agent's prompt.
   *
   * This is the payoff of storing a case as markdown: "give the agent the full
   * picture" is a file read, not a context-assembly problem. What the agent sees
   * is exactly what the person sees.
   */
  ipcHandle(ipcMain, 'cases:as-context', (_e, id: unknown) => {
    const hit = resolve(str(id, 120))
    if (!hit) return ''
    return fs.readFileSync(hit.file, 'utf8')
  })

  /**
   * The case's own numbers — KPIs, a category chart and a table, computed from
   * its CSV artifacts. The "sixth layer": a case that renders itself. Reads are
   * bounded and fail-safe — one unreadable artifact never sinks the panel.
   */
  ipcHandle(ipcMain, 'cases:insights', (_e, id: unknown) => {
    const c = load(str(id, 120))
    if (!c) return [] as ArtifactInsight[]
    const root = getWorkspaceRoot()
    const out: ArtifactInsight[] = []
    for (const rel of c.artifacts) {
      if (!/\.(csv|tsv)$/i.test(rel)) continue
      const abs = path.isAbsolute(rel) ? rel : root ? path.join(root, rel) : null
      if (!abs) continue
      try {
        const st = fs.statSync(abs)
        if (!st.isFile() || st.size > 8 * 1024 * 1024) continue
        const ins = computeCsvInsight(path.basename(rel), fs.readFileSync(abs, 'utf8'))
        if (ins) out.push(ins)
      } catch {
        /* unreadable / missing artifact — skip, the case still renders */
      }
    }
    return out
  })

  // Resolve a CSV artifact and return its text, bounded and fail-safe.
  const readArtifact = (source: string): string | null => {
    if (!/\.(csv|tsv)$/i.test(source)) return null
    const root = getWorkspaceRoot()
    const abs = path.isAbsolute(source) ? source : root ? path.join(root, source) : null
    if (!abs) return null
    try {
      const st = fs.statSync(abs)
      if (!st.isFile() || st.size > 8 * 1024 * 1024) return null
      return fs.readFileSync(abs, 'utf8')
    } catch {
      return null
    }
  }

  /**
   * The case's DECLARED view (Layer 2): curated cross-file KPIs / chart / table
   * from a ```json block in the case body. null when the case declares none —
   * the renderer then falls back to the auto-derived cards.
   */
  ipcHandle(ipcMain, 'cases:view', (_e, id: unknown) => {
    const hit = resolve(str(id, 120))
    if (!hit) return null
    const spec = extractViewSpec(fs.readFileSync(hit.file, 'utf8'))
    if (!spec) return null
    return computeView(spec, readArtifact)
  })

  /**
   * Authorize opening a case artifact and return its absolute path. Resolves the
   * (usually workspace-relative) path against the CASE'S OWN root — the folder
   * that holds its `Cases/` dir — not the currently-open workspace, so an
   * artifact opens whether or not its case's workspace is active. Guards:
   * the path must be listed in the case (membership), and a relative one must
   * not escape the case root. The vetted path is then read-allowlisted.
   */
  ipcHandle(ipcMain, 'cases:authorize-artifact', (_e, id: unknown, rel: unknown) => {
    const hit = resolve(str(id, 120))
    const c = load(str(id, 120))
    if (!hit || !c) return null
    const r = str(rel, 1000)
    if (!c.artifacts.includes(r)) return null // membership = authorization
    const caseRoot = path.dirname(path.dirname(hit.file)) // <root>/Cases/<id>.md → <root>
    const abs = path.isAbsolute(r) ? path.resolve(r) : path.resolve(caseRoot, r)
    if (!path.isAbsolute(r)) {
      // A relative artifact must stay under its case root (no ../ escape).
      const realBase = ((): string => { try { return fs.realpathSync(caseRoot) } catch { return path.resolve(caseRoot) } })()
      const realAbs = ((): string => { try { return fs.realpathSync(abs) } catch { return abs } })()
      if (realAbs !== realBase && !realAbs.startsWith(realBase + path.sep)) return null
    }
    if (!fs.existsSync(abs)) return null
    authorizeArtifactPath(abs)
    return abs
  })

  /** A `file://` URL for an artifact, so the renderer can show image thumbnails. */
  ipcHandle(ipcMain, 'cases:artifact-url', (_e, rel: unknown) => {
    const root = getWorkspaceRoot()
    const r = str(rel, 1000)
    const abs = path.isAbsolute(r) ? r : root ? path.join(root, r) : null
    if (!abs) return null
    try {
      if (!fs.statSync(abs).isFile()) return null
    } catch {
      return null
    }
    return 'file://' + abs
  })

  /**
   * Move a case between "this workspace" and "everywhere".
   *
   * A file move and nothing else — the case IS the markdown file, so changing
   * where it lives is changing where the file sits, with the same content. A
   * name already taken at the destination refuses rather than merges: two
   * threads with one name is exactly the confusion a case exists to end.
   */
  ipcHandle(ipcMain, 'cases:set-scope', (_e, id: unknown, scope: unknown) => {
    const next: CaseScope = scope === 'global' ? 'global' : 'workspace'
    const c = load(str(id, 120))
    if (!c) throw new Error('No such case.')
    if (c.scope === next) return c
    const from = resolve(c.id)
    const to = targetFile(c.id, next)
    if (!from || !to) throw new Error(next === 'workspace' ? 'No workspace folder is open.' : 'No place to store this case.')
    if (fs.existsSync(to)) throw new Error('A case with this name already exists there.')
    // Recorded in the notes, because "when did this become global?" is a real
    // question six weeks later — same reasoning as the status lines.
    const noted = {
      ...c,
      scope: next,
      notes: [
        ...c.notes,
        { at: new Date().toISOString(), author: 'system' as CaseAuthor, text: next === 'global' ? 'Scope → everywhere' : 'Scope → this workspace' },
      ],
    }
    const saved = write(noted)
    fs.unlinkSync(from.file)
    return saved
  })

  ipcHandle(ipcMain, 'cases:next-status', (_e, type: unknown, current: unknown) =>
    nextStatus(str(type, 40) || 'application', str(current, 40)),
  )
}
