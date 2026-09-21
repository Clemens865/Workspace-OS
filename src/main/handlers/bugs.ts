import { IpcMain, app } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { logPath } from '../crash-reporter'
import { getContext } from '../context/workspaceContext'
import {
  nextId,
  parseBugs,
  readBugLog,
  writeBugLog,
  bugLogPath,
  idPrefix,
  type ReportKind,
  type BugContext,
  type ExistingBug,
} from '../bugs/bug-log'
import { analyzeBug, toReport, unanalyzedReport, type Analysis } from '../bugs/bug-analyzer'

/**
 * The in-app bug reporter's main-process half.
 *
 * The awkward, load-bearing fact this module exists to handle: the bug log
 * belongs in the Workspace-OS DEVELOPMENT REPO, which has nothing to do with the
 * workspace folder the user has open. A report filed into a customer's documents
 * folder is a report nobody will ever read again. So the repo path is its own
 * configured location, validated to actually be this project before we write to
 * it, and resolved fresh on every call.
 */

const REPO_CONFIG = (): string => path.join(app.getPath('userData'), 'bug-reporter.json')

/** A candidate repo is only accepted if it really is this project. */
export function isWorkspaceOsRepo(dir: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    return pkg?.name === 'workspace-os'
  } catch {
    return false
  }
}

function storedRepo(): string | null {
  try {
    const raw = JSON.parse(fs.readFileSync(REPO_CONFIG(), 'utf8'))
    const p = typeof raw?.repoRoot === 'string' ? raw.repoRoot : ''
    return p && isWorkspaceOsRepo(p) ? p : null
  } catch {
    return null
  }
}

function storeRepo(dir: string): void {
  fs.mkdirSync(path.dirname(REPO_CONFIG()), { recursive: true })
  fs.writeFileSync(REPO_CONFIG(), JSON.stringify({ repoRoot: dir }, null, 2), 'utf8')
}

/**
 * Walk up from `start` looking for the repo root.
 *
 * `app.getAppPath()` returns the DIRECTORY OF THE ENTRY SCRIPT, so an unpackaged
 * launch (`electron out/main/index.js`) reports `<repo>/out/main` — which has no
 * package.json at all. Checking only that path silently fails to auto-detect the
 * repo in exactly the mode a developer runs. Bounded to a few levels so this
 * can't wander up to `/`.
 */
