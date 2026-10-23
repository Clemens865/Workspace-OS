/**
 * The app harness, chat side: what happens around each turn of a chat that
 * builds an app (src/main/apps/app-harness.ts does the model work).
 *
 *   first ask   → the idea becomes BRIEF.md, and the build is held to it
 *   each turn   → design check (one fix) → the app's end-to-end tests,
 *                 written or updated, run in the live preview with real
 *                 clicks (up to three fix rounds) → review of the running app
 *                 against the brief (one fix) → three next steps to click
 *
 * Every automatic fix is a turn the person sees; the only loop is the tests',
 * and it stops after three rounds.
 */
import type { SessionMsg } from './sessionModel'

/** Which automatic turn a run was, if any. */
export type AutoTurn = 'design' | 'test' | 'review'

/** How many times failing tests go back to the builder before the person decides. */
export const MAX_TEST_FIXES = 3

export interface HarnessDeps {
  app: (id: string) => string | undefined
  /** The person's last ask in the session (what the tests are updated for). */
  ask: (id: string) => string
  push: (id: string, m: Omit<SessionMsg, 'at'>) => void
  busy: (id: string, label: string | null) => void
  send: (id: string, text: string, auto: AutoTurn) => Promise<void>
}

type Review = NonNullable<Awaited<ReturnType<Window['workspace']['apps']['review']>>>
type TestReport = NonNullable<Awaited<ReturnType<Window['workspace']['apps']['test']>>>

/** Next steps found by a review whose fix turn is still running: shown once that turn is done. */
const pendingNext = new Map<string, string[]>()
/** Fix rounds the tests have had since the person's last ask. */
const testRounds = new Map<string, number>()
/** The last test run, in a line, for the review. */
const lastTests = new Map<string, string>()

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The app's folder as the builder names it: Apps/<slug>, under the content root when one is set. */
async function appFolder(slug: string): Promise<string> {
  let rel = ''
  try { rel = (await window.workspace.fs.getContentRoot?.())?.rel ?? '' } catch { /* the root, as before */ }
  return rel ? `${rel}/Apps/${slug}` : `Apps/${slug}`
}

/**
 * Before the first build: the idea becomes the app's brief. Returns what the
 * builder is told on top of the person's words ('' when there is no brief).
 */
export async function briefFirst(id: string, slug: string, idea: string, d: HarnessDeps): Promise<string> {
  d.busy(id, 'Writing the product brief')
  try {
    const b = await window.workspace.apps.brief(slug, idea)
    if (!b) return ''
    d.push(id, { role: 'system', text: `Product brief written (BRIEF.md): ${plural(b.checks, 'acceptance check')} the build is held to. Building…` })
    return `\n\nThe product brief for this app is in ${await appFolder(slug)}/BRIEF.md: read it first, then build the whole app it describes and meet every acceptance check.`
  } catch (err) {
    d.push(id, { role: 'system', text: `No brief this time (${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}); building from your words.` })
    return ''
  } finally {
    d.busy(id, null)
  }
}

/** What a review sends back to the builder, or null when nothing needs fixing. */
export function reviewFixPrompt(r: Review): string | null {
  const missing = r.checks.filter((c) => !c.met)
  if (!missing.length && !r.looks.length) return null
  return [
    "The review of the running app against its brief found this. Fix each one, keeping what works; update BRIEF.md only if the person's direction changed.",
    ...missing.map((c) => `- Not met: ${c.check}${c.note ? ` (${c.note})` : ''}`),
    ...r.looks.map((l) => `- Looks: ${l}`),
  ].join('\n')
}

/** The review's one-line summary for the chat. */
export function reviewLine(r: Review, fixing: boolean): string {
  const met = r.checks.filter((c) => c.met).length
  const parts = [r.checks.length ? `${met} of ${plural(r.checks.length, 'check')} met` : 'no brief to check against']
  if (r.looks.length) parts.push(`${plural(r.looks.length, 'thing')} to fix on screen`)
  return `Review: ${parts.join(', ')}.${fixing ? ' Fixing…' : ''}`
}

