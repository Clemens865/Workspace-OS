/**
 * The app's own end-to-end tests: Apps/<slug>/TESTS.json.
 *
 * After a turn of the builder, a model writes (or updates) the tests from the
 * brief and the app's files: scenarios of real steps (click, type, keys, drag,
 * reload) and expectations on the screen (what is visible, its text) and in
 * the running code (an expression in the app's page, its saved data, what it
 * exported). app-driver.ts runs them in the live preview, where the person
 * watches, and what fails goes back to the builder.
 *
 * The file stays with the app, so every later turn is held to it too.
 */
import fs from 'fs'
import path from 'path'
import { appDir, readManifest } from './apps-store'
import { appSources, BRIEF_FILE, HARNESS_TIMEOUT_MS, runSeeing } from './app-harness'

export const TESTS_FILE = 'TESTS.json'
export const TEST_LIMITS = { scenarios: 10, steps: 30, waitMs: 5000, timeoutMs: 15000 }

/** Where a step acts: a CSS selector, or the visible text (or label) of a control. */
export interface Target {
  target?: string
  text?: string
}
export type Step =
  | ({ do: 'click' | 'dblclick' } & Target)
  | ({ do: 'type'; value: string; clear: boolean } & Target)
  | { do: 'key'; key: string; mods: ('meta' | 'shift' | 'alt' | 'control')[] }
  | ({ do: 'drag'; by: [number, number] } & Target)
  | { do: 'wait'; ms: number }
  | { do: 'reload' }
  | ({ do: 'expect'; count?: number; visible?: boolean; contains?: string; equals?: string; timeout: number } & Target)
  | { do: 'expectJs'; js: string; timeout: number }
  | { do: 'expectSaved'; contains?: string; name?: string }

export interface Scenario {
  name: string
  check: string
  /** Saved data the app starts with (wos.storage), instead of none. */
  store: Record<string, unknown>
  /** What every wos.ai.complete answers in this scenario; unset = AI is off. */
  ai?: unknown
  /** What wos.files.open returns: the file the person "picked". */
  open?: { name: string; data: string } | null
  steps: Step[]
}

export interface TestPlan {
  scenarios: Scenario[]
}

const str = (v: unknown, n: number): string => (typeof v === 'string' ? v.slice(0, n) : '')
const num = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)
const MODS = ['meta', 'shift', 'alt', 'control'] as const

function target(o: Record<string, unknown>): Target | null {
  const t: Target = {}
  if (str(o.target, 300).trim()) t.target = str(o.target, 300).trim()
  if (str(o.text, 200).trim()) t.text = str(o.text, 200).trim()
  return t.target || t.text ? t : null
}

/** One step, or null when it is not one the driver knows. */
export function parseStep(raw: unknown): Step | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const t = target(o)
  switch (o.do) {
    case 'click':
    case 'dblclick':
      return t && { do: o.do, ...t }
    case 'type':
      return t && typeof o.value === 'string' ? { do: 'type', ...t, value: o.value.slice(0, 2000), clear: o.clear !== false } : null
    case 'key': {
      const key = str(o.key, 20)
      if (!key) return null
      const mods = (Array.isArray(o.mods) ? o.mods : []).filter((m): m is (typeof MODS)[number] => MODS.includes(m as never))
      return { do: 'key', key, mods }
    }
    case 'drag': {
      const by = Array.isArray(o.by) ? o.by : []
      return t && { do: 'drag', ...t, by: [num(by[0], -2000, 2000, 0), num(by[1], -2000, 2000, 0)] }
    }
    case 'wait':
      return { do: 'wait', ms: num(o.ms, 0, TEST_LIMITS.waitMs, 300) }
    case 'reload':
      return { do: 'reload' }
    case 'expect': {
      if (!t) return null
      const e: Step = { do: 'expect', ...t, timeout: num(o.timeout, 0, TEST_LIMITS.timeoutMs, 2000) }
      if (typeof o.count === 'number') e.count = num(o.count, 0, 10_000, 0)
      if (typeof o.visible === 'boolean') e.visible = o.visible
      if (typeof o.contains === 'string') e.contains = o.contains.slice(0, 500)
      if (typeof o.equals === 'string') e.equals = o.equals.slice(0, 500)
      return e
    }
    case 'expectJs':
      return str(o.js, 2000).trim() ? { do: 'expectJs', js: str(o.js, 2000).trim(), timeout: num(o.timeout, 0, TEST_LIMITS.timeoutMs, 2000) } : null
    case 'expectSaved': {
      const e: Step = { do: 'expectSaved' }
      if (typeof o.contains === 'string') e.contains = o.contains.slice(0, 500)
      if (typeof o.name === 'string') e.name = o.name.slice(0, 200)
      return e
    }
    default:
      return null
  }
}

/** A test plan read defensively: unknown steps are dropped, a scenario with no steps too. */
export function parsePlan(text: string): TestPlan | null {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).scenarios) ? ((raw as Record<string, unknown>).scenarios as unknown[]) : []
  const scenarios: Scenario[] = []
  for (const s of list.slice(0, TEST_LIMITS.scenarios)) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const steps = (Array.isArray(o.steps) ? o.steps : []).slice(0, TEST_LIMITS.steps).map(parseStep).filter((x): x is Step => !!x)
    const name = str(o.name, 160).trim()
    if (!name || !steps.length) continue
    const store = o.store && typeof o.store === 'object' && !Array.isArray(o.store) ? (o.store as Record<string, unknown>) : {}
    const open = o.open && typeof o.open === 'object' ? { name: str((o.open as Record<string, unknown>).name, 200) || 'file', data: str((o.open as Record<string, unknown>).data, 2_000_000) } : undefined
    scenarios.push({ name, check: str(o.check, 300).trim(), store, ...('ai' in o ? { ai: o.ai } : {}), ...(open ? { open } : {}), steps })
  }
  return scenarios.length ? { scenarios } : null
}

