import { runProviderJson } from '../agent/providerText'
import type { BugContext, BugReport, BugSeverity, ExistingBug, SuspectFile } from './bug-log'

/**
 * Turns a sentence typed in frustration into a report a developer can act on.
 *
 * "the drag is laggy" is not a bug report. It becomes one when it has a surface,
 * a severity, reproduction steps, an expected-versus-actual, and — the part only
 * a machine with the repo in front of it can add — a pointer at the code most
 * likely responsible. That is the entire value of putting Claude in this path:
 * the user should pay one sentence, and get a real report.
 *
 * THE HARD GUARANTEE OF THIS MODULE: the analyzer runs with `allowedTools`
 * restricted to Read/Grep/Glob. It can look at the source; it CANNOT edit it,
 * run anything, or touch git. "Bugs are collected here, never worked on here" is
 * therefore enforced by the tool grant rather than by asking the model nicely —
 * which is the only version of that promise worth making.
 *
 * Everything here returns a PROPOSAL. The user sees the structured report and
 * corrects it before a single byte reaches the log (same shape as the Foundry).
 */

/**
 * WOS-010. Bug triage and idea analysis are not the same size of job.
 *
 * Triage locates one defect. An idea has to SURVEY the codebase — search for
 * what already exists, name the files, judge the proposal against the roadmap
 * rule — which is several times the Read/Grep work. Running ideas on the
 * bug-sized budget is half of why every idea report failed.
 */
const ANALYZE_TIMEOUT_MS = 120_000
const IDEA_TIMEOUT_MS = 300_000

/**
 * Least time worth starting a second attempt with. The budget above is an
 * OVERALL deadline, not a per-attempt one: before this, two unparseable replies
 * could each run the full clock, so the user waited ~4 minutes to be told it did
 * not work. A retry that cannot finish is just a longer failure.
 */
const MIN_RETRY_MS = 30_000

export interface AnalysisInput {
  /** A defect, or a proposal. Defaults to 'bug' for existing callers. */
  kind?: 'bug' | 'idea'
  /** The user's own words, verbatim. */
  text: string
  context: BugContext
  /** Existing entries, so the model can flag a duplicate instead of adding one. */
  existing: readonly ExistingBug[]
  /** Absolute path to the Workspace-OS development repo, if configured. */
  repoRoot: string | null
}

export interface Analysis {
  title: string
  severity: BugSeverity
  surface: string
  whatHappened: string
  expected: string
  steps: string[]
  suspects: SuspectFile[]
  /** ID of an existing entry this duplicates, or null. */
  duplicateOf: string | null
  /** Whether the model actually had the repo to look at. */
  localized: boolean
  /**
   * IDEAS ONLY (WOS-010): the roadmap-rule judgement and the honest objection.
   * Empty for bugs. This is the part of an idea assessment worth keeping — a
   * note the user could have written in any text file is worth much less than
   * one checked against the code and argued against.
   */
  verdict?: string
}

export interface AnalyzeResult {
  ok: boolean
  analysis?: Analysis
  error?: string
}

const SEVERITIES: readonly BugSeverity[] = ['critical', 'high', 'medium', 'low']

/**
 * WOS-010: the system prompt for an IDEA.
 *
 * The bug prompt below demands `severity` and `steps`, while IDEA_GUIDANCE in
 * the user prompt says not to assign either. Sending both is what broke idea
 * analysis: given contradictory instructions the model answered in prose,
 * `parseAnalysis` returned null, and the whole thing ran twice before failing.
 *
 * So ideas get their own schema — the same fields the store already has, asked
 * as the questions an idea actually raises, and with severity and steps simply
 * absent rather than forbidden in one breath and required in the next.
 */
