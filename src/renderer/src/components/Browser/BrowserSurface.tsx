import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, PanelRightClose, Sparkles } from 'lucide-react'
import { PageAssistant } from './PageAssistant'
import { BrowserTabBar } from './BrowserTabBar'
import {
  tabsReducer,
  initialTabsState,
  activeTab as pickActive,
  newTabId,
  makeTab,
  type BrowserTab,
} from './browserTabs'
import { TAB_COMMAND_EVENT, type TabCommand, type TabInfo } from './browserTabCommands'
import { detectSignInBlock } from './signInBlock'
import styles from './BrowserSurface.module.css'
import { Omnibox } from './Omnibox'
import { FindBar } from './FindBar'
import { clampLevel, levelToPercent } from './zoom'
import { saveSession, loadSession } from './session-restore'
import { HistorySearch, type LibraryScope } from './HistorySearch'
import { everyAction, isActionId, type ActionId } from './page-actions'

/** One hour in ms — the unit the Clear Browsing History ranges are built from. */
const HOUR = 60 * 60 * 1000

/**
 * The in-app Browser surface — a TABBED browser (Stage 1 of a multi-tab
 * capability). A tab strip over the page (one entry per tab), an address bar
 * (back / forward / reload / URL) that drives the ACTIVE tab, one sandboxed
 * <webview> PER tab, and the page-aware <PageAssistant> pointed at the active
 * tab.
 *
 * Per-tab webview:
 *   - all tabs stay MOUNTED so their pages/history survive tab switches; only
 *     the active tab's webview is visible (others display:none).
 *   - all share ONE session partition ('persist:wos-browser') — cookies/logins
 *     are consistent across tabs, and the browser-drive (browserControl) already
 *     targets that partition. (A per-tab partition would isolate logins per tab;
 *     we pick the shared one so a signed-in session carries across new tabs.)
 *
 * Security posture (unchanged, applies to EVERY tab's guest):
 *   - own session partition, isolated from the app's default session + IPC bridge
 *   - no node integration, no preload (security.ts strips them on attach), so a
 *     hostile page cannot reach Electron / app IPC
 *   - main-process hardening still governs new-window / popups
 *
 * The drive follows the ACTIVE tab: on switch (and first attach) we tell main
 * which guest is active via browser.setActiveGuest(getWebContentsId()); main's
 * browserControl resolves that guest for navigate/deepRead/… + wos:browser-navigate.
 */

// Electron augments the DOM with a <webview> element + navigation methods.
interface WebviewElement extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getURL(): string
  getTitle(): string
  getWebContentsId(): number
  loadURL(url: string): Promise<void>
  executeJavaScript(code: string): Promise<unknown>
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  setZoomLevel(level: number): void
  getZoomLevel(): number
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string
          partition?: string
          allowpopups?: string
          nodeintegration?: string
          webpreferences?: string
        },
        HTMLElement
      >
    }
  }
}

const HOME_URL = 'https://duckduckgo.com/'

/** Placeholder src for a blank tab — see the <webview> comment (WOS-005). */
const BLANK_URL = 'about:blank'

/** Treat the blank placeholder (and an empty url) as "no page loaded". */
export function isBlank(url: string): boolean {
  return !url || url === BLANK_URL || url === 'about:blank#blocked'
}
/** Shared partition for every tab (see the header note on the trade-off). */
const PARTITION = 'persist:wos-browser'