/** The app's tests, or null when it has none (or they cannot be read). */
export function readPlan(root: string, slug: string): TestPlan | null {
  try {
    return parsePlan(fs.readFileSync(path.join(appDir(root, slug), TESTS_FILE), 'utf8'))
  } catch {
    return null
  }
}

const TESTS_SYSTEM = [
  'You are a senior QA engineer writing the end-to-end tests of ONE small app built inside Workspace OS (a single page: HTML, CSS, plain JavaScript; it saves with wos.storage, may call wos.ai.complete, exports with wos.files.save). A driver runs your tests in the live app the way a person would: real pointer clicks and key presses at the element\'s place on screen, so a covered or hidden button fails. Each scenario starts from a fresh load of the app with no saved data (or the "store" you give).',
  'Cover every acceptance check of the brief that can be seen or measured, and the core jobs end to end: the empty state, creating, editing, deleting, undo, persistence across a reload, export, errors. Use the selectors that are really in the app\'s files (ids first); prefer "text" for a button whose label is its meaning. Never test what the app does not have, and never write a test that only passes by accident.',
  'Answer with JSON only, no fences:',
  '{"scenarios": [{"name": "<what it proves, short>", "check": "<the acceptance check it covers, as written; empty if none>", "store": {<optional saved data to start with: key: value>}, "ai": <optional: what every wos.ai.complete answers in this scenario (a string, or the JSON value the app expects with json: true); leave it out and AI calls fail with an error the app must show>, "open": <optional {"name": "a.svg", "data": "<text>"} that wos.files.open returns>, "steps": [<steps>]}]}',
  'Steps (target = a CSS selector, or "text": the visible text, aria-label, title or placeholder of the element):',
  '{"do": "click", "target": "#add"} · {"do": "click", "text": "New note"} · {"do": "dblclick", "target": ".note"}',
  '{"do": "type", "target": "#title", "value": "Groceries"} (clicks into it and replaces its content; "clear": false appends)',
  '{"do": "key", "key": "Enter" | "Escape" | "Delete" | "Backspace" | "Tab" | "ArrowDown" | "z" | …, "mods": ["meta", "shift"]} (to the focused element)',
  '{"do": "drag", "target": ".note", "by": [120, 40]} (pointer down on it, move by x, y pixels, up)',
  '{"do": "reload"} (reloads the app keeping what this scenario saved: proves persistence) · {"do": "wait", "ms": 300} (rarely needed: expectations wait by themselves)',
  '{"do": "expect", "target": ".note", "count": 2} · {"do": "expect", "target": "#status", "contains": "Saved"} · {"do": "expect", "text": "No notes yet", "visible": true} · {"do": "expect", "target": "#title", "equals": "Groceries"} (equals compares an input\'s value or the text)',
  '{"do": "expectJs", "js": "(await wos.storage.get(\'notes\')).length === 2"} (an expression run in the app\'s page, true when right; await works; use it for state the screen cannot show)',
  '{"do": "expectSaved", "contains": "<svg"} (the app exported a file through wos.files.save; "name" matches its file name)',
  'Expectations wait up to "timeout" ms (default 2000) for the condition. Write 4 to 8 scenarios, each 3 to 15 steps, each ending in at least one expectation. Keep a test that is still right when you update tests; change one only when the app\'s intended behaviour changed.',
].join('\n')

/** Writes (or updates) Apps/<slug>/TESTS.json. Throws when no usable tests came back. */
export async function writeTests(root: string, slug: string, request: string): Promise<{ scenarios: number }> {
  const dir = appDir(root, slug)
  let brief = ''
  let old = ''
  try {
    brief = fs.readFileSync(path.join(dir, BRIEF_FILE), 'utf8')
  } catch {
    /* no brief */
  }
  try {
    old = fs.readFileSync(path.join(dir, TESTS_FILE), 'utf8')
  } catch {
    /* first tests */
  }
  const name = readManifest(root, slug)?.name ?? slug
  const prompt = [
    `The app: ${name} (Apps/${slug}/).`,
    brief ? `Its product brief:\n\n${brief}` : 'It has no product brief: test what its files show it does.',
    request.trim() ? `What the person last asked the builder for:\n\n${request.trim().slice(0, 4000)}` : '',
    old ? `Its current tests (update them: keep what is still right, change what the request changed, add what is new):\n\n${old.slice(0, 40_000)}` : '',
    `Its files:\n\n${appSources(root, slug).replace(/--- TESTS\.json ---[\s\S]*?(?=\n\n--- |$)/, '')}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await runSeeing({ prompt, systemPrompt: TESTS_SYSTEM, timeoutMs: HARNESS_TIMEOUT_MS })
  if (r.timedOut) throw new Error('Writing the tests took too long')
  const plan = parsePlan(r.text)
  if (!plan) throw new Error('No usable tests came back')
  fs.writeFileSync(path.join(dir, TESTS_FILE), JSON.stringify(plan, null, 2) + '\n')
  return { scenarios: plan.scenarios.length }
}
