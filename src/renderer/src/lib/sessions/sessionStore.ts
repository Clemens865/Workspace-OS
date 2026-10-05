/**
 * The sessions of the open workspace, and the engine that runs them.
 *
 * One store for every place a session is worked in (Chat, an agent's card, a
 * work card, the terminal's agent tabs), so a session started anywhere shows up
 * everywhere. Saved per workspace in `.workspace-os/sessions.json` through the
 * main process (local by design: the conversation never goes into the case
 * file, only the ask and the agent's outcome line do); older sessions move over
 * from localStorage once. The engine listens to the agent IPC once, for all.
 */
import { reviewStore } from '../../components/Review/reviewStore'
import { activityStore } from '../../components/Review/activityStore'
import { appendStep, type TraceStep } from '../../components/AgentTerminal/runTraceModel'
import { loadSettings } from '../../hooks/useSettings'
import { afterTurn, briefFirst, type AutoTurn, type HarnessDeps } from './appHarness'
import { caseOnFirstAsk, sessionDigest, shouldSuggestCase, titleFromPrompt, trimMessages, turnNotes, wantsReflection, type Session, type SessionMsg } from './sessionModel'

/** What only the running app knows about a session. */
export interface SessionLive {
  running: boolean
  steps: TraceStep[]
}

let root: string | null = null
let sessions: Session[] = []
const live = new Map<string, SessionLive>()
/** runId → { session, the ask, the output so far, whether the app made the ask (a design-check fix) }. */
const runs = new Map<string, { sessionId: string; ask: string; out: string; auto?: AutoTurn }>()
const listeners = new Set<() => void>()
let version = 0

const key = (r: string): string => `wos:sessions:${r}`
const emit = (): void => {
  version++
  listeners.forEach((l) => l())
}
/** True once the open workspace's sessions are read: nothing is saved before, or an empty list would overwrite them. */
let loaded = false
let saveTimer: number | null = null
function writeNow(): void {
  saveTimer = null
  if (!root || !loaded) return
  const json = JSON.stringify(sessions.map((s) => ({ ...s, messages: trimMessages(s.messages) })))
  void window.workspace.sessions?.save(root, json).catch(() => {
    /* the session still works for this run */
  })
}
/** Saves soon: a streaming reply changes the session on every chunk. */
function save(): void {
  if (!root || !loaded || typeof window === 'undefined') return
  if (saveTimer === null) saveTimer = window.setTimeout(writeNow, 400)
}
function parse(json: string | null | undefined): Session[] {
  try {
    const raw = JSON.parse(json ?? '[]') as Session[]
    return Array.isArray(raw) ? raw.filter((s) => s && typeof s.id === 'string') : []
  } catch {
    return []
  }
}
async function load(r: string | null): Promise<void> {
  if (saveTimer !== null) {
    window.clearTimeout(saveTimer)
    writeNow() // the workspace being left keeps its last words
  }
  root = r
  loaded = false
  sessions = []
  if (r) {
    const got = await window.workspace.sessions?.load().catch(() => null)
    if (root !== r) return // switched again meanwhile
    // Sessions started while this was reading stay, ahead of the saved ones.
    const early = sessions
    let saved: Session[]
    let migrated = false
    if (got && got.root === r && got.json !== null) saved = parse(got.json)
    else {
      // First time with the file: the sessions kept in this window's storage move over (left there as a copy).
      saved = parse(localStorage.getItem(key(r)))
      migrated = saved.length > 0
    }
    sessions = [...early, ...saved.filter((x) => !early.some((e) => e.id === x.id))]
    loaded = true
    if (migrated || early.length) save()
    // Sessions from before memory learned from them: only the last day's are
    // read, so an update never sends a whole history to the model at once.
    const dayAgo = Date.now() - 86_400_000
    let marked = false
    sessions = sessions.map((s) => {
      if (s.reflectedTurns !== undefined || s.lastAt >= dayAgo) return s
      marked = true
      return { ...s, reflectedTurns: s.turns }
    })
    if (marked) save()
  }
  emit()
}

// ── memory learns from quiet sessions ──
const reflecting = new Set<string>()

/** Reads a session's new turns once and lets memory propose what is worth keeping (to the Inbox). */
async function reflect(id: string): Promise<number> {
  const s = sessions.find((x) => x.id === id)
  if (!s || reflecting.has(id) || live.get(id)?.running) return 0
  const upTo = s.turns
  const digest = sessionDigest(s, s.reflectedTurns ?? 0)
  if (!loadSettings().learnFromSessions || !digest.turns.length || !window.workspace?.memory?.propose) {
    patch(id, { reflectedTurns: upTo })
    return 0
  }
  reflecting.add(id)
  try {
    const res = await window.workspace.memory.propose(digest, loadSettings().lightModel.trim() || undefined)
    if (res.proposed.length) window.dispatchEvent(new CustomEvent('wos:memory-changed'))
    return res.proposed.length
  } catch {
    return 0 // no model reachable: this session is passed over rather than retried forever
  } finally {
    reflecting.delete(id)
    if (sessions.some((x) => x.id === id)) patch(id, { reflectedTurns: upTo })
  }
}

