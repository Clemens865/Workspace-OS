
import type { AgentRunFailure } from '../../../shared/agentRun'

/** A case's numbers, computed from one CSV artifact (see main/case-insights). */
export interface ArtifactInsight {
  file: string
  kind: 'csv' | 'other'
  rows: number
  columns: string[]
  kpis: { label: string; value: string; sign?: 'neg' | 'pos' }[]
  chart: { byColumn: string; valueColumn: string; bars: { label: string; value: number; text: string }[] } | null
  preview: string[][]
}

/** A case's curated declared view (Layer 2), computed from its ```json spec. */
export interface CaseViewResult {
  title?: string
  kpis: { label: string; value: string; sign?: 'neg' | 'pos' }[]
  chart: ArtifactInsight['chart']
  table: { file: string; preview: string[][] } | null
}

/** A memory the workspace itself recorded (distinct from a Pulse insight). */
export interface WorkspaceMemory {
  id: string
  kind: 'fact' | 'preference' | 'decision' | 'entity'
  text: string
  source: string
  scope: 'workspace' | 'global'
  tags: string[]
  createdAt: number
  updatedAt: number
  reinforced: number
  lastUsedAt: number | null
  supersededBy: string | null
}

/** A calendar source the user connected (never carries the password). */
export interface CalendarSource {
  id: string
  kind: 'caldav' | 'ics' | 'google' | 'microsoft'
  displayName: string
  url: string
  username?: string
  enabledCalendars?: string[]
  createdAt: number
  updatedAt: number
}

/** A calendar this app may write to. */
export interface CalendarWriteTarget {
  id: string
  label: string
  kind: 'local' | 'caldav'
  /** Only a server can send invitations. */
  canInvite: boolean
}

export interface CalendarTargetChoice {
  /** Where to write, or null when the person has to say which. */
  target: CalendarWriteTarget | null
  options: CalendarWriteTarget[]
  /** True when there was only one real answer, so nothing was asked. */
  implied: boolean
}

export interface CalendarCollection {
  url: string
  displayName: string
  color?: string
}

/** One event instance in the viewed window. `end` is exclusive. */
export interface CalendarEvent {
  uid: string
  summary: string
  start: number
  end: number
  allDay: boolean
  location?: string
  description?: string
  tzid?: string
  rrule?: string
  recurringUid?: string
  sourceId: string
  color?: string
  /** Server identity for CalDAV events — present iff the event can be edited there. */
  href?: string
  etag?: string | null
  calendarUrl?: string
  /** Who is invited, with RSVP state, when the feed said. */
  attendees?: { email: string; name?: string; partstat?: string }[]
  organizer?: { email: string; name?: string }
  /** On a per-occurrence override: the ORIGINAL start of the occurrence it replaces. */
  recurrenceId?: number
}

/** Per-source outcome — one failing source must not blank the calendar. */
export interface CalendarSourceStatus {
  id: string
  displayName: string
  error?: string
  calendars?: CalendarCollection[]
}

export interface CalendarView {
  events: CalendarEvent[]
  sources: CalendarSourceStatus[]
}
import type { FileEntry } from './fs'

/**
 * A connected account as shown in Settings. NOTHING here is secret — the browser
 * session itself lives in Electron's encrypted persistent partition. `hasSession`
 * is a presence heuristic (cookies exist for the domain).
 */
export interface ConnectedAccountView {
  domain: string
  label: string
  addedAt: string
  hasSession: boolean
}

/* ── Routines. Mirrors src/main/routines/store.ts. ── */
export interface Routine {
  id: string
  name: string
  agentName: string | null
  prompt: string
  /** daily@HH:MM · weekdays@HH:MM · weekly@mon HH:MM · every:6h */
  schedule: string
  enabled: boolean
  capabilities: string[]
  lastRunAt: number | null
  nextRunAt: number | null
  lastJobId: string | null
  createdAt: number
  updatedAt: number
}

/* ── Background runs. Mirrors src/main/runs/queue.ts. ── */
export type BackgroundJobStatus = 'queued' | 'running' | 'pending' | 'error' | 'interrupted' | 'cancelled'
export interface BackgroundJob {
  id: string
  label: string
  prompt: string
  agentName: string | null
  origin: 'routine' | 'background'
  routineId?: string
  contextFiles: string[]
  /** Capability ids the run may reach through wos-action. */
  capabilities: string[]
  /** The workspace root the run belonged to; null = none open. */
  root: string | null
  status: BackgroundJobStatus
  enqueuedAt: number
  startedAt: number | null
  finishedAt: number | null
  code: number | null
  checkpointId: string | null
  costUsd: number
  provider?: string
  costKnown?: boolean
  inputTokens?: number
  outputTokens?: number
  cachedInputTokens?: number
  turns: number
  artifacts: { path: string; name: string; type: string }[]
  tail: string
}

/* ── Connections — the roster the Connectors page shows. Mirrors src/main/connections/registry.ts. ── */
export type ConnectionKind = 'token' | 'oauth' | 'browser' | 'account'
export type ConnectionStatus = 'connected' | 'needs-signin' | 'setup' | 'off'
export type ConnectionGroup = 'services' | 'accounts' | 'sites'
export interface ConnectionSecretView {
  envVar: string
  label: string
  hint: string
  stored: boolean
}
export type ConnectionSource =
  | { type: 'mcp'; connectorId: string; remote: boolean; enabled: boolean; secrets: ConnectionSecretView[] }
  | { type: 'site'; domain: string }
  | { type: 'mail'; accountId: string }
  | { type: 'calendar'; sourceId: string }
  | { type: 'drive' }
export interface Connection {
  id: string
  name: string
  kind: ConnectionKind
  /** The honest mechanism, in words. */
  how: string
  /** What an agent can do with it, in plain words. */
  gives: string
  status: ConnectionStatus
  detail: string
  group: ConnectionGroup
  source: ConnectionSource
  checkedAt: number
}

