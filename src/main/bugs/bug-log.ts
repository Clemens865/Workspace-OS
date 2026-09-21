import fs from 'fs'
import path from 'path'

/**
 * The bug log: one human-readable Markdown file that is also machine-parseable.
 *
 * The whole point of this subsystem is that a bug noticed while USING the app
 * survives into the next development session. That means the file has to live in
 * the DEVELOPMENT REPO (`docs/BUGS.md`), not in whatever document folder the user
 * happens to have open — a bug filed into a customer's workspace is a bug lost.
 *
 * Two properties are deliberate:
 *
 *  - **Append-only.** New reports are appended; existing blocks are never
 *    rewritten. The single exception is the `Reported:` line, which gets its
 *    "seen N×" counter bumped when the same bug is filed again. A tool that can
 *    silently rewrite your bug history is one you stop trusting.
 *  - **The reporter's own words are preserved verbatim, always.** The structured
 *    fields are Claude's INTERPRETATION and can be wrong; the original sentence
 *    is the ground truth you fall back to when the interpretation misleads. Same
 *    reasoning as provenance in the memory store.
 *
 * The format is chosen so the next session's agent can read the file top-to-bottom
 * and start work without a parser, while `parseBugs` gives the app just enough
 * structure to allocate IDs and detect duplicates.
 */

export type BugSeverity = 'critical' | 'high' | 'medium' | 'low'

/** Machine-gathered facts about the app at the moment the bug was filed. */
export interface BugContext {
  appVersion: string
  /** Short commit SHA of the running build, when it can be determined. */
  commit: string | null
  /** Which product surface was active (files, canvas, mail, …). */
  surface: string | null
  /** The document open at the time, if any. */
  openFile: string | null
  os: string
  /** Tail of the main-process error log — the breadcrumbs a user can't see. */
  recentErrors: string[]
}

export interface SuspectFile {
  path: string
  why: string
}

export interface BugReport {
  id: string
  title: string
  severity: BugSeverity
  surface: string
  whatHappened: string
  expected: string
  steps: string[]
  suspects: SuspectFile[]
  /** IDEAS ONLY (WOS-010): roadmap-rule judgement + the honest objection. */
  verdict?: string
  /** The user's original text, untouched. */
  reporterWords: string
  context: BugContext
  /** ISO timestamp. */
  reportedAt: string
  seen: number
  lastSeenAt: string
}

/** The subset of an existing entry we need for ID allocation and dedup. */
export interface ExistingBug {
  id: string
  title: string
  seen: number
}

const HEADER = `# Workspace OS — Bug Log

Bugs filed from inside the running app by the in-app reporter (⌘⇧B).

**This file is the hand-off.** Reports are captured while USING Workspace OS and
are never worked on there — they land here so the next development session can
pick them up. Structured fields below are Claude's interpretation of the report;
the *Reported as* block at the end of each entry is the user's own words and is
the authority when the two disagree.

Entries are append-only. Do not renumber IDs — they are referenced elsewhere.

---
`

const ID_PREFIX = 'WOS-'

/**
 * `## WOS-007 · Title here` — or `## IDEA-007 · …` in IDEAS.md.
 *
 * WOS-010: this matched only `WOS-` while ideas are filed with an `IDEA-`
 * prefix, so parsing IDEAS.md always returned an empty list. `nextId` then
 * handed out IDEA-001 every single time, and duplicate detection had nothing to
 * compare against. Ideas were unusable for a second reason beyond the timeout.
 */
const ENTRY_RE = /^## ((?:WOS|IDEA)-\d+) · (.+)$/gm
/** `- **Reported:** <iso> (seen 3×, last <iso>)` */
const SEEN_RE = /^- \*\*Reported:\*\* (\S+)(?: \(seen (\d+)×, last (\S+)\))?$/

/** Parse just enough of the log to allocate the next ID and spot duplicates. */
export function parseBugs(md: string): ExistingBug[] {
  const out: ExistingBug[] = []
  const lines = md.split('\n')
  ENTRY_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ENTRY_RE.exec(md)) !== null) {
    const id = m[1]
    const title = m[2].trim()
    // The seen count lives a few lines below its heading — scan forward a short
    // window rather than parsing the whole block.
    let seen = 1
    const headIdx = lines.findIndex((l) => l.startsWith(`## ${id} · `))
    if (headIdx >= 0) {
      for (const line of lines.slice(headIdx + 1, headIdx + 10)) {
        const s = SEEN_RE.exec(line)
        if (s) {
          seen = s[2] ? Number(s[2]) : 1
          break
        }
      }
    }
    out.push({ id, title, seen })
  }
  return out
}