/** Turn address-bar text into a URL: bare host → https, else DuckDuckGo search. */
function toNavUrl(raw: string): string {
  const q = raw.trim()
  if (!q) return HOME_URL
  if (/^https?:\/\//i.test(q)) return q
  if (/^[^\s]+\.[^\s]+$/.test(q) && !q.includes(' ')) return `https://${q}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
}

/** Per-tab live nav state (kept in a ref, not React state — churn-free). */
interface NavState {
  url: string
  title: string
  favicon: string
  canBack: boolean
  canForward: boolean
  loaded: boolean
  /** What the page contains — drives which actions the panel offers. */
  signals?: { tables: number; words: number; hasForm: boolean }
  /**
   * Set when an identity provider refused to sign in HERE.
   *
   * A refusal that only shows the provider's own page reads as a broken app —
   * the person retries, doubts their password, and eventually blames the
   * browser. See detectSignInBlock for why it is policy rather than a bug.
   */
  signInBlock?: { provider: string; message: string } | null
}

/** A single tab's sandboxed page. Mounted for every tab; hidden when inactive. */
function BrowserPage({
  tab,
  active,
  registerRef,
  onChange,
  onActiveAttach,
  onTabAttach,
}: {
  tab: BrowserTab
  active: boolean
  registerRef: (id: string, el: WebviewElement | null) => void
  onChange: (id: string, patch: Partial<BrowserTab> & { nav?: Partial<NavState> }) => void
  onActiveAttach: (id: string, webContentsId: number) => void
  onTabAttach: (id: string, webContentsId: number) => void
}): JSX.Element {
  const ref = useRef<WebviewElement | null>(null)

  /**
   * The src attribute is set ONCE, at mount, and never re-rendered from state.
   *
   * It used to be `src={tab.url || BLANK_URL}` with tab.url being React state
   * that syncNav writes on every did-navigate / did-navigate-in-page. So each
   * time the PAGE navigated itself, we stored the new url, React re-rendered,
   * saw the src attribute had changed, and wrote it back — and writing src on a
   * <webview> starts a NAVIGATION. Every navigation the page made, we made a
   * second time, to the place it had just arrived.
   *
   * Measured, not reasoned about: one history.pushState — a pure in-page
   * navigation that must cause zero loads in any browser — produced TWO real
   * page loads (e2e/browser/double-load.mjs).
   *
   * The damage scales with how much state the page holds:
   *   - an ordinary page: an invisible extra load, just slower
   *   - a SPA: the reload discards its in-page state, so clicking a project in
   *     Asana reloads and lands you back where you started
   *   - a sign-in flow: the redirect chain is re-issued from a one-time code
   *     that has already been consumed, so the provider rejects it and the
   *     login returns to the form. auth_context_expired. The loop.
   *
   * Navigation still works: the address bar calls loadURL(), and the page
   * navigates itself. Neither needs src to change, and tab.url stays live for
   * the tab strip and the address bar.
   */
  /**
   * ...and it is set from a REAL url, because about:blank does not attach.
   *
   * WOS-005 was closed by mounting blank tabs at about:blank, on the belief
   * that "about:blank attaches a real guest". Measured against the running app,
   * it does not: a webview mounted at about:blank reports
   * `getWebContentsId()` → "The WebView must be attached to the DOM and the
   * dom-ready event emitted", forever, while one mounted at a real url attaches
   * immediately. So the tab stayed guestless, loadURL threw, the src fallback
   * wrote an attribute nothing was listening to, and the page never painted —
   * while tab.url updated happily, which is why the model looked correct and the
   * e2e passed.
   *
   * A blank tab therefore renders NO webview. The first navigation gives the tab
   * a url, and the webview mounts with that url as its src — the same path the
   * first tab has always taken, and the one that demonstrably works.
   */
  const initialSrc = useRef<string | null>(isBlank(tab.url) ? null : tab.url)
  if (initialSrc.current === null && !isBlank(tab.url)) initialSrc.current = tab.url
  const started = initialSrc.current !== null

  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    registerRef(tab.id, wv)

    const syncNav = (): void => {
      const raw = wv.getURL?.() ?? ''
      // A blank tab is mounted at about:blank so its guest attaches (WOS-005);
      // that placeholder must never surface as the tab's url, or the address bar
      // shows "about:blank" and the start pane disappears.
      const url = isBlank(raw) ? '' : raw
      const title = wv.getTitle?.() ?? ''
      onChange(tab.id, {
        url: url || tab.url,
        title,
        nav: {
          url,
          title,
          canBack: !!wv.canGoBack?.(),
          canForward: !!wv.canGoForward?.(),
          // Cleared on every navigation, so leaving the refusal clears the bar.
          signInBlock: detectSignInBlock(url),
        },
      })
    }

    const onDomReady = (): void => {
      onChange(tab.id, { nav: { loaded: true } })
      // The guest webContents exists once attached. Map THIS tab id → its guest
      // in main (tab-scoped drive), and — if it's the active tab — also mark it
      // the active drive target.
      try {
        const wcId = wv.getWebContentsId()
        onTabAttach(tab.id, wcId)
        if (active) onActiveAttach(tab.id, wcId)
      } catch {
        /* not attached yet — the active-tab effect re-tries on switch */
      }
      syncNav()
    }
    const onFavicon = (e: Event): void => {
      const favs = (e as unknown as { favicons?: string[] }).favicons
      if (Array.isArray(favs) && favs[0]) onChange(tab.id, { favicon: favs[0] })
    }

    /**
     * Record the visit once the page has settled, WITH its readable text.
     *
     * On did-stop-loading rather than did-navigate: at navigate time the
     * document is empty, so we would index every page as blank and the whole
     * point of a content index would quietly not work.
     *
     * innerText, not innerHTML — we want what a person read, not markup. The
     * main process caps the length; this cap only avoids shipping something
     * absurd across IPC.
     *
     * Failures are swallowed on purpose: a page that refuses script evaluation
     * (a PDF viewer, a redirect stub, a CSP that blocks it) must still browse
     * normally. Losing an index entry is not worth breaking a page over.
     */
    const onSettled = (): void => {
      const url = wv.getURL?.() ?? ''
      if (!/^https?:\/\//i.test(url)) return
      void (async () => {
        let text = ''
        let signals: { tables: number; words: number; hasForm: boolean } | null = null
        try {
          /**
           * ONE script for two jobs: the text history indexes, and the counts
           * the action panel needs to decide what to offer.
           *
           * Measuring the page separately would double the cost of every
           * navigation for information the first pass already has in hand.
           *
           * A data table is one with at least two rows AND a header cell —
           * layout tables (still common) would otherwise make every page offer
           * "turn this table into a spreadsheet", which teaches people the
           * suggestions are noise.
           */
          const raw = (await wv.executeJavaScript(`(() => {
            const text = (document.body && document.body.innerText || '').slice(0, 200000)
            let tables = 0
            for (const t of document.querySelectorAll('table')) {
              if (t.rows && t.rows.length >= 2 && t.querySelector('th, thead')) tables++
            }
            return {
              text,
              tables,
              words: text.trim() ? text.trim().split(/\\s+/).length : 0,
              hasForm: !!document.querySelector('form'),
            }
          })()`)) as { text: string; tables: number; words: number; hasForm: boolean }
          text = raw?.text ?? ''
          signals = { tables: raw?.tables ?? 0, words: raw?.words ?? 0, hasForm: !!raw?.hasForm }
        } catch {
          /* not readable — record the visit without text or signals */
        }
        if (signals) onChange(tab.id, { nav: { signals } })
        try {
          await window.workspace.history.record({ url, title: wv.getTitle?.() ?? '', text })
        } catch {
          /* history is a convenience; never let it break browsing */
        }
      })()
    }

    /*
     * HTML5 fullscreen (a LinkedIn/YouTube video's ⤢ button).
     *
     * Electron's default fullscreens the WINDOW when the guest requests HTML
     * fullscreen, but the <webview> keeps its normal in-layout size — so the
     * guest's fullscreen element has no full surface to occupy and the page
     * bounces straight back out (window flashes fullscreen, then exits). Giving
     * the webview a full-window surface for the duration makes it stick.
     *
     * Toggled IMPERATIVELY on the element (never via React state): a re-render
     * here would reset the guest — the WOS-005 double-load trap.
     */
    const onEnterFs = (): void => wv.classList.add(styles.webviewFs)
    const onLeaveFs = (): void => wv.classList.remove(styles.webviewFs)

    wv.addEventListener('did-stop-loading', onSettled)
    wv.addEventListener('dom-ready', onDomReady)
    wv.addEventListener('did-navigate', syncNav as EventListener)
    wv.addEventListener('did-navigate-in-page', syncNav as EventListener)
    wv.addEventListener('page-title-updated', syncNav as EventListener)
    wv.addEventListener('page-favicon-updated', onFavicon as EventListener)
    wv.addEventListener('enter-html-full-screen', onEnterFs)
    wv.addEventListener('leave-html-full-screen', onLeaveFs)
    return () => {
      wv.removeEventListener('did-stop-loading', onSettled)
      wv.removeEventListener('dom-ready', onDomReady)
      wv.removeEventListener('did-navigate', syncNav as EventListener)
      wv.removeEventListener('did-navigate-in-page', syncNav as EventListener)
      wv.removeEventListener('page-title-updated', syncNav as EventListener)
      wv.removeEventListener('page-favicon-updated', onFavicon as EventListener)
      wv.removeEventListener('enter-html-full-screen', onEnterFs)
      wv.removeEventListener('leave-html-full-screen', onLeaveFs)
      registerRef(tab.id, null)
    }
    // Bind once per tab, and again when a blank tab first gets its webview.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, started])

  // WOS-005: a blank tab MUST still get a src. An Electron <webview> mounted
  // without one never attaches a guest webContents and never fires dom-ready, so
  // loadURL() throws and the tab is permanently dead — type a domain, press
  // Enter, nothing happens. about:blank attaches a real guest while leaving the
  // tab visually empty (syncNav maps it back to '' so the start pane stays).
  //
  // WOS-007: allowpopups lets target=_blank / window.open reach the guest's
  // window-open handler at all; main then routes them into a new in-app tab.
  // Nothing to show yet, and nothing to attach: a webview here would be a
  // permanently guestless one. The empty surface IS the new-tab page.
  if (!started) {
    return <div className={styles.blankPane} style={{ display: active ? 'flex' : 'none' }} />
  }

  return (
    <webview
      ref={ref as React.Ref<HTMLElement>}
      className={styles.webview}
      style={{ display: active ? 'inline-flex' : 'none' }}
      src={initialSrc.current as string}
      // FIRST request only — Electron uses it for the initial load and the page
      // governs its own referrers thereafter, which is what a real browser does.
      {...(tab.referrer ? { httpreferrer: tab.referrer } : {})}
      allowpopups="true"
      partition={PARTITION}
    />
  )
}

/**
 * WOS-012 — the Assistant panel's collapsed state and width.
 *
 * Persisted in localStorage next to the browser session, and read with a lazy
 * initialiser so the panel never renders open-then-shut on mount. A layout
 * preference that resets every launch is one the user has to set again forever.
 */
const ASSISTANT_KEY = 'workspace-os:browser-assistant'
const ASSISTANT_DEFAULT_W = 300
const ASSISTANT_MIN_W = 220
const ASSISTANT_MAX_W = 640

function readAssistantPrefs(): { open: boolean; width: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(ASSISTANT_KEY) || '{}')
    const width = Number(raw?.width)
    return {
      open: raw?.open !== false, // default OPEN — it is how the surface shipped
      width: Number.isFinite(width) ? Math.min(ASSISTANT_MAX_W, Math.max(ASSISTANT_MIN_W, width)) : ASSISTANT_DEFAULT_W,
    }
  } catch {
    return { open: true, width: ASSISTANT_DEFAULT_W }
  }
}

export function BrowserSurface(): JSX.Element {
  const [assistantOpen, setAssistantOpen] = useState(() => readAssistantPrefs().open)
  const [assistantWidth, setAssistantWidth] = useState(() => readAssistantPrefs().width)

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_KEY, JSON.stringify({ open: assistantOpen, width: assistantWidth }))
    } catch {
      /* a full or blocked localStorage must not break the browser */
    }
  }, [assistantOpen, assistantWidth])

  // ⌥⌘A toggles it. Not ⌘A (select-all) and not ⇧⌘A (the agent focus shortcut
  // the shell already owns).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === 'a' || e.key === 'A' || e.code === 'KeyA')) {
        e.preventDefault()
        setAssistantOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /**
   * Drag the divider. Width is tracked in a ref during the gesture and only
   * committed to state on each move — the <webview> guest relayouts on every
   * change, so the listeners are removed on mouseup rather than left attached.
   */
  const startAssistantDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = assistantWidth
      const onMove = (ev: MouseEvent) => {
        // Dragging LEFT widens the panel, so the delta is inverted.
        const next = startW + (startX - ev.clientX)
        setAssistantWidth(Math.min(ASSISTANT_MAX_W, Math.max(ASSISTANT_MIN_W, next)))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
      }
      document.body.style.cursor = 'col-resize'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [assistantWidth],
  )

  /**
   * Tabs are seeded from the previous session when there is one.
   *
   * Lazy initialiser rather than an effect: restoring after the first render
   * would mount a blank tab, then replace it, so the browser would flash an
   * empty page and the guest would attach twice.
   */
  const [state, dispatch] = useReducer(tabsReducer, HOME_URL, (home) => {
    return loadSession(makeTab) ?? initialTabsState(home)
  })
  const [address, setAddress] = useState('')

  // Live per-tab nav state (url/title/back/forward/loaded) kept out of React
  // state so page churn doesn't re-render the whole surface; a bump re-reads it.
  const navRef = useRef<Map<string, NavState>>(new Map())
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((n) => n + 1), [])

  // Stable id → live <webview> element, so the address bar drives the active one.
  const wvRefs = useRef<Map<string, WebviewElement>>(new Map())
  const registerRef = useCallback((id: string, el: WebviewElement | null) => {
    if (el) wvRefs.current.set(id, el)
    else wvRefs.current.delete(id)
  }, [])

  const active = pickActive(state)
  const activeNav = navRef.current.get(active.id)

  // Tell main which guest is active (the drive + wos:browser-navigate follow it).
  const markActiveGuest = useCallback((id: string) => {
    const wv = wvRefs.current.get(id)
    if (!wv) return
    try {
      void window.workspace?.browser?.setActiveGuest?.(wv.getWebContentsId())
    } catch {
      /* guest not attached yet — dom-ready's onActiveAttach will mark it */
    }
  }, [])

  const onActiveAttach = useCallback(
    (id: string, _webContentsId: number) => {
      if (id === active.id) markActiveGuest(id)
    },
    [active.id, markActiveGuest],
  )

  // Pending browser.newTab requests: tabId → resolver, fulfilled once that tab's
  // guest registers with main (so the returned id is immediately drivable).
  const pendingNewTab = useRef<Map<string, (r: { ok: boolean; tabId?: string; url?: string }) => void>>(
    new Map(),
  )

  // Every tab's guest registers itself (tab id → guest) with main on dom-ready,
  // so a `tab`-scoped drive call reaches the right page. Fulfils a pending newTab.
  const onTabAttach = useCallback((id: string, webContentsId: number) => {
    void window.workspace?.browser?.registerTab?.(id, webContentsId)
    const resolve = pendingNewTab.current.get(id)
    if (resolve) {
      pendingNewTab.current.delete(id)
      resolve({ ok: true, tabId: id, url: navRef.current.get(id)?.url })
    }
  }, [])

  // On every active-tab switch, re-point the drive at that tab's guest and sync
  // the address bar to that tab's current url.
  useEffect(() => {
    markActiveGuest(active.id)
    const nav = navRef.current.get(active.id)
    setAddress(nav?.url ?? active.url ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id])

  // A tab reports a nav change → merge into its NavState + the tab model (for
  // the strip's title/favicon), and refresh the address bar if it's the active tab.
  /**
   * The active tab id, mirrored in a ref and refreshed every render.
   *
   * Read instead of `state` by anything a tab's listeners can reach, because
   * those listeners are bound ONCE per tab (deps [tab.id]) and therefore
   * capture whatever `state` was when that tab mounted.
   */
  const activeIdRef = useRef(state.activeId)
  activeIdRef.current = state.activeId

  const onChange = useCallback(
    (id: string, patch: Partial<BrowserTab> & { nav?: Partial<NavState> }): void => {
      if (patch.nav) {
        const prev =
          navRef.current.get(id) ??
          ({ url: '', title: '', favicon: '', canBack: false, canForward: false, loaded: false } as NavState)
        const next = { ...prev, ...patch.nav }
        navRef.current.set(id, next)
        /**
         * Compared against the LIVE active id, not one captured in a closure.
         *
         * This was `pickActive(state).id`, and onChange closes over `state`
         * while each tab binds its navigation listeners once at mount — so a
         * tab that mounted while some OTHER tab was active kept that stale
         * belief forever, skipped setAddress, and showed the previous page's
         * url while displaying the new page's content.
         *
         * It looked intermittent because it depends on whether a tab was
         * active AT MOUNT: the first tab and foreground-opened tabs were fine,
         * while background-opened tabs and every restored-session tab except
         * the active one were broken. Session restore made it common.
         */
        if (id === activeIdRef.current) {
          if (next.url) setAddress(next.url)
          rerender()
        }
      }
      // Persist url/title/favicon into the tab model so the strip + reopen survive.
      const modelPatch: Partial<BrowserTab> = {}
      if (patch.url !== undefined) modelPatch.url = patch.url
      if (patch.title !== undefined) modelPatch.title = patch.title
      if (patch.favicon !== undefined) modelPatch.favicon = patch.favicon
      if (Object.keys(modelPatch).length > 0) dispatch({ type: 'patch', id, patch: modelPatch })
    },
    // No `state` dependency: onChange must be STABLE, or the tab listeners that
    // captured it at mount go on calling an older copy of it.
    [rerender],
  )

  const navigateActive = useCallback(
    (url: string) => {
      const id = pickActive(state).id
      const wv = wvRefs.current.get(id)
      // Record the url FIRST and unconditionally. A blank tab has no webview to
      // drive; this patch is precisely what mounts one, with this url as its
      // src. Returning early here (as it did) left the tab blank forever.
      dispatch({ type: 'patch', id, patch: { url } })
      if (!wv) return
      // loadURL EXISTS on an unattached webview and throws when called, so the
      // old `typeof` guard always took this branch and the src fallback was dead
      // code. Catch it and fall back for real (WOS-005). Also record the url on
      // the tab so a remount seeds src from state rather than about:blank.
      const fallback = (): void => {
        try {
          wv.src = url
        } catch {
          /* nothing more we can do; the patch below still updates the model */
        }
      }
      try {
        const p = wv.loadURL?.(url) as Promise<void> | undefined
        if (p && typeof p.catch === 'function') p.catch(fallback)
        else if (!wv.loadURL) fallback()
      } catch {
        fallback()
      }
    },
    [state],
  )

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      navigateActive(toNavUrl(address))
    },
    [address, navigateActive],
  )

  // Office links / the drive fire `wos:browser-navigate` with a {url}; open it in
  // the ACTIVE tab (undefined detail = the agent drive's own IPC → no-op here).
  useEffect(() => {
    const onNav = (e: Event): void => {
      const url = (e as CustomEvent<{ url?: unknown }>).detail?.url
      if (typeof url === 'string' && url) navigateActive(url)
    }
    window.addEventListener('wos:browser-navigate', onNav)
    return () => window.removeEventListener('wos:browser-navigate', onNav)
  }, [navigateActive])

  // WOS-007: a target=_blank / window.open click inside a guest arrives here
  // from main. Open it as a real tab rather than losing it (or bouncing it to
  // Safari, which strands the session and the agent's view of the page).
  useEffect(() => {
    return window.workspace.browserTabs.onOpenTab(({ url, referrer }) => {
      // The tab this link came FROM is what makes grouping automatic: five
      // links opened from one article are a task, and the browser can see that
      // without being told.
      //
      // `referrer` is what a real browser would have sent on this hop. Without
      // it the destination is a bare navigation from nowhere, and sites that
      // gate outbound links discard the target (see referrerFor in security.ts).
      if (typeof url === 'string' && url)
        dispatch({ type: 'add', url, referrer, openerId: activeIdRef.current })
    })
  }, [])

  const goBack = useCallback(() => wvRefs.current.get(active.id)?.goBack(), [active.id])
  const goForward = useCallback(() => wvRefs.current.get(active.id)?.goForward(), [active.id])
  const reload = useCallback(() => wvRefs.current.get(active.id)?.reload(), [active.id])

  const onNew = useCallback(() => {
    dispatch({ type: 'add' })
    setAddress('')
  }, [])
  const onActivate = useCallback((id: string) => dispatch({ type: 'activate', id }), [])
  const onClose = useCallback((id: string) => {
    navRef.current.delete(id)
    void window.workspace?.browser?.unregisterTab?.(id)
    dispatch({ type: 'close', id })
  }, [])

  // Live tab list for the command bus (read from the current model + nav state).
  const tabsRef = useRef<BrowserTab[]>(state.tabs)
  tabsRef.current = state.tabs

  // TAB COMMAND BUS — agent-facing browser.* tab-management actions dispatch a
  // command here (create/list/close/activate). newTab pre-generates a stable id,
  // creates the tab, and stashes a resolver so onTabAttach can return the id once
  // the guest is registered (drivable). See browserTabCommands.ts.
  useEffect(() => {
    const onCommand = (e: Event): void => {
      const cmd = (e as CustomEvent<TabCommand>).detail
      if (!cmd || typeof cmd !== 'object') return
      switch (cmd.kind) {
        case 'newTab': {
          const id = newTabId()
          pendingNewTab.current.set(id, cmd.resolve)
          // Focus by default; background-open when focus === false.
          // An agent fan-out opens every tab from the page it started on, so
          // the same opener rule groups a research run without extra plumbing.
          dispatch({
            type: 'add',
            id,
            url: cmd.url ?? '',
            activate: cmd.focus !== false,
            openerId: activeIdRef.current,
          })
          break
        }
        case 'tabs': {
          const list: TabInfo[] = tabsRef.current.map((t) => ({
            id: t.id,
            url: navRef.current.get(t.id)?.url || t.url,
            title: navRef.current.get(t.id)?.title || t.title,
            active: t.id === activeIdRef.current,
          }))
          cmd.resolve(list)
          break
        }
        case 'closeTab': {
          const known = tabsRef.current.some((t) => t.id === cmd.id)
          if (known) onClose(cmd.id)
          cmd.resolve({ ok: known })
          break
        }
        case 'activateTab': {
          const known = tabsRef.current.some((t) => t.id === cmd.id)
          if (known) onActivate(cmd.id)
          cmd.resolve({ ok: known })
          break
        }
      }
    }
    window.addEventListener(TAB_COMMAND_EVENT, onCommand)
    return () => window.removeEventListener(TAB_COMMAND_EVENT, onCommand)
  }, [onClose, onActivate])

  const canBack = !!activeNav?.canBack
  const canForward = !!activeNav?.canForward
  const loaded = !!activeNav?.loaded
  const currentUrl = activeNav?.url ?? ''

  /**
   * Whether the page in view is bookmarked.
   *
   * Re-read on every navigation rather than cached per tab: the same url can be
   * starred from the History view or by another tab, and a star that disagrees
   * with the store is worse than no star at all.
   */
  const [starred, setStarred] = useState(false)
  useEffect(() => {
    let live = true
    if (!currentUrl) {
      setStarred(false)
      return
    }
    void window.workspace.history
      .isStarred(currentUrl)
      .then((s: boolean) => {
        if (live) setStarred(!!s)
      })
      .catch(() => {
        /* a missing answer just means "not starred" */
      })
    return () => {
      live = false
    }
  }, [currentUrl])

  const toggleStar = useCallback(() => {
    if (!currentUrl) return
    const next = !starred
    setStarred(next) // optimistic: the star must feel instant
    const call = next
      ? window.workspace.history.star(currentUrl, activeNav?.title ?? '', activeNav?.favicon ?? '')
      : window.workspace.history.unstar(currentUrl)
    void Promise.resolve(call).catch(() => setStarred(!next))
  }, [currentUrl, starred, activeNav?.title, activeNav?.favicon])

  const [findOpen, setFindOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Which list the library opens on. Bookmarks are a scope on the same overlay,
  // not a second panel — see the note in HistorySearch.
  const [libraryScope, setLibraryScope] = useState<LibraryScope>('all')
  const [zoomLevel, setZoomLevel] = useState(0)
  /**
   * The live zoom level, mirrored in a ref.
   *
   * Two ⌘+ presses in quick succession both read React state from the same
   * closure, so both computed "0 + 1" and the second press did nothing — you
   * pressed twice and zoomed once. Caught by e2e/browser/phase2.mjs, which is
   * exactly the kind of thing a unit test over the pure ladder cannot see.
   * The ref is the current value regardless of render timing.
   */
  const zoomRef = useRef(0)

  /**
   * Read the guest's zoom whenever the page changes, so the badge reflects
   * reality rather than a value we think we set.
   *
   * We do NOT re-apply a stored level here: Chromium persists zoom per origin
   * inside the persistent partition, so navigating to a site you enlarged
   * arrives already enlarged. Setting it ourselves on top of that is how the
   * two records drifted apart in the first place.
   */
  useEffect(() => {
    const wv = wvRefs.current.get(active.id)
    try {
      const level = wv?.getZoomLevel() ?? 0
      zoomRef.current = level
      setZoomLevel(level)
    } catch {
      /* not attached yet — the next navigation reads it again */
    }
  }, [currentUrl, active.id])

  const applyZoom = useCallback(
    (level: number) => {
      const next = clampLevel(level)
      zoomRef.current = next
      setZoomLevel(next)
      try {
        wvRefs.current.get(active.id)?.setZoomLevel(next)
      } catch {
        /* nothing attached — Chromium keeps the level for this origin anyway */
      }
    },
    [active.id],
  )

  /** Steps zoom relative to the LIVE level, not a captured one. */
  const zoomBy = useCallback((delta: number) => applyZoom(zoomRef.current + delta), [applyZoom])

  /**
   * Browser keyboard shortcuts, scoped to this surface.
   *
   * Bound on the window because the guest has focus most of the time and never
   * bubbles its keys to us. `⌘F` while a webview is focused would otherwise do
   * nothing at all, which reads as the browser being broken.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === 'f') {
        e.preventDefault()
        setFindOpen(true)
      } else if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        zoomBy(1)
      } else if (e.key === '-') {
        e.preventDefault()
        zoomBy(-1)
      } else if (e.key === '0') {
        e.preventDefault()
        applyZoom(0)
      } else if (e.key === 'h' && e.shiftKey) {
        e.preventDefault()
        setLibraryScope('all')
        setHistoryOpen((v) => !v)
      } else if (e.key === 'o' && e.shiftKey) {
        // ⌘⇧O, as Chrome uses for its bookmark manager. NOT ⌘⇧B: that is the
        // bug reporter, bound globally in App.tsx and deliberately owned by no
        // surface — taking it here would have fired both at once.
        e.preventDefault()
        setLibraryScope('starred')
        setHistoryOpen((v) => !v)
      } else if (e.key === 'l') {
        // ⌘L focuses the address bar, as every browser does.
        e.preventDefault()
        addrRef.current?.focus()
        addrRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [applyZoom, zoomBy])

  // Focus the address bar when the active tab is blank (a fresh new tab).
  const addrRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!active.url && !currentUrl) addrRef.current?.focus()
  }, [active.id, active.url, currentUrl])

  /**
   * Persist the session on every tab change.
   *
   * Cheap (a handful of urls to localStorage) and driven by state rather than a
   * lifecycle hook, because there is no reliable "app is closing" moment in a
   * renderer — a crash or a force-quit would take the session with it.
   */
  useEffect(() => {
    saveSession(state)
  }, [state])

  /**
   * Tell the workspace which page is open, so anything started from the
   * terminal knows where the user actually is.
   *
   * setContext merges partials in main, so pushing only these two fields leaves
   * the shell's surface/folder/openFile push untouched.
   */
  useEffect(() => {
    void window.workspace.context
      .set({ browserUrl: currentUrl || null, browserTitle: activeNav?.title || null })
      .catch(() => {
        /* context is a convenience; never let it break browsing */
      })
  }, [currentUrl, activeNav?.title])

  /** What the active page contains, for the action panel. */
  const pageSignals = useMemo(
    () => ({
      hasPage: !!currentUrl,
      tables: activeNav?.signals?.tables ?? 0,
      words: activeNav?.signals?.words ?? 0,
      hasForm: activeNav?.signals?.hasForm ?? false,
      starred,
    }),
    [currentUrl, activeNav?.signals, starred],
  )

  /**
   * Keep the native menu in step with the panel.
   *
   * The same `everyAction(pageSignals)` list the panel renders is pushed to the
   * menu bar, so History/View are a second VIEW over one source rather than a
   * second list. A browser action added to page-actions.ts appears in both, or
   * in neither — which is the drift that made bookmarks invisible for months.
   *
   * Cleared on unmount so leaving the Browser takes its menus with it.
   */
  useEffect(() => {
    const actions = everyAction(pageSignals).map((a) => ({
      id: a.id,
      label: a.label,
      shortcut: a.shortcut,
      relevance: a.relevance,
    }))
    void window.workspace.menu
      ?.setBrowserContext({
        actions,
        canGoBack: !!activeNav?.canBack,
        canGoForward: !!activeNav?.canForward,
      })
      .catch(() => undefined)
    return () => {
      void window.workspace.menu?.setBrowserContext(null).catch(() => undefined)
    }
  }, [pageSignals, activeNav?.canBack, activeNav?.canForward])

  /**
   * The browser half of the action list.
   *
   * These are the ones that need a webview or the surface's own state, so the
   * panel delegates them here rather than reaching across into the guest.
   */
  const runBrowserAction = useCallback(
    (id: ActionId) => {
      switch (id) {
        case 'find':
          setFindOpen(true)
          break
        case 'bookmark':
        case 'unbookmark':
          toggleStar()
          break
        case 'zoom-in':
          zoomBy(1)
          break
        case 'zoom-out':
          zoomBy(-1)
          break
        case 'zoom-reset':
          applyZoom(0)
          break
        case 'history':
          setLibraryScope('all')
          setHistoryOpen(true)
          break
        case 'bookmarks':
          setLibraryScope('starred')
          setHistoryOpen(true)
          break
      }
    },
    [toggleStar, zoomBy, applyZoom],
  )

  /**
   * Route the native menu's clicks.
   *
   * The surface had no subscription at all, so every item the new Browser menu
   * offers would have done nothing — the precise failure page-actions.ts refuses
   * to allow in its own panel ("nothing is listed here that does not work"), and
   * a menu earns that rule no less than a panel does.
   *
   * Ids that are also panel actions go straight to runBrowserAction; the rest
   * are menu-only because they have no sensible place in a page panel — you do
   * not offer "clear all history" beside "summarise this page".
   */
  /** Forget everything visited in the last `ms` — history index only. */
  const clearSince = useCallback((ms: number) => {
    void window.workspace.history.forgetSince(Date.now() - ms).catch(() => undefined)
  }, [])

  useEffect(() => {
    return window.workspace.menu.onRunAction((id) => {
      switch (id) {
        case 'nav.back':
          goBack()
          break
        case 'nav.forward':
          goForward()
          break
        case 'nav.reload':
          reload()
          break
        case 'history.forget-current':
          if (currentUrl) {
            void window.workspace.history.forget(currentUrl).catch(() => undefined)
          }
          break
        // Ranges, because "everything" is rarely what someone means. The index
        // has supported `forgetSince` from the start; nothing ever called it.
        case 'history.clear-hour':
          clearSince(HOUR)
          break
        case 'history.clear-day':
          clearSince(24 * HOUR)
          break
        case 'history.clear-2days':
          clearSince(48 * HOUR)
          break
        case 'history.clear-week':
          clearSince(7 * 24 * HOUR)
          break
        case 'history.clear-all':
          // Asked, not assumed: this erases the indexed text of every page ever
          // read here and cannot be undone.
          if (window.confirm('Forget every page you have visited?\n\nThis erases the saved text of every page too, and cannot be undone. You will stay signed in to your accounts.')) {
            void window.workspace.history.clear().catch(() => undefined)
          }
          break
        case 'browser.clear-cache':
          void window.workspace.browser.clearCache().catch(() => undefined)
          break
        default:
          // Everything else is a panel action; ignore ids belonging to other
          // surfaces (office.*, agent.*) which have their own subscribers.
          if (isActionId(id)) runBrowserAction(id)
      }
    })
  }, [runBrowserAction, currentUrl, goBack, goForward, reload, clearSince])

  const tabs = useMemo(() => state.tabs, [state.tabs])

  return (
    <div
      className={`${styles.browser} ${assistantOpen ? '' : styles.assistantClosed}`}
      style={assistantOpen ? ({ ['--wos-assistant-w']: `${assistantWidth}px` } as React.CSSProperties) : undefined}
    >
      <div className={styles.bmain}>
        <BrowserTabBar
          tabs={tabs}
          activeId={state.activeId}
          groups={state.groups}
          onActivate={onActivate}
          onClose={onClose}
          onNew={onNew}
          onToggleGroup={(id) => dispatch({ type: 'toggleGroup', id })}
          onRenameGroup={(id, name) => dispatch({ type: 'renameGroup', id, name })}
          onUngroup={(id) => dispatch({ type: 'ungroup', id })}
        />

        <form className={styles.addrbar} onSubmit={onSubmit}>
          <button type="button" className={styles.navbtn} title="Back" onClick={goBack} disabled={!canBack}>
            <ArrowLeft size={18} />
          </button>
          <button
            type="button"
            className={styles.navbtn}
            title="Forward"
            onClick={goForward}
            disabled={!canForward}
          >
            <ArrowRight size={18} />
          </button>
          <button type="button" className={styles.navbtn} title="Reload" onClick={reload} disabled={!loaded}>
            <RotateCw size={16} />
          </button>
          <Omnibox
            value={address}
            onChange={setAddress}
            onNavigate={(url) => {
              setAddress(url)
              navigateActive(url)
            }}
            starred={starred}
            onToggleStar={toggleStar}
            inputRef={addrRef}
          />
        </form>

        {/*
          An identity provider refused to sign in here.
          Above the page rather than over it: the provider's own explanation is
          still worth reading, and this says the part it cannot — that nothing
          is broken and what to do instead. Rendered from the ACTIVE tab's nav
          state, which is where nav lives; BrowserPage has none of its own.
        */}
        {activeNav?.signInBlock && (
          <div className={styles.signInBlock} role="status">
            <strong>{activeNav.signInBlock.provider} will not sign in here.</strong>{' '}
            {activeNav.signInBlock.message}
          </div>
        )}

        <div className={styles.webhost}>
          {/* One sandboxed guest per tab; all mounted, only the active visible. */}
          {tabs.map((tab) => (
            <BrowserPage
              key={tab.id}
              tab={tab}
              active={tab.id === state.activeId}
              registerRef={registerRef}
              onChange={onChange}
              onActiveAttach={onActiveAttach}
              onTabAttach={onTabAttach}
            />
          ))}
          {historyOpen && (
            <HistorySearch
              onOpen={(url) => {
                setHistoryOpen(false)
                setAddress(url)
                navigateActive(url)
              }}
              onClose={() => setHistoryOpen(false)}
              initialScope={libraryScope}
            />
          )}
          {findOpen && (
            <FindBar target={wvRefs.current.get(active.id) ?? null} onClose={() => setFindOpen(false)} />
          )}
          {/* Only while zoom differs from 100% — at 100% there is nothing to say. */}
          {zoomLevel !== 0 && (
            <button
              type="button"
              className={styles.zoomBadge}
              onClick={() => applyZoom(0)}
              title="Reset zoom (⌘0)"
            >
              {levelToPercent(zoomLevel)}%
            </button>
          )}
          {!active.url && !currentUrl && (
            <div className={styles.startpane}>New Tab — type a URL to begin</div>
          )}
        </div>
      </div>

      {/* WOS-012: the Assistant was rendered unconditionally into a fixed
          300px column, so it permanently narrowed the page — enough to push
          responsive sites into their tablet breakpoints on a laptop. */}
      {assistantOpen ? (
        <>
          <div
            className={styles.assistantHandle}
            onMouseDown={startAssistantDrag}
            onDoubleClick={() => setAssistantWidth(ASSISTANT_DEFAULT_W)}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the assistant panel"
            title="Drag to resize · double-click to reset"
          />
          <div className={styles.assistantCol}>
            <button
              type="button"
              className={styles.assistantHide}
              onClick={() => setAssistantOpen(false)}
              title="Hide the assistant (⌥⌘A)"
              aria-label="Hide the assistant"
            >
              <PanelRightClose size={15} strokeWidth={1.9} />
            </button>
            <PageAssistant currentUrl={currentUrl} signals={pageSignals} onBrowserAction={runBrowserAction} />
          </div>
        </>
      ) : (
        // The way back. A collapsed panel with no visible affordance is just a
        // feature the user cannot find again.
        <button
          type="button"
          className={styles.assistantShow}
          onClick={() => setAssistantOpen(true)}
          title="Show the assistant (⌥⌘A)"
          aria-label="Show the assistant"
        >
          <Sparkles size={15} strokeWidth={1.9} />
        </button>
      )}
    </div>
  )
}
