import { IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { app } from 'electron'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import * as mem from '../memory/memory-service'
import { PulseMemory, type MemoryQuery, type PulseInsightType } from '../memory/pulse-memory'

/**
 * IPC surface for workspace memory — read-only queries over the user's Pulse
 * insight DB, always scoped to the active workspace project. The renderer never
 * names a DB path or another project; the project is derived here from the
 * current workspace root, so this can only ever read the user's own insights.
 */

let memory: PulseMemory | null = null

function ensureMemory(): PulseMemory {
  if (!memory) {
    memory = new PulseMemory()
    registerCleanup('pulse-memory', () => memory?.close())
  }
  return memory
}

const VALID_TYPES: readonly PulseInsightType[] = [
  'progress',
  'decision',
  'pattern',
  'fix',
  'context',
  'blocked',
]

/** Sanitizes the renderer-supplied options; the project is always the active root. */
function buildQuery(root: string, raw: unknown): MemoryQuery {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const types = Array.isArray(o.types)
    ? (o.types.filter((t) => VALID_TYPES.includes(t as PulseInsightType)) as PulseInsightType[])
    : undefined
  const search = typeof o.search === 'string' ? o.search.slice(0, 200) : undefined
  const limit = typeof o.limit === 'number' ? o.limit : undefined
  return { project: root, types, search, limit }
}

export function registerMemoryHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.MEMORY_QUERY, (_event, opts: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) return []
    return ensureMemory().query(buildQuery(root, opts))
  })

  ipcHandle(ipcMain, IPC.MEMORY_RECENT, (_event, limit: unknown) => {
    const root = getWorkspaceRoot()
    if (!root) return []
    const n = typeof limit === 'number' ? limit : 50
    return ensureMemory().recent(root, n)
  })

  // ── The workspace's OWN memory (write side) ───────────────────────────────
  // Distinct from the Pulse handlers below, which are a read-only window onto an
  // external database.
  const ctx = (): mem.MemoryContext => ({ root: getWorkspaceRoot(), userDataDir: app.getPath('userData') })

  ipcHandle(ipcMain, 'memory:remember', (_e, input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>
    if (typeof i.text !== 'string' || !i.text.trim()) throw new IpcValidationError('A memory needs text')
    if (i.text.length > 2000) throw new IpcValidationError('That memory is too long — keep one idea per memory')
    const kinds = ['fact', 'preference', 'decision', 'entity']
    const kind = kinds.includes(String(i.kind)) ? (i.kind as mem.MemoryContext extends never ? never : 'fact') : 'fact'
    return mem.remember(ctx(), {
      kind: kind as 'fact',
      text: i.text.trim(),
      source: typeof i.source === 'string' && i.source.trim() ? i.source.trim().slice(0, 300) : 'you told me',
      ...(i.scope === 'global' ? { scope: 'global' as const } : {}),
      ...(Array.isArray(i.tags) ? { tags: (i.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 20) } : {}),
    })
  })

  ipcHandle(ipcMain, 'memory:search', (_e, query: unknown, limit: unknown) => {
    const q = typeof query === 'string' ? query : ''
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 10
    return mem.search(ctx(), q, n)
  })

  ipcHandle(ipcMain, 'memory:list', (_e, opts: unknown) => {
    const o = (opts ?? {}) as { kind?: unknown; limit?: unknown }
    return mem.list(ctx(), {
      ...(typeof o.kind === 'string' ? { kind: o.kind as 'fact' } : {}),
      limit: typeof o.limit === 'number' ? Math.min(500, Math.max(1, o.limit)) : 200,
    })
  })

  ipcHandle(ipcMain, 'memory:forget', (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new IpcValidationError('Which memory?')
    return { ok: mem.forget(ctx(), id) }
  })

  ipcHandle(ipcMain, 'memory:stats', () => mem.stats(ctx()))

  ipcHandle(ipcMain, IPC.MEMORY_STATUS, () => {
    return { status: ensureMemory().status() }
  })
}
