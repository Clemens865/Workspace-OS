/**
 * The app harness, chat side: what happens around each turn of a chat that
 * builds an app (src/main/apps/app-harness.ts does the model work).
 *
 *   first ask   → the idea becomes BRIEF.md, and the build is held to it
 *   each turn   → design check (one fix) → review of the running app against
 *                 the brief (one fix) → three next steps to click
 *
 * Every automatic fix is one turn the person sees, never a loop.
 */
import type { SessionMsg } from './sessionModel'

/** Which automatic turn a run was, if any. */
export type AutoTurn = 'design' | 'review'

export interface HarnessDeps {
  app: (id: string) => string | undefined
  push: (id: string, m: Omit<SessionMsg, 'at'>) => void
  busy: (id: string, label: string | null) => void
  send: (id: string, text: string, auto: AutoTurn) => Promise<void>
}

type Review = NonNullable<Awaited<ReturnType<Window['workspace']['apps']['review']>>>

/** Next steps found by a review whose fix turn is still running: shown once that turn is done. */
const pendingNext = new Map<string, string[]>()

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

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
    return `\n\nThe product brief for this app is in Apps/${slug}/BRIEF.md: read it first, then build the whole app it describes and meet every acceptance check.`
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

/** After a turn that ended well: the design check, then the review, each with at most one fix. */
export async function afterTurn(id: string, auto: AutoTurn | undefined, d: HarnessDeps): Promise<void> {
  const slug = d.app(id)
  if (!slug) return
  if (auto === 'review') {
    // The review's fix is done: say what is still off in the design, then offer the next steps.
    await designCheck(id, slug, true, d)
    showNext(id, pendingNext.get(id) ?? [], d)
    pendingNext.delete(id)
    return
  }
  if (auto !== 'design' && (await designCheck(id, slug, false, d))) return // its fix turn comes back here
  if (auto === 'design') await designCheck(id, slug, true, d)
  await review(id, slug, d)
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
    r = await window.workspace.apps.review(slug, previewRect(slug)).catch(() => null)
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