export function ideaSystemPrompt(hasRepo: boolean, strict: boolean): string {
  return [
    'You assess FEATURE IDEAS for Workspace OS, a local-first Electron workspace',
    'app (native office editing via LibreOfficeKit, an in-app Claude agent, mail,',
    'calendar, browser, PDF).',
    '',
    'A user has just proposed something while using the app. Your job is to place',
    'that proposal against the code that already exists and judge it honestly.',
    'This is NOT a defect: do not assign a severity, and do not write steps to',
    'reproduce.',
    '',
    hasRepo
      ? [
          'You have READ-ONLY access to the Workspace-OS source in your working',
          'directory. Use it properly — search before you conclude. "We already',
          'have most of this in X" is the single most valuable thing you can say,',
          'and you can only say it by looking.',
          '',
          'You cannot edit anything, and you must not try.',
        ].join('\n')
      : [
          'You do NOT have the source available. Assess the idea from the',
          'description alone and return an empty "suspects" array. Do not invent',
          'file paths.',
        ].join('\n'),
    '',
    'Rules:',
    '- Be concrete. "Better search" is not a title; "Search results grouped by',
    '  the document they came from" is.',
    '- "whatHappened" is WHAT ALREADY EXISTS: what you found in the code that',
    '  covers part of this, named plainly. If nothing does, say that.',
    '- "expected" is WHAT THIS WOULD ADD on top of what exists — the proposal',
    '  stated concretely enough to build.',
    '- "verdict" is the honest judgement, in two parts: whether it passes the',
    '  project\'s own roadmap rule — "If a feature does not compound liveness or',
    '  the reviewable agent, it is a commodity. Skip it, or embed it — never',
    '  build it from scratch." — and then the strongest reason NOT to build it.',
    '  An honest "this is a commodity" is worth more than a padded case for it.',
    '- "surface" is what it would touch, and roughly how big it is.',
    '- "suspects" are the files that already implement part of this, so whoever',
    '  picks it up starts where the work already is.',
    '- If this duplicates an idea in the existing list, set "duplicateOf" to its',
    '  id. Same proposal, not merely the same area.',
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"title":"","surface":"","whatHappened":"","expected":"","verdict":"",',
    ' "suspects":[{"path":"","why":""}],"duplicateOf":null}',
    strict
      ? '\nYour previous reply was not valid JSON. Return the object and nothing else.'
      : '',
  ].join('\n')
}

function systemPrompt(hasRepo: boolean, strict: boolean): string {
  return [
    'You triage bug reports for Workspace OS, a local-first Electron workspace',
    'app (native office editing via LibreOfficeKit, an in-app Claude agent, mail,',
    'calendar, browser, PDF).',
    '',
    'A user has just hit a problem while USING the app and typed what they saw.',
    'Turn it into a report a developer can act on tomorrow morning.',
    '',
    hasRepo
      ? [
          'You have READ-ONLY access to the Workspace-OS source in your working',
          'directory. Use it: grep for the surface named in the report, read the',
          'relevant module, and name the files most likely responsible.',
          '',
          'You cannot edit anything, and you must not try. Your job is to LOCATE',
          'and DESCRIBE, never to fix. A wrong guess that is clearly labelled as a',
          'guess is useful; a fix attempted from here is not.',
        ].join('\n')
      : [
          'You do NOT have the source available. Structure the report from the',
          'description alone and return an empty "suspects" array. Do not invent',
          'file paths — a fabricated path costs more time than no path at all.',
        ].join('\n'),
    '',
    'Rules:',
    '- Be concrete. "Rendering is broken" is not a title; "Slide thumbnails stay',
    '  blank after switching tabs" is.',
    '- Severity: critical = data loss or the app is unusable; high = a core',
    '  workflow is blocked; medium = a workflow is degraded but has a workaround;',
    '  low = cosmetic or rare.',
    '- Steps: only what you can actually infer. An invented repro is worse than',
    '  none — leave the array empty rather than guessing.',
    '- If the report clearly describes a bug ALREADY in the existing list, set',
    '  "duplicateOf" to its id. Only do this when it is the same defect, not',
    '  merely the same area of the app.',
    '',
    'Reply with ONLY a JSON object, no prose and no code fence:',
    '{"title":"","severity":"critical|high|medium|low","surface":"",',
    ' "whatHappened":"","expected":"","steps":[""],',
    ' "suspects":[{"path":"","why":""}],"duplicateOf":null}',
    strict
      ? '\nYour previous reply was not valid JSON. Return the object and nothing else.'
      : '',
  ].join('\n')
}

/** The user's words plus everything the app knows, as the model's input. */
/**
 * How an IDEA is analysed, as opposed to a defect.
 *
 * A bug asks "where is this broken". An idea asks a different question, and
 * answering it with bug-shaped analysis produces a useless entry — severity and
 * steps-to-reproduce mean nothing for a proposal.
 *
 * The most valuable thing the analyser can say about an idea is usually "we
 * already have most of this in X" or "this conflicts with Y". A raw note the
 * user could have written in any text file is worth much less than one checked
 * against the code that already exists.
 *
 * The roadmap rule is included verbatim because it is the project's own filter,
 * and an idea that fails it should be recorded as failing it rather than
 * quietly logged as if it were a candidate.
 */