/** Every quiet session with turns memory has not read yet, a few at a time. */
async function sweep(): Promise<void> {
  const now = Date.now()
  const due = sessions.filter((s) => wantsReflection(s, !!live.get(s.id)?.running, now)).slice(0, 3)
  for (const s of due) await reflect(s.id)
}
function patch(id: string, p: Partial<Session> | ((s: Session) => Partial<Session>)): void {
  sessions = sessions.map((s) => (s.id === id ? { ...s, ...(typeof p === 'function' ? p(s) : p) } : s))
  save()
  emit()
}
function setLive(id: string, p: Partial<SessionLive>): void {
  live.set(id, { ...(live.get(id) ?? { running: false, steps: [] }), ...p })
  emit()
}
function pushMsg(id: string, m: Omit<SessionMsg, 'at'>, coalesce = false): void {
  patch(id, (s) => {
    const last = s.messages[s.messages.length - 1]
    if (coalesce && last && last.role === m.role) return { messages: [...s.messages.slice(0, -1), { ...last, text: last.text + m.text }] }
    return { messages: [...s.messages, { ...m, at: Date.now() }] }
  })
}

/** The provider conversation key of a session: stable, so Claude/Codex resume it. */
export const conversationOf = (id: string): string => `session-${id}`

let started = false
function start(): void {
  if (started || typeof window === 'undefined' || !window.workspace?.agent) return
  started = true
  void window.workspace.fs.getWorkspaceRoot().then((r) => load(r ?? null)).catch(() => load(null))
  setInterval(() => void sweep(), 60_000)
  window.workspace.fs.onRootChanged((r) => void load(r ?? null))
  window.addEventListener('beforeunload', () => saveTimer !== null && writeNow())
  const ag = window.workspace.agent
  ag.onOutput((runId, chunk) => {
    const r = runs.get(runId)
    if (!r) return
    r.out += chunk
    pushMsg(r.sessionId, { role: 'agent', text: chunk }, true)
  })
  ag.onActivity((runId, act) => {
    const r = runs.get(runId)
    if (!r) return
    activityStore.record(runId, act)
    const cur = live.get(r.sessionId)?.steps ?? []
    setLive(r.sessionId, { steps: appendStep(cur, { kind: act.kind ?? 'run', label: act.label, chip: act.chip }, Date.now()) })
  })
  ag.onRunMeta((runId, meta) => {
    if (runs.has(runId)) reviewStore.patchRun(runId, { costUsd: meta.costUsd, turns: meta.turns })
  })
  ag.onArtifacts((runId, items) => {
    const r = runs.get(runId)
    if (!r || !items.length) return
    reviewStore.patchRun(runId, { artifacts: items.map((a) => ({ path: a.path, name: a.name, type: a.type })) })
    const made = items.map((a) => a.path)
    patch(r.sessionId, (s) => {
      // This turn's reply shows them (Chat's artifact cards); a turn with no words yet gets an empty reply to carry them.
      const roles = s.messages.map((m) => m.role)
      const at = roles.lastIndexOf('agent') > roles.lastIndexOf('user') ? roles.lastIndexOf('agent') : -1
      const messages =
        at < 0
          ? [...s.messages, { role: 'agent' as const, text: '', at: Date.now(), files: made }]
          : s.messages.map((m, i) => (i === at ? { ...m, files: [...(m.files ?? []).filter((f) => !made.includes(f)), ...made] } : m))
      return { messages, files: [...s.files.filter((f) => !made.includes(f)), ...made] }
    })
  })
  ag.onDone((runId, code, checkpointId) => {
    const r = runs.get(runId)
    if (!r) return
    runs.delete(runId)
    activityStore.clear(runId)
    reviewStore.patchRun(runId, { status: code === 0 ? 'pending' : 'error', code, checkpointId: checkpointId ?? null })
    if (code !== 0) pushMsg(r.sessionId, { role: 'system', text: `[the agent stopped with code ${code}]` })
    setLive(r.sessionId, { running: false })
    patch(r.sessionId, { lastAt: Date.now() })
    void remember(r.sessionId, r.ask, r.out, runId)
    if (code === 0) void afterTurn(r.sessionId, r.auto, harness)
  })
}

