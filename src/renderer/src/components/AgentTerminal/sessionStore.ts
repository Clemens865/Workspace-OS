import { readScoped, scopedKey, EVERYWHERE } from '../../lib/workspaceScope'
/**
 * Persistence for agent-console sessions.
 *
 * Each agent tab owns one record: its display name, the conversation id the
 * main process maps to a resumable `claude` session, the raw terminal
 * transcript (ANSI included, capped), and the last submitted prompt. Records
 * live in localStorage so an app restart restores every tab and its scrollback,
 * and `--resume` picks the conversation back up (main persists the
 * conversationId → claude-session-id map on its side).
 */

export interface AgentSessionRecord {
  sessionId: string
  name: string
  /** Stable key the main process maps to a resumable claude session id. */
  conversationId: string
  /** Raw text written to the xterm viewport (ANSI included), capped. */
  transcript: string
  /** Last raw input that triggered an agent run — powers "Rerun". */
  lastPrompt: string | null
  mode: 'full' | 'safe'
  agentName: string | null
  /**
   * Which broker drives this session: 'prompt' = the shipped `claude -p`/
   * stream-json console (default, no regression); 'pty' = the interactive PTY
   * claude session with native permission prompts (broker v2).
   */
  runMode: 'prompt' | 'pty'
  /** Per-session model pick ('' = inherit Settings → Agent model). */
  model?: string
}

interface StoreShape {
  sessions: AgentSessionRecord[]
  activeSessionId: string | null
}

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORE_KEY = 'workspace-os:agent-sessions:v1'
/** Per-session transcript cap (chars). Roughly a few thousand lines. */
export const TRANSCRIPT_MAX = 120_000
const SAVE_DELAY_MS = 400

export const newConversationId = (): string =>
  `convo-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

const newSessionId = (): string =>
  `agent-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** In-memory fallback so the module also works in tests / non-DOM contexts. */
function memoryStorage(): StringStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

export class AgentSessionStore {
  private byId = new Map<string, AgentSessionRecord>()
  private order: string[] = []
  private activeSessionId: string | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  /** Which workspace this store currently belongs to (see lib/workspaceScope). */
  private scope = EVERYWHERE

  constructor(private storage: StringStorage) {
    this.load()
  }

  /**
   * Point the store at another workspace: flush what is here, drop it, read
   * that workspace's tabs. Components that seeded from `list()` must remount
   * (the dock keys itself by scope).
   */
  switchScope(scope: string): void {
    if (scope === this.scope) return
    // Only what was touched here is written; an untouched "everywhere" read
    // of the legacy blob must not become a copy under its own key.
    if (this.saveTimer) this.flush()
    this.scope = scope
    this.byId.clear()
    this.order = []
    this.activeSessionId = null
    this.load()
  }

  currentScope(): string {
    return this.scope
  }

  private load(): void {
    try {
      const raw = readScoped(this.storage, STORE_KEY, this.scope)
      if (!raw) return
      const parsed = JSON.parse(raw) as StoreShape
      if (!Array.isArray(parsed.sessions)) return
      for (const s of parsed.sessions) {
        if (typeof s?.sessionId !== 'string' || typeof s?.conversationId !== 'string') continue
        const rec: AgentSessionRecord = {
          sessionId: s.sessionId,
          name: typeof s.name === 'string' ? s.name : 'Agent',
          conversationId: s.conversationId,
          transcript: typeof s.transcript === 'string' ? s.transcript : '',
          lastPrompt: typeof s.lastPrompt === 'string' ? s.lastPrompt : null,
          mode: s.mode === 'safe' ? 'safe' : 'full',
          agentName: typeof s.agentName === 'string' ? s.agentName : null,
          model: typeof s.model === 'string' ? s.model : '',
          runMode: s.runMode === 'pty' ? 'pty' : 'prompt',
        }
        this.byId.set(rec.sessionId, rec)
        this.order.push(rec.sessionId)
      }
      this.activeSessionId =
        typeof parsed.activeSessionId === 'string' ? parsed.activeSessionId : null
    } catch {
      // Corrupt store — start fresh rather than blocking the console.
    }
  }

  list(): AgentSessionRecord[] {
    return this.order
      .map((id) => this.byId.get(id))
      .filter((s): s is AgentSessionRecord => s !== undefined)
  }

  get(sessionId: string): AgentSessionRecord | undefined {
    return this.byId.get(sessionId)
  }

  create(init?: Partial<Omit<AgentSessionRecord, 'sessionId'>>): AgentSessionRecord {
    const n = this.order.length + 1
    const rec: AgentSessionRecord = {
      sessionId: newSessionId(),
      name: init?.name ?? `Agent ${n}`,
      conversationId: init?.conversationId ?? newConversationId(),
      transcript: init?.transcript ?? '',
      lastPrompt: init?.lastPrompt ?? null,
      mode: init?.mode ?? 'full',
      agentName: init?.agentName ?? null,
      model: init?.model ?? '',
      runMode: init?.runMode ?? 'prompt',
    }
    this.byId.set(rec.sessionId, rec)
    this.order.push(rec.sessionId)
    this.scheduleSave()
    return rec
  }

  update(sessionId: string, patch: Partial<Omit<AgentSessionRecord, 'sessionId'>>): void {
    const rec = this.byId.get(sessionId)
    if (!rec) return
    Object.assign(rec, patch)
    this.scheduleSave()
  }

  /** Appends to a session transcript, trimming the oldest lines past the cap. */
  appendTranscript(sessionId: string, text: string): void {
    const rec = this.byId.get(sessionId)
    if (!rec || !text) return
    let t = rec.transcript + text
    if (t.length > TRANSCRIPT_MAX) {
      const cutAt = t.length - TRANSCRIPT_MAX
      const nl = t.indexOf('\n', cutAt)
      t = t.slice(nl === -1 ? cutAt : nl + 1)
    }
    rec.transcript = t
    this.scheduleSave()
  }

  remove(sessionId: string): void {
    this.byId.delete(sessionId)
    this.order = this.order.filter((id) => id !== sessionId)
    if (this.activeSessionId === sessionId) this.activeSessionId = null
    this.scheduleSave()
  }

  setActive(sessionId: string): void {
    if (!this.byId.has(sessionId)) return
    this.activeSessionId = sessionId
    this.scheduleSave()
  }

  getActiveId(): string | null {
    return this.activeSessionId && this.byId.has(this.activeSessionId)
      ? this.activeSessionId
      : null
  }

  /** Writes the store to storage immediately (used on beforeunload + tests). */
  flush(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    const shape: StoreShape = { sessions: this.list(), activeSessionId: this.activeSessionId }
    try {
      this.storage.setItem(scopedKey(STORE_KEY, this.scope), JSON.stringify(shape))
    } catch {
      // Quota/serialization failure — persistence is best-effort.
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, SAVE_DELAY_MS)
  }
}

export const sessionStore = new AgentSessionStore(
  typeof localStorage === 'undefined' ? memoryStorage() : localStorage
)

// Transcript chunks stream fast; the debounced save needs one last flush so a
// quit mid-run doesn't lose the tail.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => sessionStore.flush())
}