export const IDEA_GUIDANCE = [
  'This is a FEATURE IDEA, not a defect. Do not assign a severity or steps to reproduce.',
  '',
  'Answer, in this order:',
  '1. WHAT ALREADY EXISTS. Search the code. If a large part of this is already',
  '   built, say so and name the files — "we already have most of this in X" is',
  '   the single most useful thing you can report.',
  '2. WHAT IT WOULD TOUCH. Which surfaces, which modules, roughly what size.',
  '3. WHETHER IT PASSES THE ROADMAP RULE, quoted from the project dossier:',
  '   "If a feature does not compound liveness or the reviewable agent, it is a',
  '   commodity. Skip it, or embed it — never build it from scratch."',
  '   Say plainly if it does NOT pass. An honest "this is a commodity" is more',
  '   useful than a padded case for building it.',
  '4. THE HONEST OBJECTION. The strongest reason NOT to build it.',
].join('\n')

export function buildAnalysisPrompt(input: AnalysisInput): string {
  const c = input.context
  const lines = [
    ...(input.kind === 'idea' ? [IDEA_GUIDANCE, ''] : []),
    `${input.kind === 'idea' ? 'IDEA' : 'REPORT'} (the user's own words):`,
    input.text.trim(),
    '',
    'CONTEXT CAPTURED BY THE APP:',
    `- app version: ${c.appVersion}${c.commit ? ` (commit ${c.commit})` : ''}`,
    `- active surface: ${c.surface ?? 'unknown'}`,
    `- open document: ${c.openFile ?? 'none'}`,
    `- os: ${c.os}`,
  ]
  if (c.recentErrors.length > 0) {
    lines.push('- recent main-process errors:', ...c.recentErrors.map((e) => `    ${e}`))
  }
  if (input.existing.length > 0) {
    lines.push(
      '',
      'ALREADY FILED (check for a duplicate before adding a new one):',
      ...input.existing.map((b) => `- ${b.id}: ${b.title}`),
    )
  }
  return lines.join('\n')
}

/**
 * Validates and clamps a parsed model object into an Analysis.
 *
 * Pure, so it is trivially testable without a model. Everything the model can
 * get wrong is clamped rather than trusted: unknown severities fall back to
 * medium, non-string steps are dropped, suspect paths are required to look like
 * repo-relative paths, and `duplicateOf` must name an entry that actually
 * exists — a hallucinated ID would silently swallow the report into a bump of
 * something unrelated.
 */
export function validateAnalysis(
  raw: unknown,
  existing: readonly ExistingBug[],
  localized: boolean,
): Analysis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>

  const title = typeof o.title === 'string' ? o.title.trim().replace(/\s+/g, ' ') : ''
  if (!title) return null

  const severity: BugSeverity = SEVERITIES.includes(o.severity as BugSeverity)
    ? (o.severity as BugSeverity)
    : 'medium'

  const surface = typeof o.surface === 'string' && o.surface.trim() ? o.surface.trim() : 'unknown'
  const whatHappened = typeof o.whatHappened === 'string' ? o.whatHappened.trim() : ''
  const expected = typeof o.expected === 'string' ? o.expected.trim() : ''

  const steps = Array.isArray(o.steps)
    ? o.steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
    : []

  // Only keep suspects when the model actually had the repo — otherwise a
  // plausible-looking path is pure invention.
  const suspects: SuspectFile[] =
    localized && Array.isArray(o.suspects)
      ? o.suspects
          .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
          .map((s) => ({
            path: typeof s.path === 'string' ? s.path.trim() : '',
            why: typeof s.why === 'string' ? s.why.trim() : '',
          }))
          .filter((s) => s.path.length > 0 && !path_isAbsoluteOrEscaping(s.path))
      : []

  const dupRaw = typeof o.duplicateOf === 'string' ? o.duplicateOf.trim() : ''
  const duplicateOf = existing.some((b) => b.id === dupRaw) ? dupRaw : null

  // Ideas only; absent for bugs, which never ask for it.
  const verdict = typeof o.verdict === 'string' && o.verdict.trim() ? o.verdict.trim() : undefined

  return { title, severity, surface, whatHappened, expected, steps, suspects, duplicateOf, localized, verdict }
}

