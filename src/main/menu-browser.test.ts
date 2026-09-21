import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Every id the Browser menu emits must be routed by the browser surface.
 *
 * `page-actions.ts` states the rule this protects: "Nothing is listed here that
 * does not work. An offer that does nothing when clicked is worse than an absent
 * one: it teaches people the panel is decorative, and they stop reading it." A
 * menu earns that rule no less than a panel does — and the failure is silent,
 * because a dead menu item typechecks, renders, and does nothing.
 *
 * It nearly shipped twice while this menu was being written: once because the
 * browser surface had no `menu:run-action` subscription at all, and once when a
 * Reload item was added without a case for it.
 *
 * This reads both files as TEXT rather than importing them: the menu builder
 * needs a real BrowserWindow and the surface is a React component, so neither
 * can be exercised here. A structural check is not elegant, but it catches the
 * exact mistake, and the alternative was catching it in the built app or not at
 * all. Only literal `send('…')` ids are compared; ids that come from the pushed
 * action list are covered by `isActionId` in page-actions.test.ts.
 */

const SRC = path.join(__dirname, 'menu-browser.ts')
const SURFACE = path.join(__dirname, '../renderer/src/components/Browser/BrowserSurface.tsx')

const emitted = (): string[] => {
  const src = fs.readFileSync(SRC, 'utf8')
  // Digits included: `history.clear-2days` slipped past an earlier
  // [a-z.-] pattern and would have been checked by nothing at all.
  return [...src.matchAll(/send\('([a-z][a-z0-9.-]*)'\)/g)].map((m) => m[1]).sort()
}

describe('browser menu ids', () => {
  it('emits at least the navigation and history ids', () => {
    // A guard on the guard: if the regex stops matching, the test below would
    // pass vacuously and prove nothing.
    expect(emitted().length).toBeGreaterThanOrEqual(10)
  })

  it('every literal id it sends is handled by the browser surface', () => {
    const surface = fs.readFileSync(SURFACE, 'utf8')
    const unrouted = emitted().filter((id) => !surface.includes(`case '${id}':`))
    expect(unrouted).toEqual([])
  })
})

/**
 * Accelerator collisions between the Browser menu and the rest of the bar.
 *
 * Four shipped at once and none was caught: `role: 'reload'` binds Cmd+R and
 * the zoom roles bind Cmd+= / Cmd+- / Cmd+0, which are exactly the keys the
 * Browser menu claims for page reload and page zoom. Electron does not define
 * which of two items sharing an accelerator wins, and the way it resolved here
 * was the bad one — Cmd+R reloading the window and discarding every open tab.
 *
 * The earlier hygiene test only covered shortcuts the PANEL advertises, so the
 * menu's own literal accelerators were checked by nothing. This closes that.
 *
 * Roles are mapped to the keys Electron gives them by default, because the
 * collision is invisible in the source: `{ role: 'reload' }` mentions no key at
 * all.
 */
const ROLE_KEYS: Record<string, string> = {
  reload: 'CmdOrCtrl+R',
  forceReload: 'Shift+CmdOrCtrl+R',
  zoomIn: 'CmdOrCtrl+Plus',
  zoomOut: 'CmdOrCtrl+-',
  resetZoom: 'CmdOrCtrl+0',
  toggleDevTools: 'Alt+CmdOrCtrl+I',
  minimize: 'CmdOrCtrl+M',
  close: 'CmdOrCtrl+W',
}

describe('accelerators while the browser surface is active', () => {
  const MENU = path.join(__dirname, 'menu.ts')

  /** Keys menu.ts binds in the BROWSER branch — explicit ones plus role defaults. */
  const appKeys = (): string[] => {
    const src = fs.readFileSync(MENU, 'utf8')
    const explicit = [...src.matchAll(/accelerator: '([^']+)'/g)].map((m) => m[1])
    /*
     * menu.ts holds BOTH branches — the browsing one and the ordinary one — so
     * a bare `{ role: 'zoomIn' }` in the source does not prove that key is live
     * while browsing. A role written WITH an explicit accelerator anywhere has
     * been moved on purpose (the Alt variants), so its default no longer
     * applies; every other role still carries its default key.
     */
    const moved = new Set(
      [...src.matchAll(/role: '(\w+)',\s*(?:label: '[^']*',\s*)?accelerator:/g)].map((m) => m[1]),
    )
    const roles = [...src.matchAll(/role: '(\w+)'/g)]
      .map((m) => m[1])
      .filter((r) => !moved.has(r))
      .map((r) => ROLE_KEYS[r])
      .filter((k): k is string => Boolean(k))
    return [...explicit, ...roles]
  }

  const browserKeys = (): string[] => {
    const src = fs.readFileSync(SRC, 'utf8')
    const literal = [...src.matchAll(/accelerator: '([^']+)'/g)].map((m) => m[1])
    // Page zoom and find take their keys from the panel's own labels.
    const fromPanel = ['CmdOrCtrl+F', 'CmdOrCtrl+Plus', 'CmdOrCtrl+-', 'CmdOrCtrl+0']
    return [...literal, ...fromPanel]
  }

  it('claims no key the app menu still binds unmodified', () => {
    const clash = browserKeys().filter((k) => appKeys().includes(k))
    expect(clash).toEqual([])
  })

  it('checks a meaningful number of keys', () => {
    expect(browserKeys().length).toBeGreaterThanOrEqual(6)
    expect(appKeys().length).toBeGreaterThanOrEqual(8)
  })
})
