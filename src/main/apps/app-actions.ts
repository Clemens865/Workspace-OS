import { appsRel, appsRoot } from './apps-store'
/**
 * The builder's hands and eyes on its own app, while it builds: `wos-action
 * run app.<verb>` from the builder's run (actionBridge.ts routes them here; a
 * run's grant names the one app it builds, and only that app is reachable).
 *
 * They drive the same live preview the person watches, with the same real
 * input as the app's tests (app-driver.ts). Until the turn ends the app runs
 * in test mode on a scratch copy of its data, so nothing the builder clicks
 * reaches the person's saved data; AI answers only what the builder set with
 * app.ai. When the turn ends (endAppSession) the app reloads as the person's.
 */
import fs from 'fs'
import path from 'path'
import { mainWindow } from '../main-window'
import { getWorkspaceRoot } from '../workspace-root'
import { storage } from './apps-store'
import { AppDriver, runPlan, runStep, SHOT_DIR, testing, type TestMode } from './app-driver'
import { parseStep, readPlan } from './app-tests'

type Reply = { ok: true; result?: unknown } | { ok: false; error: string }

/** The builder's scratch session per app: the test mode it set. It lasts the builder's whole turn, however long that takes. */
const sessions = new Map<string, { mode: TestMode }>()
/** The bridge's CLI waits 35 s for an answer; a test run from the builder stops before that. */
const TEST_BUDGET_MS = 25_000

const VERBS = ['look', 'click', 'type', 'key', 'drag', 'reload', 'check', 'data', 'ai', 'test'] as const

function scratchFromDisk(root: string, slug: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    for (const k of storage(root, slug, 'keys') as string[]) out[k] = storage(root, slug, 'get', k)
  } catch {
    /* no data yet */
  }
  return out
}

/** The builder's session: test mode on a scratch copy of the person's data (entered once, reloading the app into it). */
async function session(root: string, slug: string, d: AppDriver): Promise<TestMode> {
  const s = sessions.get(slug)
  if (s && testing.get(slug) === s.mode) return s.mode
  const mode: TestMode = { store: scratchFromDisk(root, slug), ai: null, open: null, saved: [] }
  testing.set(slug, mode)
  sessions.set(slug, { mode })
  await d.reload()
  return mode
}

/** The builder's turn is over: the app leaves test mode and reloads with the person's data. */
export async function endAppSession(slug: string): Promise<void> {
  const s = sessions.get(slug)
  if (!s) return
  sessions.delete(slug)
  if (testing.get(slug) !== s.mode) return // the tests took over, and give the app back themselves
  testing.delete(slug)
  const win = mainWindow()
  if (win) await new AppDriver(win, slug).reload().catch(() => {})
}

const say = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What the page looks like now: its controls, its errors, and a screenshot the builder can Read. */
async function look(root: string, slug: string, d: AppDriver, shot: boolean): Promise<unknown> {
  const page = await d.page<{ title: string; size: number[]; items: string[] }>('outline')
  const errors = await d.page<string[]>('errors').catch(() => [])
  let file: string | null = null
  if (shot) {
    const png = await d.shot().catch(() => null)
    if (png) {
      const dir = path.join(appsRoot(root), slug, SHOT_DIR)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'look.png'), png)
      file = `${appsRel(root)}/${slug}/${SHOT_DIR}/look.png`
    }
  }
  return { ...page, errors, ...(file ? { screenshot: `${file} (look at it with Read)` } : {}) }
}

/** One app.<verb> for the app this run builds. */
export async function runAppAction(slug: string, actionId: string, args: unknown): Promise<Reply> {
  const verb = actionId.slice(4) as (typeof VERBS)[number]
  if (!VERBS.includes(verb)) return { ok: false, error: `unknown action: ${actionId} (app.${VERBS.join(', app.')})` }
  const root = getWorkspaceRoot()
  const win = mainWindow()
  if (!root || !win) return { ok: false, error: 'Workspace OS has no open workspace window' }
  const a = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>
  const d = new AppDriver(win, slug)
  try {
    if (verb === 'test') {
      const plan = readPlan(root, slug)
      if (!plan) return { ok: false, error: `${appsRel(root)}/${slug}/TESTS.json has no tests yet` }
      const only = typeof a.scenario === 'string' ? plan.scenarios.filter((s) => s.name.toLowerCase().includes((a.scenario as string).toLowerCase())) : plan.scenarios
      if (!only.length) return { ok: false, error: `No scenario is called "${a.scenario}"` }
      sessions.delete(slug) // the run gives the app back; the next action starts a fresh scratch session
      return { ok: true, result: await runPlan(win, root, slug, { scenarios: only }, undefined, TEST_BUDGET_MS) }
    }
    const mode = await session(root, slug, d)
    switch (verb) {
      case 'look':
        return { ok: true, result: await look(root, slug, d, a.screenshot !== false) }
      case 'reload':
        await d.reload()
        return { ok: true, result: await look(root, slug, d, false) }
      case 'data':
        if (a.reset === true) mode.store = {}
        if (a.set && typeof a.set === 'object' && !Array.isArray(a.set)) mode.store = JSON.parse(JSON.stringify(a.set))
        if (a.reset === true || a.set) await d.reload()
        return { ok: true, result: { store: mode.store, saved: mode.saved.map((f) => ({ name: f.name, bytes: f.data.length, start: f.data.slice(0, 200) })) } }
      case 'ai':
        mode.ai = 'reply' in a && a.reply !== null ? { reply: a.reply } : null
        return { ok: true, result: mode.ai ? 'wos.ai.complete now answers that' : 'AI is off again' }
      case 'check': {
        const step = parseStep('js' in a ? { do: 'expectJs', js: a.js, timeout: a.timeout } : { ...a, do: 'expect' })
        if (!step) return { ok: false, error: 'Check what? {"target"|"text", "count"|"visible"|"contains"|"equals"} or {"js": "<expression>"}' }
        try {
          await runStep(d, step, mode)
          return { ok: true, result: 'holds' }
        } catch (e) {
          return { ok: true, result: `does not hold: ${say(e)}` }
        }
      }
      default: {
        const step = parseStep({ ...a, do: verb === 'click' && a.double === true ? 'dblclick' : verb })
        if (!step) return { ok: false, error: `app.${verb} needs ${verb === 'key' ? '{"key", "mods"}' : verb === 'type' ? '{"target"|"text", "value"}' : verb === 'drag' ? '{"target"|"text", "by": [x, y]}' : '{"target"|"text"}'}` }
        await runStep(d, step, mode)
        await new Promise((ok) => setTimeout(ok, 250))
        const errors = await d.page<string[]>('errors').catch(() => [])
        return { ok: true, result: errors.length ? { done: true, errors } : { done: true } }
      }
    }
  } catch (e) {
    return { ok: false, error: say(e) }
  } finally {
    d.detach()
  }
}