/** Mirror of the API exposed by the preload contextBridge (src/preload/index.ts). */
export interface WorkspaceApi {
  print: {
    document: (title: string, html: string) => Promise<void>
  }
  pdf: {
    print: (filePath: string, annotations: unknown) => Promise<void>
    readAnnotations: (filePath: string) => Promise<{ version: 1; file: string; annotations: unknown[] }>
    writeAnnotations: (filePath: string, doc: unknown) => Promise<{ ok: boolean }>
    exportAnnotated: (filePath: string, annotations: unknown, inPlace?: boolean) => Promise<{ ok: boolean; path: string }>
    reorderPages: (filePath: string, order: number[]) => Promise<{ ok: boolean }>
    rotatePage: (filePath: string, page: number, delta: number) => Promise<{ ok: boolean }>
    readForm: (filePath: string) => Promise<{ name: string; type: string; value: string; options?: string[] }[]>
    fillForm: (filePath: string, values: Record<string, string>) => Promise<{ ok: boolean }>
    sign: (filePath: string, pngBase64: string, page: number, rect: { x: number; y: number; w: number; h: number }) => Promise<{ ok: boolean }>
  }
  calendar: {
    sources: () => Promise<CalendarSource[]>
    test: (input: { kind: 'caldav' | 'ics'; url: string; username?: string; password?: string }) =>
      Promise<{ ok: true; calendars: CalendarCollection[] } | { ok: false; error: string }>
    add: (input: {
      kind: 'caldav' | 'ics'
      url: string
      displayName: string
      username?: string
      password?: string
      enabledCalendars?: string[]
    }) => Promise<CalendarSource>
    update: (id: string, patch: { displayName?: string; enabledCalendars?: string[] }) => Promise<CalendarSource | null>
    remove: (id: string) => Promise<{ ok: boolean }>
    events: (from: number, to: number) => Promise<CalendarView>
    /** Where a new event would go, and what else it could go to. */
    writeTargets: () => Promise<CalendarTargetChoice>
    setDefaultTarget: (id: string | null) => Promise<{ ok: true }>
    /**
     * Create an event in the calendar the person chose — a connected account
     * when there is one, otherwise the app's own local file.
     *
     * Attendees are invited BY THE SERVER, which is why they need a connected
     * account: a local .ics can hold a meeting but cannot tell anyone about it.
     */
    createEvent: (input: {
      summary: string
      start: number
      end?: number
      allDay?: boolean
      location?: string
      description?: string
      /** Which calendar; omitted means the remembered one. */
      target?: string
      attendees?: { email: string; name?: string }[]
    }) => Promise<CalendarEvent & { calendar: string; invited: string[] }>
    /**
     * Edit an event where it lives — the local file by uid, a server event by
     * its href. On a server, attendees/alarms survive and SEQUENCE is bumped,
     * so the server itself tells every attendee the meeting changed.
     */
    updateEvent: (
      ref: { uid: string; sourceId?: string; href?: string; scope?: 'occurrence' | 'series'; occurrence?: number },
      changes: {
        summary: string; start: number; end: number; allDay?: boolean; location?: string; description?: string
        /** Absent = attendees untouched; an array replaces WHO is invited (kept people keep their RSVP). */
        attendees?: { email: string; name?: string }[]
      },
    ) => Promise<{ ok: true }>
    /** Delete an event where it lives. On a server this sends the cancellations.
     * scope 'occurrence' deletes one occurrence of a series (EXDATE on the master). */
    removeEvent: (
      ref: string | { uid: string; sourceId?: string; href?: string; scope?: 'occurrence'; occurrence?: number },
    ) => Promise<{ ok: boolean }>
    connectOAuth: (provider: 'google' | 'microsoft', displayName: string) =>
      Promise<{ ok: true; source: CalendarSource; calendars: CalendarCollection[] } | { ok: false; error: string }>
  }
  fs: {
    readDir: (dirPath: string) => Promise<FileEntry[]>
    readFile: (filePath: string) => Promise<string>
    readFileBytes: (filePath: string) => Promise<Uint8Array>
    writeFile: (filePath: string, content: string) => Promise<void>
    delete: (filePath: string) => Promise<void>
    rename: (oldPath: string, newName: string) => Promise<void>
    create: (dirPath: string, name: string, isDirectory: boolean) => Promise<string>
    openFolderDialog: () => Promise<string | null>
    saveCopyDialog: (srcPath: string) => Promise<string | null>
    getWorkspaceRoot: () => Promise<string | null>
    closeWorkspace: () => Promise<void>
    /** Every file under the workspace root (bounded walk) — quick-open's data source. */
    listFiles: () => Promise<string[]>
    /** Recently opened workspace roots, most recent first (pruned to existing dirs). */
    recentWorkspaces: () => Promise<string[]>
    /** Opens a known workspace directory without the folder dialog. */
    openWorkspace: (dir: string) => Promise<boolean>
    onRootChanged: (callback: (root: string | null) => void) => () => void
    reveal: (filePath: string) => Promise<void>
    watchStart: () => Promise<void>
    watchStop: () => Promise<void>
    onWatchEvent: (callback: (event: { event: string; path: string }) => void) => () => void
  }
  shell: {
    spawn: (sessionId: string) => Promise<{ pid: number }>
    input: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    onOutput: (callback: (sessionId: string, data: string) => void) => () => void
  }
  /** Integrated Terminal Dock — PTY host for the new shell (emits data + exit). */
  terminal: {
    create: (sessionId: string) => Promise<{ pid: number }>
    write: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    onData: (callback: (sessionId: string, data: string) => void) => () => void
    onExit: (callback: (sessionId: string, code: number) => void) => () => void
  }
  /** Live workspace harness — push where the user is; main merges + persists it. */
  context: {
    set: (ctx: {
      root?: string | null
      surface?: string | null
      folder?: string | null
      openFile?: string | null
      /**
       * The page open in the in-app browser. Without it, an agent started in
       * the terminal can drive the browser but cannot see where it already is.
       */
      browserUrl?: string | null
      browserTitle?: string | null
      /** Per-surface action manifest for the AGENT→ACTION bridge preamble. */
      actions?: { id: string; agentHint: string }[]
      /** Every registered action id — the socket bridge's allow-set. */
      allActionIds?: string[]
    }) => Promise<void>
  }
  /** AGENT→ACTION bridge (renderer executor). Main forwards an agent's
   *  `wos-action run <id>` here; we run the surfaceActions registry + reply. */
  agentActions: {
    onInvoke: (
      callback: (payload: { reqId: string; actionId: string; args?: unknown }) => void,
    ) => () => void
    result: (payload: { reqId: string; ok: boolean; result?: unknown; error?: string }) => void
  }
  search: {
    query: (q: string) => Promise<SearchResult[]>
    symbols: (q: string) => Promise<SymbolResult[]>
    indexStatus: () => Promise<{ indexed: number; queued: number; running: boolean; done: number; total: number }>
    start: () => Promise<void>
    prioritize: (filePath: string) => Promise<void>
  }
  /** Knowledge base — the [[wikilink]] backlinks graph over workspace notes. */
  links: {
    /** Notes that link TO `filePath`, each with the linking line. */
    backlinks: (filePath: string) => Promise<Backlink[]>
    /** This file's outgoing links, each resolved to a path or marked a stub. */
    outgoing: (filePath: string) => Promise<OutgoingLink[]>
    /** Referenced note names that don't exist yet, most-referenced first. */
    stubs: () => Promise<Stub[]>
    /** Resolve a note name to a file path (case-insensitive), or null. */
    resolve: (name: string) => Promise<string | null>
    /** The whole-workspace graph: nodes (notes + stubs) + resolved-link edges. */
    graph: () => Promise<KnowledgeGraph>
    /** Notes most related to `filePath` by link-graph proximity (no ML). */
    related: (filePath: string) => Promise<RelatedNote[]>
  }
  /** Read-only cross-project insights from the local Pulse DB, scoped to the
   *  active workspace project in the main process. */
  memory: {
    remember: (input: {
      text: string
      kind?: 'fact' | 'preference' | 'decision' | 'entity'
      source?: string
      scope?: 'workspace' | 'global'
      tags?: string[]
    }) => Promise<WorkspaceMemory>
    search: (query: string, limit?: number) => Promise<WorkspaceMemory[]>
    listMemories: (opts?: { kind?: string; limit?: number }) => Promise<WorkspaceMemory[]>
    forget: (id: string) => Promise<{ ok: boolean }>
    memStats: () => Promise<{ workspace: number; global: number }>

    query: (opts?: { types?: PulseInsightType[]; search?: string; limit?: number }) => Promise<PulseInsight[]>
    recent: (limit?: number) => Promise<PulseInsight[]>
    status: () => Promise<{ status: 'available' | 'absent' | 'incompatible' | 'error' }>
  }
  codex: {
    openRequest: (runId: string, requestId: string) => Promise<void>
    setEffort: (effort: string) => Promise<void>
    respond: (runId: string, requestId: string, response: unknown) => Promise<boolean>
    steer: (runId: string, text: string) => Promise<boolean>
    onQuestion: (callback: (question: any) => void) => () => void
  }
  agent: {
    run: (runId: string, prompt: string, contextFiles: string[], activeFile?: string | null, mode?: 'full' | 'safe', agentName?: string | null, conversationId?: string, model?: string | null, resumeOnly?: boolean) => Promise<{ pid: number; checkpointId: string | null; provider?: 'claude' | 'codex'; model?: string }>
    /** Default model alias for every run path (mirrors Settings → Agent model); '' = the CLI's default. */
    setDefaultModel: (model: string) => Promise<void>
    listModels: () => Promise<{ codex: { id: string; label: string; hint: string; efforts?: string[] }[]; status?: { available: boolean; account: string; error?: string } }>
    cancel: (runId: string) => Promise<void>
    forgetConversation: (conversationId: string) => Promise<void>
    onOutput: (callback: (runId: string, chunk: string) => void) => () => void
    onDone: (callback: (runId: string, code: number, checkpointId: string | null, failure?: AgentRunFailure) => void) => () => void
    onArtifact: (callback: (runId: string, path: string) => void) => () => void
    /** Classified list of a run's output files, surfaced as openable artifact cards. */
    onArtifacts: (callback: (runId: string, artifacts: RunArtifact[]) => void) => () => void
    onRunMeta: (callback: (runId: string, meta: { costUsd: number; turns: number; durationMs: number; provider?: string; costKnown?: boolean; inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }) => void) => () => void
    /** Live activity label per tool_use, parsed from the same stream (no extra tokens). */
    /** kind = icon family (think/read/write/run/web/search/app); chip = the mono detail (file, command, domain). */
    onActivity: (callback: (runId: string, activity: { tool: string; label: string; kind?: string; chip?: string }) => void) => () => void
  }
  agentPty: {
    spawn: (sessionId: string, options?: { model?: string; agentName?: string | null; mode?: string; activeFile?: string | null }) => Promise<{ pid: number; provider?: 'claude' | 'codex' }>
    input: (sessionId: string, data: string) => Promise<void>
    resize: (sessionId: string, cols: number, rows: number) => Promise<void>
    kill: (sessionId: string) => Promise<void>
    onOutput: (callback: (sessionId: string, data: string) => void) => () => void
    onExit: (callback: (sessionId: string, code: number) => void) => () => void
  }
  skills: {
    list: (model?: string) => Promise<{ name: string; description: string; scope: 'global' | 'project'; path?: string }[]>
  }
  /**
   * Browser drive — the agent drives the VISIBLE in-app Browser <webview>.
   * navigate is http(s) only; extract runs a FIXED script by `mode` (no
   * arbitrary JS); screenshot writes a PNG under userData / the workspace.
   */
  /**
   * Browsing history + bookmarks — ONE store, so a bookmark is a starred
   * history row and cannot drift out of sync with it.
   *
   * `search` is full-text over page CONTENT — the reason the index exists.
   * `suggest` is the omnibox's url/title match and deliberately does NOT read
   * body text, so three keystrokes cannot surface every page that mentions the
   * word. Deletion removes the indexed text, not just the listing.
   */
  history: {
    record: (arg: { url: string; title?: string; favicon?: string; text?: string }) => Promise<{ ok: boolean }>
    search: (query: string, limit?: number) => Promise<HistoryEntry[]>
    suggest: (prefix: string, limit?: number) => Promise<HistorySuggestion[]>
    recent: (limit?: number) => Promise<HistoryEntry[]>
    star: (url: string, title?: string, favicon?: string) => Promise<{ ok: boolean }>
    unstar: (url: string) => Promise<{ ok: boolean }>
    isStarred: (url: string) => Promise<boolean>
    bookmarks: (limit?: number) => Promise<HistoryEntry[]>
    forget: (url: string) => Promise<{ ok: boolean }>
    forgetSince: (since: number) => Promise<{ ok: boolean; removed: number }>
    clear: () => Promise<{ ok: boolean }>
  }

