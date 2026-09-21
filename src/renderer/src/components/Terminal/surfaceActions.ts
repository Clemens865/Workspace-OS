import {
  FilePlus, FolderPlus, Search, FolderOpen, FileDown, FileText, CopyPlus,
  PenSquare, RefreshCw, Reply, StickyNote, Link2,
  Globe, Camera, ScanText, Map as MapIcon, ShieldCheck, Telescope,
  MousePointerClick, Cookie, MoveVertical, Hourglass, ArrowLeft, ArrowRight, Keyboard,
  Brain, Share2,
  type LucideIcon,
} from 'lucide-react'
import { categoryOf, OFFICE } from '../../lib/fileCategory'
import {
  requestNewTab,
  requestTabs,
  requestCloseTab,
  requestActivateTab,
} from '../Browser/browserTabCommands'

/**
 * PER-SURFACE ACTION TOOLSETS — a data-driven map of `surface → Action[]`.
 *
 * Each surface (Files, Document, …) exposes a small, calm set of actions that
 * are (a) rendered as quick-action chips in the terminal dock and (b) enumerated
 * to the in-app agent via each action's `agentHint`, so the agent KNOWS what it
 * can do where the user is. Actions REUSE the existing `window.workspace.*` APIs
 * (fs / lok / office / search) + the existing `wos:*` renderer events — no new IPC.
 *
 * Kept pure + free of React so the registry is unit-testable in the node vitest
 * environment. Components import `actionsForSurface(ctx)`; adding an action is
 * data here, not new plumbing in each surface.
 */

/** Pulls plain text out of whatever shape browser.extract returned. */
function extractedText(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const d = data as { text?: unknown; content?: unknown }
    if (typeof d.text === 'string') return d.text
    if (typeof d.content === 'string') return d.content
  }
  return ''
}

/** The live harness the dock hands each action to run against. */
export interface SurfaceActionContext {
  root: string | null
  surface: string | null
  folder: string | null
  openFile: string | null
}

export interface SurfaceAction {
  id: string
  label: string
  /** The surface this action belongs to ('files' | 'document'). */
  surface: string
  icon: LucideIcon
  /** One blue primary per surface; the rest render quiet. */
  primary?: boolean
  /** Gate: only offered when this returns true for the live context. */
  appliesTo?: (ctx: SurfaceActionContext) => boolean
  /**
   * Perform the action against the live harness. Reuses window.workspace.*.
   * `args` is the optional JSON the agent passes to `wos-action run <id> <json>`
   * (e.g. {url} for browser.navigate); UI-only actions ignore it. A RETURNED
   * value (e.g. extracted page data / a screenshot path) becomes the `result`
   * the AGENT→ACTION bridge relays back to the agent as {ok, result}; void is
   * fine for UI-only actions.
   */
  run: (ctx: SurfaceActionContext, args?: unknown) => Promise<unknown> | unknown
  /** A short capability sentence enumerated to the agent preamble. */
  agentHint: string
}

/** The pseudo-surface used when a document is open (openFile present). */
export const DOCUMENT_SURFACE = 'document'

const basename = (p: string): string => p.split('/').pop() ?? p

/** True when the open file is an office type the doc engine can export/convert. */
export function isOfficeFile(openFile: string | null): boolean {
  return !!openFile && OFFICE.has(categoryOf(openFile))
}

/** Reveal a path in the Files surface (reuses the existing renderer event). */
function revealInFiles(target: string | null): void {
  window.dispatchEvent(new CustomEvent('wos:reveal-path', { detail: target ?? undefined }))
}

/** Open the workspace quick-open / search palette (renderer event, no IPC). */
function openQuickOpen(): void {
  window.dispatchEvent(new CustomEvent('wos:quick-open'))
}

/** Fire a renderer-only CustomEvent (the reveal-path/quick-open pattern; no IPC). */
function emit(type: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(type, detail === undefined ? undefined : { detail }))
}

