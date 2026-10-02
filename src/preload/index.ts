import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../main/ipc-channels'
import type { AgentRunFailure } from '../shared/agentRun'

/**
 * Exposes a strictly-typed, minimal API to the renderer.
 * The renderer has zero Node.js access — everything goes through these validated channels.
 */
contextBridge.exposeInMainWorld('workspace', {
  print: {
    document: (title: string, html: string) => ipcRenderer.invoke('print:document', title, html),
  },
  pdf: {
    print: (filePath: string, annotations: unknown) => ipcRenderer.invoke('pdf:print', filePath, annotations),
    readAnnotations: (filePath: string) => ipcRenderer.invoke('pdf:annotations:read', filePath),
    writeAnnotations: (filePath: string, doc: unknown) => ipcRenderer.invoke('pdf:annotations:write', filePath, doc),
    exportAnnotated: (filePath: string, annotations: unknown, inPlace?: boolean) =>
      ipcRenderer.invoke('pdf:export', filePath, annotations, inPlace === true),
    reorderPages: (filePath: string, order: number[]) => ipcRenderer.invoke('pdf:pages:reorder', filePath, order),
    rotatePage: (filePath: string, page: number, delta: number) => ipcRenderer.invoke('pdf:pages:rotate', filePath, page, delta),
    readForm: (filePath: string) => ipcRenderer.invoke('pdf:form:read', filePath),
    fillForm: (filePath: string, values: Record<string, string>) => ipcRenderer.invoke('pdf:form:fill', filePath, values),
    sign: (filePath: string, pngBase64: string, page: number, rect: { x: number; y: number; w: number; h: number }) =>
      ipcRenderer.invoke('pdf:sign', filePath, pngBase64, page, rect),
  },
  /**
   * Google Drive, over the API. The in-app browser cannot sign into Google —
   * this connects through the SYSTEM browser instead, which is what Google
   * asks desktop apps to do.
   */
  drive: {
    connection: () => ipcRenderer.invoke('drive:connection'),
    connect: (access: 'readOnly' | 'full' | 'appFiles') => ipcRenderer.invoke('drive:connect', access),
    disconnect: () => ipcRenderer.invoke('drive:disconnect'),
    list: (folderId?: string, pageToken?: string) => ipcRenderer.invoke('drive:list', folderId, pageToken),
    search: (query: string) => ipcRenderer.invoke('drive:search', query),
    /** Fetches into <workspace>/Drive and returns the local path. */
    open: (fileId: string) => ipcRenderer.invoke('drive:open', fileId),
    save: (fileId: string, localPath: string) => ipcRenderer.invoke('drive:save', fileId, localPath),
  },
  calendar: {
    sources: () => ipcRenderer.invoke('calendar:sources'),
    test: (input: unknown) => ipcRenderer.invoke('calendar:test', input),
    add: (input: unknown) => ipcRenderer.invoke('calendar:add', input),
    update: (id: string, patch: unknown) => ipcRenderer.invoke('calendar:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('calendar:remove', id),
    events: (from: number, to: number) => ipcRenderer.invoke('calendar:events', from, to),
    /** Create an event. Lands in the app's own local calendar, never a feed. */
    writeTargets: () => ipcRenderer.invoke('calendar:write-targets'),
    setDefaultTarget: (id: string | null) => ipcRenderer.invoke('calendar:set-default-target', id),
    createEvent: (input: {
      summary: string
      start: number
      end?: number
      allDay?: boolean
      location?: string
      description?: string
      /** Which calendar; omitted means the remembered one. */
      target?: string
      /** People the SERVER should invite. */
      attendees?: { email: string; name?: string }[]
    }) =>
      ipcRenderer.invoke('calendar:create-event', input),
    /** Edit an event where it lives — local file by uid, server event by its href.
     * For a recurring event, `scope` says which slice: one occurrence or the series. */
    updateEvent: (
      ref: { uid: string; sourceId?: string; href?: string; scope?: 'occurrence' | 'series'; occurrence?: number },
      changes: {
        summary: string; start: number; end: number; allDay?: boolean; location?: string; description?: string
        attendees?: { email: string; name?: string }[]
      },
    ) => ipcRenderer.invoke('calendar:update-event', ref, changes),
    removeEvent: (
      ref: string | { uid: string; sourceId?: string; href?: string; scope?: 'occurrence'; occurrence?: number },
    ) => ipcRenderer.invoke('calendar:remove-event', ref),
    connectOAuth: (provider: 'google' | 'microsoft', displayName: string) =>
      ipcRenderer.invoke('calendar:connect-oauth', provider, displayName),
  },
  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke(IPC.FS_READ_DIR, dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke(IPC.FS_READ_FILE, filePath),
    writeFile: (filePath: string, content: string) => ipcRenderer.invoke(IPC.FS_WRITE_FILE, filePath, content),
    delete: (filePath: string) => ipcRenderer.invoke(IPC.FS_DELETE, filePath),
    rename: (oldPath: string, newName: string) => ipcRenderer.invoke(IPC.FS_RENAME, oldPath, newName),
    create: (dirPath: string, name: string, isDirectory: boolean) =>
      ipcRenderer.invoke(IPC.FS_CREATE, dirPath, name, isDirectory),
    readFileBytes: (filePath: string) => ipcRenderer.invoke('fs:read-file-bytes', filePath),
    openFolderDialog: () => ipcRenderer.invoke('fs:open-folder-dialog'),
    saveCopyDialog: (srcPath: string) => ipcRenderer.invoke('fs:save-copy-dialog', srcPath),
    getWorkspaceRoot: () => ipcRenderer.invoke('workspace:get-root'),
    closeWorkspace: () => ipcRenderer.invoke('workspace:close'),
    listFiles: () => ipcRenderer.invoke('fs:list-files'),
    recentWorkspaces: () => ipcRenderer.invoke('workspace:recents'),
    openWorkspace: (dir: string) => ipcRenderer.invoke('workspace:open-recent', dir),
    onRootChanged: (callback: (root: string | null) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, root: string | null) => callback(root)
      ipcRenderer.on('workspace:root-changed', handler)
      return () => ipcRenderer.removeListener('workspace:root-changed', handler)
    },
    reveal: (filePath: string) => ipcRenderer.invoke('fs:reveal', filePath),
    watchStart: () => ipcRenderer.invoke(IPC.FS_WATCH_START),
    watchStop: () => ipcRenderer.invoke(IPC.FS_WATCH_STOP),
    onWatchEvent: (callback: (event: { event: string; path: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, data: { event: string; path: string }) => callback(data)
      ipcRenderer.on(IPC.FS_WATCH_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.FS_WATCH_EVENT, handler)
    },
  },

  shell: {
    spawn: (sessionId: string) => ipcRenderer.invoke(IPC.SHELL_SPAWN, sessionId),
    input: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.SHELL_INPUT, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.SHELL_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.SHELL_KILL, sessionId),
    onOutput: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string, data: string) =>
        callback(sessionId, data)
      ipcRenderer.on(IPC.SHELL_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.SHELL_OUTPUT, handler)
    },
  },

  // Integrated Terminal Dock — PTY host for the new shell (lazy-native, emits
  // an explicit exit). Separate from `shell` above so the legacy layout is
  // untouched. See main/terminal/ptyHost.ts + main/handlers/terminal.ts.
  terminal: {
    create: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_CREATE, sessionId),
    write: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.TERMINAL_WRITE, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.TERMINAL_KILL, sessionId),
    onData: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, data: string) =>
        callback(sessionId, data)
      ipcRenderer.on(IPC.TERMINAL_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, handler)
    },
    onExit: (callback: (sessionId: string, code: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, code: number) =>
        callback(sessionId, code)
      ipcRenderer.on(IPC.TERMINAL_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_EXIT, handler)
    },
  },

  // Live workspace harness — the renderer pushes root/surface/folder/open-file
  // as the user navigates; main merges it into the shared context.
  context: {
    set: (ctx: {
      root?: string | null
      surface?: string | null
      folder?: string | null
      openFile?: string | null
      browserUrl?: string | null
      browserTitle?: string | null
      actions?: { id: string; agentHint: string }[]
      allActionIds?: string[]
    }) => ipcRenderer.invoke(IPC.CONTEXT_SET, ctx),
  },

  // AGENT→ACTION bridge (renderer executor side). Main forwards an agent's
  // `wos-action run <id>` here (INVOKE); the app runs the SAME surfaceActions
  // registry a dock chip runs, then replies reqId-correlated (RESULT).
  agentActions: {
    onInvoke: (callback: (payload: { reqId: string; actionId: string; args?: unknown; runId?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, payload: { reqId: string; actionId: string; args?: unknown; runId?: string }) =>
        callback(payload)
      ipcRenderer.on(IPC.AGENT_ACTION_INVOKE, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ACTION_INVOKE, handler)
    },
    result: (payload: { reqId: string; ok: boolean; result?: unknown; error?: string }) =>
      ipcRenderer.send(IPC.AGENT_ACTION_RESULT, payload),
  },

  search: {
    query: (q: string) => ipcRenderer.invoke(IPC.SEARCH_QUERY, q),
    symbols: (q: string) => ipcRenderer.invoke(IPC.SEARCH_SYMBOLS, q),
    indexStatus: () => ipcRenderer.invoke(IPC.SEARCH_INDEX_STATUS),
    start: () => ipcRenderer.invoke('search:start'),
    prioritize: (filePath: string) => ipcRenderer.invoke('search:prioritize', filePath),
  },

  // Knowledge base — [[wikilink]] backlinks graph over the workspace notes.
  links: {
    backlinks: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_BACKLINKS, filePath),
    outgoing: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_OUTGOING, filePath),
    stubs: () => ipcRenderer.invoke(IPC.LINKS_STUBS),
    resolve: (name: string) => ipcRenderer.invoke(IPC.LINKS_RESOLVE, name),
    graph: () => ipcRenderer.invoke(IPC.LINKS_GRAPH),
    related: (filePath: string) => ipcRenderer.invoke(IPC.LINKS_RELATED, filePath),
  },

  // Workspace memory — read-only prior insights from the local Pulse DB,
  // scoped in the main process to the active workspace project.
  memory: {
    remember: (input: unknown) => ipcRenderer.invoke('memory:remember', input),
    search: (query: string, limit?: number) => ipcRenderer.invoke('memory:search', query, limit),
    listMemories: (opts?: unknown) => ipcRenderer.invoke('memory:list', opts),
    forget: (id: string) => ipcRenderer.invoke('memory:forget', id),
    memStats: () => ipcRenderer.invoke('memory:stats'),

    query: (opts?: { types?: string[]; search?: string; limit?: number }) =>
      ipcRenderer.invoke(IPC.MEMORY_QUERY, opts ?? {}),
    recent: (limit?: number) => ipcRenderer.invoke(IPC.MEMORY_RECENT, limit),
    status: () => ipcRenderer.invoke(IPC.MEMORY_STATUS),
  },

  codex: {
    openRequest: (runId: string, requestId: string) => ipcRenderer.invoke('codex:open-request', runId, requestId),
    setEffort: (effort: string) => ipcRenderer.invoke('codex:set-effort', effort),
    respond: (runId: string, requestId: string, response: unknown) => ipcRenderer.invoke('codex:respond', runId, requestId, response),
    steer: (runId: string, text: string) => ipcRenderer.invoke('codex:steer', runId, text),
    onQuestion: (callback: (question: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, question: unknown) => callback(question)
      ipcRenderer.on('codex:question', handler)
      return () => ipcRenderer.removeListener('codex:question', handler)
    },
  },
  agent: {
    run: (runId: string, prompt: string, contextFiles: string[], activeFile?: string | null, mode?: 'full' | 'safe', agentName?: string | null, conversationId?: string, model?: string | null, resumeOnly?: boolean) =>
      ipcRenderer.invoke(IPC.AGENT_RUN, { runId, prompt, contextFiles, activeFile, mode, agentName, conversationId, model, resumeOnly }),
    setDefaultModel: (model: string) => ipcRenderer.invoke('agent:set-default-model', model),
    listModels: () => ipcRenderer.invoke('agent:list-models'),
    cancel: (runId: string) => ipcRenderer.invoke(IPC.AGENT_CANCEL, runId),
    // Forget a closed tab's conversation → claude-session-id mapping in main.
    forgetConversation: (conversationId: string) =>
      ipcRenderer.invoke(IPC.AGENT_FORGET_CONVERSATION, conversationId),
    onOutput: (callback: (runId: string, chunk: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, chunk: string) =>
        callback(runId, chunk)
      ipcRenderer.on(IPC.AGENT_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_OUTPUT, handler)
    },
    onDone: (callback: (runId: string, code: number, checkpointId: string | null, failure?: AgentRunFailure) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, code: number, checkpointId: string | null, failure?: AgentRunFailure) =>
        callback(runId, code, checkpointId, failure)
      ipcRenderer.on(IPC.AGENT_DONE, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_DONE, handler)
    },
    onArtifact: (callback: (runId: string, path: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, p: string) => callback(runId, p)
      ipcRenderer.on(IPC.AGENT_ARTIFACT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ARTIFACT, handler)
    },
    // Classified list of a run's output files → the artifact cards strip.
    onArtifacts: (callback: (runId: string, artifacts: { path: string; name: string; type: string }[]) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, artifacts: { path: string; name: string; type: string }[]) =>
        callback(runId, artifacts)
      ipcRenderer.on(IPC.AGENT_ARTIFACTS, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ARTIFACTS, handler)
    },
    // Structured per-run cost/turn metadata for the session budget ledger.
    onRunMeta: (callback: (runId: string, meta: { costUsd: number; turns: number; durationMs: number }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, meta: { costUsd: number; turns: number; durationMs: number }) =>
        callback(runId, meta)
      ipcRenderer.on(IPC.AGENT_RUN_META, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_RUN_META, handler)
    },
    // Live "what the agent is DOING" — a friendly label per tool_use, parsed
    // from the same stream (no extra tokens). Drives the working indicator.
    onActivity: (callback: (runId: string, activity: { tool: string; label: string; kind?: string; chip?: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, runId: string, activity: { tool: string; label: string }) =>
        callback(runId, activity)
      ipcRenderer.on(IPC.AGENT_ACTIVITY, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_ACTIVITY, handler)
    },
  },

  // Agent broker v2 — interactive PTY `claude` session (native permission prompts).
  agentPty: {
    spawn: (sessionId: string, options?: { model?: string; agentName?: string | null; mode?: string; activeFile?: string | null }) => ipcRenderer.invoke(IPC.AGENT_PTY_SPAWN, sessionId, options),
    input: (sessionId: string, data: string) => ipcRenderer.invoke(IPC.AGENT_PTY_INPUT, sessionId, data),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke(IPC.AGENT_PTY_RESIZE, sessionId, cols, rows),
    kill: (sessionId: string) => ipcRenderer.invoke(IPC.AGENT_PTY_KILL, sessionId),
    onOutput: (callback: (sessionId: string, data: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, data: string) => callback(sessionId, data)
      ipcRenderer.on(IPC.AGENT_PTY_OUTPUT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_PTY_OUTPUT, handler)
    },
    onExit: (callback: (sessionId: string, code: number) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, sessionId: string, code: number) => callback(sessionId, code)
      ipcRenderer.on(IPC.AGENT_PTY_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_PTY_EXIT, handler)
    },
  },

  skills: {
    list: (model?: string) => ipcRenderer.invoke(IPC.SKILLS_LIST, model),
  },

  // Browser drive — the agent drives the VISIBLE in-app Browser <webview>.
  // Extraction is a fixed script chosen by `mode` (no arbitrary JS); navigation
  // is http(s) only; screenshots write under userData / the workspace.
  // Every drive method takes an OPTIONAL `tab` id: when given, act on that tab's
  // registered guest; when omitted, act on the ACTIVE tab (backward-compatible).
  browser: {
    navigate: (url: string, tab?: string) => ipcRenderer.invoke(IPC.BROWSER_NAVIGATE, { url, tab }),
    screenshot: (destPath?: string, tab?: string) =>
      ipcRenderer.invoke(IPC.BROWSER_SCREENSHOT, { destPath, tab }),
    thumbnail: (width?: number, tab?: string) => ipcRenderer.invoke(IPC.BROWSER_THUMBNAIL, { width, tab }),
    extract: (mode?: 'text' | 'links' | 'tables' | 'meta', tab?: string) =>
      ipcRenderer.invoke(IPC.BROWSER_EXTRACT, { mode, tab }),
    // Structured page perception (links-by-category, interactives, headings,
    // consent hint) — a FIXED read-only script; no arbitrary JS.
    map: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_MAP, { tab }),
    current: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_CURRENT, { tab }),
    // Interaction — FIXED, param'd scripts (selector/text/direction/timeout are
    // DATA, never agent JS): dismiss cookie banners, click, scroll, wait, nav.
    dismissCookies: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_DISMISS_COOKIES, { tab }),
    // Hardened consent: overlay + consent-wall + same-origin iframes.
    clearConsent: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_CLEAR_CONSENT, { tab }),
    /** Empties the HTTP cache. Logins are cookies and are left alone. */
    clearCache: () => ipcRenderer.invoke(IPC.BROWSER_CLEAR_CACHE),
    // One-shot deep read → a clean {name,homepage,pages,emails,phones,socials}.
    deepRead: (arg: { url: string; maxPages?: number; focus?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_DEEP_READ, arg),
    click: (arg?: { selector?: string; text?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_CLICK, arg ?? {}),
    scroll: (arg?: { to?: 'top' | 'bottom'; by?: number; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_SCROLL, arg ?? {}),
    waitFor: (arg?: { selector?: string; text?: string; timeoutMs?: number; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_WAIT_FOR, arg ?? {}),
    back: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_BACK, { tab }),
    forward: (tab?: string) => ipcRenderer.invoke(IPC.BROWSER_FORWARD, { tab }),
    type: (arg?: { selector?: string; text?: string; tab?: string }) =>
      ipcRenderer.invoke(IPC.BROWSER_TYPE, arg ?? {}),
    // Multi-tab: mark a tab's guest (by getWebContentsId()) as the active drive
    // target, so navigate/deepRead/… + wos:browser-navigate act on the visible tab.
    setActiveGuest: (id: number) => ipcRenderer.invoke(IPC.BROWSER_SET_ACTIVE_GUEST, { id }),
    // Tab-scoped drive: map a renderer TAB ID → its guest (on dom-ready) so a
    // `tab`-carrying drive call targets that exact tab; unmap it on tab close.
    registerTab: (tabId: string, webContentsId: number) =>
      ipcRenderer.invoke(IPC.BROWSER_REGISTER_TAB, { tabId, webContentsId }),
    unregisterTab: (tabId: string) => ipcRenderer.invoke(IPC.BROWSER_UNREGISTER_TAB, { tabId }),
  },

  components: {
    list: () => ipcRenderer.invoke('components:list'),
    save: (c: unknown) => ipcRenderer.invoke('components:save', c),
    delete: (id: string) => ipcRenderer.invoke('components:delete', id),
  },

  // Live-transclusion: source-of-truth metrics + their links into real cells.
  metrics: {
    list: () => ipcRenderer.invoke('metric:list'),
    create: (name: string, value: number) => ipcRenderer.invoke('metric:create', name, value),
    update: (id: string, patch: { name?: string; value?: number; source?: unknown }) =>
      ipcRenderer.invoke('metric:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('metric:delete', id),
    // Source-linked metrics: read a value LIVE from a real spreadsheet cell.
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string },
    ) => ipcRenderer.invoke('metric:createFromSource', name, source),
    refreshFromSource: (id: string) => ipcRenderer.invoke('metric:refreshFromSource', id),
    refreshAllFromSource: () => ipcRenderer.invoke('metric:refreshAllFromSource'),
    refreshForFile: (filePath: string) => ipcRenderer.invoke('metric:refreshForFile', filePath),
  },
  transclusions: {
    forFile: (filePath: string) => ipcRenderer.invoke('transclusion:forFile', filePath),
    // Read-only "where is this linked": every link for a metric across ALL files.
    forMetric: (metricId: string) => ipcRenderer.invoke('transclusion:forMetric', metricId),
    // Read-only: every link (for per-metric link-count badges).
    allLinks: () => ipcRenderer.invoke('transclusion:allLinks'),
    // Anchor is either a flat {sheet, cell} (xlsx), a {tag} (docx), or a
    // discriminated `target` (xlsx-cell / docx-cc / pptx-shape) — all resolved
    // by the main-process validator.
    add: (input: {
      metricId: string
      filePath: string
      lastValue: number
      sheet?: string
      cell?: string
      tag?: string
      target?:
        | { kind: 'xlsx-cell'; sheet: string; cell: string }
        | { kind: 'docx-cc'; tag: string }
        | { kind: 'pptx-shape'; tag: string; slide?: number }
    }) => ipcRenderer.invoke('transclusion:add', input),
    remove: (id: string) => ipcRenderer.invoke('transclusion:remove', id),
    previewSyncAll: (metricId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('transclusion:previewSyncAll', metricId, openFilePath),
    syncAll: (metricId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('transclusion:syncAll', metricId, openFilePath),
  },
  // Live ranges: source-of-truth GRIDS (the range-sized sibling of metrics) +
  // their block links into real files. A range's values only ever come from its
  // source (create/refresh) — the renderer never sets grids directly.
  ranges: {
    list: () => ipcRenderer.invoke('range:list'),
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => ipcRenderer.invoke('range:createFromSource', name, source),
    update: (id: string, patch: { name?: string; source?: unknown }) =>
      ipcRenderer.invoke('range:update', id, patch),
    refreshFromSource: (id: string) => ipcRenderer.invoke('range:refreshFromSource', id),
    refreshAllFromSource: () => ipcRenderer.invoke('range:refreshAllFromSource'),
    refreshForFile: (filePath: string) => ipcRenderer.invoke('range:refreshForFile', filePath),
    delete: (id: string) => ipcRenderer.invoke('range:delete', id),
  },
  rangeLinks: {
    forFile: (filePath: string) => ipcRenderer.invoke('rangeLink:forFile', filePath),
    forRange: (rangeId: string) => ipcRenderer.invoke('rangeLink:forRange', rangeId),
    allLinks: () => ipcRenderer.invoke('rangeLink:allLinks'),
    add: (input: {
      rangeId: string
      filePath: string
      target:
        | { kind: 'xlsx-block'; sheet: string; cell: string }
        | { kind: 'docx-table'; tag: string }
        | { kind: 'pptx-table'; tag: string; slide?: number }
      lastValues: (number | string | null)[][]
    }) => ipcRenderer.invoke('rangeLink:add', input),
    remove: (id: string) => ipcRenderer.invoke('rangeLink:remove', id),
    previewSyncAll: (rangeId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('rangeLink:previewSyncAll', rangeId, openFilePath),
    syncAll: (rangeId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('rangeLink:syncAll', rangeId, openFilePath),
  },
  // Collections: source-of-truth typed RECORD SETS (records→layout, the leap
  // above ranges) + their field-mapped layout links into real files. A
  // collection's records only ever come from its source (create/refresh); the
  // renderer never sets records directly.
  collections: {
    list: () => ipcRenderer.invoke('collection:list'),
    createFromSource: (
      name: string,
      source: { kind: 'xlsx-range'; filePath: string; sheet: string; ref: string },
    ) => ipcRenderer.invoke('collection:createFromSource', name, source),
    update: (id: string, patch: { name?: string; source?: unknown }) =>
      ipcRenderer.invoke('collection:update', id, patch),
    refresh: (id: string) => ipcRenderer.invoke('collection:refresh', id),
    refreshAll: () => ipcRenderer.invoke('collection:refreshAll'),
    refreshForFile: (filePath: string) => ipcRenderer.invoke('collection:refreshForFile', filePath),
    delete: (id: string) => ipcRenderer.invoke('collection:delete', id),
  },
  collectionLinks: {
    forFile: (filePath: string) => ipcRenderer.invoke('collectionLink:forFile', filePath),
    forCollection: (collectionId: string) =>
      ipcRenderer.invoke('collectionLink:forCollection', collectionId),
    allLinks: () => ipcRenderer.invoke('collectionLink:allLinks'),
    add: (input: {
      collectionId: string
      filePath: string
      target:
        | { kind: 'xlsx-block'; sheet: string; cell: string }
        | { kind: 'docx-table'; tag: string }
        | { kind: 'pptx-table'; tag: string; slide?: number }
      columns: { field: string; header: string }[]
      lastGrid: (number | string | null)[][]
    }) => ipcRenderer.invoke('collectionLink:add', input),
    remove: (id: string) => ipcRenderer.invoke('collectionLink:remove', id),
    previewSyncAll: (collectionId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('collectionLink:previewSyncAll', collectionId, openFilePath),
    syncAll: (collectionId: string, openFilePath: string | null) =>
      ipcRenderer.invoke('collectionLink:syncAll', collectionId, openFilePath),
  },

  system: {
    status: () => ipcRenderer.invoke(IPC.SYSTEM_STATUS),
  },

  // WOS-008: the system pasteboard. navigator.clipboard is unusable here —
  // every permission request is denied by design, so `clipboard-read` fails.
  clipboard: {
    readText: (): Promise<string> => ipcRenderer.invoke(IPC.CLIPBOARD_READ),
    writeText: (text: string): Promise<boolean> => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE, text),
  },

  // Secret vault — key NAMES cross IPC, never values. `set` sends the value once
  // (encrypted + persisted in main immediately; never kept renderer-side).
  secrets: {
    list: () => ipcRenderer.invoke(IPC.SECRET_LIST),
    status: () => ipcRenderer.invoke(IPC.SECRET_STATUS),
    set: (name: string, value: string) => ipcRenderer.invoke(IPC.SECRET_SET, name, value),
    remove: (name: string) => ipcRenderer.invoke(IPC.SECRET_REMOVE, name),
  },

  // MCP connectors — catalog + enable/disable + readiness (no secret values).
  mcp: {
    listConnectors: () => ipcRenderer.invoke(IPC.MCP_LIST_CONNECTORS),
    enable: (id: string) => ipcRenderer.invoke(IPC.MCP_ENABLE, id),
    disable: (id: string) => ipcRenderer.invoke(IPC.MCP_DISABLE, id),
    status: () => ipcRenderer.invoke(IPC.MCP_STATUS),
    // Remote OAuth (Path B) — run the loopback flow / query connected state /
    // disconnect. No token ever crosses this boundary.
    oauthConnect: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_CONNECT, id),
    oauthStatus: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_STATUS, id),
    oauthDisconnect: (id: string) => ipcRenderer.invoke(IPC.MCP_OAUTH_DISCONNECT, id),
  },

  // Native mail client (Phase 1: read-only inbox). The password crosses only on
  // add/test; it is never returned, cached in the renderer, or logged.
  mail: {
    accounts: {
      list: () => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_LIST),
      add: (
        payload: {
          displayName: string
          user: string
          imap: { host: string; port: number; tls: boolean }
          smtp?: { host: string; port: number; tls: boolean } | null
        },
        secret: string,
      ) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_ADD, payload, secret),
      remove: (id: string) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_REMOVE, id),
      // One-click built-in demo mailbox — no credentials, no network.
      addDemo: () => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_ADD_DEMO),
      test: (
        payload: {
          displayName: string
          user: string
          imap: { host: string; port: number; tls: boolean }
          smtp?: { host: string; port: number; tls: boolean } | null
        },
        secret: string,
      ) => ipcRenderer.invoke(IPC.MAIL_ACCOUNTS_TEST, payload, secret),
    },
    folders: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_FOLDERS, accountId),
    messages: (accountId: string, folder: string, opts?: { limit?: number; beforeUid?: number; offset?: number }) =>
      ipcRenderer.invoke(IPC.MAIL_MESSAGES, accountId, folder, opts ?? {}),
    /** Move a message (Archive, filing, or delete-as-move-to-Trash). Undoable. */
    move: (accountId: string, folder: string, uid: number, messageId: string, toFolder: string, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_MOVE, accountId, folder, uid, messageId, toFolder, label),
    setRead: (accountId: string, folder: string, uid: number, messageId: string, read: boolean, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_SET_READ, accountId, folder, uid, messageId, read, label),
    setFlagged: (accountId: string, folder: string, uid: number, messageId: string, flagged: boolean, label?: string) =>
      ipcRenderer.invoke(IPC.MAIL_SET_FLAGGED, accountId, folder, uid, messageId, flagged, label),
    /** Take back a journalled action. */
    undo: (accountId: string, actionId: number) => ipcRenderer.invoke(IPC.MAIL_UNDO, accountId, actionId),
    /** Propose a filing plan for recent mail. Moves nothing. */
    proposeFiling: (accountId: string, folder: string, days: 7 | 30 | 90) =>
      ipcRenderer.invoke(IPC.MAIL_FILING_PROPOSE, accountId, folder, days),
    /** Apply an APPROVED filing plan. Recorded as agent actions, so undoable in one go. */
    applyFiling: (accountId: string, plan: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_FILING_APPLY, accountId, plan),
    /** Undo everything the AGENT did since a moment (ms epoch). */
    undoAgentSince: (accountId: string, sinceMs: number) =>
      ipcRenderer.invoke(IPC.MAIL_UNDO_AGENT, accountId, sinceMs),
    /** The undo stack, newest first. */
    undoable: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_UNDOABLE, accountId),
    /** Save an attachment to a location the user picks. */
    saveAttachment: (accountId: string, folder: string, uid: number, index: number) =>
      ipcRenderer.invoke(IPC.MAIL_ATTACHMENT_SAVE, accountId, folder, uid, index),
    /** Open an attachment with the OS default app, from a temp copy. */
    openAttachment: (accountId: string, folder: string, uid: number, index: number) =>
      ipcRenderer.invoke(IPC.MAIL_ATTACHMENT_OPEN, accountId, folder, uid, index),
    /** Export a rendered message to PDF. */
    exportPdf: (html: string, subject: string) => ipcRenderer.invoke(IPC.MAIL_EXPORT_PDF, html, subject),
    /** Raw RFC822 source — "show original". */
    rawSource: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke(IPC.MAIL_RAW_SOURCE, accountId, folder, uid),
    createFolder: (accountId: string, folderPath: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_CREATE, accountId, folderPath),
    renameFolder: (accountId: string, from: string, to: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_RENAME, accountId, from, to),
    deleteFolder: (accountId: string, folderPath: string) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_DELETE, accountId, folderPath),
    /** Start/stop watching a folder for new mail. */
    watchStart: (accountId: string, folder: string) =>
      ipcRenderer.invoke(IPC.MAIL_WATCH_START, accountId, folder),
    watchStop: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_WATCH_STOP, accountId),
    /** Subscribe to new-mail events. Returns an unsubscribe function. */
    onNewMail: (cb: (e: { accountId: string; folder: string; count: number; latest: { subject: string; from: string } | null }) => void) => {
      const handler = (_e: unknown, payload: never): void => cb(payload)
      ipcRenderer.on(IPC.MAIL_NEW_MAIL, handler)
      return () => ipcRenderer.removeListener(IPC.MAIL_NEW_MAIL, handler)
    },
    /** Unread + total per folder, for the rail badges. */
    folderCounts: (accountId: string, folders: string[]) =>
      ipcRenderer.invoke(IPC.MAIL_FOLDER_COUNTS, accountId, folders),
    /** Send behind an undo window — returns immediately with a queue id. */
    sendQueued: (accountId: string, draft: unknown, context: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_SEND_QUEUED, accountId, draft, context),
    /** Cancel a held send. Only possible before the window expires. */
    cancelSend: (id: string) => ipcRenderer.invoke(IPC.MAIL_SEND_CANCEL, id),
    /** Skip the remaining hold and send now. */
    sendNow: (id: string) => ipcRenderer.invoke(IPC.MAIL_SEND_NOW, id),
    /** Save a compose draft to the server's Drafts folder. */
    saveDraft: (accountId: string, draft: unknown, context: unknown, replaceUid?: number) =>
      ipcRenderer.invoke(IPC.MAIL_SAVE_DRAFT, accountId, draft, context, replaceUid),
    /** Per-account signature. */
    getSignature: (accountId: string) => ipcRenderer.invoke(IPC.MAIL_SIGNATURE_GET, accountId),
    setSignature: (accountId: string, signature: string) =>
      ipcRenderer.invoke(IPC.MAIL_SIGNATURE_SET, accountId, signature),
    /** Recipient suggestions from real correspondence. */
    contacts: (query: string, limit?: number) => ipcRenderer.invoke(IPC.MAIL_CONTACTS, query, limit),
    /** The folder as the local index knows it — instant, no network. */
    cached: (accountId: string, folder: string, limit?: number) =>
      ipcRenderer.invoke(IPC.MAIL_CACHED, accountId, folder, limit),
    /** Full-text search over the LOCAL index (subject, sender, body). */
    search: (query: string, opts?: { accountId?: string; folder?: string; limit?: number; sort?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_SEARCH, query, opts),
    /** Refresh the local index for a folder; deepens bodies in the background. */
    sync: (accountId: string, folder: string) => ipcRenderer.invoke(IPC.MAIL_SYNC, accountId, folder),
    indexStats: () => ipcRenderer.invoke(IPC.MAIL_INDEX_STATS),
    message: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke(IPC.MAIL_MESSAGE, accountId, folder, uid),
    // Opt-in remote images: main fetches them without cookies or referrer and
    // hands back data: URIs, so the reader iframe never needs network access.
    remoteImages: (urls: string[]) => ipcRenderer.invoke(IPC.MAIL_REMOTE_IMAGES, urls),
    // A spreadsheet + an intent → agent-authored, validated email blocks.
    draftFromFile: (payload: { filePath: string; intent: string; instruction?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_DRAFT_FROM_FILE, payload),
    pickWorkbook: () => ipcRenderer.invoke(IPC.MAIL_PICK_WORKBOOK),
    // Phase 2 — SMTP-side "Test connection" (no save) and send.
    smtpTest: (
      payload: {
        displayName: string
        user: string
        imap: { host: string; port: number; tls: boolean }
        smtp?: { host: string; port: number; tls: boolean } | null
      },
      secret: string,
    ) => ipcRenderer.invoke(IPC.MAIL_SMTP_TEST, payload, secret),
    send: (accountId: string, draft: unknown, context?: unknown) =>
      ipcRenderer.invoke(IPC.MAIL_SEND, accountId, draft, context ?? { kind: 'new' }),
    // Phase 3 — triage a folder → ranked "needs a reply" list; draft one reply
    // (agent-suggested body; never sends). Send stays the MAIL_SEND path above.
    rules: {
      list: () => ipcRenderer.invoke('mail:rules:list'),
      add: (rule: unknown) => ipcRenderer.invoke('mail:rules:add', rule),
      update: (id: string, patch: unknown) => ipcRenderer.invoke('mail:rules:update', id, patch),
      remove: (id: string) => ipcRenderer.invoke('mail:rules:remove', id),
      reorder: (id: string, delta: number) => ipcRenderer.invoke('mail:rules:reorder', id, delta),
    },
    newsletters: {
      propose: (accountId: string, folder: string, days?: number) =>
        ipcRenderer.invoke('mail:newsletters:propose', accountId, folder, days),
      file: (accountId: string, sweep: unknown) => ipcRenderer.invoke('mail:newsletters:file', accountId, sweep),
    },
    classify: (accountId: string, folder: string, uid: number) =>
      ipcRenderer.invoke('mail:classify', accountId, folder, uid),
    triage: (accountId: string, folder: string, opts?: { limit?: number; maxCandidates?: number }) =>
      ipcRenderer.invoke(IPC.MAIL_TRIAGE, accountId, folder, opts ?? {}),
    // The Morning Sift: one batched light-model pass over what's new →
    // zone + priority + one-line summary per mail. Model comes from settings.
    sift: (accountId: string, folder: string, opts?: { model?: string; caseTitles?: string[]; excludeUids?: number[] }) =>
      ipcRenderer.invoke(IPC.MAIL_SIFT, accountId, folder, opts ?? {}),
    draftReply: (
      accountId: string,
      payload: { folder: string; uid: number; replyAll?: boolean; instruction?: string; stance?: 'positive' | 'neutral' | 'negative' },
    ) => ipcRenderer.invoke(IPC.MAIL_DRAFT_REPLY, accountId, payload),
    // OAuth (Google XOAUTH2) — alternative to app-password. `oauthConfigured`
    // tells the UI whether a client id is set; `oauthGoogle` runs the loopback
    // flow and returns the created xoauth2 account (secret = refresh token).
    oauthConfigured: () => ipcRenderer.invoke(IPC.MAIL_OAUTH_CONFIGURED),
    oauthGoogle: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => ipcRenderer.invoke(IPC.MAIL_OAUTH_GOOGLE, payload),
    // OAuth (Microsoft XOAUTH2) — required for Outlook/Hotmail/Live/MSN since
    // Microsoft disabled basic auth in 2024. Same shape as the Google pair.
    oauthMicrosoftConfigured: () => ipcRenderer.invoke(IPC.MAIL_OAUTH_MICROSOFT_CONFIGURED),
    // Save an OAuth client id from the UI instead of hand-creating a JSON file.
    oauthSetClientId: (provider: 'google' | 'microsoft', clientId: string) =>
      ipcRenderer.invoke(IPC.MAIL_OAUTH_SET_CLIENT_ID, provider, clientId),
    oauthMicrosoft: (payload: {
      displayName?: string
      user: string
      imap?: { host: string; port: number; tls: boolean }
      smtp?: { host: string; port: number; tls: boolean } | null
    }) => ipcRenderer.invoke(IPC.MAIL_OAUTH_MICROSOFT, payload),
    // Autoconfig — email address → resolved IMAP/SMTP settings (table/ISPDB/guess).
    autoconfig: (email: string) => ipcRenderer.invoke(IPC.MAIL_AUTOCONFIG, email),
    // Advanced 1:1 email — richer than a plain-text box. All NEVER send; the
    // renderer previews, then reuses `send` above with the compiled html + text.
    //  - richBuild: theme + structured blocks → responsive HTML + text fallback
    //    (live {{metric:<id>}} tokens resolved true at build time).
    //  - richDraft: a one-line brief → agent-authored MJML → responsive HTML.
    //  - richAssist: current draft + an action → a revised body.
    //  - liveData: list metrics/ranges, or (with an id) get a drop-in block.
    richBuild: (payload: { themeId?: string; blocks: unknown[] }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_BUILD, payload),
    richDraft: (payload: { brief: string; brand?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_DRAFT, payload),
    richAssist: (payload: { action: string; draft: string; instruction?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_RICH_ASSIST, payload),
    liveData: (payload?: { metricId?: string; rangeId?: string }) =>
      ipcRenderer.invoke(IPC.MAIL_LIVE_DATA, payload ?? {}),
  },

  // Brand kit — the user's brand (palette/fonts/logo/voice), codified once and
  // flowed into agent output. NOT secret — plain app data. `setLogo` sends the
  // logo bytes base64-encoded; main copies them into userData/brand/.
  brand: {
    get: () => ipcRenderer.invoke(IPC.BRAND_GET),
    set: (patch: unknown) => ipcRenderer.invoke(IPC.BRAND_SET, patch),
    setLogo: (payload: { filename: string; content: string }) =>
      ipcRenderer.invoke(IPC.BRAND_SET_LOGO, payload),
  },

  // Connected Accounts — the user signs into a website ONCE by hand in the in-app
  // browser; we manage the SESSION lifecycle + a non-secret record per site. NO
  // credential crosses this boundary. `list` returns entries + a live hasSession
  // flag; `add` records intent (does NOT log in); `signout` clears the session.
  accounts: {
    list: () => ipcRenderer.invoke(IPC.ACCOUNTS_LIST),
    add: (url: string) => ipcRenderer.invoke(IPC.ACCOUNTS_ADD, url),
    signout: (domain: string) => ipcRenderer.invoke(IPC.ACCOUNTS_SIGNOUT, domain),
  },

  // Connections — one roster over every store, with a computed status. No
  // secret value crosses this boundary (presence booleans + probe verdicts).
  connections: {
    list: (opts?: { force?: boolean }) => ipcRenderer.invoke(IPC.CONNECTIONS_LIST, opts ?? {}),
    signout: (id: string) => ipcRenderer.invoke(IPC.CONNECTIONS_SIGNOUT, id),
  },

  // Needs-you notifications.
  notify: {
    prefs: () => ipcRenderer.invoke(IPC.NOTIFY_PREFS),
    setPrefs: (next: { approvals?: boolean; routines?: boolean; cases?: boolean; connectors?: boolean }) =>
      ipcRenderer.invoke(IPC.NOTIFY_SET_PREFS, next),
    request: (event: { source: string; key: string; title: string; body?: string; rail?: string }) =>
      ipcRenderer.invoke(IPC.NOTIFY_REQUEST, event),
    recent: () => ipcRenderer.invoke(IPC.NOTIFY_RECENT),
    onOpen: (callback: (target: { rail: string; key: string; source: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, target: { rail: string; key: string; source: string }) => callback(target)
      ipcRenderer.on(IPC.NOTIFY_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.NOTIFY_OPEN, handler)
    },
  },

  // Routines — agents on the app's clock.
  routines: {
    list: () => ipcRenderer.invoke(IPC.ROUTINES_LIST),
    save: (input: { id?: string; name: string; prompt: string; schedule: string; agentName?: string | null; enabled?: boolean; capabilities?: string[] }) =>
      ipcRenderer.invoke(IPC.ROUTINES_SAVE, input),
    delete: (id: string) => ipcRenderer.invoke(IPC.ROUTINES_DELETE, id),
    runNow: (id: string) => ipcRenderer.invoke(IPC.ROUTINES_RUN_NOW, id),
    describe: (schedule: string) => ipcRenderer.invoke(IPC.ROUTINES_DESCRIBE, schedule),
    onUpdated: (callback: (routines: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, routines: unknown) => callback(routines)
      ipcRenderer.on(IPC.ROUTINES_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.ROUTINES_UPDATED, handler)
    },
  },

  // Background runs — owned by main, streamed on the agent:* channels by job id.
  runs: {
    enqueue: (input: { prompt: string; label?: string; agentName?: string | null; origin?: 'routine' | 'background'; contextFiles?: string[] }) =>
      ipcRenderer.invoke(IPC.RUNS_ENQUEUE, input),
    list: () => ipcRenderer.invoke(IPC.RUNS_LIST),
    cancel: (id: string) => ipcRenderer.invoke(IPC.RUNS_CANCEL, id),
    pause: (id: string) => ipcRenderer.invoke(IPC.RUNS_PAUSE, id),
    resume: (id: string) => ipcRenderer.invoke(IPC.RUNS_RESUME, id),
    onUpdated: (callback: (job: unknown) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, job: unknown) => callback(job)
      ipcRenderer.on(IPC.RUNS_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.RUNS_UPDATED, handler)
    },
  },

  agents: {
    list: () => ipcRenderer.invoke(IPC.AGENTS_LIST),
    read: (name: string, scope?: 'global' | 'project') => ipcRenderer.invoke(IPC.AGENTS_READ, name, scope),
    write: (payload: { name: string; model?: string; description?: string; persona?: string; mode?: 'full' | 'safe'; skills?: string[]; capabilities?: string[]; surface?: string; scope?: 'global' | 'project' }) =>
      ipcRenderer.invoke(IPC.AGENTS_WRITE, payload),
    delete: (name: string, scope?: 'global' | 'project') => ipcRenderer.invoke(IPC.AGENTS_DELETE, name, scope),
    // Agent Foundry: the capability palette + the meta-agent that authors a spec.
    capabilities: () => ipcRenderer.invoke(IPC.AGENTS_CAPABILITIES),
    build: (description: string) => ipcRenderer.invoke(IPC.AGENTS_BUILD, description),
  },

  checkpoint: {
    list: () => ipcRenderer.invoke('checkpoint:list'),
    rollback: (id: string) => ipcRenderer.invoke('checkpoint:rollback', id),
    diff: (id: string) => ipcRenderer.invoke('checkpoint:diff', id),
  },

  snapshots: {
    list: () => ipcRenderer.invoke('snapshot:list'),
    save: (name: string, state: unknown) => ipcRenderer.invoke('snapshot:save', name, state),
    delete: (id: string) => ipcRenderer.invoke('snapshot:delete', id),
  },

  trash: {
    list: () => ipcRenderer.invoke('trash:list'),
    restore: (id: string) => ipcRenderer.invoke('trash:restore', id),
    delete: (id: string) => ipcRenderer.invoke('trash:delete', id),
    empty: () => ipcRenderer.invoke('trash:empty'),
  },

  office: {
    print: (filePath: string) => ipcRenderer.invoke('office:print', filePath),
    available: () => ipcRenderer.invoke('office:available'),
    toPdf: (filePath: string) => ipcRenderer.invoke('office:to-pdf', filePath),
    exportPdf: (filePath: string) => ipcRenderer.invoke('office:export-pdf', filePath),
  },

  // Native LibreOfficeKit rendering + editing (Phase 3a).
  lok: {
    available: () => ipcRenderer.invoke('lok:available'),
    open: (filePath: string) => ipcRenderer.invoke('lok:open', filePath),
    newDoc: (ext: string, fileName: string) => ipcRenderer.invoke('lok:new', ext, fileName),
    tile: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) =>
      ipcRenderer.invoke('lok:tile', args),
    tiles: (args: { cw: number; ch: number; tx: number; ty: number; tw: number; th: number }[]) =>
      ipcRenderer.invoke('lok:tiles', args),
    partTile: (args: { part: number; cw: number; ch: number; tx: number; ty: number; tw: number; th: number }) =>
      ipcRenderer.invoke('lok:parttile', args),
    key: (type: number, charCode: number, keyCode: number) => ipcRenderer.invoke('lok:key', type, charCode, keyCode),
    mouse: (args: { type: number; x: number; y: number; count: number; buttons: number; modifier: number }) =>
      ipcRenderer.invoke('lok:mouse', args),
    uno: (command: string) => ipcRenderer.invoke('lok:uno', command),
    insertImage: () => ipcRenderer.invoke('lok:insertImage'),
    imageShape: () => ipcRenderer.invoke('lok:imageShape'),
    pickImage: () => ipcRenderer.invoke('lok:pickImage'),
    setBorder: (preset: string, color: number, width: number) => ipcRenderer.invoke('lok:setborder', preset, color, width),
    sheetGeometry: () => ipcRenderer.invoke('lok:sheetgeometry'),
    setSize: (kind: 'col' | 'row', index: number, size: number) => ipcRenderer.invoke('lok:setsize', kind, index, size),
    macro: (name: string, args: string) => ipcRenderer.invoke('lok:macro', name, args),
    findReplace: (args: {
      mode: 'findnext' | 'findprev' | 'replaceall'
      find: string
      replace?: string
      caseSensitive?: boolean
      wholeWord?: boolean
      regex?: boolean
    }) => ipcRenderer.invoke('lok:findReplace', args),
    setRangeBlock: (args: { sheet: string; cell: string; values: (number | string | null)[][] }) =>
      ipcRenderer.invoke('lok:setRangeBlock', args),
    setTable: (args: {
      macro: 'WosInsertDocTable' | 'WosSetDocTable' | 'WosInsertSlideTable' | 'WosSetSlideTable'
      tag: string
      values: (number | string | null)[][]
    }) => ipcRenderer.invoke('lok:setTable', args),
    selInfo: () => ipcRenderer.invoke('lok:selinfo'),
    partInfo: () => ipcRenderer.invoke('lok:partinfo'),
    commandValues: (command: string) => ipcRenderer.invoke('lok:cmdvalues', command),
    docStatus: () => ipcRenderer.invoke('lok:docstatus'),
    lastShape: () => ipcRenderer.invoke('lok:lastshape'),
    transition: (args: string) => ipcRenderer.invoke('lok:transition', args),
    animate: (args: string) => ipcRenderer.invoke('lok:animate', args),
    officeMacro: (name: string, args: string) => ipcRenderer.invoke('lok:officeMacro', name, args),
    getNotes: (index?: number) => ipcRenderer.invoke('lok:getNotes', { index }),
    setNotes: (index: number, text: string) => ipcRenderer.invoke('lok:setNotes', { index, text }),
    capture: () => ipcRenderer.invoke('lok:capture'),
    buildCaptured: (elements: string[]) => ipcRenderer.invoke('lok:buildCaptured', elements),
    setPart: (n: number) => ipcRenderer.invoke('lok:setpart', n),
    parts: () => ipcRenderer.invoke('lok:parts'),
    save: () => ipcRenderer.invoke('lok:save'),
    exportAs: (format: string) => ipcRenderer.invoke('lok:export', format),
    slidesSvg: () => ipcRenderer.invoke('lok:slidessvg'),
    print: (filePath: string) => ipcRenderer.invoke('lok:print', filePath),
    fileInfo: () => ipcRenderer.invoke('lok:fileinfo'),
    windowPaint: (args: { id: number; w: number; h: number }) => ipcRenderer.invoke('lok:wpaint', args),
    windowMouse: (args: { id: number; type: number; x: number; y: number; count: number; buttons: number; modifier: number }) => ipcRenderer.invoke('lok:wmouse', args),
    windowKey: (args: { id: number; type: number; charCode: number; keyCode: number }) => ipcRenderer.invoke('lok:wkey', args),
    dialogEvent: (args: { id: number; control: string; cmd: string; type: string; data?: string }) => ipcRenderer.invoke('lok:dlgevent', args),
    windowClose: (id: number) => ipcRenderer.invoke('lok:wclose', id),
    close: () => ipcRenderer.invoke('lok:close'),
    onCallback: (callback: (cb: { type: number; payload: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, cb: { type: number; payload: string }) => callback(cb)
      ipcRenderer.on('lok:callback', handler)
      return () => ipcRenderer.removeListener('lok:callback', handler)
    },
  },

  canvas: {
    // Frame→slide bridge v1: ordered PNG buffers → a real .pptx written beside
    // the .wcanvas (image-based, one-way).
    exportPptx: (arg: { targetPath: string; images: { png: Uint8Array; title?: string }[] }) =>
      ipcRenderer.invoke('canvas:export-pptx', arg),
    // Frame→live-slide bridge v1: append a NATIVE, editable slide to the OPEN
    // Impress deck from a serialized SlideSpec payload (+ image fallbacks). One-way.
    frameToSlide: (arg: { payload: string; fallbackImages: { png: Uint8Array }[] }) =>
      ipcRenderer.invoke('canvas:frame-to-slide', arg),
  },

  menu: {
    setActions: (items: { id: string; label: string }[]) => ipcRenderer.invoke('menu:set-actions', items),
    setAgentMenu: (data: { agents: { id: string; label: string }[]; skills: { id: string; label: string }[]; mode: 'full' | 'safe'; activeAgent: string | null }) =>
      ipcRenderer.invoke('menu:set-agent-menu', data),
    setOfficeContext: (data: { type: number | null; parts?: string[] }) => ipcRenderer.invoke('menu:set-office-context', data),
    setOfficeState: (data: { checked: Record<string, boolean>; disabled: string[] }) => ipcRenderer.invoke('menu:set-office-state', data),
    officeCommands: () => ipcRenderer.invoke('menu:office-commands'),
    runAction: (id: string) => ipcRenderer.invoke('menu:run-action', id),
    // The browser pushes the actions its own panel is showing, so the native
    // menu is the same data rather than a second list. null = left the surface.
    setBrowserContext: (
      data: {
        actions: { id: string; label: string; shortcut?: string; relevance: number }[]
        canGoBack: boolean
        canGoForward: boolean
      } | null,
    ) => ipcRenderer.invoke('menu:set-browser-context', data),
    onRunAction: (callback: (actionId: string) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, actionId: string) => callback(actionId)
      ipcRenderer.on('menu:run-action', handler)
      return () => ipcRenderer.removeListener('menu:run-action', handler)
    },
  },

  window: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE),
    maximize: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE),
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE),
  },

  // Browsing history + bookmarks — ONE store. `search` is full-text over page
  // CONTENT (the reason the index exists); `suggest` is the omnibox's url/title
  // match, which deliberately does NOT search body text, so typing three
  // letters cannot surface every page that mentions the word.
  history: {
    record: (arg: { url: string; title?: string; favicon?: string; text?: string }) =>
      ipcRenderer.invoke(IPC.HISTORY_RECORD, arg),
    search: (query: string, limit?: number) => ipcRenderer.invoke(IPC.HISTORY_SEARCH, { query, limit }),
    suggest: (prefix: string, limit?: number) => ipcRenderer.invoke(IPC.HISTORY_SUGGEST, { prefix, limit }),
    recent: (limit?: number) => ipcRenderer.invoke(IPC.HISTORY_RECENT, { limit }),
    star: (url: string, title?: string, favicon?: string) =>
      ipcRenderer.invoke(IPC.HISTORY_STAR, { url, title, favicon }),
    unstar: (url: string) => ipcRenderer.invoke(IPC.HISTORY_UNSTAR, { url }),
    isStarred: (url: string) => ipcRenderer.invoke(IPC.HISTORY_IS_STARRED, { url }),
    bookmarks: (limit?: number) => ipcRenderer.invoke(IPC.HISTORY_BOOKMARKS, { limit }),
    // Deletion removes the indexed TEXT too, not just the listing.
    forget: (url: string) => ipcRenderer.invoke(IPC.HISTORY_FORGET, { url }),
    forgetSince: (since: number) => ipcRenderer.invoke(IPC.HISTORY_FORGET_SINCE, { since }),
    clear: () => ipcRenderer.invoke(IPC.HISTORY_CLEAR),
  },

  /**
   * Cases — a thread of work that outlives any one agent run: the subject, the
   * documents produced for it, the status, and the notes.
   */
  /** Sub-projects: marked subfolders of the workspace (docs/landscape/PLAN.md §5a). */
  projects: {
    list: (home?: string) => ipcRenderer.invoke('projects:list', home),
    create: (home: string | undefined, name: string, color?: string) => ipcRenderer.invoke('projects:create', home, name, color),
  },
  cases: {
    list: () => ipcRenderer.invoke('cases:list'),
    get: (id: string) => ipcRenderer.invoke('cases:get', id),
    workFolder: (id: string) => ipcRenderer.invoke('cases:work-folder', id),
    promote: (id: string, filePath: string) => ipcRenderer.invoke('cases:promote', id, filePath),
    statuses: (type?: string) => ipcRenderer.invoke('cases:statuses', type),
    create: (payload: { title: string; type?: string; description?: string; subject?: string; artifacts?: string[] }) =>
      ipcRenderer.invoke('cases:create', payload),
    setStatus: (id: string, status: string) => ipcRenderer.invoke('cases:set-status', id, status),
    addNote: (id: string, text: string, author?: 'you' | 'agent') =>
      ipcRenderer.invoke('cases:add-note', id, text, author),
    addArtifact: (id: string, filePath: string) => ipcRenderer.invoke('cases:add-artifact', id, filePath),
    setDescription: (id: string, description: string) => ipcRenderer.invoke('cases:set-description', id, description),
    markActed: (id: string, signal: unknown) => ipcRenderer.invoke('cases:mark-acted', id, signal),
    /** Move a case between "this workspace" and "everywhere" (a file move). */
    setScope: (id: string, scope: 'workspace' | 'global') => ipcRenderer.invoke('cases:set-scope', id, scope),
    terminalStatuses: () => ipcRenderer.invoke('cases:terminal'),
    /** The whole case as markdown — what an agent is given as context. */
    asContext: (id: string) => ipcRenderer.invoke('cases:as-context', id),
    nextStatus: (type: string, current: string) => ipcRenderer.invoke('cases:next-status', type, current),
    /** KPIs / chart / table computed from the case's CSV artifacts. */
    insights: (id: string) => ipcRenderer.invoke('cases:insights', id),
    /** The case's declared curated view (Layer 2), or null. */
    view: (id: string) => ipcRenderer.invoke('cases:view', id),
    /** A file:// URL for an artifact (for image thumbnails). */
    artifactUrl: (rel: string) => ipcRenderer.invoke('cases:artifact-url', rel),
    /** Authorize+resolve a case artifact to an absolute path (opens across workspaces). */
    authorizeArtifact: (id: string, rel: string) => ipcRenderer.invoke('cases:authorize-artifact', id, rel),
  },

  browserTabs: {
    /** Main asks the Browser surface to open a url in a NEW tab (WOS-007). */
    onOpenTab: (callback: (payload: { url: string; referrer?: string }) => void) => {
      // Older payload shape was a bare string; normalise so a stale listener
      // and a new sender can never disagree about the argument.
      const handler = (_e: Electron.IpcRendererEvent, payload: unknown) =>
        callback(typeof payload === 'string' ? { url: payload } : (payload as { url: string; referrer?: string })) 
      ipcRenderer.on('browser:open-tab', handler)
      return () => ipcRenderer.removeListener('browser:open-tab', handler)
    },
  },

  bugs: {
    status: () => ipcRenderer.invoke('bug:status'),
    setRepo: (dir: string) => ipcRenderer.invoke('bug:setRepo', dir),
    context: (surface: string | null, openFile: string | null) =>
      ipcRenderer.invoke('bug:context', surface, openFile),
    analyze: (text: string, surface: string | null, openFile: string | null, kind?: 'bug' | 'idea') =>
      ipcRenderer.invoke('bug:analyze', text, surface, openFile, kind),
    file: (text: string, analysis: unknown, context: unknown, kind?: 'bug' | 'idea') =>
      ipcRenderer.invoke('bug:file', text, analysis, context, kind),
    list: () => ipcRenderer.invoke('bug:list'),
  },

  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onUpdateReady: (callback: (info: { version: string }) => void) => {
      const handler = (_e: Electron.IpcRendererEvent, info: { version: string }) => callback(info)
      ipcRenderer.on('updater:update-ready', handler)
      return () => ipcRenderer.removeListener('updater:update-ready', handler)
    },
  },
})