  browser: {
    navigate: (url: string, tab?: string) => Promise<{ ok: boolean; url?: string; title?: string; error?: string }>
    screenshot: (destPath?: string, tab?: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    extract: (
      mode?: 'text' | 'links' | 'tables' | 'meta',
      tab?: string,
    ) => Promise<{ ok: boolean; mode?: string; data?: unknown; error?: string }>
    map: (tab?: string) => Promise<{
      ok: boolean
      data?: {
        title: string
        url: string
        headings: string[]
        links: { text: string; href: string; category: string }[]
        interactives: { tag: string; text: string; type: string }[]
        consent: { present: boolean; hint: string }
      }
      error?: string
    }>
    current: (tab?: string) => Promise<{ ok: boolean; url?: string; title?: string; error?: string }>
    dismissCookies: (tab?: string) => Promise<{
      ok: boolean
      clicked?: boolean
      label?: string
      error?: string
    }>
    /**
     * Empties the browser's HTTP cache. Cookies are untouched, so Connected
     * Accounts stay signed in — clearing storage on this partition would sign
     * the user out of everything.
     */
    clearCache: () => Promise<{ ok: boolean }>
    clearConsent: (tab?: string) => Promise<{
      ok: boolean
      cleared?: boolean
      method?: 'overlay' | 'wall' | 'iframe' | 'none'
      wasWall?: boolean
      error?: string
    }>
    deepRead: (arg: { url: string; maxPages?: number; focus?: string; tab?: string }) => Promise<{
      ok: boolean
      profile?: {
        name: string
        homepage: string
        title: string
        pages: { url: string; category: string; title: string; excerpt: string }[]
        emails: string[]
        phones: string[]
        socials: string[]
      }
      notes?: string[]
      error?: string
    }>
    click: (arg?: { selector?: string; text?: string; tab?: string }) => Promise<{
      ok: boolean
      clicked?: boolean
      tag?: string
      text?: string
      href?: string
      error?: string
    }>
    scroll: (arg?: { to?: 'top' | 'bottom'; by?: number; tab?: string }) => Promise<{
      ok: boolean
      scrollY?: number
      atBottom?: boolean
      error?: string
    }>
    waitFor: (arg?: { selector?: string; text?: string; timeoutMs?: number; tab?: string }) => Promise<{
      ok: boolean
      found?: boolean
      error?: string
    }>
    back: (tab?: string) => Promise<{ ok: boolean; url?: string; error?: string }>
    forward: (tab?: string) => Promise<{ ok: boolean; url?: string; error?: string }>
    type: (arg?: { selector?: string; text?: string; tab?: string }) => Promise<{
      ok: boolean
      typed?: boolean
      tag?: string
      error?: string
    }>
    /** Multi-tab: mark a tab's guest (by getWebContentsId()) as the active drive target. */
    setActiveGuest: (id: number) => Promise<{ ok: boolean; active?: number | null; error?: string }>
    /** Tab-scoped drive: map a renderer TAB ID → its guest (on dom-ready). */
    registerTab: (tabId: string, webContentsId: number) => Promise<{ ok: boolean; tab?: string | null; error?: string }>
    /** Forget a tab's guest mapping (tab closed). */
    unregisterTab: (tabId: string) => Promise<{ ok: boolean; error?: string }>
  }
  components: {
    list: () => Promise<Component[]>
    save: (c: Partial<Component>) => Promise<Component>
    delete: (id: string) => Promise<void>
  }
  /** Live-transclusion: source-of-truth metrics that back real office cells. */
  metrics: {
    list: () => Promise<Metric[]>
    create: (name: string, value: number) => Promise<Metric>
    update: (id: string, patch: { name?: string; value?: number; source?: MetricSource }) => Promise<Metric>
    delete: (id: string) => Promise<void>
    /** Create a metric whose value is READ LIVE from a real spreadsheet cell. */
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string },
    ) => Promise<Metric>
    /** Re-read one sourced metric from disk; propagates downstream if it changed. */
    refreshFromSource: (id: string) => Promise<MetricRefreshResult>
    /** Re-read every sourced metric ("refresh all"). */
    refreshAllFromSource: () => Promise<MetricRefreshResult[]>
    /** Re-read only metrics sourced from `filePath` (auto-refresh-on-save). */
    refreshForFile: (filePath: string) => Promise<MetricRefreshResult[]>
  }
  /** Live links {metricId → file+anchor}; the file always holds a literal. */
  transclusions: {
    forFile: (filePath: string) => Promise<TransclusionLink[]>
    /** Read-only: every link for a metric across ALL files ("where is this linked"). */
    forMetric: (metricId: string) => Promise<TransclusionLink[]>
    /** Read-only: every link in the store (for per-metric link-count badges). */
    allLinks: () => Promise<TransclusionLink[]>
    add: (input: {
      metricId: string
      filePath: string
      lastValue: number
      sheet?: string
      cell?: string
      tag?: string
      target?: LinkTarget
    }) => Promise<TransclusionLink>
    remove: (id: string) => Promise<void>
    /** Impact of pushing a metric into every linked file, WITHOUT writing. */
    previewSyncAll: (metricId: string, openFilePath: string | null) => Promise<SyncAllPreview>
    /** Explicitly push a metric into every CLOSED linked file on disk (fail-safe). */
    syncAll: (metricId: string, openFilePath: string | null) => Promise<SyncAllResult>
  }
  /** Live ranges: source-of-truth grids (the range-sized sibling of metrics). */
  ranges: {
    list: () => Promise<LiveRange[]>
    /** Create a range whose grid is READ LIVE from a real spreadsheet block. */
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => Promise<LiveRange>
    /** Rename, or detach to a literal grid via source: { kind: 'literal' }. */
    update: (id: string, patch: { name?: string; source?: RangeSource | { kind: 'literal' } }) => Promise<LiveRange>
    /** Re-read one sourced range from disk; propagates downstream if it changed. */
    refreshFromSource: (id: string) => Promise<RangeRefreshResult>
    /** Re-read every sourced range ("refresh all"). */
    refreshAllFromSource: () => Promise<RangeRefreshResult[]>
    /** Re-read only ranges sourced from `filePath` (auto-refresh-on-save). */
    refreshForFile: (filePath: string) => Promise<RangeRefreshResult[]>
    delete: (id: string) => Promise<void>
  }
  /** Live block links {rangeId → file+anchor}; the file always holds literals. */
  rangeLinks: {
    forFile: (filePath: string) => Promise<RangeLink[]>
    forRange: (rangeId: string) => Promise<RangeLink[]>
    allLinks: () => Promise<RangeLink[]>
    add: (input: {
      rangeId: string
      filePath: string
      target: RangeLinkTarget
      lastValues: RangeGrid
    }) => Promise<RangeLink>
    remove: (id: string) => Promise<void>
    /** Impact of pushing a range into every linked file, WITHOUT writing. */
    previewSyncAll: (rangeId: string, openFilePath: string | null) => Promise<RangeSyncAllPreview>
    /** Explicitly push a range into every CLOSED linked file on disk (fail-safe). */
    syncAll: (rangeId: string, openFilePath: string | null) => Promise<RangeSyncAllResult>
  }
  /** Collections: source-of-truth typed record sets (records→layout). */
  collections: {
    list: () => Promise<Collection[]>
    /** Create a collection whose records are READ LIVE from a real .xlsx block. */
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => Promise<Collection>
    /** Rename, or detach to a literal set via source: { kind: 'literal' }. */
    update: (id: string, patch: { name?: string; source?: CollectionSource | { kind: 'literal' } }) => Promise<Collection>
    /** Re-read one sourced collection from disk; propagates downstream if changed. */
    refresh: (id: string) => Promise<CollectionRefreshResult>
    /** Re-read every sourced collection ("refresh all"). */
    refreshAll: () => Promise<CollectionRefreshResult[]>
    /** Re-read only collections sourced from `filePath` (auto-refresh-on-save). */
    refreshForFile: (filePath: string) => Promise<CollectionRefreshResult[]>
    delete: (id: string) => Promise<void>
  }
  /** Live layout links {collectionId → file+anchor+mapping}; file holds literals. */
  collectionLinks: {
    forFile: (filePath: string) => Promise<CollectionLink[]>
    forCollection: (collectionId: string) => Promise<CollectionLink[]>
    allLinks: () => Promise<CollectionLink[]>
    add: (input: {
      collectionId: string
      filePath: string
      target: CollectionLinkTarget
      columns: FieldColumn[]
      view?: CollectionView
      lastGrid: RangeGrid
      layout?: CollectionLayout
      cardTemplate?: CardTemplate
    }) => Promise<CollectionLink>
    remove: (id: string) => Promise<void>
    /** Impact of pushing a collection into every linked file, WITHOUT writing. */
    previewSyncAll: (collectionId: string, openFilePath: string | null) => Promise<CollectionSyncAllPreview>
    /** Explicitly render + push a collection into every CLOSED linked file. */
    syncAll: (collectionId: string, openFilePath: string | null) => Promise<CollectionSyncAllResult>
  }
  system: {
    status: () => Promise<{ engine: boolean; python: boolean; claude: { ok: boolean; path: string | null } }>
  }
  /**
   * System pasteboard (WOS-008). Use this, not navigator.clipboard: the app
   * denies every browser permission request, so `clipboard-read` is refused
   * and readText() rejects. `writeText` resolves false if it was handed a
   * non-string rather than pasting "[object Object]" over the user's clipboard.
   */
  clipboard: {
    readText: () => Promise<string>
    writeText: (text: string) => Promise<boolean>
  }
  /** Secret vault — key NAMES only cross this boundary; values are write-only. */
  secrets: {
    list: () => Promise<{ name: string }[]>
    status: () => Promise<{ available: boolean; backend: string }>
    set: (name: string, value: string) => Promise<{ ok: true }>
    remove: (name: string) => Promise<{ ok: true }>
  }
  /** MCP connectors — catalog + enable/disable + per-connector readiness. */
  mcp: {
    listConnectors: () => Promise<{
      id: string
      displayName: string
      description: string
      kind: 'stdio-apikey' | 'remote-oauth'
      secrets: { envVar: string; label: string; hint: string }[]
    }[]>
    enable: (id: string) => Promise<{ ok: true }>
    disable: (id: string) => Promise<{ ok: true }>
    status: () => Promise<{
      id: string
      kind: 'stdio-apikey' | 'remote-oauth'
      enabled: boolean
      requiredSecrets: string[]
      missingSecrets: string[]
      /** Remote-oauth only: is an OAuth record stored? */
      connected?: boolean
      ready: boolean
    }[]>
    /** Remote OAuth — run the loopback flow; on success stores the refresh token. */
    oauthConnect: (id: string) => Promise<{ ok: true; connected: true } | { ok: false; error: string }>
    /** Remote OAuth — is the connector connected (a record is stored)? */
    oauthStatus: (id: string) => Promise<{ connected: boolean }>
    /** Remote OAuth — disconnect (remove the stored record). */
    oauthDisconnect: (id: string) => Promise<{ ok: true }>
  }
  /** Native IMAP client (Phase 1: read-only inbox). Password crosses only on add/test. */
  mail: {
    accounts: {
      list: () => Promise<MailAccount[]>
      add: (payload: MailAccountFormInput, secret: string) => Promise<MailAccount>
      /** One-click built-in demo mailbox — no credentials, no network. */
      addDemo: () => Promise<MailAccount>
      remove: (id: string) => Promise<{ ok: true }>
      test: (payload: MailAccountFormInput, secret: string) => Promise<MailResult<true>>
    }
    folders: (accountId: string) => Promise<MailResult<MailFolder[]>>
    messages: (accountId: string, folder: string, opts?: { limit?: number; beforeUid?: number; offset?: number }) => Promise<MailResult<MessageSummary[]>>
    message: (accountId: string, folder: string, uid: number) => Promise<MailResult<FullMessage>>
    /** Move a message (Archive, filing, or delete-as-move-to-Trash). Undoable. */
    move: (
      accountId: string, folder: string, uid: number, messageId: string, toFolder: string, label?: string,
    ) => Promise<MailResult<MailActionRecord>>
    setRead: (
      accountId: string, folder: string, uid: number, messageId: string, read: boolean, label?: string,
    ) => Promise<MailResult<MailActionRecord>>
    setFlagged: (
      accountId: string, folder: string, uid: number, messageId: string, flagged: boolean, label?: string,
    ) => Promise<MailResult<MailActionRecord>>
    /** Take back a journalled action. */
    undo: (accountId: string, actionId: number) => Promise<MailResult<unknown>>
    /** Propose a filing plan for recent mail. Moves nothing. */
    proposeFiling: (
      accountId: string, folder: string, days: 7 | 30 | 90,
    ) => Promise<MailResult<MailFilingPlan>>
    /** Apply an APPROVED filing plan. */
    applyFiling: (
      accountId: string, plan: MailFilingPlan,
    ) => Promise<MailResult<{ moved: number; failed: number; created: number }>>
    /** Undo everything the AGENT did since a moment (ms epoch). */
    undoAgentSince: (
      accountId: string, sinceMs: number,
    ) => Promise<MailResult<{ undone: number; failed: number }>>
    /** The undo stack, newest first. */
    undoable: (accountId: string) => Promise<MailResult<UndoEntry[]>>
    /** Save an attachment to a location the user picks. */
    saveAttachment: (
      accountId: string, folder: string, uid: number, index: number,
    ) => Promise<MailResult<{ saved: boolean; path?: string }>>
    /** Open an attachment with the OS default app. */
    openAttachment: (
      accountId: string, folder: string, uid: number, index: number,
    ) => Promise<MailResult<{ opened: boolean }>>
    /** Export a rendered message to PDF. */
    exportPdf: (html: string, subject: string) => Promise<MailResult<{ saved: boolean; path?: string }>>
    /** Raw RFC822 source — "show original". */
    rawSource: (accountId: string, folder: string, uid: number) => Promise<MailResult<string>>
    createFolder: (accountId: string, folderPath: string) => Promise<MailResult<true>>
    renameFolder: (accountId: string, from: string, to: string) => Promise<MailResult<true>>
    deleteFolder: (accountId: string, folderPath: string) => Promise<MailResult<true>>
    /** Start/stop watching a folder for new mail. */
    watchStart: (accountId: string, folder: string) => Promise<MailResult<{ watching: boolean }>>
    watchStop: (accountId: string) => Promise<{ ok: true }>
    /** Subscribe to new-mail events. Returns an unsubscribe function. */
    onNewMail: (
      cb: (e: { accountId: string; folder: string; count: number; latest: { subject: string; from: string } | null }) => void,
    ) => () => void
    /** Unread + total per folder, for the rail badges. */
    folderCounts: (
      accountId: string, folders: string[],
    ) => Promise<MailResult<Record<string, { total: number; unseen: number }>>>
    /** Send behind an undo window — returns immediately with a queue id. */
    sendQueued: (
      accountId: string, draft: MailDraft, context: MailComposeContext,
    ) => Promise<MailResult<{ id: string; holdMs: number }>>
    /** Cancel a held send. Only possible before the window expires. */
    cancelSend: (id: string) => Promise<MailResult<{ cancelled: boolean }>>
    /** Skip the remaining hold and send now. */
    sendNow: (id: string) => Promise<MailResult<{ state: string }>>
    /** Save a compose draft to the server's Drafts folder. */
    saveDraft: (
      accountId: string, draft: MailDraft, context: MailComposeContext, replaceUid?: number,
    ) => Promise<MailResult<{ folder: string; uid: number | null }>>
    /** Per-account signature. */
    getSignature: (accountId: string) => Promise<MailResult<string>>
    setSignature: (accountId: string, signature: string) => Promise<{ ok: true }>
    /** Recipient suggestions from real correspondence. */
    contacts: (
      query: string, limit?: number,
    ) => Promise<MailResult<{ address: string; name: string; count: number; lastSeen: number | null }[]>>
    /** The folder as the local index knows it — instant, no network. */
    cached: (
      accountId: string, folder: string, limit?: number,
    ) => Promise<MailResult<(IndexedMailRow & { threadCount: number })[]>>
    /** Full-text search over the LOCAL index (subject, sender, body). */
    search: (
      query: string,
      opts?: { accountId?: string; folder?: string; limit?: number; sort?: string },
    ) => Promise<MailResult<IndexedMailRow[]>>
    /** Refresh the local index for a folder; bodies deepen in the background. */
    sync: (accountId: string, folder: string) => Promise<MailResult<MailSyncReport>>
    indexStats: () => Promise<MailResult<{ messages: number; threads: number; accounts: number }>>

    /** Phase 2 — SMTP-side "Test connection" (validates SMTP, does not save). */
    smtpTest: (payload: MailAccountFormInput, secret: string) => Promise<MailResult<true>>
    /** Phase 2 — send a composed / reply / forward message via SMTP. */
    send: (
      accountId: string,
      draft: MailDraft,
      context?: MailComposeContext,
    ) => Promise<MailResult<MailSendResult>>
    /** Phase 3 — scan a folder → the messages that plausibly need a reply (ranked). */
    /** The rules that override how mail is sorted. Order decides; first match wins. */
    rules: {
      list: () => Promise<MailRule[]>
      add: (rule: Omit<MailRule, 'id'>) => Promise<MailRule>
      update: (id: string, patch: Partial<MailRule>) => Promise<MailRule | null>
      remove: (id: string) => Promise<{ ok: true }>
      reorder: (id: string, delta: number) => Promise<MailRule[]>
    }
    /** Proposes filing the newsletters. Proposes — moves nothing until `file`. */
    newsletters: {
      propose: (accountId: string, folder: string, days?: number) => Promise<{ ok: true; value: NewsletterSweep }>
      file: (
        accountId: string,
        sweep: NewsletterSweep,
      ) => Promise<{ ok: true; value: { moved: number; failed: number; created: number } } | { ok: false; error: { message: string } }>
    }
    /** What the app thinks one message is, and why. */
    classify: (
      accountId: string,
      folder: string,
      uid: number,
    ) => Promise<{ ok: true; value: { category: MailCategory; reason: string; ruleId?: string } } | { ok: false; error: { message: string } }>
    triage: (
      accountId: string,
      folder: string,
      opts?: { limit?: number; maxCandidates?: number },
    ) => Promise<MailResult<MailNeedsReply[]>>
    /**
     * The Morning Sift — one batched light-model pass over what's unread:
     * zone + priority + one-line summary per mail. Reads the local index only.
     */
    sift: (
      accountId: string,
      folder: string,
      opts?: { model?: string; caseTitles?: string[]; excludeUids?: number[] },
    ) => Promise<{
      verdicts: MailSiftVerdict[]
      /** The assistant's spoken-style overview of the fresh batch, or null. */
      briefing: string | null
      degraded: boolean
      scanned: number
      unreadUids: number[]
    }>
    /** Phase 3 — draft a reply (agent-suggested body + threaded envelope). NEVER sends. */
    draftReply: (
      accountId: string,
      payload: { folder: string; uid: number; replyAll?: boolean; instruction?: string; stance?: 'positive' | 'neutral' | 'negative' },
    ) => Promise<MailResult<MailDraftedReply>>
    /** OAuth — is Google sign-in configured (a client id is set)? */
    oauthConfigured: () => Promise<{ configured: boolean }>
    /** OAuth — run the Google loopback flow and create an xoauth2 account. */
    oauthGoogle: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => Promise<MailResult<MailAccount>>
    /** OAuth — is Microsoft sign-in configured (a client id is set)? */
    oauthMicrosoftConfigured: () => Promise<{ configured: boolean }>
    /** Save an OAuth client id (validated) so the OAuth sign-in button appears. */
    oauthSetClientId: (provider: 'google' | 'microsoft', clientId: string) => Promise<{ ok: boolean }>
    /** OAuth — run the Microsoft loopback flow and create an xoauth2 account
     *  (required for consumer Outlook/Hotmail/Live/MSN since 2024). */
    oauthMicrosoft: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => Promise<MailResult<MailAccount>>
    /** Autoconfig — email address → resolved IMAP/SMTP settings (table/ISPDB/guess). */
    autoconfig: (email: string) => Promise<MailResult<MailAutoconfigResult>>
    /**
     * Advanced 1:1 email — richer than a plain-text box. All NEVER send; the
     * renderer previews then reuses `send` with the compiled html + text.
     */
    /** Assemble a theme + structured blocks → responsive HTML + text fallback. */
    richBuild: (payload: { themeId?: EmailThemeId; blocks: EmailBlock[] }) => Promise<MailResult<BuiltRichEmail>>
    /** A one-line brief → agent-authored MJML → compiled responsive HTML. */
    richDraft: (payload: { brief: string; brand?: string }) => Promise<MailResult<DraftedRichEmail>>
    /** Current draft + an action (tighten/clearer/warmer/…) → a revised body. */
    richAssist: (payload: { action: EmailAssistAction; draft: string; instruction?: string }) => Promise<MailResult<{ body: string }>>
    /** Live-data picker: list metrics/ranges, or (with an id) get a drop-in block. */
    liveData: (payload?: { metricId?: string; rangeId?: string }) => Promise<MailResult<MailLiveData>>
    /**
     * Opt-in remote images: main fetches each URL without cookies or referrer
     * and returns data: URIs keyed by the ORIGINAL url from the markup.
     *
     * The reader cannot load them itself — its srcdoc document inherits the
     * app-wide CSP, which has no `https:` in img-src, and an inherited policy
     * can only be narrowed by the inner one, never widened.
     */
    remoteImages: (urls: string[]) => Promise<MailResult<MailRemoteImages>>
    /**
     * Build an email from a spreadsheet.
     *
     * The agent runs without tools, so main extracts the sheet and puts it in
     * the prompt — the model only ever sees the file the user picked. Every
     * figure it writes must come from that data.
     */
    draftFromFile: (payload: {
      filePath: string
      intent: 'summary' | 'executive' | 'visualize' | 'digest'
      instruction?: string
    }) => Promise<MailResult<MailDraftFromFile>>
    /** Native picker; resolves to null when the user cancels. */
    pickWorkbook: () => Promise<MailResult<string | null>>
  }
  /** Brand kit — the user's brand (palette/fonts/logo/voice). NOT secret. */
  brand: {
    get: () => Promise<Brand>
    set: (patch: BrandPatch) => Promise<Brand>
    /** Copy a logo into userData/brand/; `content` is base64 of the file bytes. */
    setLogo: (payload: { filename: string; content: string }) => Promise<Brand>
  }
  /**
   * Connected Accounts — the user signs into a website ONCE by hand in the in-app
   * browser; we manage only the SESSION lifecycle + a non-secret record per site.
   * NO password/credential ever crosses this boundary. `hasSession` is a presence
   * heuristic (cookies exist for the domain), never their contents.
   */
  /** Google Drive — one connection. Connect opens the SYSTEM browser (mirrors src/main/handlers/drive.ts). */
  drive: {
    connection: () => Promise<{
      connection: { email: string; access: 'readOnly' | 'full' | 'appFiles'; connectedAt: string } | null
      canWrite: boolean
      clientIdConfigured: boolean
    }>
    connect: (access: 'readOnly' | 'full' | 'appFiles') => Promise<
      | { ok: true; value: { connection: { email: string; access: 'readOnly' | 'full' | 'appFiles'; connectedAt: string }; canWrite: boolean } }
      | { ok: false; error: { message: string } }
    >
    disconnect: () => Promise<{ ok: true }>
  }
  /** Needs-you notifications (local). Prefs live in main so it can decide with no window open. */
  notify: {
    prefs: () => Promise<{ approvals: boolean; routines: boolean; cases: boolean; connectors: boolean; supported: boolean }>
    setPrefs: (next: { approvals?: boolean; routines?: boolean; cases?: boolean; connectors?: boolean }) => Promise<{ approvals: boolean; routines: boolean; cases: boolean; connectors: boolean }>
    request: (event: { source: 'approvals' | 'routines' | 'cases' | 'connectors' | 'test'; key: string; title: string; body?: string; rail?: 'agents' | 'cockpit' | 'connectors' }) => Promise<{ result: 'show' | 'off' | 'throttled' | 'unsupported' }>
    recent: () => Promise<{ at: number; decision: string; event: { source: string; key: string; title: string; body: string; rail: string } }[]>
    onOpen: (callback: (target: { rail: string; key: string; source: string }) => void) => () => void
  }
  /** Routines — agents on the app's clock; each fire is a background run. */
  routines: {
    list: () => Promise<Routine[]>
    save: (input: { id?: string; name: string; prompt: string; schedule: string; agentName?: string | null; enabled?: boolean; capabilities?: string[] }) => Promise<Routine>
    delete: (id: string) => Promise<{ ok: boolean }>
    runNow: (id: string) => Promise<{ ok: true; jobId: string } | { ok: false; error: string }>
    describe: (schedule: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
    onUpdated: (callback: (routines: Routine[]) => void) => () => void
  }
  /** Background runs — main-owned, survive the window; stream rides agent.* by job id. */
  runs: {
    enqueue: (input: { prompt: string; label?: string; agentName?: string | null; origin?: 'routine' | 'background'; contextFiles?: string[] }) => Promise<BackgroundJob>
    list: () => Promise<BackgroundJob[]>
    cancel: (id: string) => Promise<{ ok: boolean }>
    onUpdated: (callback: (job: BackgroundJob) => void) => () => void
  }
  /** One roster over every store, status computed (probes cached 10 min; `force` re-probes). */
  connections: {
    list: (opts?: { force?: boolean }) => Promise<Connection[]>
    /** Sign out of one connection by id; routed to the owning store. */
    signout: (id: string) => Promise<{ ok: true }>
  }
  accounts: {
    /** Recorded entries + a live `hasSession` flag per domain. */
    list: () => Promise<ConnectedAccountView[]>
    /** Record intent for a site (domain normalized). Does NOT log in. */
    add: (url: string) => Promise<ConnectedAccountView>
    /** Clear that site's session data from the partition + drop the entry. */
    signout: (domain: string) => Promise<{ ok: boolean }>
  }
  agents: {
    list: () => Promise<{ name: string; description: string; scope: 'global' | 'project'; mode?: 'full' | 'safe'; capabilities?: string[]; surface?: string; model?: string }[]>
    read: (name: string, scope?: 'global' | 'project') => Promise<{ name: string; description: string; scope: 'global' | 'project'; mode?: 'full' | 'safe'; persona: string; skills: string[]; capabilities?: string[]; surface?: string; model?: string }>
    write: (payload: { name: string; model?: string; description?: string; persona?: string; mode?: 'full' | 'safe'; skills?: string[]; capabilities?: string[]; surface?: string; scope?: 'global' | 'project' }) => Promise<{ name: string; path: string; scope: 'global' | 'project' }>
    delete: (name: string, scope?: 'global' | 'project') => Promise<void>
    /** Agent Foundry: the capability palette a specialist can be given. */
    capabilities: () => Promise<{ id: string; label: string; description: string; surface: string; actions: string[]; toolMode: 'safe' | 'full' }[]>
    /**
     * Agent Foundry: forge an agent spec from a plain-language description.
     * Returns a PROPOSAL — preview it, then call `write` to persist on approval.
     */
    build: (description: string) => Promise<{
      ok: boolean
      spec?: { name: string; description: string; persona: string; capabilities: string[]; surface?: string; mode: 'safe' | 'full' }
      error?: string
    }>
  }
  checkpoint: {
    list: () => Promise<Checkpoint[]>
    rollback: (id: string) => Promise<Checkpoint>
    diff: (id: string) => Promise<string>
  }
  snapshots: {
    list: () => Promise<WorkspaceSnapshot[]>
    save: (name: string, state: SnapshotState) => Promise<WorkspaceSnapshot>
    delete: (id: string) => Promise<void>
  }
  trash: {
    list: () => Promise<TrashEntry[]>
    restore: (id: string) => Promise<void>
    delete: (id: string) => Promise<void>
    empty: () => Promise<void>
  }
  office: {
    print: (filePath: string) => Promise<void>
    available: () => Promise<boolean>
    toPdf: (filePath: string) => Promise<Uint8Array>
    exportPdf: (filePath: string) => Promise<string | null>
  }
  lok: {
    available: () => Promise<boolean>
    open: (filePath: string) => Promise<{ ok: boolean; type?: number; parts?: number; cur?: number; names?: string[]; w?: number; h?: number; err?: string }>
    newDoc: (ext: string, fileName: string) => Promise<{ ok: boolean; path?: string; type?: number; w?: number; h?: number; err?: string }>
    tile: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) => Promise<{ cw: number; ch: number; bgra: Uint8Array }>
    /** Batched tiles: one IPC + one engine round-trip for a whole repaint (order matches the request). */
    tiles: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[]) => Promise<{ cw: number; ch: number; bgra: Uint8Array }[]>
    partTile: (args: { part: number; cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) => Promise<{ cw: number; ch: number; bgra: Uint8Array }>
    key: (type: number, charCode: number, keyCode: number) => Promise<boolean>
    mouse: (args: { type: number; x: number; y: number; count: number; buttons: number; modifier: number }) => Promise<boolean>
    uno: (command: string) => Promise<boolean>
    insertImage: () => Promise<boolean>
    imageShape: () => Promise<boolean>
    pickImage: () => Promise<string | null>
    setBorder: (preset: string, color: number, width: number) => Promise<boolean>
    sheetGeometry: () => Promise<SheetGeometry | null>
    setSize: (kind: 'col' | 'row', index: number, size: number) => Promise<boolean>
    macro: (name: string, args: string) => Promise<boolean>
    /** Find/replace in the OPEN Writer/Calc doc via the model search API. Returns
     *  the match/replace count (>=0), or -1 when the doc type is unsupported. */
    findReplace: (args: {
      mode: 'findnext' | 'findprev' | 'replaceall'
      find: string
      replace?: string
      caseSensitive?: boolean
      wholeWord?: boolean
      regex?: boolean
    }) => Promise<{ ok: boolean; count: number }>
    /** Stamp a grid into the OPEN Calc doc as a block anchored at `cell`. */
    setRangeBlock: (args: { sheet: string; cell: string; values: RangeGrid }) => Promise<boolean>
    /** Insert/update a range grid as a real TABLE in the OPEN Writer/Impress doc. */
    setTable: (args: {
      macro: 'WosInsertDocTable' | 'WosSetDocTable' | 'WosInsertSlideTable' | 'WosSetSlideTable'
      tag: string
      values: RangeGrid
    }) => Promise<boolean>
    selInfo: () => Promise<{ name: string; w: number; h: number; fill: number; text: string } | null>
    /** Per-part visibility (Calc sheets / Impress slides), index-aligned with parts(). */
    partInfo: () => Promise<{ visible: boolean[] }>
    /** Allowlisted getCommandValues (ViewAnnotations, AcceptTrackedChanges, TrackedChangeAuthors), parsed. */
    commandValues: (command: string) => Promise<unknown>
    /** Writer: page / pages / words / characters (null for other apps). */
    docStatus: () => Promise<{ page: number; pages: number; words: number; chars: number } | null>
    /** Bounds (1/100 mm) of the shape the last WosShapeInsert placed. */
    lastShape: () => Promise<{ x: number; y: number; w: number; h: number } | null>
    /** Impress slide transitions: 'set|idx|type|subtype|dur|change|advance|all' or 'info'; raw = one line per slide. */
    transition: (args: string) => Promise<{ raw: string }>
    /** Impress animations: 'add|preset|nodeType' · 'remove|i' · 'clear' · 'order|i:nt,…' · 'timing|i|dur|delay' · 'info'. */
    animate: (args: string) => Promise<{ raw: string }>
    /** Allowlisted read-mostly office macros (WosOutline, WosShapeRects, WosTableGeom, WosSlideText, WosRulerInfo, WosParaFmt, WosPageMargins); raw = the macro's output text. */
    officeMacro: (name: string, args: string) => Promise<{ raw: string }>
    getNotes: (index?: number) => Promise<{ text: string } | null>
    setNotes: (index: number, text: string) => Promise<boolean>
    capture: () => Promise<{ w: number; h: number; elements: string[] } | null>
    buildCaptured: (elements: string[]) => Promise<boolean>
    setPart: (n: number) => Promise<{ ok: boolean; cur: number; w: number; h: number }>
    parts: () => Promise<{ parts: number; cur: number; names: string[] }>
    save: () => Promise<boolean>
    exportAs: (format: string) => Promise<{ ok: boolean; path?: string }>
    /** Whole deck as one SVG (Impress only; null otherwise) — vector rendering. */
    slidesSvg: () => Promise<string | null>
    print: (filePath: string) => Promise<boolean>
    fileInfo: () => Promise<{ name: string; bytes: number; modified: number } | null>
    windowPaint: (args: { id: number; w: number; h: number }) => Promise<{ cw: number; ch: number; bgra: Uint8Array }>
    windowMouse: (args: { id: number; type: number; x: number; y: number; count: number; buttons: number; modifier: number }) => Promise<boolean>
    windowKey: (args: { id: number; type: number; charCode: number; keyCode: number }) => Promise<boolean>
    /** A JSDialog widget event: control id, action (click/change/selected/…), widget type, optional data. */
    dialogEvent: (args: { id: number; control: string; cmd: string; type: string; data?: string }) => Promise<boolean>
    windowClose: (id: number) => Promise<boolean>
    close: () => Promise<boolean>
    onCallback: (callback: (cb: { type: number; payload: string }) => void) => () => void
  }
  canvas: {
    exportPptx: (arg: {
      targetPath: string
      images: { png: Uint8Array; title?: string }[]
    }) => Promise<{ ok: boolean; path: string; slides: number }>
    frameToSlide: (arg: {
      payload: string
      fallbackImages: { png: Uint8Array }[]
    }) => Promise<{ ok: boolean; slide: number; native: number; images: number }>
  }
  menu: {
    setActions: (items: { id: string; label: string }[]) => Promise<void>
    setAgentMenu: (data: { agents: { id: string; label: string }[]; skills: { id: string; label: string }[]; mode: 'full' | 'safe'; activeAgent: string | null }) => Promise<void>
    setOfficeContext: (data: { type: number | null; parts?: string[] }) => Promise<void>
    /** Engine state for the office menu bar: which toggles are on, which commands are greyed. */
    setOfficeState: (data: { checked: Record<string, boolean>; disabled: string[] }) => Promise<void>
    /** The office menu bar's commands for the palette (empty when no document is active). */
    officeCommands: () => Promise<{ id: string; label: string; path: string; accel?: string }[]>
    /** Run a menu action id exactly as a menu click would. */
    runAction: (id: string) => Promise<void>
    /**
     * Push what the browser surface is currently offering, so the native
     * History/View menus are built from the same actions the in-window panel
     * shows. `null` when leaving the surface — the menus disappear rather than
     * lingering as dead entries.
     */
    setBrowserContext: (
      data: {
        actions: { id: string; label: string; shortcut?: string; relevance: number }[]
        canGoBack: boolean
        canGoForward: boolean
      } | null,
    ) => Promise<void>
    onRunAction: (callback: (actionId: string) => void) => () => void
  }
  window: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
  }
  /** Cases — the thread of work that binds a subject, its documents and its notes. */
  cases: {
    list: () => Promise<WorkCase[]>
    get: (id: string) => Promise<WorkCase | null>
    statuses: (type?: string) => Promise<string[]>
    create: (payload: { title: string; type?: string; description?: string; subject?: string; artifacts?: string[] }) => Promise<WorkCase>
    setStatus: (id: string, status: string) => Promise<WorkCase>
    /** Returns the saved case plus what the note implies — suggestions only. */
    addNote: (id: string, text: string, author?: 'you' | 'agent') => Promise<WorkCase & { signals?: NoteSignal[] }>
    addArtifact: (id: string, filePath: string) => Promise<WorkCase>
    setDescription: (id: string, description: string) => Promise<WorkCase>
    markActed: (id: string, signal: NoteSignal) => Promise<WorkCase>
    setScope: (id: string, scope: 'workspace' | 'global') => Promise<WorkCase>
    /** The statuses that END a case — one list, shared by every surface. */
    terminalStatuses: () => Promise<string[]>
    asContext: (id: string) => Promise<string>
    nextStatus: (type: string, current: string) => Promise<string | null>
    insights: (id: string) => Promise<ArtifactInsight[]>
    view: (id: string) => Promise<CaseViewResult | null>
    artifactUrl: (rel: string) => Promise<string | null>
    authorizeArtifact: (id: string, rel: string) => Promise<string | null>
  }

  browserTabs: {
    /** Main asks the Browser surface to open a url in a NEW tab (WOS-007). */
    onOpenTab: (callback: (payload: { url: string; referrer?: string }) => void) => () => void
  }

  /**
   * In-app bug reporter. Reports are analyzed READ-ONLY and appended to
   * `docs/BUGS.md` in the Workspace-OS development repo — never to the user's
   * open workspace, and never acted on from inside the app.
   */
  bugs: {
    /** Where reports will land, and how many are already filed. */
    status: () => Promise<{ repoRoot: string | null; logPath: string | null; count: number }>
    /** Point the reporter at the Workspace-OS repo (validated before storing). */
    setRepo: (dir: string) => Promise<{ ok: boolean; repoRoot: string }>
    /** Everything the app knows right now — shown before filing, never hidden. */
    context: (surface: string | null, openFile: string | null) => Promise<BugContext>
    /** Structure the report. Returns a PROPOSAL for the user to correct. */
    analyze: (
      text: string,
      surface: string | null,
      openFile: string | null,
      /** 'idea' analyses against the roadmap rule instead of hunting a defect. */
      kind?: 'bug' | 'idea',
    ) => Promise<{ ok: boolean; analysis?: BugAnalysis; error?: string; context: BugContext }>
    /** Append it. `analysis` may be null — a failed analysis never loses a report. */
    file: (
      text: string,
      analysis: BugAnalysis | null,
      context: BugContext,
      /** 'idea' files to docs/IDEAS.md with an IDEA- id; 'bug' to docs/BUGS.md. */
      kind?: 'bug' | 'idea',
    ) => Promise<{ ok: boolean; id: string; duplicate: boolean; logPath: string }>
    list: () => Promise<{ id: string; title: string; seen: number }[]>
  }

  updater: {
    /** Trigger a manual "Check for Updates…" (also on the app menu). */
    check: () => Promise<void>
    /** Restart and install a downloaded update. */
    install: () => Promise<void>
    /** Fires when an update has finished downloading and is ready to install. */
    onUpdateReady: (callback: (info: { version: string }) => void) => () => void
  }
}