// ── Files surface ──────────────────────────────────────────────────────────
const FILES_ACTIONS: SurfaceAction[] = [
  {
    id: 'files.new-document',
    label: 'New document',
    surface: 'files',
    icon: FilePlus,
    primary: true,
    // Create a Word doc via the doc engine, like FilePanel's New menu does.
    run: async () => {
      await window.workspace.lok.newDoc('docx', 'New Document.docx')
    },
    agentHint: 'create a new document (docx/xlsx/pptx/md) in the workspace',
  },
  {
    id: 'files.new-folder',
    label: 'New folder',
    surface: 'files',
    icon: FolderPlus,
    // Create a folder in the current folder (or root) via fs.create.
    run: async (ctx) => {
      const dir = ctx.folder ?? ctx.root
      if (!dir) return
      await window.workspace.fs.create(dir, 'New Folder', true)
    },
    agentHint: 'create a new folder in the current folder',
  },
  {
    id: 'files.search',
    label: 'Search workspace',
    surface: 'files',
    icon: Search,
    run: () => openQuickOpen(),
    agentHint: 'search the whole workspace for a file or symbol',
  },
  {
    id: 'files.reveal-folder',
    label: 'Reveal current folder',
    surface: 'files',
    icon: FolderOpen,
    appliesTo: (ctx) => !!(ctx.folder ?? ctx.root),
    run: (ctx) => window.workspace.fs.reveal(ctx.folder ?? ctx.root!),
    agentHint: 'reveal the current folder in the OS file browser',
  },
]

// ── Document surface (openFile present) ──────────────────────────────────────
const DOCUMENT_ACTIONS: SurfaceAction[] = [
  {
    id: 'document.export-pdf',
    label: 'Export as PDF',
    surface: DOCUMENT_SURFACE,
    icon: FileDown,
    primary: true,
    // Office-only: the bundled doc engine converts + a save dialog picks the target.
    appliesTo: (ctx) => isOfficeFile(ctx.openFile),
    run: async (ctx) => {
      if (!ctx.openFile) return
      await window.workspace.office.exportPdf(ctx.openFile)
    },
    agentHint: 'export this document to PDF',
  },
  {
    id: 'document.export-word',
    label: 'Export as Word',
    surface: DOCUMENT_SURFACE,
    icon: FileText,
    // Office-only: reuse the LOK engine's exportAs on the open doc.
    appliesTo: (ctx) => isOfficeFile(ctx.openFile),
    run: async () => {
      await window.workspace.lok.exportAs('docx')
    },
    agentHint: 'export this document to Word (.docx)',
  },
  {
    id: 'document.duplicate',
    label: 'Duplicate',
    surface: DOCUMENT_SURFACE,
    icon: CopyPlus,
    appliesTo: (ctx) => !!ctx.openFile,
    run: async (ctx) => {
      if (!ctx.openFile) return
      await window.workspace.fs.saveCopyDialog(ctx.openFile)
    },
    agentHint: 'duplicate (save a copy of) this file',
  },
  {
    id: 'document.reveal',
    label: 'Reveal in Files',
    surface: DOCUMENT_SURFACE,
    icon: FolderOpen,
    appliesTo: (ctx) => !!ctx.openFile,
    run: (ctx) => revealInFiles(ctx.openFile),
    agentHint: 'reveal this file in the Files surface',
  },
  {
    id: 'document.backlinks',
    label: 'Show backlinks',
    surface: DOCUMENT_SURFACE,
    icon: Link2,
    // Knowledge, for the open file: switch to the Knowledge rail and show which
    // notes link here (the panel reuses links.backlinks). Renderer event, no IPC.
    appliesTo: (ctx) => !!ctx.openFile,
    run: (ctx) => emit('wos:knowledge-backlinks', ctx.openFile),
    agentHint: 'show which notes link to this file (its backlinks)',
  },
]

// ── Mail surface ─────────────────────────────────────────────────────────────
// Every action is NON-DESTRUCTIVE: Compose/Reply only OPEN a prefilled draft in
// the MailPanel UI — no action here ever calls window.workspace.mail.send.
// Sending stays behind the user's own compose→send in the composer.
const MAIL_ACTIONS: SurfaceAction[] = [
  {
    id: 'mail.compose',
    label: 'Compose',
    surface: 'mail',
    icon: PenSquare,
    primary: true,
    // Opens a NEW empty draft in the composer (MailPanel listens). Never sends.
    run: () => emit('wos:mail-compose'),
    agentHint: 'open a new email draft in the composer (the user sends it, not you)',
  },
  {
    id: 'mail.reply',
    label: 'Reply',
    surface: 'mail',
    icon: Reply,
    // Opens a prefilled reply draft for the message the user has open (no-op if
    // none is open). ONLY opens a draft — it never sends.
    run: () => emit('wos:mail-reply'),
    agentHint: 'open a prefilled reply draft for the open message (opens only, never sends)',
  },
  {
    id: 'mail.search',
    label: 'Search mail',
    surface: 'mail',
    icon: Search,
    // Focuses the MailPanel's in-list message filter (renderer event, no IPC).
    run: () => emit('wos:mail-search'),
    agentHint: 'filter the current mailbox by sender or subject',
  },
  {
    id: 'mail.refresh',
    label: 'Refresh inbox',
    surface: 'mail',
    icon: RefreshCw,
    // Re-reads the active account's folders + messages (MailPanel listens).
    run: () => emit('wos:mail-refresh'),
    agentHint: 'refresh the mailbox (re-read folders and messages)',
  },
]

