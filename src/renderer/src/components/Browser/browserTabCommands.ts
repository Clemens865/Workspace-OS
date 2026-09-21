/**
 * BROWSER TAB COMMAND BUS (Stage 2) — a tiny request/response channel between the
 * agent-facing `browser.*` tab-management actions (surfaceActions) and the
 * BrowserSurface that OWNS the tab state.
 *
 * surfaceActions can't reach into BrowserSurface's reducer directly, and the
 * established renderer pattern here is CustomEvents (see wos:reveal-path /
 * wos:browser-navigate). We extend that pattern with a REPLY: each command
 * carries a `resolve` callback in its detail, so an action can `await` the
 * result — crucially, `newTab` awaits the new tab's guest REGISTRATION before
 * returning its id, so an agent can immediately drive that tab by id.
 *
 * Pure of React + DOM specifics beyond `window` events, so the round-trip logic
 * (newTab creates → registers → resolves the id; timeout → error) is unit-testable
 * with a mocked bus.
 */

/** The event name BrowserSurface listens on for every tab command. */
export const TAB_COMMAND_EVENT = 'wos:browser-tab-command'

/** A listed tab (what `browser.tabs` returns to the agent). */
export interface TabInfo {
  id: string
  url: string
  title: string
  active: boolean
}

/** How long we wait for a new tab's guest to register before failing (ms). */
export const NEW_TAB_TIMEOUT_MS = 8000

/**
 * The commands BrowserSurface handles. Each resolves via its `resolve` callback:
 *  - newTab → the new tab's id, resolved ONLY once its guest has registered with
 *    main (so the returned id is immediately drivable). Rejects on timeout.
 *  - tabs → the current tab list.
 *  - closeTab / activateTab → {ok} (ok:false when the id is unknown).
 */
export type TabCommand =
  | { kind: 'newTab'; url?: string; focus?: boolean; resolve: (r: NewTabResult) => void }
  | { kind: 'tabs'; resolve: (r: TabInfo[]) => void }
  | { kind: 'closeTab'; id: string; resolve: (r: { ok: boolean }) => void }
  | { kind: 'activateTab'; id: string; resolve: (r: { ok: boolean }) => void }

export interface NewTabResult {
  ok: boolean
  tabId?: string
  url?: string
  error?: string
}

/** Dispatch a tab command and await its reply (used by surfaceActions). */
function dispatch<T>(build: (resolve: (r: T) => void) => TabCommand): Promise<T> {
  return new Promise<T>((resolve) => {
    const detail = build(resolve)
    window.dispatchEvent(new CustomEvent(TAB_COMMAND_EVENT, { detail }))
  })
}

/**
 * Open a new tab in the Browser surface and RESOLVE ONLY once its guest is
 * registered (so the returned id is immediately drivable by a `tab`-scoped call).
 * If no BrowserSurface is mounted / registration never completes, resolves with a
 * clear timeout error rather than hanging the agent.
 */
export function requestNewTab(url?: string, focus?: boolean): Promise<NewTabResult> {
  return new Promise<NewTabResult>((resolve) => {
    let settled = false
    const done = (r: NewTabResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(
      () => done({ ok: false, error: 'timed out opening a new browser tab — is the Browser surface available?' }),
      NEW_TAB_TIMEOUT_MS,
    )
    window.dispatchEvent(
      new CustomEvent(TAB_COMMAND_EVENT, {
        detail: { kind: 'newTab', url, focus, resolve: done } satisfies TabCommand,
      }),
    )
  })
}

/** List the browser's tabs. Resolves [] when no surface is mounted. */
export function requestTabs(): Promise<TabInfo[]> {
  return Promise.race([
    dispatch<TabInfo[]>((resolve) => ({ kind: 'tabs', resolve })),
    new Promise<TabInfo[]>((resolve) => setTimeout(() => resolve([]), 2000)),
  ])
}

/** Close a tab by id. Resolves {ok:false} when unknown / no surface. */
export function requestCloseTab(id: string): Promise<{ ok: boolean }> {
  return Promise.race([
    dispatch<{ ok: boolean }>((resolve) => ({ kind: 'closeTab', id, resolve })),
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: false }), 2000)),
  ])
}

/** Activate (focus) a tab by id. Resolves {ok:false} when unknown / no surface. */
export function requestActivateTab(id: string): Promise<{ ok: boolean }> {
  return Promise.race([
    dispatch<{ ok: boolean }>((resolve) => ({ kind: 'activateTab', id, resolve })),
    new Promise<{ ok: boolean }>((resolve) => setTimeout(() => resolve({ ok: false }), 2000)),
  ])
}
