import fs from 'fs'
import path from 'path'
import { app, IpcMain, WebContents } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { IPC } from '../ipc-channels'
import { normalizeMode, scriptForMode, type ExtractMode } from './extractScript'
import {
  dismissCookiesScript,
  clearConsentScript,
  clickScript,
  scrollScript,
  waitForScript,
  typeScript,
} from './interactScript'
import { mapScript } from './mapScript'
import {
  DEEP_READ,
  normalizeMaxPages,
  selectSubpages,
  harvestEmails,
  harvestPhones,
  harvestSocials,
  toExcerpt,
  hostOf,
  type MappedLink,
  type Profile,
  type ProfilePage,
} from './deepRead'
import { getWorkspaceRoot } from '../workspace-root'

/**
 * BROWSER DRIVE (main side).
 *
 * Lets the in-app agent drive the VISIBLE in-app Browser surface — a sandboxed
 * <webview> — so the user watches it work: navigate → screenshot (confirmation)
 * → extract page data (into xlsx/pptx downstream). The guest webContents is
 * captured from `did-attach-webview` in security.ts (there is one Browser
 * surface; we keep the latest attached guest). The renderer's browser actions
 * call these over IPC; each returns a `result` the AGENT→ACTION bridge relays.
 *
 * Security posture (mirrors security.ts):
 *  - We never create or configure the guest here — it stays sandboxed (own
 *    partition, no node, no preload). We only read/drive an already-hardened one.
 *  - http(s) navigation only; anything else is refused.
 *  - Extraction runs a FIXED script chosen by a `mode` enum — NO arbitrary agent
 *    JS ever reaches `executeJavaScript`.
 *  - Screenshots are written only to a caller-provided path under userData /
 *    the workspace; the path is resolved + guarded before any write.
 */

/** How long a navigation may take before we give up (ms). */
const NAV_TIMEOUT_MS = 30_000

// Guest tracking + tab-scoped resolution live in guestRegistry (kept small +
// focused). Re-exported so existing importers (security.ts → captureBrowserGuest)
// and the tests keep their import path.
export {
  captureBrowserGuest,
  setActiveGuest,
  registerTab,
  unregisterTab,
  resetBrowserGuest,
  requireGuest,
} from './guestRegistry'
import { requireGuest, setActiveGuest, registerTab, unregisterTab } from './guestRegistry'

/** http(s) only, mirroring security.ts. Throws on anything else. */
function requireHttpUrl(raw: unknown): string {
  const url = typeof raw === 'string' ? raw.trim() : ''
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('only http(s) URLs can be opened')
  }
  return url
}

/** Navigate the guest to `url`, resolving once it loads (or the nav fails). */
export async function navigate(wc: WebContents, url: string): Promise<{ ok: true; url: string; title: string }> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const done = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      wc.removeListener('did-finish-load', onLoad)
      wc.removeListener('did-fail-load', onFail)
      fn()
    }
    const onLoad = (): void => done(resolve)
    const onFail = (_e: unknown, errCode: number, errDesc: string): void => {
      // -3 (ERR_ABORTED) fires for in-page/redirect churn — ignore, wait for load.
      if (errCode === -3) return
      done(() => reject(new Error(`navigation failed: ${errDesc || 'unknown error'}`)))
    }
    const timer = setTimeout(
      () => done(() => reject(new Error('navigation timed out'))),
      NAV_TIMEOUT_MS,
    )
    wc.on('did-finish-load', onLoad)
    wc.on('did-fail-load', onFail)
    wc.loadURL(url).catch((err: Error) => done(() => reject(err)))
  })
  return { ok: true, url: wc.getURL(), title: wc.getTitle() }
}

/** The roots a screenshot may be written under (userData + the workspace). */
function screenshotRoots(): string[] {
  const roots = [app.getPath('userData')]
  // The live workspace root lives in main's own state — WOS_WORKSPACE is only
  // set in the agent's spawned shells, not in this (main) process, so relying on
  // the env var rejected legitimate in-workspace paths.
  const ws = getWorkspaceRoot() ?? process.env['WOS_WORKSPACE']
  if (ws) roots.push(ws)
  return roots.map((r) => path.resolve(r))
}

/**
 * Resolve + guard a caller screenshot path: default under userData, and confirm
 * the resolved path stays within an allowed root (no traversal outside).
 */