/** Raw .uno:SheetGeometryData — column/row sizes as run-length strings
 *  ("size:lastIndex size:lastIndex …", sizes in twips). */
export interface SheetGeometry {
  commandName: string
  maxtiledcolumn?: string
  maxtiledrow?: string
  columns?: { sizes?: string; hidden?: string; groups?: string }
  rows?: { sizes?: string; hidden?: string; groups?: string }
}

/** One classified file produced by an agent run (mirror of src/main/artifacts.ts). */
export type ArtifactType = 'office' | 'page' | 'image' | 'code' | 'data' | 'diff' | 'other'
export interface RunArtifact {
  path: string
  name: string
  type: ArtifactType
}

export interface Component {
  id: string
  name: string
  type: 'shape' | 'card' | 'media' | 'captured' | 'block' | 'range'
  blockKind: 'heading' | 'callout' | 'signature' | 'quote'
  rangeKind: 'kpi' | 'header' | 'table'
  variants: { name: string; fill: number; fontColor: number }[]
  base: 'rect' | 'roundrect' | 'ellipse' | 'text'
  fill: number
  fillKind: 'solid' | 'gradient' | 'pattern'
  gradTo: number
  line: number
  lineWidth: number
  dash: 'solid' | 'dashed' | 'dotted' | 'dashdot'
  fontColor: number
  text: string
  body: string
  image: string
  w: number
  h: number
  elements?: string[]
}