/** Next free ID, zero-padded to three digits. Never reuses a retired number. */
export function nextId(existing: readonly ExistingBug[], prefix = 'WOS'): string {
  // Count only ids of THIS kind: a shared counter would make WOS-007 and
  // IDEA-007 land at different numbers depending on which was filed first,
  // and ids in this project are referenced elsewhere and never renumbered.
  const tag = `${prefix}-`
  let max = 0
  for (const b of existing) {
    if (!b.id.startsWith(tag)) continue
    const n = Number(b.id.slice(tag.length))
    if (Number.isFinite(n) && n > max) max = n
  }
  return `${tag}${String(max + 1).padStart(3, '0')}`
}

function bullet(items: readonly string[], empty: string): string {
  if (items.length === 0) return empty
  return items.map((s, i) => `${i + 1}. ${s}`).join('\n')
}

/**
 * Render one report as its Markdown block (no trailing separator).
 *
 * WOS-010: an idea is rendered differently from a defect. Severity and
 * steps-to-reproduce are meaningless for a proposal, and printing
 * "**Steps to reproduce** — _Not captured_" under every idea made IDEAS.md read
 * like a list of broken things. The idea sections instead carry what its
 * analysis actually produces: what already exists, what this would add, and the
 * roadmap-rule verdict with the honest objection.
 */
export function renderBug(bug: BugReport, kind: ReportKind = 'bug'): string {
  const seenSuffix =
    bug.seen > 1 ? ` (seen ${bug.seen}×, last ${bug.lastSeenAt})` : ''

  const suspects =
    bug.suspects.length > 0
      ? bug.suspects.map((s) => `- \`${s.path}\` — ${s.why}`).join('\n')
      : '- _Not localized._'

  // Appended as LINES, not joined-then-filtered: the blank strings below are
  // load-bearing Markdown separators, and a blanket `.filter(Boolean)` over the
  // whole block silently welds "**What happens**" onto the preceding bullet list.
  const errors: string[] =
    bug.context.recentErrors.length > 0
      ? ['', '<details><summary>Main-process errors at the time</summary>', '', '```', ...bug.context.recentErrors, '```', '', '</details>']
      : []

  const isIdea = kind === 'idea'

  // The body differs by kind; the header, suspects and the user's own words do
  // not. Kept as line arrays for the same reason as `errors` above — the blank
  // strings are load-bearing Markdown separators.
  const body: string[] = isIdea
    ? [
        '**What already exists**',
        '',
        bug.whatHappened || '_Not assessed._',
        '',
        '**What this would add**',
        '',
        bug.expected || '_Not captured._',
        '',
        ...(bug.verdict ? ['**Worth building?**', '', bug.verdict, ''] : []),
        '**Where the work already is** — analysis only, unverified',
        '',
        suspects,
        '',
      ]
    : [
        '**What happens**',
        '',
        bug.whatHappened,
        '',
        '**Expected**',
        '',
        bug.expected,
        '',
        '**Steps to reproduce**',
        '',
        bullet(bug.steps, '_Not captured — reproduce from the description._'),
        '',
        '**Suspected code** — analysis only, unverified, do not trust without checking',
        '',
        suspects,
        '',
      ]

  return [
    `## ${bug.id} · ${bug.title}`,
    '',
    `- **Status:** open`,
    // An idea has no severity — printing one invites it to be triaged as a defect.
    ...(isIdea ? [] : [`- **Severity:** ${bug.severity}`]),
    `- **Surface:** ${bug.surface}`,
    `- **Reported:** ${bug.reportedAt}${seenSuffix}`,
    `- **Build:** ${bug.context.appVersion}${bug.context.commit ? ` · \`${bug.context.commit}\`` : ''}`,
    `- **Environment:** ${bug.context.os}${bug.context.openFile ? ` · open: \`${bug.context.openFile}\`` : ''}`,
    '',
    ...body,
    '**Reported as** (the user\'s own words — authoritative)',
    '',
    bug.reporterWords
      .trim()
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n'),
    ...errors,
  ].join('\n')
}

/** Append a rendered report, creating the file with its header if absent. */
export function appendBug(md: string, bug: BugReport, kind: ReportKind = 'bug'): string {
  const base = md.trim().length > 0 ? md.trimEnd() : HEADER.trimEnd()
  return `${base}\n\n${renderBug(bug, kind)}\n\n---\n`
}

/**
 * Bump an existing entry's seen counter instead of filing a duplicate.
 *
 * Rewrites exactly one line. Returns the input unchanged if the entry or its
 * Reported line can't be found — a dedup miss must degrade to "file it as new",
 * never to a mangled file.
 */
export function bumpSeen(md: string, id: string, at: string): string {
  const lines = md.split('\n')
  const head = lines.findIndex((l) => l.startsWith(`## ${id} · `))
  if (head < 0) return md
  for (let i = head + 1; i < Math.min(head + 10, lines.length); i++) {
    const s = SEEN_RE.exec(lines[i])
    if (!s) continue
    const count = (s[2] ? Number(s[2]) : 1) + 1
    lines[i] = `- **Reported:** ${s[1]} (seen ${count}×, last ${at})`
    return lines.join('\n')
  }
  return md
}

