/**
 * Runs an app's tests (app-tests.ts) in its live preview beside the builder
 * chat, the way a person uses it: real pointer and key events at the
 * element's place on screen (a covered button fails, as it would for the
 * person), with a pointer mark so the person can watch.
 *
 * Input goes through Chromium's own input path (the DevTools protocol's
 * Input domain), which hit-tests into the app's frame. Measured 2026-10-06:
 * webContents.sendInputEvent stops at the window's page, whose mousedown
 * lands on the <iframe> element, so no app ever saw a click.
 *
 * While it runs the app is in test mode (see `testing`): its saved data is
 * a scratch copy in memory, AI answers what the scenario says (or is off),
 * and files never reach a dialog. The person's data is untouched, and the app
 * reloads with it when the run ends.
 */
import type { BrowserWindow, WebFrameMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { PAGE } from './app-page'
import { type Scenario, type Step, type Target, type TestPlan } from './app-tests'

export interface TestMode {
  store: Record<string, unknown>
  ai: { reply: unknown } | null
  open: { name: string; data: string } | null
  saved: { name: string; data: string }[]
}
/** Apps under test: their calls (apps:call) go here instead of to the disk, the model or a dialog. */
export const testing = new Map<string, TestMode>()

export interface ScenarioResult {
  name: string
  check: string
  ok: boolean
  /** 1-based step that failed, and why. */
  step?: number
  error?: string
  /** The page's errors during the scenario. */
  errors: string[]
  /** The app at the end (a failure's picture), relative to the workspace. */
  shot?: string
}
export interface TestReport {
  total: number
  passed: number
  scenarios: ScenarioResult[]
  ms: number
  /** Set when the run itself could not go on (the preview was closed). */
  stopped?: string
}

export const SHOT_DIR = '.tests'
const PACE_MS = 220
const RUN_BUDGET_MS = 6 * 60_000

const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms))
/** Named keys: [key, code, Windows key code, text it types]. */
const NAMED: Record<string, [string, string, number, string]> = {
  Enter: ['Enter', 'Enter', 13, '\r'],
  Escape: ['Escape', 'Escape', 27, ''],
  Backspace: ['Backspace', 'Backspace', 8, ''],
  Delete: ['Delete', 'Delete', 46, ''],
  Tab: ['Tab', 'Tab', 9, ''],
  ArrowLeft: ['ArrowLeft', 'ArrowLeft', 37, ''],
  ArrowUp: ['ArrowUp', 'ArrowUp', 38, ''],
  ArrowRight: ['ArrowRight', 'ArrowRight', 39, ''],
  ArrowDown: ['ArrowDown', 'ArrowDown', 40, ''],
  Home: ['Home', 'Home', 36, ''],
  End: ['End', 'End', 35, ''],
  PageUp: ['PageUp', 'PageUp', 33, ''],
  PageDown: ['PageDown', 'PageDown', 34, ''],
  ' ': [' ', 'Space', 32, ' '],
}
const ALIAS: Record<string, string> = { Esc: 'Escape', Return: 'Enter', Space: ' ', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight' }
const MOD_BITS: Record<string, number> = { alt: 1, control: 2, meta: 4, shift: 8 }

/** A key as the Input domain wants it, or null for one it does not know. */
export function keyEvent(key: string, mods: string[]): { key: string; code: string; windowsVirtualKeyCode: number; text: string; modifiers: number } | null {
  const k = ALIAS[key] ?? key
  const modifiers = mods.reduce((n, m) => n | (MOD_BITS[m] ?? 0), 0)
  const typed = (t: string): string => (modifiers & (MOD_BITS.meta | MOD_BITS.control) ? '' : t)
  const named = NAMED[k]
  if (named) return { key: named[0], code: named[1], windowsVirtualKeyCode: named[2], text: typed(named[3]), modifiers }
  if ([...k].length !== 1) return null
  const up = k.toUpperCase()
  const code = /[A-Z]/.test(up) ? `Key${up}` : /\d/.test(k) ? `Digit${k}` : ''
  const ch = mods.includes('shift') ? up : k
  return { key: ch, code, windowsVirtualKeyCode: /[A-Z0-9]/.test(up) ? up.charCodeAt(0) : 0, text: typed(ch), modifiers }
}

class Stop extends Error {}

/** One app's live preview in the window. */
export class AppDriver {
  constructor(
    private win: BrowserWindow,
    private slug: string,
  ) {}

  private get wc(): Electron.WebContents {
    if (this.win.isDestroyed()) throw new Stop('The window was closed')
    return this.win.webContents
  }

  private attached = false

  /** One Input-domain command (attaching once; detach() lets go). */
  private async input(method: string, params: Record<string, unknown>): Promise<void> {
    const dbg = this.wc.debugger
    if (!dbg.isAttached()) {
      try {
        dbg.attach('1.3')
        this.attached = true
      } catch (e) {
        throw new Stop(`The tests cannot press anything in this window (${e instanceof Error ? e.message : String(e)})`)
      }
    }
    await dbg.sendCommand(method, params)
  }

  detach(): void {
    if (this.attached && !this.win.isDestroyed() && this.wc.debugger.isAttached()) this.wc.debugger.detach()
    this.attached = false
  }

  private mouse(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', x: number, y: number, clickCount = 0, down = false): Promise<void> {
    return this.input('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !down ? 'none' : 'left', buttons: down || type === 'mousePressed' ? 1 : 0, clickCount })
  }

  /** Where the preview's frame is in the window (CSS pixels), and its address. */
  async box(): Promise<{ x: number; y: number; w: number; h: number; src: string }> {
    const sel = `[data-testid="chat-app-preview"][data-app="${this.slug}"] [data-testid="app-frame"]`
    const b = await this.wc.executeJavaScript(
      `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 40) return null; return { x: r.left + el.clientLeft, y: r.top + el.clientTop, w: el.clientWidth, h: el.clientHeight, src: el.src } })()`,
    )
    if (!b) throw new Stop('The app’s preview is not on screen')
    return b
  }

  private async frame(): Promise<WebFrameMain> {
    const { src } = await this.box()
    const mine = this.wc.mainFrame.framesInSubtree.filter((f) => !f.isDestroyed() && f.url.startsWith(`wos-app://app/${this.slug}/`))
    const f = mine.find((x) => x.url === src) ?? mine[0]
    if (!f) throw new Stop('The app’s page is not loaded')
    return f
  }

  /** PAGE(op, arg) in the app's page. */
  async page<T>(op: string, arg: unknown = null): Promise<T> {
    return (await this.frame()).executeJavaScript(`(${PAGE})(${JSON.stringify(op)}, ${JSON.stringify(arg)})`) as Promise<T>
  }

  /** Reloads the app and waits until it has started. */
  async reload(): Promise<void> {
    await this.page('stale').catch(() => {})
    ;(await this.frame()).reload()
    for (let t = 0; t < 10_000; t += 150) {
      await sleep(150)
      if (await this.page<boolean>('ready').catch(() => false)) return void (await sleep(400))
    }
    throw new Error('The app did not finish loading within 10 s')
  }

  /** The element's centre in the window's page (CSS pixels); waits for it a little, fails when it is missing or covered. */
  private async point(t: Target): Promise<{ x: number; y: number; px: number; py: number }> {
    let last = ''
    for (let waited = 0; ; waited += 150) {
      const r = await this.page<{ x?: number; y?: number; covered?: string | null; missing?: string; error?: string }>('locate', t)
      if (r.error) throw new Error(r.error)
      if (r.x !== undefined && r.y !== undefined) {
        if (r.covered) throw new Error(`${t.target ? `"${t.target}"` : `"${t.text}"`} cannot be clicked: ${r.covered} is on top of it`)
        const b = await this.box()
        return { x: b.x + r.x, y: b.y + r.y, px: r.x, py: r.y }
      }
      last = r.missing ?? 'Not found'
      if (waited >= 2000) throw new Error(last)
      await sleep(150)
    }
  }

  private mark(px: number, py: number): Promise<unknown> {
    return this.page('cursor', { x: px, y: py }).catch(() => null)
  }

  async click(t: Target, count = 1): Promise<void> {
    const p = await this.point(t)
    await this.mark(p.px, p.py)
    await this.mouse('mouseMoved', p.x, p.y)
    for (let i = 1; i <= count; i++) {
      await this.mouse('mousePressed', p.x, p.y, i)
      await this.mouse('mouseReleased', p.x, p.y, i)
    }
  }

  async type(t: Target, value: string, clear: boolean): Promise<void> {
    await this.click(t)
    await sleep(60)
    if (!(await this.page<boolean>('select', { clear }))) throw new Error(`Clicking ${t.target ? `"${t.target}"` : `"${t.text}"`} gave nothing to type into`)
    // Typing replaces the selection; an empty value clears it.
    if (value) await this.input('Input.insertText', { text: value })
    else if (clear) await this.key('Backspace', [])
  }

  async key(key: string, mods: string[]): Promise<void> {
    const k = keyEvent(key, mods)
    if (!k) throw new Error(`Not a key the tests know: "${key}"`)
    await this.input('Input.dispatchKeyEvent', { type: k.text ? 'keyDown' : 'rawKeyDown', ...k })
    await this.input('Input.dispatchKeyEvent', { type: 'keyUp', ...k, text: '' })
  }

  async drag(t: Target, by: [number, number]): Promise<void> {
    const p = await this.point(t)
    await this.mark(p.px, p.py)
    await this.mouse('mouseMoved', p.x, p.y)
    await this.mouse('mousePressed', p.x, p.y, 1)
    const steps = 10
    for (let i = 1; i <= steps; i++) {
      await sleep(16)
      await this.mouse('mouseMoved', p.x + (by[0] * i) / steps, p.y + (by[1] * i) / steps, 0, true)
    }
    await this.mouse('mouseReleased', p.x + by[0], p.y + by[1], 1)
    await this.mark(p.px + by[0], p.py + by[1])
  }

  /** Polls a check until it holds or the time is up; throws its last reason. */
  async until(check: () => Promise<{ ok: boolean; why?: string }>, timeout: number): Promise<void> {
    let why = ''
    for (let waited = 0; ; waited += 150) {
      const r = await check()
      if (r.ok) return
      why = r.why ?? 'It did not hold'
      if (waited >= timeout) throw new Error(why)
      await sleep(150)
    }
  }

  /** An expression in the app's page (await works), true when right. */
  async js(code: string): Promise<{ ok: boolean; why?: string }> {
    const f = await this.frame()
    try {
      const v = await f.executeJavaScript(`(async () => (${code}))()`)
      return v ? { ok: true } : { ok: false, why: `This was not true: ${code}` }
    } catch (e) {
      return { ok: false, why: `This failed: ${code} (${e instanceof Error ? e.message.replace(/^.*?Error: /, '') : String(e)})` }
    }
  }

  /** The app as it looks now (PNG), without the pointer mark. */
  async shot(): Promise<Buffer | null> {
    await this.page('uncursor').catch(() => {})
    const b = await this.box()
    const z = this.wc.getZoomFactor()
    const img = await this.wc.capturePage({ x: Math.round(b.x * z), y: Math.round(b.y * z), width: Math.round(b.w * z), height: Math.round(b.h * z) })
    return img.isEmpty() ? null : img.toPNG()
  }
}

export async function runStep(d: AppDriver, s: Step, mode: TestMode): Promise<void> {
  switch (s.do) {
    case 'click':
      return d.click(s)
    case 'dblclick':
      return d.click(s, 2)
    case 'type':
      return d.type(s, s.value, s.clear)
    case 'key':
      return d.key(s.key, s.mods)
    case 'drag':
      return d.drag(s, s.by)
    case 'wait':
      return sleep(s.ms)
    case 'reload':
      return d.reload()
    case 'expect':
      return d.until(() => d.page('expect', s), s.timeout)
    case 'expectJs':
      return d.until(() => d.js(s.js), s.timeout)
    case 'expectSaved':
      return d.until(async () => {
        const hit = mode.saved.some((f) => (!s.name || f.name.toLowerCase().includes(s.name.toLowerCase())) && (!s.contains || f.data.includes(s.contains)))
        return hit ? { ok: true } : { ok: false, why: mode.saved.length ? `The app saved ${mode.saved.map((f) => f.name).join(', ')}, not what was expected${s.contains ? ` (containing "${s.contains}")` : ''}` : 'The app saved no file' }
      }, 2000)
  }
}

async function runScenario(d: AppDriver, sc: Scenario, mode: TestMode): Promise<ScenarioResult> {
  mode.store = JSON.parse(JSON.stringify(sc.store))
  mode.ai = 'ai' in sc ? { reply: sc.ai } : null
  mode.open = sc.open ?? null
  mode.saved = []
  const result: ScenarioResult = { name: sc.name, check: sc.check, ok: true, errors: [] }
  await d.reload()
  for (let i = 0; i < sc.steps.length; i++) {
    try {
      await runStep(d, sc.steps[i], mode)
      await sleep(PACE_MS)
    } catch (e) {
      if (e instanceof Stop) throw e
      Object.assign(result, { ok: false, step: i + 1, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) })
      break
    }
  }
  result.errors = await d.page<string[]>('errors').catch(() => [])
  if (result.ok && result.errors.length) Object.assign(result, { ok: false, error: `The page had errors: ${result.errors.slice(0, 3).join(' | ')}` })
  return result
}

/**
 * Runs the plan in the app's live preview. The app is in test mode
 * throughout and reloads with the person's own data afterwards.
 */
export async function runPlan(
  win: BrowserWindow,
  root: string,
  slug: string,
  plan: TestPlan,
  onProgress: (i: number, total: number, name: string) => void = () => {},
  budgetMs = RUN_BUDGET_MS,
): Promise<TestReport> {
  const d = new AppDriver(win, slug)
  const started = Date.now()
  const report: TestReport = { total: plan.scenarios.length, passed: 0, scenarios: [], ms: 0 }
  const shots = path.join(root, 'Apps', slug, SHOT_DIR)
  fs.rmSync(shots, { recursive: true, force: true })
  const mode: TestMode = { store: {}, ai: null, open: null, saved: [] }
  testing.set(slug, mode)
  try {
    for (let i = 0; i < plan.scenarios.length; i++) {
      const sc = plan.scenarios[i]
      if (Date.now() - started > budgetMs) {
        report.stopped = `The tests ran out of time after ${i} of ${plan.scenarios.length} scenarios`
        break
      }
      onProgress(i + 1, plan.scenarios.length, sc.name)
      const r = await runScenario(d, sc, mode)
      if (!r.ok) {
        const png = await d.shot().catch(() => null)
        if (png) {
          fs.mkdirSync(shots, { recursive: true })
          const file = `${i + 1}.png`
          fs.writeFileSync(path.join(shots, file), png)
          r.shot = `Apps/${slug}/${SHOT_DIR}/${file}`
        }
      }
      report.scenarios.push(r)
      if (r.ok) report.passed++
    }
  } catch (e) {
    report.stopped = e instanceof Error ? e.message : String(e)
  } finally {
    testing.delete(slug)
    d.detach()
    await d.reload().catch(() => {})
    report.ms = Date.now() - started
  }
  return report
}