export interface Checkpoint {
  id: string
  label: string
  createdAt: number
}

/** UI state captured by a workspace snapshot (mirror of src/main/snapshots.ts). */
export interface SnapshotState {
  files: string[]
  activeFile: string | null
  sidebarView: 'files' | 'search' | 'memory' | 'knowledge' | 'review' | 'mail'
  sidebarOpen: boolean
  terminalOpen: boolean
  panel: { filePanel: number; terminal: number } | null
}

export interface WorkspaceSnapshot {
  id: string
  name: string
  root: string
  createdAt: number
  state: SnapshotState
}

/** Where a metric's value ORIGINATES. Mirrors src/main/metrics.ts. */
export type MetricSource =
  | { kind: 'literal' }
  | { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string }

/** A named source-of-truth value (live-transclusion). Mirrors src/main/metrics.ts. */
export interface Metric {
  id: string
  name: string
  value: number
  updatedAt: number
  /** Absent = literal (hand-typed). Present = the value's live origin. */
  source?: MetricSource
}

/** Outcome of refreshing a sourced metric (metric:refreshFromSource). */
export interface MetricRefreshResult {
  id: string
  status: 'literal' | 'stale' | 'unchanged' | 'updated'
  /** True when the last read failed and the cached value was kept. */
  stale: boolean
  metric: Metric
}