// ── Knowledge surface ────────────────────────────────────────────────────────
const KNOWLEDGE_ACTIONS: SurfaceAction[] = [
  {
    id: 'knowledge.search',
    label: 'Search knowledge',
    surface: 'knowledge',
    icon: Search,
    primary: true,
    // Reuse the existing workspace search palette (same event as Files search).
    run: () => openQuickOpen(),
    agentHint: 'search the knowledge base / workspace for a note',
  },
  {
    id: 'knowledge.new-note',
    label: 'New note',
    surface: 'knowledge',
    icon: StickyNote,
    // Create a new markdown note in the current folder (or root) via fs.create,
    // then reveal it in Files (the existing reveal-path event).
    run: async (ctx) => {
      const dir = ctx.folder ?? ctx.root
      if (!dir) return
      const path = await window.workspace.fs.create(dir, 'New Note.md', false)
      revealInFiles(path)
    },
    agentHint: 'create a new markdown note in the workspace',
  },
]

// ── Browser surface (agent-drives the visible in-app webview) ────────────────
// RESEARCH FLOW. For a COMPANY/site, prefer ONE `browser.deepRead {url}`: it
// navigates → clears consent → maps → visits the top About/Products/Team/Contact
// subpages → and returns a clean PROFILE ({name,homepage,pages,emails,phones,
// socials}) in a single call. To browse MANUALLY: navigate → clearConsent → map
// (structured links-by-category + interactives + consent) → click into a mapped
// About/Products link (by text/href) → extract. Fall back to dismissCookies +
// click / scroll / waitFor / type for anything bespoke, then extract/screenshot.
// The agent drives the VISIBLE Browser <webview> so the user watches. Each action
// RETURNS its main-side result so the bridge relays it back. The agent NEVER
// supplies JS: every script is FIXED and parameterized ONLY by vetted, escaped
// simple inputs — it picks WHAT to read/click, never runs its own code. http(s)
// only, sandbox intact.
const BROWSER_ACTIONS: SurfaceAction[] = [
  {
    id: 'browser.navigate',
    label: 'Open URL',
    surface: 'browser',
    icon: Globe,
    primary: true,
    // Switch to the Browser rail first (so the user SEES it + the guest exists),
    // then load the URL. Returns {ok,url,title} for the agent.
    run: async (_ctx, args) => {
      const a = (args ?? {}) as { url?: unknown; tab?: unknown }
      const url = typeof a.url === 'string' ? a.url : ''
      const tab = typeof a.tab === 'string' ? a.tab : undefined
      // Only auto-open the Browser rail when driving the ACTIVE tab; a `tab`-scoped
      // call targets an already-open background tab (don't steal focus).
      if (!tab) emit('wos:browser-navigate')
      // Give the rail a beat to mount the webview before the first drive call.
      await new Promise((r) => setTimeout(r, 150))
      return window.workspace.browser.navigate(url, tab)
    },
    agentHint: 'open a web page in the in-app browser (arg: {"url":"https://…"}; optional {"tab":"<id>"} to target a specific tab from browser.newTab); returns the final url + title',
  },
  {
    id: 'browser.screenshot',
    label: 'Screenshot page',
    surface: 'browser',
    icon: Camera,
    // Capture the visible page to a PNG (arg: {destPath}); returns {ok,path}.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { destPath?: unknown; tab?: unknown }
      return window.workspace.browser.screenshot(
        typeof a.destPath === 'string' ? a.destPath : undefined,
        typeof a.tab === 'string' ? a.tab : undefined,
      )
    },
    agentHint: 'screenshot a browser page to a PNG (optional {"destPath":"…/shot.png"}, optional {"tab":"<id>"}); returns the saved path',
  },
  {
    id: 'browser.shareWithClaude',
    label: 'Give Claude this page',
    surface: 'browser',
    icon: Share2,
    primary: true,
    /**
     * Hands the page the user is looking at to whatever is running in the
     * terminal — including a plain `claude` in zsh, which knows nothing about
     * this app.
     *
     * The gap this closes: an agent started in the terminal can DRIVE the
     * browser but has no idea where the browser already is, so "can you see
     * this job posting?" gets "nothing came through with your message" — a
     * correct answer to a question the harness never passed along.
     *
     * It writes a file rather than pasting the page into the terminal. Reading
     * a file is every coding agent's native move, needs no knowledge of
     * `wos-action`, survives a huge page without flooding the scrollback, and
     * leaves something the user can inspect. The terminal only receives one
     * line pointing at it.
     */
    run: async (ctx) => {
      const cur = (await window.workspace.browser.current()) as {
        ok: boolean
        url?: string
        title?: string
      }
      if (!cur?.ok || !cur.url) return { error: 'No page is open in the browser.' }

      const ex = (await window.workspace.browser.extract('text')) as { ok: boolean; data?: unknown }
      const text = extractedText(ex.ok ? ex.data : '')
      const root = ctx.root
      if (!root) return { error: 'No workspace is open, so there is nowhere to put the page.' }

      // Alongside agent-context.json, which is already the place this app
      // leaves things for agents to read.
      const dest = `${root}/.workspace-os/current-page.md`
      const body = [
        `# ${cur.title || cur.url}`,
        '',
        `Source: ${cur.url}`,
        `Captured: ${new Date().toISOString()}`,
        '',
        '---',
        '',
        text || '(the page had no readable text)',
        '',
      ].join('\n')
      await window.workspace.fs.writeFile(dest, body)

      return {
        path: dest,
        url: cur.url,
        title: cur.title ?? '',
        // The dock types this into the active shell. NOT submitted — the user
        // presses Enter, so a button never puts words in their session.
        insert: `Read .workspace-os/current-page.md — it's the page I'm looking at (${cur.url})`,
      }
    },
    agentHint:
      'capture the page the user is looking at to .workspace-os/current-page.md and return its path — use this when asked about "this page" or "what I am looking at"',
  },
  {
    id: 'browser.extract',
    label: 'Extract page data',
    surface: 'browser',
    icon: ScanText,
    // Read page data via a FIXED script (mode: text|links|tables|meta); returns {ok,data}.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { mode?: 'text' | 'links' | 'tables' | 'meta'; tab?: unknown }
      return window.workspace.browser.extract(a.mode, typeof a.tab === 'string' ? a.tab : undefined)
    },
    agentHint: 'extract data from a browser page (arg: {"mode":"text|links|tables|meta"}; optional {"tab":"<id>"}); returns structured JSON',
  },
  {
    id: 'browser.map',
    label: 'Map page',
    surface: 'browser',
    icon: MapIcon,
    // FIXED read-only perception: links bucketed by category (about/team/products/
    // contact/careers, EN+DE), interactives, h1/h2 headings, and a consent hint.
    run: (_ctx, args) =>
      window.workspace.browser.map(typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : undefined),
    agentHint: 'perceive a page structure (optional {"tab":"<id>"}); returns {title,headings,links:[{text,href,category}],interactives,consent}. Use it to find the About/Products/Team/Contact links to click into.',
  },
  {
    id: 'browser.deepRead',
    label: 'Deep read site',
    surface: 'browser',
    icon: Telescope,
    // One-shot company research: navigate → clearConsent → map → visit the top
    // same-origin subpages by category → extract → assemble a clean profile.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { url?: string; maxPages?: number; focus?: string; tab?: string }
      const url = typeof a.url === 'string' ? a.url : ''
      const tab = typeof a.tab === 'string' ? a.tab : undefined
      if (!tab) emit('wos:browser-navigate')
      return (async () => {
        await new Promise((r) => setTimeout(r, 150))
        return window.workspace.browser.deepRead({ url, maxPages: a.maxPages, focus: a.focus, tab })
      })()
    },
    agentHint: 'DEEP-READ a whole company/site in one call (arg: {"url":"https://…","maxPages"?:4,"focus"?:"team"}; optional {"tab":"<id>"} to read in a specific tab); navigates + clears consent + maps + visits the top About/Products/Team/Contact pages, returns a PROFILE {name,homepage,pages,emails,phones,socials}. Prefer this for company research. For PARALLEL research, open one tab per item with browser.newTab and deepRead each by its tab id.',
  },
  {
    id: 'browser.dismissCookies',
    label: 'Dismiss cookies',
    surface: 'browser',
    icon: Cookie,
    // Fixed heuristic: find + click the first visible cookie ACCEPT/OK button.
    // No arg; returns {ok,clicked,label}. Best-effort ({clicked:false} if none).
    run: (_ctx, args) =>
      window.workspace.browser.dismissCookies(typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : undefined),
    agentHint: 'dismiss a cookie-consent banner by clicking Accept/OK (optional {"tab":"<id>"}); returns {clicked,label}. Run this right after navigate.',
  },
  {
    id: 'browser.clearConsent',
    label: 'Clear consent',
    surface: 'browser',
    icon: ShieldCheck,
    // Hardened: overlay accept, THEN consent-wall pages, THEN same-origin iframes
    // (cross-origin frames are inaccessible and skipped). Best-effort.
    run: (_ctx, args) =>
      window.workspace.browser.clearConsent(typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : undefined),
    agentHint: 'clear consent robustly — overlay banners, consent-WALL pages, AND same-origin iframes (optional {"tab":"<id>"}); returns {cleared,method,wasWall}. Prefer this over dismissCookies when a page is gated by a consent wall.',
  },
  {
    id: 'browser.click',
    label: 'Click element',
    surface: 'browser',
    icon: MousePointerClick,
    // Click the first VISIBLE element matching a CSS selector OR visible text.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { selector?: string; text?: string; tab?: string }
      return window.workspace.browser.click({ selector: a.selector, text: a.text, tab: a.tab })
    },
    agentHint: 'click a page element by CSS selector OR visible text (arg: {"selector":"…"} or {"text":"Products"}; optional {"tab":"<id>"}); returns {clicked,tag,text,href}',
  },
  {
    id: 'browser.scroll',
    label: 'Scroll page',
    surface: 'browser',
    icon: MoveVertical,
    // Scroll to top/bottom or by an amount; helps lazy content + full capture.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { to?: 'top' | 'bottom'; by?: number; tab?: string }
      return window.workspace.browser.scroll({ to: a.to, by: a.by, tab: a.tab })
    },
    agentHint: 'scroll the page (arg: {"to":"top|bottom"} or {"by":800}; optional {"tab":"<id>"}); returns {scrollY,atBottom} — use for lazy-loaded content',
  },
  {
    id: 'browser.waitFor',
    label: 'Wait for element',
    surface: 'browser',
    icon: Hourglass,
    // Poll in-page (capped, default 8s) until a selector/text appears.
    run: (_ctx, args) => {
      const a = (args ?? {}) as { selector?: string; text?: string; timeoutMs?: number; tab?: string }
      return window.workspace.browser.waitFor({ selector: a.selector, text: a.text, timeoutMs: a.timeoutMs, tab: a.tab })
    },
    agentHint: 'wait until an element appears (arg: {"selector":"…"} or {"text":"…"}, optional {"timeoutMs":8000}, optional {"tab":"<id>"}); returns {found} — use after a click/nav before extract',
  },
  {
    id: 'browser.back',
    label: 'Go back',
    surface: 'browser',
    icon: ArrowLeft,
    run: (_ctx, args) =>
      window.workspace.browser.back(typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : undefined),
    agentHint: 'go back in browser history (optional {"tab":"<id>"}); returns the settled {url}',
  },
  {
    id: 'browser.forward',
    label: 'Go forward',
    surface: 'browser',
    icon: ArrowRight,
    run: (_ctx, args) =>
      window.workspace.browser.forward(typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : undefined),
    agentHint: 'go forward in browser history (optional {"tab":"<id>"}); returns the settled {url}',
  },
  {
    id: 'browser.type',
    label: 'Type into input',
    surface: 'browser',
    icon: Keyboard,
    // Set an input's value (the text is DATA into .value, never executed JS).
    run: (_ctx, args) => {
      const a = (args ?? {}) as { selector?: string; text?: string; tab?: string }
      return window.workspace.browser.type({ selector: a.selector, text: a.text, tab: a.tab })
    },
    agentHint: 'type text into an input/textarea (arg: {"selector":"input[name=q]","text":"hello"}; optional {"tab":"<id>"}); returns {typed,tag}',
  },
  // ── Tab management (Stage 2): agents can open/list/close/activate tabs, so
  // different agents/subagents drive different tabs without colliding. ──────────
  {
    id: 'browser.newTab',
    label: 'New browser tab',
    surface: 'browser',
    icon: Globe,
    // Create a tab in the BrowserSurface + await its guest registration, so the
    // returned tabId is immediately drivable via the `tab` param on any action.
    run: async (_ctx, args) => {
      const a = (args ?? {}) as { url?: unknown; focus?: unknown }
      const url = typeof a.url === 'string' ? a.url : undefined
      const focus = a.focus === undefined ? undefined : !!a.focus
      // Make sure the Browser rail is mounted so the tab can be created + attach.
      emit('wos:browser-navigate')
      await new Promise((r) => setTimeout(r, 150))
      return requestNewTab(url, focus)
    },
    agentHint: 'open a NEW browser tab (optional {"url":"https://…","focus":true}); returns {tabId} once the tab is ready to drive. For PARALLEL research, open one tab per item and drive each by its tab id (pass {"tab":"<tabId>"} to navigate/deepRead/extract/…).',
  },
  {
    id: 'browser.tabs',
    label: 'List browser tabs',
    surface: 'browser',
    icon: MapIcon,
    run: () => requestTabs(),
    agentHint: 'list the open browser tabs (no arg); returns [{id,url,title,active}]. Use the ids as the "tab" param on drive actions.',
  },
  {
    id: 'browser.closeTab',
    label: 'Close browser tab',
    surface: 'browser',
    icon: ArrowLeft,
    run: (_ctx, args) => {
      const id = typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : ''
      return requestCloseTab(id)
    },
    agentHint: 'close a browser tab (arg: {"tab":"<id>"}); returns {ok}.',
  },
  {
    id: 'browser.activateTab',
    label: 'Activate browser tab',
    surface: 'browser',
    icon: ArrowRight,
    run: (_ctx, args) => {
      const id = typeof (args as { tab?: unknown })?.tab === 'string' ? (args as { tab: string }).tab : ''
      return requestActivateTab(id)
    },
    agentHint: 'bring a browser tab to the front (arg: {"tab":"<id>"}); returns {ok}.',
  },
]