export function findRepoUpward(start: string, maxUp = 5): string | null {
  let dir = start
  for (let i = 0; i <= maxUp; i++) {
    if (isWorkspaceOsRepo(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/**
 * Where the log lives. A stored path wins; otherwise, when running unpackaged,
 * the app IS the repo (found by walking up from the entry script). In a packaged
 * build with nothing configured this is null, and the UI asks for the folder once.
 */
export function resolveRepoRoot(): string | null {
  const stored = storedRepo()
  if (stored) return stored
  if (!app.isPackaged) {
    return findRepoUpward(app.getAppPath()) ?? findRepoUpward(process.cwd())
  }
  return null
}

/** Short SHA of the running build, when the repo is reachable. */
function commitSha(repoRoot: string | null): string | null {
  if (!repoRoot) return null
  try {
    const head = fs.readFileSync(path.join(repoRoot, '.git', 'HEAD'), 'utf8').trim()
    const ref = head.startsWith('ref: ') ? head.slice(5) : null
    if (!ref) return head.slice(0, 7)
    const sha = fs.readFileSync(path.join(repoRoot, '.git', ref), 'utf8').trim()
    return sha.slice(0, 7)
  } catch {
    return null
  }
}

/**
 * The last few error lines from the main-process log.
 *
 * This is the part a user genuinely cannot provide: they saw a blank panel, not
 * the exception behind it. Bounded hard — a bug report is not a log dump, and an
 * unbounded tail would bury the actual report.
 */
export function recentErrors(logText: string, max = 12): string[] {
  return logText
    .split('\n')
    .filter((l) => /\[(error|warn)\]/i.test(l))
    .slice(-max)
    .map((l) => l.slice(0, 400))
}

function readErrors(): string[] {
  try {
    return recentErrors(fs.readFileSync(logPath(), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Everything the app knows about its own state right now.
 *
 * Surface and open file come from the LIVE harness context the shells already
 * push (`context.set`), rather than being threaded through the reporter UI —
 * that way the capture is identical in both shells and cannot drift out of sync
 * with what the user is actually looking at. Explicit arguments still win when
 * a caller has better information.
 */
function gatherContext(surface: string | null, openFile: string | null): BugContext {
  const repoRoot = resolveRepoRoot()
  const live = getContext()
  return {
    appVersion: app.getVersion(),
    commit: commitSha(repoRoot),
    surface: surface ?? live.surface ?? null,
    openFile: openFile ?? live.openFile ?? null,
    os: `${os.type()} ${os.release()} (${os.arch()})`,
    recentErrors: readErrors(),
  }
}

function existingBugs(repoRoot: string | null, kind: ReportKind = 'bug'): ExistingBug[] {
  return repoRoot ? parseBugs(readBugLog(repoRoot, kind)) : []
}

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new IpcValidationError(`${field} must be a non-empty string`)
  }
  return v
}

export function registerBugHandlers(ipcMain: IpcMain): void {
  /** Where reports will land, and whether analysis can see the source. */
  ipcHandle(ipcMain, 'bug:status', () => {
    const repoRoot = resolveRepoRoot()
    return {
      repoRoot,
      logPath: repoRoot ? bugLogPath(repoRoot) : null,
      count: existingBugs(repoRoot).length,
    }
  })

  /** Point the reporter at the development repo (validated). */
  ipcHandle(ipcMain, 'bug:setRepo', (_e, dir: unknown) => {
    const d = str(dir, 'repo path')
    if (!isWorkspaceOsRepo(d)) {
      throw new IpcValidationError('That folder is not the Workspace-OS repository')
    }
    storeRepo(d)
    return { ok: true, repoRoot: d }
  })

  /** Everything the app knows about right now — shown to the user before filing. */
  ipcHandle(ipcMain, 'bug:context', (_e, surface: unknown, openFile: unknown) =>
    gatherContext(
      typeof surface === 'string' ? surface : null,
      typeof openFile === 'string' ? openFile : null,
    ),
  )

  /**
   * Analyze — read-only, and returns a PROPOSAL. Nothing is written here; the
   * user reviews and corrects it first.
   */
  ipcHandle(ipcMain, 'bug:analyze', async (_e, text: unknown, surface: unknown, openFile: unknown, kind: unknown) => {
    const body = str(text, 'report')
    const repoRoot = resolveRepoRoot()
    const k: ReportKind = kind === 'idea' ? 'idea' : 'bug'
    const context = gatherContext(
      typeof surface === 'string' ? surface : null,
      typeof openFile === 'string' ? openFile : null,
    )
    // Ideas are compared against the IDEA list, bugs against the bug list —
    // duplicate detection across two different kinds would be nonsense.
    const res = await analyzeBug({ text: body, context, existing: existingBugs(repoRoot, k), repoRoot, kind: k })
    return { ...res, context }
  })

  /**
   * File it. Accepts the (possibly user-edited) analysis, or none at all — a
   * failed analysis must never cost the user their report.
   */
  ipcHandle(ipcMain, 'bug:file', (_e, text: unknown, analysis: unknown, context: unknown, kind: unknown) => {
    const body = str(text, 'report')
    const repoRoot = resolveRepoRoot()
    if (!repoRoot) {
      throw new IpcValidationError('Set the Workspace-OS repository folder before filing bugs')
    }
    const k: ReportKind = kind === 'idea' ? 'idea' : 'bug'
    const existing = existingBugs(repoRoot, k)
    const id = nextId(existing, idPrefix(k))
    const now = new Date().toISOString()
    const ctx = (context ?? gatherContext(null, null)) as BugContext

    const a = analysis as Analysis | null
    const report = a && typeof a === 'object' && typeof a.title === 'string' && a.title.trim()
      ? toReport(id, body, a, ctx, now)
      : unanalyzedReport(id, body, ctx, now)

    const filedAs = writeBugLog(repoRoot, report, a?.duplicateOf ?? null, k)
    return {
      ok: true,
      id: filedAs,
      duplicate: filedAs !== id,
      logPath: bugLogPath(repoRoot, k),
    }
  })

  /** The current log, for an in-app list of what's outstanding. */
  ipcHandle(ipcMain, 'bug:list', () => {
    const repoRoot = resolveRepoRoot()
    return repoRoot ? parseBugs(readBugLog(repoRoot)) : []
  })
}