/** Where the app's live preview is, for the screenshot (null when it is not on screen). */
function previewRect(slug: string): { x: number; y: number; width: number; height: number } | null {
  const el = document.querySelector(`[data-testid="chat-app-preview"][data-app="${CSS.escape(slug)}"] [data-testid="app-frame"]`)
  const r = el?.getBoundingClientRect()
  return r && r.width > 40 && r.height > 40 ? { x: r.left, y: r.top, width: r.width, height: r.height } : null
}

const showNext = (id: string, next: string[], d: HarnessDeps): void => {
  if (next.length) d.push(id, { role: 'system', text: 'Next, you could ask:', suggest: next })
}

/** After a turn that ended well: the design check, the tests, then the review. */
export async function afterTurn(id: string, auto: AutoTurn | undefined, d: HarnessDeps): Promise<void> {
  const slug = d.app(id)
  if (!slug) return
  if (auto === 'review') {
    // The review's fix is done: say what is still off, check nothing broke, then offer the next steps.
    await designCheck(id, slug, true, d)
    const r = await runTests(id, slug, d)
    if (r) d.push(id, { role: 'system', text: `Tests after the review fix: ${testLine(r)}.` })
    showNext(id, pendingNext.get(id) ?? [], d)
    pendingNext.delete(id)
    return
  }
  if (!auto && (await designCheck(id, slug, false, d))) return // its fix turn comes back here
  if (auto === 'design') await designCheck(id, slug, true, d)
  if (auto !== 'test') {
    testRounds.set(id, 0)
    await writeTests(id, slug, d)
  }
  if (await testAndFix(id, slug, d)) return // its fix turn comes back here
  await review(id, slug, d)
}

/** "4 of 6 passed (failing: Saves a note, Undo)". */
export function testLine(r: TestReport): string {
  const failed = r.scenarios.filter((s) => !s.ok).map((s) => s.name)
  const head = r.passed === r.total && !r.stopped ? `all ${r.total} passed` : `${r.passed} of ${r.total} passed`
  return `${head}${failed.length ? ` (failing: ${failed.join(', ')})` : ''}${r.stopped ? `; stopped: ${r.stopped}` : ''}`
}

/** What the builder is told when tests fail, or null when none did. */
export function testFixPrompt(slug: string, r: TestReport, folder = `Apps/${slug}`): string | null {
  const failed = r.scenarios.filter((s) => !s.ok)
  if (!failed.length) return null
  return [
    `The app's end-to-end tests (${folder}/TESTS.json) ran in the live app with real clicks and key presses: ${r.passed} of ${r.total} passed. Fix what fails, keeping what works.`,
    ...failed.map((s) => `- "${s.name}"${s.check ? ` (check: ${s.check})` : ''}: ${s.step ? `step ${s.step} failed: ` : ''}${s.error ?? 'failed'}${s.shot ? ` (the app at that moment: ${s.shot}; look at it with Read)` : ''}`),
    'If a test is wrong and the app does the right thing (a selector that changed, a step in the wrong order), fix that test in TESTS.json instead, and say so.',
  ].join('\n')
}

/** Writes or updates the app's tests for the person's last ask. */
async function writeTests(id: string, slug: string, d: HarnessDeps): Promise<void> {
  d.busy(id, 'Writing the app’s tests')
  try {
    const w = await window.workspace.apps.testsWrite(slug, d.ask(id))
    if (w) d.push(id, { role: 'system', text: `Tests written (TESTS.json): ${plural(w.scenarios, 'scenario')}. Running them in the app beside this chat: watch it being clicked.` })
  } catch (err) {
    d.push(id, { role: 'system', text: `No new tests this time (${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}).` })
  } finally {
    d.busy(id, null)
  }
}