/**
 * Record a REPEAT sighting of an existing bug: bump its counter AND keep the
 * new reporter's words.
 *
 * Bumping alone was a real defect. The dedup verdict is the analyzer's JUDGEMENT,
 * and a wrong one silently destroyed the report — the exact failure this tool
 * exists to prevent. Two people hitting "the same" bug also rarely describe it
 * identically, and the second description is often the one that cracks it.
 *
 * Returns the input unchanged if the entry can't be found, so the caller falls
 * back to filing it as new.
 */
export function recordSighting(md: string, id: string, at: string, words: string): string {
  const bumped = bumpSeen(md, id, at)
  if (bumped === md) return md
  if (!words.trim()) return bumped

  const lines = bumped.split('\n')
  const head = lines.findIndex((l) => l.startsWith(`## ${id} · `))
  if (head < 0) return bumped

  // End of this entry — whichever comes first: the next entry or its separator.
  let end = lines.length
  for (let i = head + 1; i < lines.length; i++) {
    if (lines[i].startsWith('## WOS-') || lines[i].trim() === '---') {
      end = i
      break
    }
  }

  lines.splice(end, 0, `**Also reported** ${at}`, '', ...words.trim().split('\n').map((l) => `> ${l}`), '')
  return lines.join('\n')
}

/* ------------------------------------------------------------------ disk --- */

/**
 * What was reported: a defect, or a proposal.
 *
 * They share a capture (one shortcut, because an idea you have to find a second
 * shortcut for is an idea you lose) and separate DESTINATIONS. The bug log is a
 * work queue — forty ideas in it make the three real bugs invisible — while an
 * idea list is a backlog that is browsed, argued with, and mostly never built.
 * Different lifecycles, different files.
 */
export type ReportKind = 'bug' | 'idea'

export function bugLogPath(repoRoot: string, kind: ReportKind = 'bug'): string {
  return path.join(repoRoot, 'docs', kind === 'idea' ? 'IDEAS.md' : 'BUGS.md')
}

/** ID prefix per kind, so WOS-004 and IDEA-004 can never be confused. */
export function idPrefix(kind: ReportKind): string {
  return kind === 'idea' ? 'IDEA' : 'WOS'
}

export function readBugLog(repoRoot: string, kind: ReportKind = 'bug'): string {
  try {
    return fs.readFileSync(bugLogPath(repoRoot, kind), 'utf8')
  } catch {
    return ''
  }
}

/**
 * Write a report to the log, or bump an existing entry when `duplicateOf` names
 * one. Returns the ID the report ended up under.
 */
export function writeBugLog(repoRoot: string, bug: BugReport, duplicateOf?: string | null, kind: ReportKind = 'bug'): string {
  const file = bugLogPath(repoRoot, kind)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const current = readBugLog(repoRoot, kind)

  if (duplicateOf) {
    // Keeps the new reporter's words alongside the bump — see recordSighting.
    const bumped = recordSighting(current, duplicateOf, bug.lastSeenAt, bug.reporterWords)
    // Only treat it as a duplicate if the bump actually landed; otherwise the
    // report would vanish entirely.
    if (bumped !== current) {
      fs.writeFileSync(file, bumped, 'utf8')
      return duplicateOf
    }
  }

  fs.writeFileSync(file, appendBug(current, bug, kind), 'utf8')
  return bug.id
}
