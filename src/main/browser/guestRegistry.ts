import { WebContents } from 'electron'

/**
 * BROWSER GUEST REGISTRY (main side).
 *
 * Tracks the sandboxed <webview> guests that back the Browser surface's tabs and
 * resolves WHICH guest a drive call (navigate/deepRead/…) should act on:
 *
 *  - `attached` holds every live guest, latest last (the fallback drive target).
 *  - `activeId` is the webContents id of the VISIBLE tab, set over IPC on tab
 *    switch (and first attach) — the default target when no `tab` is given.
 *  - `byTab` maps a renderer TAB ID → its guest (Stage 2), so a drive call
 *    carrying a `tab` id acts on that EXACT tab (different agents/subagents can
 *    drive different tabs without colliding). Registered on each tab's dom-ready.
 *
 * Split out of browserControl so the drive functions stay focused; the resolution
 * logic (explicit-tab vs active-fallback vs error) is unit-tested here + there.
 */

const attached: WebContents[] = []
let activeId: number | null = null
const byTab = new Map<string, WebContents>()

/**
 * Called from security.ts on `did-attach-webview`. Registers the guest and — if
 * no tab is active yet — makes it the active one (first-attach default). When the
 * guest goes away (tab closed / crash) we forget it so the next drive resolves
 * another guest instead of touching a dead handle.
 */
export function captureBrowserGuest(wc: WebContents): void {
  attached.push(wc)
  if (activeId === null) activeId = wc.id
  wc.once('destroyed', () => {
    const i = attached.indexOf(wc)
    if (i !== -1) attached.splice(i, 1)
    if (activeId === wc.id) activeId = null
  })
}

/**
 * The renderer marks a tab's guest ACTIVE by its getWebContentsId(). Ignored if
 * the id isn't a live attached guest (a stale switch during teardown).
 */
export function setActiveGuest(id: unknown): { ok: true; active: number | null } {
  if (typeof id === 'number' && attached.some((wc) => wc.id === id && !wc.isDestroyed())) {
    activeId = id
  }
  return { ok: true, active: activeId }
}

/**
 * Map a renderer tab id → its guest webContents (by getWebContentsId()). Ignored
 * if the id isn't a live attached guest (a stale register during teardown). When
 * a mapped guest is destroyed we drop its entry so a later `tab` resolves cleanly.
 */
export function registerTab(tabId: unknown, wcId: unknown): { ok: true; tab: string | null } {
  const id = typeof tabId === 'string' ? tabId.trim() : ''
  if (!id || typeof wcId !== 'number') return { ok: true, tab: null }
  const wc = attached.find((w) => w.id === wcId && !w.isDestroyed())
  if (!wc) return { ok: true, tab: null }
  byTab.set(id, wc)
  wc.once('destroyed', () => {
    if (byTab.get(id) === wc) byTab.delete(id)
  })
  return { ok: true, tab: id }
}

/** Forget a tab's guest mapping (tab closed). Idempotent. */
export function unregisterTab(tabId: unknown): { ok: true } {
  const id = typeof tabId === 'string' ? tabId.trim() : ''
  if (id) byTab.delete(id)
  return { ok: true }
}

/** Test seam / teardown: forget all captured guests. */
export function resetBrowserGuest(): void {
  attached.length = 0
  activeId = null
  byTab.clear()
}

/**
 * Resolve the guest to drive. With an explicit `tab` id, act on THAT tab's guest
 * (registered on its dom-ready) — an unknown/closed tab is an Error, so an agent
 * driving a specific tab never silently hits the wrong page. Without a `tab`,
 * resolve the ACTIVE-tab guest by id, falling back to the latest still-attached
 * guest — today's behavior, backward-compatible. Errors when nothing's open.
 */
export function requireGuest(tab?: unknown): WebContents {
  // Drop any dead handles first (defensive — destroyed listeners also prune).
  for (let i = attached.length - 1; i >= 0; i--) {
    if (attached[i].isDestroyed()) attached.splice(i, 1)
  }
  const tabId = typeof tab === 'string' ? tab.trim() : ''
  if (tabId) {
    const scoped = byTab.get(tabId)
    if (!scoped || scoped.isDestroyed()) {
      throw new Error(`no live browser tab "${tabId}" — open it with browser.newTab first`)
    }
    return scoped
  }
  const active = activeId != null ? attached.find((wc) => wc.id === activeId) : undefined
  const guest = active ?? attached[attached.length - 1]
  if (!guest || guest.isDestroyed()) {
    throw new Error('the Browser surface is not open — open the Browser rail first')
  }
  return guest
}