/**
 * MEMORY surface — durable recall the agent writes and reads.
 *
 * Routed through the action bridge rather than a standalone CLI on purpose: the
 * store is SQLite, and a bundled CLI cannot resolve better-sqlite3's native
 * binding. The app already owns an open database and a validated agent bridge,
 * so memory rides that instead of shipping a second, fragile path.
 *
 * `memory.remember` is non-destructive (it only ever adds or reinforces), and
 * `memory.forget` is deliberately NOT registered — an agent that can silently
 * erase what you taught it is a worse failure than one that cannot forget.
 * Forgetting stays a human action in the Memory panel.
 */
const MEMORY_ACTIONS: SurfaceAction[] = [
  {
    id: 'memory.remember',
    label: 'Remember',
    surface: 'memory',
    icon: Brain,
    run: async (_ctx, args) => {
      const a = (args ?? {}) as { text?: string; kind?: string; source?: string; scope?: string; tags?: string[] }
      if (!a.text) throw new Error('memory.remember needs {"text": "..."}')
      return window.workspace.memory.remember({
        text: a.text,
        kind: (a.kind as 'fact' | 'preference' | 'decision' | 'entity') ?? 'fact',
        source: a.source || 'agent run',
        ...(a.scope === 'global' ? { scope: 'global' as const } : {}),
        ...(Array.isArray(a.tags) ? { tags: a.tags } : {}),
      })
    },
    agentHint:
      'remember something durable for next time — `wos-action run memory.remember \'{"text":"<the fact>","kind":"decision|fact|preference|entity","source":"<where you learned it>"}\'`. Record only what will still be true later, not this run\'s chatter. Add "scope":"global" for a fact about the PERSON rather than this project.',
  },
  {
    id: 'memory.search',
    label: 'Recall',
    surface: 'memory',
    icon: Brain,
    run: async (_ctx, args) => {
      const a = (args ?? {}) as { query?: string; limit?: number }
      return window.workspace.memory.search(a.query ?? '', Math.min(50, Math.max(1, a.limit ?? 10)))
    },
    agentHint:
      'recall what is already known — `wos-action run memory.search \'{"query":"<topic>"}\'`. Check this before asking the user something they may have told you before.',
  },
]