/** What the app harness (./appHarness.ts) may do with a session. */
const harness: HarnessDeps = {
  app: (id) => sessions.find((x) => x.id === id)?.app,
  push: (id, m) => pushMsg(id, m),
  busy: (id, label) => setLive(id, label ? { running: true, steps: appendStep([], { kind: 'run', label }, Date.now()) } : { running: false, steps: [] }),
  send: (id, text, auto) => sessionStore.send(id, text, [], { auto }),
}

/** "Felix" for "Felix — Funding Scout": how an agent signs a note. */
const signOf = (agentName: string | null): string => (agentName ?? 'Agent').split(' — ')[0]

/** Writes a turn to the session's case, if it has one: the ask, the agent's outcome, its files. */
async function remember(sessionId: string, ask: string, out: string, runId: string): Promise<void> {
  const s = sessions.find((x) => x.id === sessionId)
  if (!s?.caseId) return
  const cases = window.workspace.cases
  try {
    for (const n of turnNotes(ask, out)) await cases.addNote(s.caseId, n.author === 'agent' ? `${signOf(s.agentName)}: ${n.text}` : n.text, n.author)
    const run = reviewStore.getSnapshot().runs.find((x) => x.runId === runId)
    for (const a of run?.artifacts ?? []) await cases.addArtifact(s.caseId, a.path).catch(() => {})
  } catch {
    /* memory is best effort: the turn already happened */
  }
}

/** Opens the case a session lives in, carrying over what it already did. */
async function openCase(s: Session, ask?: string): Promise<string> {
  const cases = window.workspace.cases
  // What it is about, in the person's own words: the first ask (the title is only its opening).
  const first = (ask ?? s.messages.find((m) => m.role === 'user')?.text ?? '').replace(/\s+/g, ' ').trim()
  const about = first.length > 400 ? first.slice(0, 399) + '…' : first
  const started = `Started with ${s.agentName ? signOf(s.agentName) : 'the assistant'} on ${new Date(s.createdAt).toLocaleDateString()}.`
  const made = await cases.create({ title: s.title, type: 'task', description: about ? `${about}\n\n${started}` : started })
  // Carry the turns so far (asks and outcome lines only) and the files.
  const msgs = s.messages
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user') continue
    const answer = msgs.slice(i + 1).find((m) => m.role !== 'system')
    for (const n of turnNotes(msgs[i].text, answer?.role === 'agent' ? answer.text : '')) {
      await cases.addNote(made.id, n.author === 'agent' ? `${signOf(s.agentName)}: ${n.text}` : n.text, n.author).catch(() => {})
    }
  }
  for (const f of s.files) await cases.addArtifact(made.id, f).catch(() => {})
  return made.id
}

export interface SendContext {
  /** The harness preamble (where the person is), prepended to the ask. */
  preamble?: string
  openFile?: string | null
  /** Files the person attached (uploads or workspace files), shown with the message and read by the run. */
  attachments?: string[]
  /** This turn's model pick; unset = the agent's or the Settings default. */
  model?: string | null
  /** The app asks, not the person (a design-check or review fix): no message of theirs, no new turn title. */
  auto?: AutoTurn
}