export function resolveScreenshotPath(destPath: unknown, roots: string[]): string {
  const raw = typeof destPath === 'string' && destPath.trim()
    ? destPath.trim()
    : path.join(roots[0], `browser-${Date.now()}.png`)
  const resolved = path.resolve(raw)
  const inside = roots.some((root) => resolved === root || resolved.startsWith(root + path.sep))
  if (!inside) {
    throw new Error('screenshot path must be under the workspace or app data directory')
  }
  if (path.extname(resolved).toLowerCase() !== '.png') {
    throw new Error('screenshot path must end in .png')
  }
  return resolved
}

/** Capture the guest page to a PNG at `destPath`. */
export async function screenshot(wc: WebContents, destPath: unknown): Promise<{ ok: true; path: string }> {
  const target = resolveScreenshotPath(destPath, screenshotRoots())
  const image = await wc.capturePage()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, image.toPNG())
  return { ok: true, path: target }
}

/** Run the FIXED extraction script for `mode` in the guest; return its JSON. */
export async function extract(wc: WebContents, mode: ExtractMode): Promise<{ ok: true; mode: ExtractMode; data: unknown }> {
  const data = await wc.executeJavaScript(scriptForMode(mode), true)
  return { ok: true, mode, data }
}

/**
 * Run the FIXED perception script in the guest; return the structured page map
 * ({title,url,headings,links,interactives,consent}). Takes NO agent input.
 */
export async function map(wc: WebContents): Promise<{ ok: true; data: unknown }> {
  const data = await wc.executeJavaScript(mapScript(), true)
  return { ok: true, data }
}

/** The guest's current URL + title. */
export function current(wc: WebContents): { ok: true; url: string; title: string } {
  return { ok: true, url: wc.getURL(), title: wc.getTitle() }
}

/**
 * Run the FIXED cookie-dismiss heuristic in the guest. Best-effort: returns
 * `{clicked:false}` when no consent button is found (NOT an error). Takes no
 * agent input — the selector/text lists live in interactScript.ts.
 */
export async function dismissCookies(
  wc: WebContents,
): Promise<{ ok: true; clicked: boolean; label?: string }> {
  const r = (await wc.executeJavaScript(dismissCookiesScript(), true)) as {
    clicked?: boolean
    label?: string
  }
  return { ok: true, clicked: !!r?.clicked, label: r?.label }
}

/**
 * Run the HARDENED consent clearer in the guest (overlay → wall → same-origin
 * iframe). Best-effort: `cleared:false` is NOT an error. Waits briefly for any
 * redirect/settle after a click. Takes NO agent input.
 */
export async function clearConsent(
  wc: WebContents,
): Promise<{ ok: true; cleared: boolean; method: 'overlay' | 'wall' | 'iframe' | 'none'; wasWall: boolean }> {
  const r = (await wc.executeJavaScript(clearConsentScript(), true)) as {
    cleared?: boolean
    method?: 'overlay' | 'wall' | 'iframe' | 'none'
    wasWall?: boolean
  }
  // A consent accept often triggers a redirect back to the real page — give it a
  // brief beat to settle so the caller's next map/extract sees the content page.
  if (r?.cleared) await settle(wc)
  return {
    ok: true,
    cleared: !!r?.cleared,
    method: r?.method ?? 'none',
    wasWall: !!r?.wasWall,
  }
}

/**
 * DEEP-READ orchestration (main side). Deterministically drives the VISIBLE
 * guest — navigate → clearConsent → map → pick top same-origin subpages by
 * category → for each navigate → clearConsent → extract(text|meta) — and
 * assembles a clean PROFILE. Bounded by `maxPages` (1..8) and a wall-clock
 * budget (~60s). Reuses the drive fns above; produces NO agent JS.
 */