/** The registry: surface id → its actions (before context gating). */
export const SURFACE_ACTIONS: Record<string, SurfaceAction[]> = {
  files: FILES_ACTIONS,
  [DOCUMENT_SURFACE]: DOCUMENT_ACTIONS,
  mail: MAIL_ACTIONS,
  knowledge: KNOWLEDGE_ACTIONS,
  browser: BROWSER_ACTIONS,
  memory: MEMORY_ACTIONS,
}

/**
 * Every registered action across all surfaces, flattened. The single source of
 * truth the AGENT→ACTION bridge validates against: the socket server only lets
 * the agent invoke an id that appears here, and the renderer executor only runs
 * one it can resolve here. Every action is NON-DESTRUCTIVE by construction (see
 * the surface lists above — no send/delete is ever registered).
 */
export const ALL_ACTIONS: SurfaceAction[] = Object.values(SURFACE_ACTIONS).flat()

const ACTIONS_BY_ID = new Map(ALL_ACTIONS.map((a) => [a.id, a]))

/** Look up a registered action by its stable id (undefined when unknown). */
export function actionById(id: string): SurfaceAction | undefined {
  return ACTIONS_BY_ID.get(id)
}

/** A compact manifest {id, agentHint} for a live harness — pushed to main so the
 *  agent preamble can enumerate what it can run right here. */