/** Where a metric's value is written inside a file. Mirrors src/main/transclusions.ts. */
export type LinkTarget =
  | { kind: 'xlsx-cell'; sheet: string; cell: string }
  | { kind: 'docx-cc'; tag: string }
  | { kind: 'pptx-shape'; tag: string; slide?: number }

/** A live link binding a metric to one anchor. Mirrors src/main/transclusions.ts. */
export interface TransclusionLink {
  id: string
  metricId: string
  filePath: string
  target: LinkTarget
  lastValue: number
}

/** Dry-run impact of sync-all (transclusion:previewSyncAll). */
export interface SyncAllPreview {
  value: number
  /** Closed-file anchors that WOULD change (open file + in-sync links excluded). */
  willUpdate: { file: string; label: string; from: number }[]
  /** Count of links already in sync (no write needed). */
  unchanged: number
  /** Count of links in the currently-open file (handled live, not by the writer). */
  openSkipped: number
}

/** Outcome of an applied sync-all (transclusion:syncAll). */
export interface SyncAllResult {
  updated: { file: string; label: string }[]
  skipped: { file: string; label: string; reason: string }[]
}

/** One cell of a live range. Mirrors src/main/ranges.ts. */
export type RangeCell = number | string | null
/** A rectangular grid of cells (every row the same length). */
export type RangeGrid = RangeCell[][]

