import { sendToWindow } from './main-window'
import type { MI } from './menu-office'

/**
 * The Browser menu — a native view over the SAME actions the in-window panel
 * offers.
 *
 * The panel (page-actions.ts) already owns the vocabulary: ids, plain-language
 * labels, and the shortcut for each. Its own note states the intent — "the
 * palette and this list are the same data, so speed and discovery never drift
 * apart" — and a menu written from a second hand-maintained list would be
 * exactly the drift it warns about. So the renderer PUSHES its action list here
 * and the menu is built from it. A new browser action appears in both places or
 * in neither; there is no third list to forget.
 *
 * This matters more than it sounds. Bookmarks worked from the first day and were
 * invisible for months because the only way in was a shortcut nobody had been
 * told about. The menu bar is where people LOOK for "Bookmarks" — and it is
 * outside the window, so it costs no space that the page could have used.
 *
 * Clicks send the same `menu:run-action` ids the panel sends, which the browser
 * surface already routes. Nothing new to handle.
 */

/** One action as the renderer describes it. Mirrors page-actions.ts. */
export interface BrowserAction {
  id: string
  label: string
  shortcut?: string
  /** 0 means "not relevant to this page" — shown, but disabled. */
  relevance: number
}

/** Everything the menu needs to know about the browser's current state. */
export interface BrowserContext {
  actions: BrowserAction[]
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * macOS accelerators, derived from the label the panel already displays.
 *
 * Parsed rather than declared separately for the same reason the actions are
 * pushed rather than restated: two lists of key bindings drift, and the panel's
 * is the one a user has already read. A shortcut the parser does not recognise
 * simply gets no accelerator — the item still works from the menu.
 */
function accelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined
  const key = shortcut.replace(/[⌘⇧⌥⌃]/g, '')
  const mods = [
    shortcut.includes('⌘') ? 'CmdOrCtrl' : '',
    shortcut.includes('⇧') ? 'Shift' : '',
    shortcut.includes('⌥') ? 'Alt' : '',
  ].filter(Boolean)
  const named: Record<string, string> = { '+': 'Plus', '−': '-', '-': '-', '0': '0' }
  const k = named[key] ?? (key.length === 1 ? key.toUpperCase() : key)
  if (!k) return undefined
  return [...mods, k].join('+')
}

/**
 * Builds the single `Browser` menu for the browser surface.
 *
 * Named after the SURFACE, not the category — Browser, and later Mail and
 * Files. A menu bar whose shape changes per surface is only learnable if the
 * rule is simple, and "the menu named after where you are holds what you can do
 * here" is simpler than remembering that the browser contributes History while
 * mail would contribute something else. It is also the only natural home for
 * per-surface settings: `Browser ▸ Settings…` reads; `History ▸ Settings…` does
 * not.
 *
 * It costs a small break with macOS convention — Safari and Chrome put History
 * and Bookmarks at the top level — but this is not a browser, it is one surface
 * inside an app, and consistency across surfaces is worth more here than
 * matching a dedicated browser's menu bar.
 *
 * PAGE zoom lives here rather than in View. View carries the app's own zoom,
 * and two different zooms in one menu is a muddle: "Make the text bigger"
 * (this page) sat three items from "Zoom In" (the whole window).
 */
export function browserMenus(ctx: BrowserContext): { browser: MI } {
  const send = (id: string): void => sendToWindow('menu:run-action', id)
  const byId = new Map(ctx.actions.map((a) => [a.id, a]))

  /** An item for a pushed action, or nothing when the renderer did not offer it. */
  const item = (id: string, override?: string): MI | null => {
    const a = byId.get(id)
    if (!a) return null
    return {
      label: override ?? a.label,
      accelerator: accelerator(a.shortcut),
      // relevance 0 means the page cannot support it (no page, no table).
      // Shown greyed rather than hidden: a menu that changes shape as you browse
      // is harder to learn than one whose items are sometimes unavailable.
      enabled: a.relevance > 0,
      click: () => send(a.id),
    }
  }
  const compact = (items: (MI | null)[]): MI[] => items.filter((i): i is MI => i !== null)

  const browser: MI = {
    label: 'Browser',
    submenu: compact([
      { label: 'Back', accelerator: 'CmdOrCtrl+[', enabled: ctx.canGoBack, click: () => send('nav.back') },
      { label: 'Forward', accelerator: 'CmdOrCtrl+]', enabled: ctx.canGoForward, click: () => send('nav.forward') },
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => send('nav.reload') },
      { type: 'separator' },
      item('find'),
      // Page zoom, distinct from the window zoom in View.
      item('zoom-in'),
      item('zoom-out'),
      item('zoom-reset'),
      { type: 'separator' },
      item('history'),
      item('bookmarks'),
      // Bookmark/unbookmark is one action whose label flips, so whichever the
      // renderer pushed is the right one to show.
      item('bookmark') ?? item('unbookmark'),
      { type: 'separator' },
      { label: 'Forget This Page', click: () => send('history.forget-current') },
      {
        /**
         * Time ranges, because "clear everything" is almost never what someone
         * wants — they want the last twenty minutes gone. `forgetSince` has
         * supported this since the index was written and nothing ever called it.
         *
         * Each range is its OWN literal id rather than one parameterised id.
         * That is slightly more verbose here and it is what lets the dead-item
         * test see them: it matches literal `send('…')` calls, so a range added
         * without a route fails the suite instead of failing in the menu.
         *
         * Cookies are deliberately absent from this submenu. This browser runs
         * on the partition that holds Connected Accounts, so "clear cookies"
         * here would sign the user out of every connected service — a
         * destructive act hiding behind a housekeeping label. Signing out lives
         * per-account in Settings, where it says what it does.
         */
        label: 'Clear Browsing History',
        submenu: [
          { label: 'Last Hour', click: () => send('history.clear-hour') },
          { label: 'Last 24 Hours', click: () => send('history.clear-day') },
          { label: 'Last 48 Hours', click: () => send('history.clear-2days') },
          { label: 'Last Week', click: () => send('history.clear-week') },
          { type: 'separator' },
          // Ellipsis: this one asks first. It cannot be undone.
          { label: 'Everything…', click: () => send('history.clear-all') },
        ],
      },
      {
        label: 'Empty Cache',
        // Named for what it does and does not do — people reasonably fear that
        // clearing anything browser-shaped will log them out.
        toolTip: 'Frees disk space. You stay signed in to everything.',
        click: () => send('browser.clear-cache'),
      },
    ]),
  }

  return { browser }
}