export function actionManifest(ctx: SurfaceActionContext): { id: string; agentHint: string }[] {
  return agentActionsForSurface(ctx).map((a) => ({ id: a.id, agentHint: a.agentHint }))
}

/**
 * Resolve the ACTIVE surface for a harness: an open file means the user is on a
 * document (regardless of which rail is showing), otherwise the rail surface.
 */
export function activeSurface(ctx: SurfaceActionContext): string | null {
  if (ctx.openFile) return DOCUMENT_SURFACE
  return ctx.surface
}

/**
 * The actions available for the live harness, in registry order, after applying
 * each action's `appliesTo` gate (e.g. office-only export actions). Pure. This
 * is the DOCK-chip set — strictly the current surface's own actions.
 */
export function actionsForSurface(ctx: SurfaceActionContext): SurfaceAction[] {
  const surface = activeSurface(ctx)
  const list = surface ? SURFACE_ACTIONS[surface] ?? [] : []
  return list.filter((a) => (a.appliesTo ? a.appliesTo(ctx) : true))
}

/**
 * The actions offered to the AGENT for a harness. Superset of the dock set: the
 * browser-drive actions (navigate → screenshot → extract) are AMBIENT — the
 * agent can research from any surface (navigate auto-opens the Browser rail so
 * the user watches) — so they are appended, never duplicated on the Browser
 * surface itself. This drives the agent manifest/preamble, not the dock chips.
 */
export function agentActionsForSurface(ctx: SurfaceActionContext): SurfaceAction[] {
  const own = actionsForSurface(ctx)
  if (activeSurface(ctx) === 'browser') return own
  return [...own, ...SURFACE_ACTIONS.browser]
}

/**
 * A one-line capability sentence for the agent preamble, enumerating what the
 * agent can do on the current surface (empty string when nothing applies).
 * e.g. "Here you can: export this document to PDF; export this document to
 * Word (.docx); duplicate (save a copy of) this file; reveal this file in Files."
 */
export function agentActionsHint(ctx: SurfaceActionContext): string {
  const actions = agentActionsForSurface(ctx)
  if (actions.length === 0) return ''
  const where = ctx.openFile
    ? `this ${categoryOf(ctx.openFile)} (${basename(ctx.openFile)})`
    : 'here'
  return `Available actions ${where === 'here' ? 'here' : `for ${where}`}: ${actions
    .map((a) => a.agentHint)
    .join('; ')}.`
}