/** Reject absolute paths and `..` escapes so a suspect can't point off-repo. */
function path_isAbsoluteOrEscaping(p: string): boolean {
  return p.startsWith('/') || p.startsWith('~') || p.split('/').includes('..')
}

/** Pull the JSON object out of a model reply that may be wrapped in prose. */
export function parseAnalysis(
  text: string,
  existing: readonly ExistingBug[],
  localized: boolean,
): Analysis | null {
  const trimmed = text.trim()
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  const candidates = [fenced?.[1], trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]
  for (const c of candidates) {
    if (!c) continue
    try {
      return validateAnalysis(JSON.parse(c), existing, localized)
    } catch {
      /* try the next shape */
    }
  }
  return null
}

/**
 * Run the analysis. Retries once with a strict nudge if the model returns
 * something unparseable — the same two-attempt contract the Foundry uses, but
 * bounded by one overall deadline (WOS-010) so a retry can never double the
 * wait before the failure.
 */
export async function analyzeBug(input: AnalysisInput): Promise<AnalyzeResult> {
  const localized = !!input.repoRoot
  const prompt = buildAnalysisPrompt(input)
  const isIdea = input.kind === 'idea'

  // WOS-010: one deadline for the WHOLE call, not per attempt. The retry gets
  // whatever is left, and is skipped when that is too little to finish in — the
  // old code let two attempts each burn the full budget.
  const deadline = Date.now() + (isIdea ? IDEA_TIMEOUT_MS : ANALYZE_TIMEOUT_MS)

  for (let attempt = 0; attempt < 2; attempt++) {
    const remainingMs = deadline - Date.now()
    if (attempt > 0 && remainingMs < MIN_RETRY_MS) break

    let res
    try {
      res = await runProviderJson({
        prompt,
        systemPrompt: isIdea
          ? ideaSystemPrompt(localized, attempt > 0)
          : systemPrompt(localized, attempt > 0),
        timeoutMs: remainingMs,
        // The read-only guarantee. Without a repo there is nothing to read, so
        // the grant is empty and the model works from the description alone.
        ...(input.repoRoot
          ? { cwd: input.repoRoot, allowedTools: ['Read', 'Grep', 'Glob'] }
          : { allowedTools: [] }),
      })
    } catch (err) {
      return { ok: false, error: `Could not start the analyzer: ${(err as Error).message}` }
    }
    if (res.timedOut) return { ok: false, error: 'The analyzer timed out. File it unanalyzed and move on.' }
    const analysis = parseAnalysis(res.text, input.existing, localized)
    if (analysis) return { ok: true, analysis }
  }
  return { ok: false, error: 'The analyzer did not return a usable report.' }
}

/**
 * The fallback report used when analysis fails or the user skips it.
 *
 * A bug reporter that can lose your report because a model call failed is worse
 * than one that never had a model. The user's words always make it to disk.
 */
export function unanalyzedReport(
  id: string,
  text: string,
  context: BugContext,
  now: string,
): BugReport {
  const firstLine = text.trim().split('\n')[0].slice(0, 80)
  return {
    id,
    title: firstLine || 'Unanalyzed report',
    severity: 'medium',
    surface: context.surface ?? 'unknown',
    whatHappened: text.trim(),
    expected: '_Not captured._',
    steps: [],
    suspects: [],
    reporterWords: text,
    context,
    reportedAt: now,
    seen: 1,
    lastSeenAt: now,
  }
}

/** Combine an approved analysis with the raw report into the final entry. */
export function toReport(
  id: string,
  text: string,
  analysis: Analysis,
  context: BugContext,
  now: string,
): BugReport {
  return {
    id,
    title: analysis.title,
    severity: analysis.severity,
    surface: analysis.surface,
    whatHappened: analysis.whatHappened || text.trim(),
    expected: analysis.expected || '_Not captured._',
    steps: analysis.steps,
    suspects: analysis.suspects,
    verdict: analysis.verdict,
    reporterWords: text,
    context,
    reportedAt: now,
    seen: 1,
    lastSeenAt: now,
  }
}