export async function deepRead(
  wc: WebContents,
  rawUrl: unknown,
  rawMaxPages: unknown,
  rawFocus: unknown,
): Promise<{ ok: true; profile: Profile; notes: string[] }> {
  const url = requireHttpUrl(rawUrl)
  const maxPages = normalizeMaxPages(rawMaxPages)
  const focus = typeof rawFocus === 'string' ? rawFocus.trim().slice(0, 80) : ''
  const deadline = Date.now() + DEEP_READ.timeBudgetMs
  const notes: string[] = []
  const timeLeft = (): boolean => Date.now() < deadline

  // 1. Homepage: navigate → clearConsent → map.
  const home = await navigate(wc, url)
  await clearConsent(wc)
  const homeMap = (await map(wc)).data as {
    title?: string
    links?: MappedLink[]
  }
  const homepage = wc.getURL() || home.url
  const links = Array.isArray(homeMap?.links) ? homeMap.links : []

  // 2. Pick same-origin subpages by category priority (focus-biased).
  const picks = selectSubpages(homepage, links, maxPages, focus)
  if (picks.length === 0) notes.push('no same-origin subpages found on the homepage')

  // 3. Visit each: navigate → clearConsent → extract(text) + extract(meta).
  const pages: ProfilePage[] = []
  const collected: string[] = []
  for (const link of picks) {
    if (!timeLeft()) {
      notes.push('time budget reached — stopped early')
      break
    }
    try {
      await navigate(wc, link.href)
      await clearConsent(wc)
      const textData = (await extract(wc, 'text')).data as { title?: string; text?: string }
      const excerpt = toExcerpt(textData?.text)
      collected.push(textData?.text ?? '')
      pages.push({
        url: wc.getURL() || link.href,
        category: link.category,
        title: textData?.title || link.text || '',
        excerpt,
      })
    } catch (err) {
      notes.push(`skipped ${link.href}: ${(err as Error).message}`)
    }
  }

  // 4. Assemble the profile. Emails/phones from all collected text; socials from
  //    the homepage's mapped links.
  const allText = [homeMap ? '' : '', ...collected].join('\n')
  const profile: Profile = {
    name: homeMap?.title || home.title || hostOf(homepage),
    homepage,
    title: homeMap?.title || home.title || '',
    pages,
    emails: harvestEmails(allText),
    phones: harvestPhones(allText),
    socials: harvestSocials(links),
  }
  return { ok: true, profile, notes }
}

/** Click the first visible element matching selector OR visible-text. */
export async function click(
  wc: WebContents,
  selector: unknown,
  text: unknown,
): Promise<{ ok: true; clicked: boolean; tag?: string; text?: string; href?: string }> {
  const sel = typeof selector === 'string' ? selector.trim() : ''
  const txt = typeof text === 'string' ? text.trim() : ''
  if (!sel && !txt) {
    throw new Error('click needs a selector or text to match')
  }
  const r = (await wc.executeJavaScript(clickScript(sel, txt), true)) as {
    clicked?: boolean
    tag?: string
    text?: string
    href?: string
  }
  return { ok: true, clicked: !!r?.clicked, tag: r?.tag, text: r?.text, href: r?.href }
}

/** Scroll the page (to top/bottom or by an amount). Returns scroll state. */
export async function scroll(
  wc: WebContents,
  to: unknown,
  by: unknown,
): Promise<{ ok: true; scrollY: number; atBottom: boolean }> {
  const r = (await wc.executeJavaScript(scrollScript(to, by), true)) as {
    scrollY?: number
    atBottom?: boolean
  }
  return { ok: true, scrollY: r?.scrollY ?? 0, atBottom: !!r?.atBottom }
}

/** Poll in-page (capped) until a selector/text appears, or timeout. */
export async function waitFor(
  wc: WebContents,
  selector: unknown,
  text: unknown,
  timeoutMs: unknown,
): Promise<{ ok: true; found: boolean }> {
  const sel = typeof selector === 'string' ? selector.trim() : ''
  const txt = typeof text === 'string' ? text.trim() : ''
  if (!sel && !txt) {
    throw new Error('waitFor needs a selector or text to match')
  }
  const r = (await wc.executeJavaScript(waitForScript(sel, txt, timeoutMs), true)) as {
    found?: boolean
  }
  return { ok: true, found: !!r?.found }
}

/** Wait for the guest to settle after a history nav (or a short cap). */
function settle(wc: WebContents): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      wc.removeListener('did-finish-load', finish)
      resolve()
    }
    const timer = setTimeout(finish, 2000)
    wc.once('did-finish-load', finish)
  })
}

/** History back. Returns the settled url (no-op when there's nothing to go to). */
export async function back(wc: WebContents): Promise<{ ok: true; url: string }> {
  const nav = wc.navigationHistory
  if (nav.canGoBack()) {
    nav.goBack()
    await settle(wc)
  }
  return { ok: true, url: wc.getURL() }
}