/** Runs the tests in the live preview, saying which scenario is on. Null when there are none or they could not run. */
async function runTests(id: string, slug: string, d: HarnessDeps): Promise<TestReport | null> {
  d.busy(id, 'Testing the app')
  const off = window.workspace.apps.onTestProgress((p) => p.slug === slug && d.busy(id, `Testing ${p.i} of ${p.total}: ${p.name}`))
  // The preview reloads when a turn ends: let it draw first.
  await new Promise((ok) => setTimeout(ok, 1500))
  let r: TestReport | null = null
  try {
    r = await window.workspace.apps.test(slug)
  } catch (err) {
    d.push(id, { role: 'system', text: `The tests could not run (${(err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}).` })
  } finally {
    off()
    d.busy(id, null)
  }
  if (!r) return null
  if (!r.scenarios.length) {
    d.push(id, { role: 'system', text: `The tests could not run: ${r.stopped ?? 'nothing ran'}.` })
    return null
  }
  lastTests.set(id, testLine(r))
  return r
}

/** One test run: when something fails, one fix turn (at most MAX_TEST_FIXES in a row). True when it sent one. */
async function testAndFix(id: string, slug: string, d: HarnessDeps): Promise<boolean> {
  const r = await runTests(id, slug, d)
  if (!r) return false
  const rounds = testRounds.get(id) ?? 0
  const fix = testFixPrompt(slug, r, await appFolder(slug))
  if (!fix) {
    d.push(id, { role: 'system', text: `Tests: ${testLine(r)} in the running app${rounds ? ` after ${plural(rounds, 'fix round')}` : ''}.` })
    return false
  }
  if (rounds >= MAX_TEST_FIXES) {
    d.push(id, { role: 'system', text: `Tests: ${testLine(r)} after ${MAX_TEST_FIXES} fix rounds. Ask for a fix, or say if a test is wrong.` })
    return false
  }
  testRounds.set(id, rounds + 1)
  d.push(id, { role: 'system', text: `Tests: ${testLine(r)}. Fixing, round ${rounds + 1} of ${MAX_TEST_FIXES}…` })
  await d.send(id, fix, 'test')
  return true
}

/**
 * The app's files against the kit and the sandbox. Sends one fix turn the
 * person sees and returns true when it did; what is still found after a fix is only said.
 */
async function designCheck(id: string, slug: string, wasFix: boolean, d: HarnessDeps): Promise<boolean> {
  const found = await window.workspace.apps.lint(slug).catch(() => [])
  if (!found.length) {
    if (wasFix) d.push(id, { role: 'system', text: 'Design check: all fixed.' })
    return false
  }
  if (wasFix) {
    d.push(id, { role: 'system', text: `Design check: ${plural(found.length, 'thing')} still off. Ask for a fix if you want it gone.` })
    return false
  }
  d.push(id, { role: 'system', text: `Design check: ${plural(found.length, 'thing')} to fix (${[...new Set(found.map((f) => f.rule))].join(', ')}). Fixing…` })
  await d.send(id, `The app's design check found this. Fix each one with small edits, changing nothing else:\n${found.map((f) => `- ${f.detail}`).join('\n')}`, 'design')
  return true
}

/** The running app and its files, against the brief: one fix turn when something is missing, then next steps. */
async function review(id: string, slug: string, d: HarnessDeps): Promise<void> {
  d.busy(id, 'Reviewing the app')
  let r: Review | null = null
  try {
    // The preview reloads when a turn ends: let it draw before the screenshot.
    await new Promise((ok) => setTimeout(ok, 2500))
    r = await window.workspace.apps.review(slug, previewRect(slug), lastTests.get(id)).catch(() => null)
  } finally {
    d.busy(id, null)
  }
  if (!r) return
  const fix = reviewFixPrompt(r)
  d.push(id, { role: 'system', text: reviewLine(r, !!fix) })
  if (!fix) return showNext(id, r.next, d)
  pendingNext.set(id, r.next)
  await d.send(id, fix, 'review')
}
