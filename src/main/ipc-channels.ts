/**
 * Single source of truth for all IPC channel names.
 * Imported by both main process and preload — never hardcode channel strings elsewhere.
 */
export const IPC = {
  // File system
  FS_READ_DIR: 'fs:read-dir',
  FS_READ_FILE: 'fs:read-file',
  FS_WRITE_FILE: 'fs:write-file',
  FS_DELETE: 'fs:delete',
  FS_RENAME: 'fs:rename',
  FS_CREATE: 'fs:create',
  FS_WATCH_START: 'fs:watch-start',
  FS_WATCH_STOP: 'fs:watch-stop',
  FS_WATCH_EVENT: 'fs:watch-event',

  // Shell / Agent Terminal
  SHELL_SPAWN: 'shell:spawn',
  SHELL_INPUT: 'shell:input',
  SHELL_OUTPUT: 'shell:output',
  SHELL_RESIZE: 'shell:resize',
  SHELL_KILL: 'shell:kill',

  // Agent (Claude CLI bridge — `-p`/stream-json pipeline)
  AGENT_RUN: 'agent:run',
  AGENT_OUTPUT: 'agent:output',
  AGENT_DONE: 'agent:done',
  AGENT_CANCEL: 'agent:cancel',
  // Drop a closed tab's conversation → claude-session-id mapping so the LRU map
  // (and its persisted file) don't accrete resume-ids for tabs that no longer exist.
  AGENT_FORGET_CONVERSATION: 'agent:forget-conversation',
  AGENT_ARTIFACT: 'agent:artifact',
  // Classified list of every file a run produced/touched — surfaced as openable
  // artifact cards in the agent session (superset of the single AGENT_ARTIFACT
  // office auto-open above).
  AGENT_ARTIFACTS: 'agent:artifacts',
  // Structured per-run cost/turn metadata parsed from the stream-json `result`
  // event — feeds the session budget ledger without changing the -p console.
  AGENT_RUN_META: 'agent:run-meta',
  // Compact "what the agent is DOING" signal parsed from `tool_use` events in
  // the SAME stream-json — drives the working indicator + steps trail. Free:
  // pure parsing of output we already receive, no extra tokens, no new runs.
  AGENT_ACTIVITY: 'agent:activity',

  // Agent broker v2 — interactive PTY `claude` session (native permission
  // prompts). Additive to the -p pipeline above; chosen per session by a toggle.
  AGENT_PTY_SPAWN: 'agent:pty-spawn',
  AGENT_PTY_INPUT: 'agent:pty-input',
  AGENT_PTY_OUTPUT: 'agent:pty-output',
  AGENT_PTY_RESIZE: 'agent:pty-resize',
  AGENT_PTY_KILL: 'agent:pty-kill',
  AGENT_PTY_EXIT: 'agent:pty-exit',

  // Integrated Terminal Dock — PTY host (separate from the legacy SHELL_* pair;
  // this one is lazy-native + emits an explicit EXIT event and lives only in the
  // new shell). See main/terminal/ptyHost.ts.
  TERMINAL_CREATE: 'terminal:create',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_KILL: 'terminal:kill',
  TERMINAL_DATA: 'terminal:data',
  TERMINAL_EXIT: 'terminal:exit',

  // Live workspace harness/context — the shared context every terminal + agent
  // session carries (root / surface / folder / open file / capabilities).
  CONTEXT_SET: 'context:set',

  // AGENT→ACTION bridge — the in-app `claude -p` agent EXECUTES per-surface
  // actions by running the `wos-action` CLI, which reaches main over a local
  // unix socket. Main forwards `run <id>` to the focused window's renderer
  // executor (INVOKE) and awaits its reqId-correlated reply (RESULT). The
  // renderer runs the SAME surfaceActions registry a dock chip runs — the
  // agent drives the live UI. Only NON-DESTRUCTIVE, registered ids are allowed.
  AGENT_ACTION_INVOKE: 'agent:action-invoke',
  AGENT_ACTION_RESULT: 'agent:action-result',

  // Browser drive — the agent DRIVES the visible in-app Browser surface's
  // sandboxed <webview> (navigate / screenshot / extract / read current URL).
  // Main captures the guest webContents from `did-attach-webview` (security.ts)
  // and reaches it here. http(s) only; extraction is a FIXED script with a mode
  // enum (no arbitrary agent JS); screenshots write only under a caller path.
  BROWSER_NAVIGATE: 'browser:navigate',
  BROWSER_SCREENSHOT: 'browser:screenshot',
  BROWSER_THUMBNAIL: 'browser:thumbnail',
  BROWSER_EXTRACT: 'browser:extract',
  // Structured page perception (links-by-category, interactives, headings,
  // consent hint) via a FIXED read-only script. Deep-read builds on this.
  BROWSER_MAP: 'browser:map',
  BROWSER_CURRENT: 'browser:current',
  // Interaction — FIXED, param'd scripts (a selector / visible-text / direction /
  // timeout is DATA, never agent JS): dismiss cookie banners, click, scroll,
  // wait-for, history nav, and type-into-input. Same sandbox + http(s)-only guest.
  BROWSER_DISMISS_COOKIES: 'browser:dismiss-cookies',
  // Hardened consent: overlay + consent-wall pages + same-origin iframes.
  BROWSER_CLEAR_CONSENT: 'browser:clear-consent',
  // One-shot deep read: navigate → clearConsent → map → visit top subpages →
  // extract → assemble a company/site PROFILE. Bounded by maxPages + time.
  BROWSER_DEEP_READ: 'browser:deep-read',
  BROWSER_CLICK: 'browser:click',
  BROWSER_SCROLL: 'browser:scroll',
  BROWSER_WAIT_FOR: 'browser:wait-for',
  BROWSER_BACK: 'browser:back',
  BROWSER_FORWARD: 'browser:forward',
  BROWSER_TYPE: 'browser:type',
  // Multi-tab: the renderer tells main which tab's guest is ACTIVE (by its
  // getWebContentsId()), so the drive (navigate/deepRead/…) + wos:browser-navigate
  // act on the VISIBLE tab. Falls back to the latest attached guest.
  BROWSER_SET_ACTIVE_GUEST: 'browser:set-active-guest',
  // Multi-tab (Stage 2): the renderer maps a TAB ID → its guest (by
  // getWebContentsId()) on the tab's dom-ready, and unmaps it on tab close, so a
  // drive call carrying a `tab` id acts on that exact tab's guest (create/register
  // must already have happened). Omitting `tab` keeps today's active-tab behavior.
  BROWSER_REGISTER_TAB: 'browser:register-tab',
  BROWSER_UNREGISTER_TAB: 'browser:unregister-tab',

  // Browsing history + bookmarks. ONE store: a bookmark is a starred history
  // row, so bookmarks are full-text searchable and cannot drift out of sync.
  // HISTORY_SEARCH is full-text over page CONTENT; HISTORY_SUGGEST is the
  // omnibox's url/title match, which deliberately does NOT search body text.
  HISTORY_RECORD: 'history:record',
  HISTORY_SEARCH: 'history:search',
  HISTORY_SUGGEST: 'history:suggest',
  HISTORY_RECENT: 'history:recent',
  HISTORY_STAR: 'history:star',
  HISTORY_UNSTAR: 'history:unstar',
  HISTORY_IS_STARRED: 'history:is-starred',
  HISTORY_BOOKMARKS: 'history:bookmarks',
  HISTORY_FORGET: 'history:forget',
  HISTORY_FORGET_SINCE: 'history:forget-since',
  HISTORY_CLEAR: 'history:clear',
  /** Empties the browser's HTTP cache. Never touches cookies — see the handler. */
  BROWSER_CLEAR_CACHE: 'browser:clear-cache',

  // Skills (Claude skills discovery)
  SKILLS_LIST: 'skills:list',

  // Agents (user-defined personas)
  AGENTS_LIST: 'agents:list',
  AGENTS_READ: 'agents:read',
  AGENTS_WRITE: 'agents:write',
  AGENTS_DELETE: 'agents:delete',
  // Agent Foundry — the capability catalog (single source of truth for what a
  // specialist can be granted) + the meta-agent that AUTHORS a spec from a
  // plain-language description. BUILD returns a PROPOSAL; the UI previews and
  // the user approves, then calls AGENTS_WRITE.
  AGENTS_CAPABILITIES: 'agents:capabilities',
  AGENTS_BUILD: 'agents:build',

  // System status (engine/python/claude health)
  SYSTEM_STATUS: 'system:status',

  // System pasteboard. WOS-008: the renderer CANNOT use navigator.clipboard —
  // applySessionSecurity denies every permission request, which includes
  // `clipboard-read`, so readText() rejects. Rather than punch a hole in a
  // deliberate deny-all policy, clipboard access goes through Electron's own
  // module in main: no permission gate, no transient-activation requirement,
  // and testable without a browser clipboard mock.
  CLIPBOARD_READ: 'clipboard:read',
  CLIPBOARD_WRITE: 'clipboard:write',

  // Secret vault (OS-keychain-encrypted) — key NAMES + metadata cross IPC,
  // NEVER values. `secret:set` takes a value that leaves the renderer at once.
  SECRET_LIST: 'secret:list',
  SECRET_SET: 'secret:set',
  SECRET_REMOVE: 'secret:remove',
  SECRET_STATUS: 'secret:status',

  // MCP connectors — catalog, enable/disable, and per-connector readiness.
  MCP_LIST_CONNECTORS: 'mcp:list-connectors',
  MCP_ENABLE: 'mcp:enable',
  MCP_DISABLE: 'mcp:disable',
  MCP_STATUS: 'mcp:status',
  // Remote OAuth connectors (Path B) — run the PKCE loopback flow against the
  // server's own auth server and store the refresh token in the vault; report
  // connected state; disconnect (remove the stored record).
  MCP_OAUTH_CONNECT: 'mcp:oauth-connect',
  MCP_OAUTH_STATUS: 'mcp:oauth-status',
  MCP_OAUTH_DISCONNECT: 'mcp:oauth-disconnect',

  // Search index
  SEARCH_QUERY: 'search:query',
  SEARCH_SYMBOLS: 'search:symbols',
  SEARCH_INDEX_STATUS: 'search:index-status',

  // Knowledge base — [[wikilink]] backlinks graph over the workspace notes.
  LINKS_BACKLINKS: 'links:backlinks',
  LINKS_OUTGOING: 'links:outgoing',
  LINKS_STUBS: 'links:stubs',
  LINKS_RESOLVE: 'links:resolve',
  LINKS_GRAPH: 'links:graph',
  LINKS_RELATED: 'links:related',

  // Workspace memory (read-only Pulse cross-project insights)
  MEMORY_QUERY: 'memory:query',
  MEMORY_RECENT: 'memory:recent',
  MEMORY_STATUS: 'memory:status',

  // Mail (native IMAP client — read-only inbox, Phase 1)
  MAIL_ACCOUNTS_LIST: 'mail:accounts-list',
  MAIL_ACCOUNTS_ADD: 'mail:accounts-add',
  // Add the built-in demo mailbox (one click, no credentials, no network).
  MAIL_ACCOUNTS_ADD_DEMO: 'mail:accounts-add-demo',
  MAIL_ACCOUNTS_REMOVE: 'mail:accounts-remove',
  MAIL_ACCOUNTS_TEST: 'mail:accounts-test',
  MAIL_FOLDERS: 'mail:folders',
  MAIL_MESSAGES: 'mail:messages',
  MAIL_MESSAGE: 'mail:message',
  /** Fetch a message's remote images in MAIN and return them as data: URIs. */
  MAIL_REMOTE_IMAGES: 'mail:remote-images',
  // Mail (Phase 2: compose / reply / forward / send via SMTP)
  MAIL_SEND: 'mail:send',
  MAIL_SMTP_TEST: 'mail:smtp-test',
  // Mail (Phase 3: fuse inbound mail into the Agent Review / Living Feed)
  //  - triage a folder → the messages that plausibly need a human reply
  //  - draft a reply for one message (agent-drafted body; NEVER sends)
  // Local index: cache-first list, real full-text search, background sync.
  // Mutating verbs. Every one is journalled and undoable; there is no delete
  // (that is a move to Trash) and no expunge.
  MAIL_MOVE: 'mail:move',
  MAIL_SET_READ: 'mail:set-read',
  MAIL_SET_FLAGGED: 'mail:set-flagged',
  MAIL_UNDO: 'mail:undo',
  MAIL_UNDOABLE: 'mail:undoable',
  MAIL_UNDO_AGENT: 'mail:undo-agent',
  MAIL_FILING_PROPOSE: 'mail:filing-propose',
  MAIL_FILING_APPLY: 'mail:filing-apply',
  MAIL_WATCH_START: 'mail:watch-start',
  MAIL_WATCH_STOP: 'mail:watch-stop',
  MAIL_NEW_MAIL: 'mail:new-mail',
  MAIL_FOLDER_COUNTS: 'mail:folder-counts',
  MAIL_FOLDER_CREATE: 'mail:folder-create',
  MAIL_FOLDER_RENAME: 'mail:folder-rename',
  MAIL_FOLDER_DELETE: 'mail:folder-delete',
  MAIL_ATTACHMENT_SAVE: 'mail:attachment-save',
  MAIL_ATTACHMENT_OPEN: 'mail:attachment-open',
  MAIL_EXPORT_PDF: 'mail:export-pdf',
  MAIL_RAW_SOURCE: 'mail:raw-source',
  MAIL_CACHED: 'mail:cached',
  MAIL_CONTACTS: 'mail:contacts',
  MAIL_SAVE_DRAFT: 'mail:save-draft',
  MAIL_SEND_QUEUED: 'mail:send-queued',
  MAIL_SEND_CANCEL: 'mail:send-cancel',
  MAIL_SEND_NOW: 'mail:send-now',
  MAIL_SIGNATURE_GET: 'mail:signature-get',
  MAIL_SIGNATURE_SET: 'mail:signature-set',
  MAIL_SEARCH: 'mail:search',
  MAIL_SYNC: 'mail:sync',
  MAIL_INDEX_STATS: 'mail:index-stats',
  MAIL_TRIAGE: 'mail:triage',
  MAIL_SIFT: 'mail:sift',
  MAIL_DRAFT_REPLY: 'mail:draft-reply',
  // Mail (advanced 1:1 email): the everyday compose/reply, richer than a plain
  // box. All NEVER send — sending reuses MAIL_SEND with the compiled html + text.
  //  - RICH_BUILD: assemble a chosen theme + structured blocks → responsive HTML
  //    + plain-text fallback, with live {{metric:<id>}} tokens resolved true.
  //  - RICH_DRAFT: a one-line brief → agent-authored MJML → responsive HTML.
  //  - RICH_ASSIST: current draft + an action (tighten/clearer/warmer/…) → revised body.
  //  - LIVE_DATA: list the workspace metrics + ranges for the "insert live data" picker.
  MAIL_RICH_BUILD: 'mail:rich-build',
  MAIL_RICH_DRAFT: 'mail:rich-draft',
  MAIL_RICH_ASSIST: 'mail:rich-assist',
  MAIL_LIVE_DATA: 'mail:live-data',
  /** Spreadsheet + intent → agent-authored email blocks. */
  MAIL_DRAFT_FROM_FILE: 'mail:draft-from-file',
  /** Native picker for the spreadsheet the email is built from. */
  MAIL_PICK_WORKBOOK: 'mail:pick-workbook',
  // Mail (OAuth): is Google sign-in configured?; run the loopback OAuth flow and
  // create an xoauth2 account (stored secret = refresh token, never a password).
  MAIL_OAUTH_CONFIGURED: 'mail:oauth-configured',
  MAIL_OAUTH_GOOGLE: 'mail:oauth-google',
  // Mail (OAuth, Microsoft): consumer Outlook/Hotmail/Live/MSN require OAuth since
  // Microsoft disabled basic auth in 2024. Same shape as the Google pair.
  MAIL_OAUTH_MICROSOFT_CONFIGURED: 'mail:oauth-microsoft-configured',
  MAIL_OAUTH_MICROSOFT: 'mail:oauth-microsoft',
  MAIL_OAUTH_SET_CLIENT_ID: 'mail:oauth-set-client-id',
  // Mail (autoconfig): email address → resolved IMAP/SMTP settings (curated
  // provider table → Mozilla ISPDB → heuristic guess). Fills the Add Account
  // dialog's server fields with one lookup. No secrets involved.
  MAIL_AUTOCONFIG: 'mail:autoconfig',

  // Brand kit — the user's brand (palette/fonts/logo/voice), codified once and
  // flowed into agent-generated output. NOT secret — plain app data in userData.
  //  - BRAND_GET: read the current brand (a sensible default when unset).
  //  - BRAND_SET: apply a validated partial patch (name/palette/fonts/voice…).
  //  - BRAND_SET_LOGO: copy logo bytes into userData/brand/ and point the brand at it.
  BRAND_GET: 'brand:get',
  BRAND_SET: 'brand:set',
  BRAND_SET_LOGO: 'brand:set-logo',

  // Connected Accounts — the user signs into a website ONCE by hand in the
  // in-app browser (persistent partition); we manage the SESSION lifecycle + a
  // non-secret record per site. NO credential ever crosses this boundary.
  //  - LIST: recorded entries + a live `hasSession` flag (cookies exist? bool only).
  //  - ADD:  record intent for a domain (does NOT log in). The UI opens a login tab.
  //  - SIGNOUT: clear that site's session data from the partition + drop the entry.
  ACCOUNTS_LIST: 'accounts:list',
  ACCOUNTS_ADD: 'accounts:add',
  ACCOUNTS_SIGNOUT: 'accounts:signout',

  // Connections — ONE roster over the MCP vault, Connected Accounts and the
  // mail / calendar / drive stores, with a COMPUTED status (probe verdicts,
  // cached ten minutes). LIST returns presence booleans only; SIGNOUT routes
  // by id prefix to the owning store. No secret value ever crosses here.
  CONNECTIONS_LIST: 'connections:list',
  CONNECTIONS_SIGNOUT: 'connections:signout',

  // Background runs — main-owned agent runs that survive the window (routines,
  // unattended work). Safe mode only, idle timeout. Their stream rides the
  // agent:* channels keyed by job id; UPDATED carries the persisted job record.
  RUNS_ENQUEUE: 'runs:enqueue',
  RUNS_LIST: 'runs:list',
  RUNS_CANCEL: 'runs:cancel',
  RUNS_UPDATED: 'runs:updated',

  // Routines — agents on the app's own clock. Each fire is a background run
  // with the routine's id, label and exactly its capabilities.
  ROUTINES_LIST: 'routines:list',
  ROUTINES_SAVE: 'routines:save',
  ROUTINES_DELETE: 'routines:delete',
  ROUTINES_RUN_NOW: 'routines:run-now',
  ROUTINES_DESCRIBE: 'routines:describe',
  ROUTINES_UPDATED: 'routines:updated',

  // Needs-you notifications (local, Electron Notification). REQUEST is how
  // the renderer's sources (approvals) ask; OPEN is main → renderer after a
  // click, naming the rail to show.
  NOTIFY_PREFS: 'notify:prefs',
  NOTIFY_SET_PREFS: 'notify:set-prefs',
  NOTIFY_REQUEST: 'notify:request',
  NOTIFY_RECENT: 'notify:recent',
  NOTIFY_OPEN: 'notify:open',

  // Window
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