/** History forward. Returns the settled url (no-op when there's nothing to go to). */
export async function forward(wc: WebContents): Promise<{ ok: true; url: string }> {
  const nav = wc.navigationHistory
  if (nav.canGoForward()) {
    nav.goForward()
    await settle(wc)
  }
  return { ok: true, url: wc.getURL() }
}

/** Set an input's value (agent text is DATA into `.value`, never executed). */
export async function type(
  wc: WebContents,
  selector: unknown,
  text: unknown,
): Promise<{ ok: true; typed: boolean; tag?: string }> {
  const sel = typeof selector === 'string' ? selector.trim() : ''
  if (!sel) {
    throw new Error('type needs a selector for the target input')
  }
  const r = (await wc.executeJavaScript(typeScript(sel, text), true)) as {
    typed?: boolean
    tag?: string
  }
  return { ok: true, typed: !!r?.typed, tag: r?.tag }
}

/** Register the four browser-drive IPC handlers. */
export function registerBrowserHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.BROWSER_NAVIGATE, async (_e, arg: unknown) => {
    const a = arg as { url?: unknown; tab?: unknown }
    const url = requireHttpUrl(a?.url)
    return navigate(requireGuest(a?.tab), url)
  })
  ipcHandle(ipcMain, IPC.BROWSER_SCREENSHOT, async (_e, arg: unknown) => {
    const a = arg as { destPath?: unknown; tab?: unknown }
    return screenshot(requireGuest(a?.tab), a?.destPath)
  })
  ipcHandle(ipcMain, IPC.BROWSER_EXTRACT, async (_e, arg: unknown) => {
    const a = arg as { mode?: unknown; tab?: unknown }
    return extract(requireGuest(a?.tab), normalizeMode(a?.mode))
  })
  ipcHandle(ipcMain, IPC.BROWSER_MAP, async (_e, arg: unknown) => {
    return map(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_CURRENT, async (_e, arg: unknown) => {
    return current(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_DISMISS_COOKIES, async (_e, arg: unknown) => {
    return dismissCookies(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_CLEAR_CONSENT, async (_e, arg: unknown) => {
    return clearConsent(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_DEEP_READ, async (_e, arg: unknown) => {
    const a = arg as { url?: unknown; maxPages?: unknown; focus?: unknown; tab?: unknown }
    return deepRead(requireGuest(a?.tab), a?.url, a?.maxPages, a?.focus)
  })
  ipcHandle(ipcMain, IPC.BROWSER_CLICK, async (_e, arg: unknown) => {
    const a = arg as { selector?: unknown; text?: unknown; tab?: unknown }
    return click(requireGuest(a?.tab), a?.selector, a?.text)
  })
  ipcHandle(ipcMain, IPC.BROWSER_SCROLL, async (_e, arg: unknown) => {
    const a = arg as { to?: unknown; by?: unknown; tab?: unknown }
    return scroll(requireGuest(a?.tab), a?.to, a?.by)
  })
  ipcHandle(ipcMain, IPC.BROWSER_WAIT_FOR, async (_e, arg: unknown) => {
    const a = arg as { selector?: unknown; text?: unknown; timeoutMs?: unknown; tab?: unknown }
    return waitFor(requireGuest(a?.tab), a?.selector, a?.text, a?.timeoutMs)
  })
  ipcHandle(ipcMain, IPC.BROWSER_BACK, async (_e, arg: unknown) => {
    return back(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_FORWARD, async (_e, arg: unknown) => {
    return forward(requireGuest((arg as { tab?: unknown })?.tab))
  })
  ipcHandle(ipcMain, IPC.BROWSER_TYPE, async (_e, arg: unknown) => {
    const a = arg as { selector?: unknown; text?: unknown; tab?: unknown }
    return type(requireGuest(a?.tab), a?.selector, a?.text)
  })
  ipcHandle(ipcMain, IPC.BROWSER_SET_ACTIVE_GUEST, async (_e, arg: unknown) => {
    return setActiveGuest((arg as { id?: unknown })?.id)
  })
  ipcHandle(ipcMain, IPC.BROWSER_REGISTER_TAB, async (_e, arg: unknown) => {
    const a = arg as { tabId?: unknown; webContentsId?: unknown }
    return registerTab(a?.tabId, a?.webContentsId)
  })
  ipcHandle(ipcMain, IPC.BROWSER_UNREGISTER_TAB, async (_e, arg: unknown) => {
    return unregisterTab((arg as { tabId?: unknown })?.tabId)
  })
}