export const sessionStore = {
  subscribe(l: () => void): () => void {
    start()
    listeners.add(l)
    return () => listeners.delete(l)
  },
  getVersion: (): number => version,
  list: (): Session[] => sessions,
  get: (id: string | null | undefined): Session | undefined => (id ? sessions.find((s) => s.id === id) : undefined),
  live: (id: string | null | undefined): SessionLive => (id && live.get(id)) || { running: false, steps: [] },

  /** A new session, optionally as an agent and/or inside a case. */
  create(o: { agentName?: string | null; caseId?: string | null; id?: string; title?: string; kind?: 'chat'; app?: string } = {}): Session {
    start()
    const now = Date.now()
    const s: Session = {
      id: o.id ?? `s${now.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
      title: o.title ?? (o.kind === 'chat' ? 'New chat' : 'New session'),
      ...(o.kind ? { kind: o.kind } : {}),
      ...(o.app ? { app: o.app } : {}),
      agentName: o.agentName ?? null,
      caseId: o.caseId ?? null,
      createdAt: now,
      lastAt: now,
      turns: 0,
      files: [],
      lastRunId: null,
      messages: [],
    }
    sessions = [s, ...sessions.filter((x) => x.id !== s.id)]
    save()
    emit()
    return s
  },

  /** Sends one ask: the run streams into the session; a first ask may open its case (the setting). */
  async send(id: string, text: string, mentions: string[] = [], ctx: SendContext = {}): Promise<void> {
    start()
    const s = sessions.find((x) => x.id === id)
    if (!s || live.get(id)?.running) return
    const attached = ctx.attachments ?? []
    const ask = text.trim() || [...mentions, ...attached].map((m) => m.split('/').pop()).join(', ')
    if (!ask) return
    const chat = s.kind === 'chat'
    const mode = loadSettings().sessionCases ?? 'suggest'
    if (s.turns === 0) patch(id, { title: s.title === 'New session' || s.title === 'New chat' ? titleFromPrompt(ask) : s.title })
    let caseId = sessions.find((x) => x.id === id)!.caseId
    // A chat is a conversation: it becomes a case only when the person keeps it.
    if (!caseId && !chat && s.turns === 0 && caseOnFirstAsk(mode)) {
      caseId = await openCase(sessions.find((x) => x.id === id)!, ask).catch(() => null)
      if (caseId) patch(id, { caseId })
    }
    const runId = `sess-${id}-${Date.now()}`
    runs.set(runId, { sessionId: id, ask, out: '', auto: ctx.auto })
    if (!ctx.auto) pushMsg(id, { role: 'user', text: ask, ...(attached.length ? { files: attached } : {}) })
    const firstAsk = s.turns === 0
    patch(id, (x) => ({ turns: x.turns + 1, lastAt: Date.now(), lastRunId: runId }))
    // A new app starts from a product brief its build is held to (./appHarness.ts).
    const brief = s.app && !ctx.auto && firstAsk ? await briefFirst(id, s.app, ask, harness) : ''
    setLive(id, { running: true, steps: [] })
    const agentName = s.agentName
    reviewStore.openRun({ runId, sessionId: conversationOf(id), sessionName: agentName ?? 'Assistant', prompt: ask, mode: loadSettings().agentMode, agentName, agentId: conversationOf(id) })
    // A session in a case works in the case's folder and knows the case.
    let prompt = text.trim() || (attached.length ? 'Look at the files I attached.' : 'Look at the attached files.')
    if (caseId) {
      const work = await window.workspace.cases.workFolder(caseId).catch(() => null)
      prompt = `[This conversation is the case "${caseId}". Its notes and files are kept for you.]${work ? `\n${work.guidance}` : ''}\n\n${prompt}`
    }
    if (ctx.preamble) prompt = `${ctx.preamble}\n\n${prompt}`
    prompt += brief
    try {
      await window.workspace.agent.run(runId, prompt, [...mentions, ...attached], ctx.openFile ?? null, loadSettings().agentMode, agentName, conversationOf(id), ctx.model ?? null, undefined, s.app ? 'app' : chat ? 'chat' : 'work', s.app)
    } catch (err) {
      runs.delete(runId)
      pushMsg(id, { role: 'system', text: `[error] ${(err as Error).message}` })
      reviewStore.patchRun(runId, { status: 'error', code: null })
      setLive(id, { running: false })
    }
  },

  /** Stops the running turn. */
  async stop(id: string): Promise<void> {
    const runId = [...runs.entries()].find(([, r]) => r.sessionId === id)?.[0]
    if (runId) await window.workspace.agent.cancel(runId).catch(() => {})
  },

  /** Keeps a session as a case (the suggestion, or by hand). */
  async keepAsCase(id: string): Promise<string | null> {
    const s = sessions.find((x) => x.id === id)
    if (!s) return null
    if (s.caseId) return s.caseId
    const caseId = await openCase(s)
    patch(id, { caseId })
    return caseId
  },

  dismissSuggestion(id: string): void {
    patch(id, { suggestDismissed: true })
  },

  /** Whether the app should offer to keep this session as a case now. */
  suggests(id: string): boolean {
    const s = sessions.find((x) => x.id === id)
    return !!s && !live.get(id)?.running && shouldSuggestCase(s, loadSettings().sessionCases ?? 'suggest')
  },

  rename(id: string, title: string): void {
    const t = title.trim()
    if (t) patch(id, { title: t })
  },

  /** Lets memory learn from a session now, without waiting for it to go quiet. Resolves to how many it proposed. */
  reflect(id: string): Promise<number> {
    return reflect(id)
  },

  /** Deletes a session: its conversation here and the provider's resume key. Its case, if any, stays. */
  async remove(id: string): Promise<void> {
    await this.stop(id)
    sessions = sessions.filter((s) => s.id !== id)
    live.delete(id)
    save()
    emit()
    await window.workspace.agent.forgetConversation(conversationOf(id)).catch(() => {})
  },

  /** A case was deleted: its sessions go with it. */
  async removeCase(caseId: string): Promise<void> {
    for (const s of sessions.filter((x) => x.caseId === caseId)) await this.remove(s.id)
  },
}

// Expose for e2e harnesses.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __sessionStore?: typeof sessionStore }).__sessionStore = sessionStore
}