/** Where a range's grid ORIGINATES. Mirrors src/main/ranges.ts. */
export type RangeSource = { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string }

/** A named source-of-truth grid (live ranges). Mirrors src/main/ranges.ts. */
export interface LiveRange {
  id: string
  name: string
  values: RangeGrid
  updatedAt: number
  /** Absent = literal grid. Present = the grid's live origin. */
  source?: RangeSource
}

/** Outcome of refreshing a sourced range (range:refreshFromSource). */
export interface RangeRefreshResult {
  id: string
  status: 'literal' | 'stale' | 'unchanged' | 'updated'
  /** True when the last read failed and the cached grid was kept. */
  stale: boolean
  range: LiveRange
}

/** Where a range's grid is written inside a file. Mirrors src/main/rangeLinks.ts. */
export type RangeLinkTarget =
  | { kind: 'xlsx-block'; sheet: string; cell: string }
  | { kind: 'docx-table'; tag: string }
  | { kind: 'pptx-table'; tag: string; slide?: number }

/** A live link binding a range to one block anchor. Mirrors src/main/rangeLinks.ts. */
export interface RangeLink {
  id: string
  rangeId: string
  filePath: string
  target: RangeLinkTarget
  lastValues: RangeGrid
}

/** Dry-run impact of range sync-all (rangeLink:previewSyncAll). */
export interface RangeSyncAllPreview {
  willUpdate: { file: string; label: string }[]
  unchanged: number
  openSkipped: number
}

/** Outcome of an applied range sync-all (rangeLink:syncAll). */
export interface RangeSyncAllResult {
  updated: { file: string; label: string }[]
  skipped: { file: string; label: string; reason: string }[]
}

/** One record cell value (mirrors src/main/collections.ts). */
export type FieldValue = number | string | null
/** One record: field name → value. */
export type CollectionRecord = Record<string, FieldValue>

/** Where a collection's records ORIGINATE. Mirrors src/main/collections.ts. */
export type CollectionSource =
  | { kind: 'literal' }
  | { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string }

/** A named source-of-truth typed record set. Mirrors src/main/collections.ts. */
export interface Collection {
  id: string
  name: string
  /** The schema — field names, in source-column order. */
  fields: string[]
  records: CollectionRecord[]
  updatedAt: number
  /** Absent = literal set. Present = the records' live origin. */
  source?: CollectionSource
}

/** Outcome of refreshing a sourced collection (collection:refresh). */
export interface CollectionRefreshResult {
  id: string
  status: 'literal' | 'stale' | 'unchanged' | 'updated'
  stale: boolean
  collection: Collection
}

/** One column of a link's field mapping. Mirrors src/main/collectionLinks.ts. */
export interface FieldColumn {
  field: string
  header: string
}

/** A filter/sort op for a live view. Mirrors src/main/collectionLinks.ts. */
export type ViewOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte'

export interface ViewFilter {
  field: string
  op: ViewOp
  value: string | number
}

export interface ViewSort {
  field: string
  dir: 'asc' | 'desc'
}

/** A live query over a collection's records (filter/sort/limit) applied before projection. */
export interface CollectionView {
  filters?: ViewFilter[]
  sort?: ViewSort[]
  limit?: number
}

/** Where a collection's rendered block is written inside a file. */
export type CollectionLinkTarget =
  | { kind: 'xlsx-block'; sheet: string; cell: string }
  | { kind: 'docx-table'; tag: string }
  | { kind: 'pptx-table'; tag: string; slide?: number }

/** One inline segment of a card line: a record field, or a literal string. */
export interface CardSegment {
  field?: string
  literal?: string
  bold?: boolean
}

/** One line of a card = one paragraph built from ordered inline segments. */
export interface CardLine {
  segments: CardSegment[]
}

/** The card/directory render model: N lines, each a paragraph of segments. */
export interface CardTemplate {
  lines: CardLine[]
}

/** How a link renders its records: a table grid, or a repeated card block. */
export type CollectionLayout = 'table' | 'cards'

/** A live link binding a collection to one block anchor via a field mapping. */
export interface CollectionLink {
  id: string
  collectionId: string
  filePath: string
  target: CollectionLinkTarget
  columns: FieldColumn[]
  view?: CollectionView
  lastGrid: RangeGrid
  layout?: CollectionLayout
  cardTemplate?: CardTemplate
}

/** Dry-run impact of collection sync-all (collectionLink:previewSyncAll). */
export interface CollectionSyncAllPreview {
  willUpdate: { file: string; label: string }[]
  unchanged: number
  openSkipped: number
}

/** Outcome of an applied collection sync-all (collectionLink:syncAll). */
export interface CollectionSyncAllResult {
  updated: { file: string; label: string }[]
  skipped: { file: string; label: string; reason: string }[]
}

export interface TrashEntry {
  id: string
  originalPath: string
  originalName: string
  op: 'delete' | 'overwrite'
  isDirectory: boolean
  trashedAt: number
  storedPath: string
}

export interface SearchResult {
  path: string
  name: string
  snippet: string
  matchType: 'filename' | 'content'
}

/** Insight category as stored by claude-pulse. */
export type PulseInsightType = 'progress' | 'decision' | 'pattern' | 'fix' | 'context' | 'blocked'

/** A prior cross-project insight surfaced from the local Pulse DB (read-only). */
export interface PulseInsight {
  id: number
  type: PulseInsightType
  text: string
  project: string
  timestamp: string
  reasoning: string | null
}

export type SymbolKind =
  | 'heading'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'method'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'module'

export interface SymbolResult {
  path: string
  name: string
  kind: SymbolKind
  line: number
}

// ── Knowledge base ([[wikilink]] backlinks graph). Mirror of src/main/search/index-db.ts. ──

/** A backlink: a note that links TO the queried file. */
export interface Backlink {
  path: string
  name: string
  snippet: string
  heading?: string
}

/** One outgoing link from a file — resolved to a real path, or a stub (null). */
export interface OutgoingLink {
  targetName: string
  heading?: string
  snippet: string
  resolvedPath: string | null
  ambiguous: boolean
}

/** A stub: a referenced note name that no file resolves to yet. */
export interface Stub {
  targetName: string
  refCount: number
}

/** One node in the knowledge graph — a note or a referenced-but-missing stub. */
export interface GraphNode {
  /** Stable id: the file path for notes, `stub:<key>` for stubs. */
  id: string
  name: string
  kind: 'note' | 'stub'
  /** In + out degree — drives node size. */
  degree: number
}

/** One directed edge — a resolved link (or link to a stub), with its multiplicity. */
export interface GraphEdge {
  source: string
  target: string
  count: number
}

/** The whole-workspace [[wikilink]] graph. Mirror of src/main/search/index-db.ts. */
export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** True when the node/edge cap clipped the result (graph is partial). */
  truncated: boolean
}

/** Why a note surfaced as related — the link-graph signals that scored it. */
export interface RelatedReasons {
  /** This note directly links the active file (or vice-versa). */
  direct?: boolean
  /** Count of shared outgoing targets (bibliographic coupling). */
  coupling?: number
  /** Count of shared citers (co-citation). */
  cocitation?: number
}

/** A note related to the active file by link-graph proximity. Mirror of related.ts. */
export interface RelatedNote {
  path: string
  name: string
  score: number
  reasons: RelatedReasons
}

// ── Mail (native IMAP client, Phase 1) — mirror of src/main/mail/*. ──────────

/** Non-secret account record. NOTE: no password field — secrets live encrypted
 *  in a separate keychain-backed store, never on this object. */
/** What kind of mail something is. Three, on purpose — see classify.ts. */
export type MailCategory = 'personal' | 'notification' | 'newsletter'

/** A batch of newsletters the app is offering to file. Nothing has moved. */
export interface NewsletterSweep {
  folder: string
  messages: { folder: string; uid: number; subject: string; fromName: string; fromAddress: string; date: number | null }[]
  senders: { label: string; address: string; count: number }[]
  /** Messages the index never looked at closely enough to judge. */
  unknown: number
  summary: string
}

/** A rule the person wrote to override how mail is sorted. */
export interface MailRule {
  id: string
  /** Substring of the sender address or name. */
  from?: string
  /** Sender domain, matching that domain or any subdomain. */
  domain?: string
  /** Substring of the subject. */
  subject?: string
  category: MailCategory
  enabled?: boolean
}

export interface MailAccount {
  id: string
  displayName: string
  user: string
  authKind: 'basic' | 'xoauth2' | 'demo'
  imap: { host: string; port: number; tls: boolean }
  smtp?: { host: string; port: number; tls: boolean } | null
  createdAt: number
  updatedAt: number
}

/** Form payload for add/test (non-secret; the password is a separate arg). */
export interface MailAccountFormInput {
  displayName: string
  user: string
  imap: { host: string; port: number; tls: boolean }
  smtp?: { host: string; port: number; tls: boolean } | null
}

/** Transport security for one server leg (implicit TLS vs STARTTLS). */
export type MailSecurity = 'ssl' | 'starttls'

/** One resolved server leg (IMAP or SMTP) from provider lookup / autoconfig. */
export interface MailProviderServer {
  host: string
  port: number
  security: MailSecurity
}

/** A resolved provider: both server legs + auth guidance. Mirror of providers.ts. */
export interface MailProviderInfo {
  id: string
  label: string
  imap: MailProviderServer
  smtp: MailProviderServer
  appPasswordRequired: boolean
  supportsOAuth: boolean
  authNote: string
  guessed: boolean
}

/** Autoconfig result: the resolved provider + where it came from. */
export interface MailAutoconfigResult {
  provider: MailProviderInfo
  source: 'table' | 'ispdb' | 'guess'
}

export interface MailAddress {
  name: string
  address: string
}

export interface MailAttachmentMeta {
  filename: string
  contentType: string
  size: number
  cid?: string
  inline: boolean
}

export interface MailFolder {
  path: string
  name: string
  specialUse?: string
  subscribed: boolean
  selectable: boolean
}

/** A journalled mailbox action — everything mutating returns one. */
export interface MailActionRecord {
  id: number
  at: number
  kind: 'move' | 'markRead' | 'markUnread' | 'flag' | 'unflag'
  messageId: string
  fromFolder: string
  toFolder: string | null
}

