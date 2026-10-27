import { IpcMain } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle, registerCleanup } from '../ipc-registry'
import { app } from 'electron'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import path from 'path'
import * as mem from '../memory/memory-service'
import { workerEmbedder } from '../memory/embedder'
import { proposeFromSession, type SessionTurn } from '../memory/proposals'
import { tidy, tidyDue, lastTidy, type OutsideDecision } from '../memory/tidy'
import { runProviderOneShot } from '../agent/providerText'
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

  // Recall by meaning too: the model runs in a worker and is downloaded once, on
  // first need, into the app's own folder (WOS_NO_MEANING=1 keeps memory word-only).
  if (process.env.WOS_NO_MEANING !== '1') mem.setEmbedder(workerEmbedder(path.join(app.getPath('userData'), 'models')))
  // A new or corrected memory gets its meaning vector behind the scenes.
  const embedSoon = <T,>(v: T): T => {
    void mem.embedPending(ctx()).catch(() => {})
    return v
  }

  const KINDS = ['fact', 'preference', 'decision', 'entity'] as const
  type Kind = (typeof KINDS)[number]
  const authorOf = (a: unknown): 'you' | 'agent' => (a === 'you' ? 'you' : 'agent')
  const memoryText = (t: unknown): string => {
    if (typeof t !== 'string' || !t.trim()) throw new IpcValidationError('A memory needs text')
    if (t.length > 2000) throw new IpcValidationError('That memory is too long — keep one idea per memory')
    return t.trim()
  }
  const memoryId = (id: unknown): string => {
    if (typeof id !== 'string' || !id) throw new IpcValidationError('Which memory?')
    return id
  }

  ipcHandle(ipcMain, 'memory:remember', (_e, input: unknown) => {
    const i = (input ?? {}) as Record<string, unknown>
    const kind: Kind = KINDS.includes(i.kind as Kind) ? (i.kind as Kind) : 'fact'
    return embedSoon(mem.remember(ctx(), {
      kind,
      text: memoryText(i.text),
      source: typeof i.source === 'string' && i.source.trim() ? i.source.trim().slice(0, 300) : 'you told me',
      author: authorOf(i.author),
      ...(i.scope === 'global' ? { scope: 'global' as const } : {}),
      ...(Array.isArray(i.tags) ? { tags: (i.tags as unknown[]).filter((t): t is string => typeof t === 'string').slice(0, 20) } : {}),
    }))
  })

  // Correct (the old version stays as history), keep (confirm), what it said before, and what is already known.
  ipcHandle(ipcMain, 'memory:correct', (_e, id: unknown, text: unknown, author: unknown, source: unknown) =>
    embedSoon(mem.correct(ctx(), memoryId(id), memoryText(text), authorOf(author), typeof source === 'string' ? source.slice(0, 300) : undefined)),
  )
  ipcHandle(ipcMain, 'memory:confirm', (_e, id: unknown) => ({ ok: mem.confirm(ctx(), memoryId(id)) }))
  ipcHandle(ipcMain, 'memory:history', (_e, id: unknown) => mem.history(ctx(), memoryId(id)))
  ipcHandle(ipcMain, 'memory:similar', (_e, text: unknown, scope: unknown) => mem.similar(ctx(), memoryText(text), scope === 'global' ? 'global' : 'workspace'))

  ipcHandle(ipcMain, 'memory:search', (_e, query: unknown, limit: unknown) => {
    const q = typeof query === 'string' ? query : ''
    const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.min(50, Math.max(1, limit)) : 10
    // A question finds by words and meaning; no words at all lists the newest.
    return mem.toMatchQuery(q) ? mem.recallMeaning(ctx(), q, n) : mem.search(ctx(), q, n)
  })

  ipcHandle(ipcMain, 'memory:meaning', () => ({ status: mem.embedderStatus() }))

  // ── memory that fills and tidies itself ──
  // A quiet session, read once by the person's light model: what is worth
  // remembering goes to the Inbox, unconfirmed. The model is the person's
  // setting passed through, never a name in source.
  ipcHandle(ipcMain, 'memory:propose', async (_e, digest: unknown, model: unknown) => {
    const d = (digest ?? {}) as Record<string, unknown>
    const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')
    const turns: SessionTurn[] = (Array.isArray(d.turns) ? d.turns : [])
      .slice(-12)
      .map((t) => (t ?? {}) as Record<string, unknown>)
      .map((t) => ({ ask: str(t.ask, 4000), outcome: str(t.outcome, 6000) }))
      .filter((t) => t.ask.trim())
    const alias = typeof model === 'string' && model.trim() ? model.trim().slice(0, 64) : undefined
    // The workspace the session ran in, held across the model call (the person may switch meanwhile).
    const res = await proposeFromSession(ctx(), { title: str(d.title, 120) || 'a session', agentName: str(d.agentName, 80) || null, turns }, (prompt) =>
      runProviderOneShot(prompt, { label: 'Remembering the session', model: alias }),
    )
    void mem.embedPending(ctx()).catch(() => {})
    return { proposed: res.proposed, skipped: res.skipped }
  })

  // Decisions noted in Pulse for this workspace, for the tidy to offer.
  const pulseDecisions = (root: string): OutsideDecision[] => {
    try {
      if (ensureMemory().status() !== 'available') return []
      return ensureMemory()
        .query({ project: root, types: ['decision'], limit: 20 })
        .map((i) => ({ text: i.text, at: Date.parse(i.timestamp) || 0 }))
        .sort((a, b) => a.at - b.at)
    } catch {
      return []
    }
  }
  const runTidy = async (): Promise<unknown> => {
    const c = ctx()
    if (!c.root) return null
    return tidy(c, { outside: pulseDecisions(c.root) })
  }
  ipcHandle(ipcMain, 'memory:tidy', () => runTidy())
  ipcHandle(ipcMain, 'memory:lastTidy', () => lastTidy(ctx()))
  // Once a day, checked hourly (and soon after start): no model, nothing the person would not do.
  const tidyIfDue = (): void => {
    try {
      if (tidyDue(ctx())) void runTidy().catch(() => {})
    } catch {
      /* no workspace, or the store is busy: next hour */
    }
  }
  if (process.env.WOS_NO_TIDY !== '1') {
    setTimeout(tidyIfDue, 2 * 60_000).unref()
    setInterval(tidyIfDue, 60 * 60_000).unref()
  }

  ipcHandle(ipcMain, 'memory:list', (_e, opts: unknown) => {
    const o = (opts ?? {}) as { kind?: unknown; limit?: unknown; unconfirmed?: unknown }
    return mem.list(ctx(), {
      ...(typeof o.kind === 'string' ? { kind: o.kind as 'fact' } : {}),
      ...(o.unconfirmed === true ? { unconfirmed: true } : {}),
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