/** One entry in the undo stack, with a plain-language description. */
export interface UndoEntry {
  id: number
  at: number
  description: string
}

/** A proposed filing plan — reviewed by a human before anything moves. */
export interface MailFilingPlan {
  windowDays: 7 | 30 | 90
  folders: {
    name: string
    reason: string
    messages: { uid: number; folder: string; subject: string; fromAddress: string }[]
  }[]
  skipped: { count: number; reasons: Record<string, number> }
}

/** One row from the LOCAL mail index (list views never carry the body). */
export interface IndexedMailRow {
  accountId: string
  folder: string
  uid: number
  threadId: string
  subject: string
  fromName: string
  fromAddress: string
  date: number | null
  seen: boolean
  hasAttachments: boolean
  snippet: string
}

/** What a folder sync did. */
export interface MailSyncReport {
  indexed: number
  pruned: number
  deepened: number
  remaining: number
}

export interface MessageSummary {
  uid: number
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  date: string | null
  flags: string[]
  seen: boolean
  hasAttachments: boolean
  snippet: string
}

export interface FullMessage {
  uid: number
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  date: string | null
  messageId: string | null
  text: string
  html: string
  hasBlockedRemoteContent: boolean
  attachments: MailAttachmentMeta[]
  flags: string[]
  seen: boolean
}

export type MailErrorCode =
  | 'auth' | 'tls' | 'host' | 'timeout' | 'not-found' | 'unavailable' | 'unknown'

export interface MailError {
  code: MailErrorCode
  message: string
}

/** Discriminated result — nothing throws raw across IPC. */
export type MailResult<T> = { ok: true; value: T } | { ok: false; error: MailError }

// ── Outgoing mail (Phase 2: compose / reply / forward / send). ──────────────

export interface MailOutAddress {
  name?: string
  address: string
}

/** An attachment to send; `content` is base64-encoded raw bytes across IPC. */
export interface MailDraftAttachment {
  filename: string
  contentType?: string
  content: string
  /** Content-ID for an inline image the html references as `cid:<cid>`. */
  cid?: string
}

/** A renderer-authored draft. Threading is derived from context, not crafted here. */
export interface MailDraft {
  to: MailOutAddress[]
  cc?: MailOutAddress[]
  bcc?: MailOutAddress[]
  subject: string
  text: string
  html?: string
  attachments?: MailDraftAttachment[]
}

/** How a draft relates to an existing message (drives headers + quoting). */
export type MailComposeContext =
  | { kind: 'new' }
  | { kind: 'reply'; source: FullMessage; replyAll?: boolean }
  | { kind: 'forward'; source: FullMessage }

export interface MailSendResult {
  messageId: string
  accepted: string[]
  rejected: string[]
}

// ── Advanced 1:1 email (theme + blocks + live data). Mirror of rich-email/*. ──

/** One MJML validation/compile problem (already sanitized — no filesystem path). */
export interface MjmlError {
  message: string
  line?: number
  tagName?: string
}

/** A liveness token left as a visible placeholder (unknown/unreadable metric). */
export interface EmailUnresolvedToken {
  token: string
  id: string
  reason: 'unknown' | 'unreadable'
}

/** A design theme id. `clean` is the default; `brand` derives from the Brand kit. */
export type EmailThemeId = 'clean' | 'editorial' | 'compact' | 'brand'

/** The Brand kit — codified once, flowed into agent-generated output. NOT secret. */
export interface Brand {
  name: string
  tagline?: string
  palette: { primary: string; accent: string; background: string; text: string; muted: string }
  fonts: { heading: string; body: string }
  logoPath?: string
  voice?: string
  approvedImages?: string[]
}

/** A partial brand update; nested palette/fonts merge field-by-field. */
export interface BrandPatch {
  name?: string
  tagline?: string
  palette?: Partial<Brand['palette']>
  fonts?: Partial<Brand['fonts']>
  voice?: string
  approvedImages?: string[]
  /** Pass null to clear the logo; omit to leave it as-is. */
  logoPath?: string | null
}

/** One entry in a case's note stream. */
export interface CaseNote {
  at: string
  author: 'you' | 'agent'
  text: string
}

/** A thread of work: its subject, the documents made for it, its status, its notes. */
export interface WorkCase {
  id: string
  /** Where it lives: 'workspace' (the open folder) or 'global' (everywhere). */
  scope?: 'workspace' | 'global'
  type: string
  title: string
  /** One line saying what this is — a title says what it is called, not what it is. */
  description: string
  subject: string
  status: string
  artifacts: string[]
  notes: CaseNote[]
  /** Offers already taken up, as `kind:value`. */
  acted: string[]
  /** What this case is still asking for; filled in by `cases.list`. */
  signals?: NoteSignal[]
  created: string
  updated: string
}

/** What a note implies — offered to the user, never run automatically. */
export interface NoteSignal {
  kind: 'research-person' | 'prepare-interview' | 'schedule'
  label: string
  value: string
}

/** The assist actions the rich compose offers. */
export type EmailAssistAction = 'draft' | 'tighten' | 'clearer' | 'warmer' | 'add-numbers'

/** One structured, drop-in block the user assembles in rich compose. */
export type EmailBlock =
  | { kind: 'text'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'divider' }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'metric'; label: string; value: string }
  | { kind: 'cta'; label: string; href: string }
  | { kind: 'hosted-link'; label: string; target: string }
  /**
   * A horizontal bar chart, drawn with table cells rather than an image —
   * Gmail and Outlook strip `data:` images, so a rendered PNG would vanish for
   * most recipients. `value` drives the bar, `display` is the label beside it.
   */
  | { kind: 'chart'; title?: string; bars: { label: string; value: number; display?: string }[] }
  /**
   * An inline image. The html references `cid:<cid>` (the mechanism clients
   * actually render); `data`/`contentType` hold the bytes RENDERER-SIDE only —
   * the preview substitutes a data: URI, send attaches them as an inline CID
   * attachment, and the per-keystroke build IPC carries just the reference.
   */
  | { kind: 'image'; cid: string; alt: string; data: string; contentType: string }

/** A rich email assembled from a theme + blocks: HTML + plain-text fallback. */
export interface BuiltRichEmail {
  mjml: string
  html: string
  text: string
  errors: MjmlError[]
  unresolvedTokens: EmailUnresolvedToken[]
}

/** A rich email drafted from a one-line brief — MJML, HTML, subject, problems. */
export interface DraftedRichEmail {
  mjml: string
  html: string
  subject: string
  errors: MjmlError[]
  unresolvedTokens: EmailUnresolvedToken[]
}

/** The live-data picker payload: available metrics + ranges, or a drop-in block. */
/** Blocks the agent authored from a spreadsheet, ready to drop into compose. */
export interface MailDraftFromFile {
  blocks: EmailBlock[]
  /** Which sheets were read — shown so the sender can see what it looked at. */
  sheetNames: string[]
  /** True when the workbook was larger than the extractor's caps. */
  truncated: boolean
}

/** Result of an opt-in remote-image load. Misses are simply absent from `images`. */
export interface MailRemoteImages {
  /** Original URL from the markup → data: URI. */
  images: Record<string, string>
  requested: number
  loaded: number
  failed: number
}

export interface MailLiveData {
  metrics?: { id: string; name: string; value: number }[]
  ranges?: { id: string; name: string; rows: number; cols: number }[]
  block?: EmailBlock
}

// ── Mail (Phase 3: triage + agent-drafted replies in the Living Feed). ──────

/** One sift verdict (mirror of sift.ts): where a new mail lands and why. */
interface MailSiftVerdict {
  uid: number
  folder: string
  zone: 'answer' | 'case' | 'glance' | 'noise'
  /** 0 (ignorable) … 3 (urgent). */
  priority: number
  /** One plain-language line: what this mail is about / wants from you. */
  summary: string
  /** The open case it belongs to — only when zone is 'case'. */
  caseTitle: string | null
  /** The concrete next step ("Reply with your availability"), or null. */
  todo: string | null
  /** ISO date (YYYY-MM-DD) the mail names as a deadline/event, or null. */
  due: string | null
  fromName: string
  fromAddress: string
  subject: string
  /** Epoch ms, or null when the server gave no parseable date. */
  date: number | null
  /** Null on index rows never deepened — actions needing it must skip then. */
  messageId: string | null
}

/** One inbox message that plausibly needs a human reply (mirror of triage.ts). */
export interface MailNeedsReply {
  uid: number
  folder: string
  subject: string
  from: MailAddress | null
  /** 0..100 — higher = more likely to genuinely need a reply. */
  score: number
  reason: string
  hasQuestion: boolean
}

/** A fully-specified outgoing message (mirror of main's OutgoingMessage). */
export interface MailOutgoingMessage {
  from: MailOutAddress
  to: MailOutAddress[]
  cc?: MailOutAddress[]
  bcc?: MailOutAddress[]
  subject: string
  text: string
  html?: string
  inReplyTo?: string
  references?: string[]
}

/** The result of drafting a reply — envelope + agent body, NOT yet sent. */
export interface MailDraftedReply {
  envelope: MailOutgoingMessage
  suggestedBody: string
  sourceMessageId: string | null
  replyAll: boolean
}

/** One page in the browsing history (a bookmark is one with starred: true). */
export interface HistoryEntry {
  url: string
  title: string
  favicon: string
  lastVisited: number
  visitCount: number
  starred: boolean
  snippet: string
}

/** One omnibox suggestion, ranked by frecency. */
export interface HistorySuggestion {
  url: string
  title: string
  favicon: string
  starred: boolean
  score: number
  kind: 'bookmark' | 'history'
}

declare global {
  interface Window {
    workspace: WorkspaceApi
  }
}

/** Machine-gathered facts attached to a bug report. */
export interface BugContext {
  appVersion: string
  commit: string | null
  surface: string | null
  openFile: string | null
  os: string
  recentErrors: string[]
}

/** Claude's structured interpretation of a report — a proposal, always correctable. */
export interface BugAnalysis {
  title: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  surface: string
  whatHappened: string
  expected: string
  steps: string[]
  suspects: { path: string; why: string }[]
  duplicateOf: string | null
  localized: boolean
  /** Ideas only — roadmap-rule judgement and the honest objection (WOS-010). */
  verdict?: string
}
