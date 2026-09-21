/**
 * A CASE — a thread of work that outlives any one agent run.
 *
 * The gap this closes: an agent writes a CV and a cover letter, the files land
 * in a folder, and the *pursuit* has nowhere to live. Why you applied, what the
 * recruiter said, that you decided not to apply after all — none of it is
 * stored, so every later run starts cold and the person is the only memory of
 * the thread.
 *
 * A case holds the subject, the documents produced for it, the status, and the
 * notes. It is what an agent reads to have the full picture, and what it writes
 * back into.
 *
 * WHY A MARKDOWN FILE AND NOT A DATABASE
 *
 * The workspace already indexes notes for full-text search and resolves
 * `[[wikilinks]]` between them. A case stored as markdown is therefore
 * searchable, linkable and backlinked for free — and "give the agent the full
 * picture" reduces to "let it read this file", with no context plumbing at all.
 * It also stays readable and editable when Workspace OS is not running, which
 * is the same fail-safe rule the transclusion layer follows: the artefact must
 * survive the tool.
 *
 * Structured fields live in the frontmatter; notes live in the body as ordinary
 * prose lines, because that is the part a human reads and edits by hand.
 */

/**
 * Who wrote a note.
 *
 * `system` is the app's own bookkeeping — "Status → interview". It exists as a
 * separate author because those lines are not things anybody SAID, and reading
 * them as if they were is how a case at the interview stage came to permanently
 * ask to be prepared for an interview: the offer fired on the name of the
 * stage, not on anything a person or an agent had written.
 */
export type CaseAuthor = 'you' | 'agent' | 'system'

export interface CaseNote {
  /** ISO timestamp. */
  at: string
  author: CaseAuthor
  text: string
}

/**
 * Where a case lives. A WORKSPACE case belongs to the open folder — a client
 * engagement, a tender. A GLOBAL case is a life thread — a job hunt — that
 * must not vanish because a different folder is open. Derived from the file's
 * LOCATION, never serialized into the file: one source of truth.
 */
export type CaseScope = 'workspace' | 'global'

export interface WorkCase {
  /** Slug, and the file's basename. */
  id: string
  /** Where this case lives — stamped by the store on read, absent in the file. */
  scope?: CaseScope
  /** Which vocabulary of statuses applies. */
  type: string
  title: string
  /**
   * One line saying what this is and why it matters — written by whoever opens
   * the case, human or agent.
   *
   * The card was unreadable without it: a title and a status say what something
   * is CALLED and where it stands, never what it IS. Six weeks later "Fonio" is
   * not a memory, and neither is "applied".
   */
  description: string
  /** What the case is ABOUT — a job posting url, a customer, a tender. */
  subject: string
  status: string
  /** Workspace-relative paths to the documents produced for this case. */
  artifacts: string[]
  notes: CaseNote[]
  /**
   * Offers already taken up, as `kind:value`.
   *
   * Without this the offers were React state, so they existed only for whoever
   * happened to type the note in that session — reopen the app, or let an agent
   * write the note, and a case that was asking for three things sat there
   * silent. Which offers are still open is part of what the case IS, so it
   * belongs in the file with everything else.
   */
  acted: string[]
  /**
   * The case's DECLARED view — the JSON a `## View` ```json block holds (Layer
   * 2). Preserved verbatim across saves so an app-side status change never wipes
   * the curated view an agent wrote. Absent = the case declares no view.
   */
  viewBlock?: string
  created: string
  updated: string
}

/**
 * The statuses a case can hold, per type.
 *
 * Ordered, because "what comes next" is the question the UI answers — but not a
 * strict machine: a case can jump (an interview can be cancelled), and every
 * type ends with a terminal pair. `not-applied` exists because preparing a CV
 * and then deciding NOT to apply is a real outcome, and a system that cannot
 * record it teaches people to leave cases half-finished.
 */
export const STATUS_FLOWS: Record<string, string[]> = {
  application: ['drafted', 'applied', 'interview', 'offer', 'accepted', 'rejected', 'not-applied'],
  /**
   * The generic flow, for everything that is not an application.
   *
   * A case is not a job-application feature — it is the thread any piece of
   * ongoing work leaves behind: a tender, a customer, a piece of research, a
   * house purchase. Those do not share a vocabulary of stages, so they get a
   * plain one and can grow their own when a second real instance shows what it
   * should be. Designing five speculative flows now would be guessing.
   */
  task: ['open', 'in-progress', 'waiting', 'done', 'dropped'],
}

/**
 * Statuses that mean the case is WAITING ON THE PERSON — a draft to send, an
 * interview to prepare, an offer to answer, a task parked on their reply.
 * The cockpit's hero and the needs-you notification both read this.
 */
export const WAITING_ON_YOU: ReadonlySet<string> = new Set(['drafted', 'interview', 'offer', 'waiting'])

/** Statuses that end a case — shown apart from the forward path. */
export const TERMINAL: ReadonlySet<string> = new Set([
  'accepted',
  'rejected',
  'not-applied',
  'closed',
  // The generic flow's endings. Without these a finished task kept a "what
  // comes next" and counted as live work everywhere the two are told apart.
  'done',
  'dropped',
])

export function statusesFor(type: string): string[] {
  return STATUS_FLOWS[type] ?? STATUS_FLOWS.task
}

/** The status that usually follows, or null at the end of the road. */
export function nextStatus(type: string, current: string): string | null {
  const flow = statusesFor(type).filter((s) => !TERMINAL.has(s))
  const i = flow.indexOf(current)
  if (i < 0 || i === flow.length - 1) return null
  return flow[i + 1]
}

/* ── file format ─────────────────────────────────────────────────────────── */

const NOTE_RE = /^-\s+(\S+)\s+·\s+(you|agent|system)\s+·\s+([\s\S]*)$/

/** Slug for the filename: readable, stable, safe on every filesystem. */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'case'
  )
}

const esc = (v: string): string => String(v ?? '').replace(/\r?\n/g, ' ').trim()

export function serializeCase(c: WorkCase): string {
  const lines = [
    '---',
    `type: ${esc(c.type)}`,
    `title: ${esc(c.title)}`,
    `description: ${esc(c.description)}`,
    `subject: ${esc(c.subject)}`,
    `status: ${esc(c.status)}`,
    `created: ${esc(c.created)}`,
    `updated: ${esc(c.updated)}`,
    'artifacts:',
    ...c.artifacts.map((a) => `  - ${esc(a)}`),
    'acted:',
    ...(c.acted ?? []).map((a) => `  - ${esc(a)}`),
    '---',
    '',
    `# ${c.title}`,
    '',
    c.description ? c.description : '',
    '',
    c.subject ? `Source: ${c.subject}` : '',
    '',
    '## Notes',
    '',
    // Newest last, so the file reads as a story from the top.
    ...c.notes.map((n) => `- ${n.at} · ${n.author} · ${n.text.replace(/\r?\n/g, ' ')}`),
    '',
    // The declared view, preserved verbatim so a save never drops it.
    ...(c.viewBlock ? ['## View', '', '```json', c.viewBlock.trim(), '```', ''] : []),
  ]
  return lines.filter((l, i) => !(l === '' && lines[i - 1] === '')).join('\n')
}

/**
 * Reads a case back. Tolerant on purpose: a human edits these by hand, and a
 * file with a typo in one field must not become unreadable.
 */
export function parseCase(id: string, md: string): WorkCase {
  const text = String(md ?? '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const front = m ? m[1] : ''
  /*
   * Spaces and tabs only — NOT \s.
   *
   * `\s` matches a newline, so `subject:` with no value consumed the line
   * break and captured the NEXT field: a case with an empty subject silently
   * stored "status: drafted" as its subject, and then wrote that back to disk.
   * Every empty field did this, and it went unnoticed because the file still
   * looked plausible.
   */
  const field = (k: string): string => {
    const f = new RegExp(`^${k}:[ \\t]*(.*)$`, 'm').exec(front)
    return f ? f[1].trim() : ''
  }
  /*
   * Scanned line by line rather than with one regex over the block.
   *
   * The regex version used `\Z` as an end anchor — which JavaScript does not
   * have, so it matched a literal "Z", the block never terminated, and every
   * artifact was silently dropped. The list still LOOKED right in the file.
   */
  const list = (key: string): string[] => {
    const out: string[] = []
    let inside = false
    for (const line of front.split(/\r?\n/)) {
      if (new RegExp(`^${key}:\\s*$`).test(line)) {
        inside = true
        continue
      }
      if (!inside) continue
      const a = /^\s+-\s+(.+)$/.exec(line)
      if (a) out.push(a[1].trim())
      else if (line.trim() !== '') break // a new top-level field ends the list
    }
    return out
  }

  const notes: CaseNote[] = []
  for (const line of text.split(/\r?\n/)) {
    const n = NOTE_RE.exec(line.trim())
    if (n) notes.push({ at: n[1], author: n[2] as CaseAuthor, text: n[3].trim() })
  }

  const title = field('title') || id
  return {
    id,
    type: field('type') || 'task',
    title,
    description: field('description'),
    subject: field('subject'),
    status: field('status') || 'drafted',
    artifacts: list('artifacts'),
    acted: list('acted'),
    notes,
    viewBlock: (/```json\s*([\s\S]*?)```/.exec(text)?.[1] ?? '').trim() || undefined,
    created: field('created') || new Date(0).toISOString(),
    updated: field('updated') || field('created') || new Date(0).toISOString(),
  }
}

/* ── what a note is asking for ───────────────────────────────────────────── */

export interface NoteSignal {
  /** What the app would do about it. */
  kind: 'research-person' | 'prepare-interview' | 'schedule'
  /** Shown to the user, in their words where possible. */
  label: string
  /** The extracted subject — a name, a date phrase. */
  value: string
}

/**
 * Reads a note the way a colleague would, and says what it implies.
 *
 * "I have an invite with Maria Schmidt on Thursday" should not just sit there:
 * it means somebody to look up and a meeting to prepare for. The point of a
 * case is that adding to it MOVES something.
 *
 * Deliberately conservative. A wrong suggestion costs more than a missing one —
 * it teaches people the offers are noise, the same reasoning the browser's
 * action panel follows. So this matches explicit phrasing rather than guessing
 * at every capitalised word, and it never fires an agent by itself: it proposes,
 * and the person chooses.
 */
/**
 * Turns a time named in a note into an actual instant, or nothing.
 *
 * A note is written the way a person speaks: "first meeting with Anna on
 * Tuesday 25.08.2026 at 14:00", "Gespräch am Donnerstag um 9 Uhr", "call
 * tomorrow". All of those have to become a real slot, because the whole point
 * is that saying it puts it in the calendar.
 *
 * `now` is injectable so tests are not hostage to the day they run on — a
 * "next Thursday" test that passes on Wednesday and fails on Friday is worse
 * than no test.
 *
 * Returns null rather than guessing. "Next week" is a real phrase and an
 * unschedulable one; an event on a day nobody chose gets trusted and makes
 * somebody miss the real thing.
 */
export interface WhenFound {
  at: number
  label: string
  /** False when only a day was given and 09:00 was assumed. */
  hasTime: boolean
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sonntag: 0,
  monday: 1, montag: 1,
  tuesday: 2, dienstag: 2,
  wednesday: 3, mittwoch: 3,
  thursday: 4, donnerstag: 4,
  friday: 5, freitag: 5,
  saturday: 6, samstag: 6,
}

/** "at 14:00", "um 9 Uhr", "14.30", "2pm" → minutes since midnight, or null. */
function findTime(t: string): { minutes: number; label: string } | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(t)
  if (ampm) {
    let h = Number(ampm[1]) % 12
    if (/pm/i.test(ampm[3])) h += 12
    return { minutes: h * 60 + Number(ampm[2] ?? 0), label: ampm[0] }
  }
  /*
   * 14:00 / 14.30 / "um 9 Uhr" — scanning ALL candidates, not just the first.
   *
   * "25.08.2026 at 14:00" offers `25.08` first. It is correctly rejected as an
   * hour, but `exec` only ever returns one match, so the real time was never
   * examined and the label came out as "at 14". Keep looking.
   */
  for (const m of t.matchAll(/\b(?:at|um|@)?\s*(\d{1,2})[:.](\d{2})\b/gi)) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h <= 23 && min <= 59) {
      return { minutes: h * 60 + min, label: `${String(h).padStart(2, '0')}:${m[2]}` }
    }
  }
  const bare = /\b(?:at|um|@)\s*(\d{1,2})\s*(?:uhr|h|o'clock)?\b/i.exec(t)
  if (bare && Number(bare[1]) <= 23) {
    return { minutes: Number(bare[1]) * 60, label: `${String(bare[1]).padStart(2, '0')}:00` }
  }
  return null
}

/** An explicit calendar date, in either of the two orders people write. */
function findDate(t: string): { y: number; m: number; d: number; label: string } | null {
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t)
  if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3], label: iso[0] }
  // 25.08.2026 or 25/08/2026 — day first, which is how it is written here.
  const eu = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/.exec(t)
  if (eu) return { y: +eu[3], m: +eu[2], d: +eu[1], label: eu[0] }
  return null
}

export function resolveWhen(text: string, now = new Date()): WhenFound | null {
  const t = String(text ?? '')
  const time = findTime(t)
  const date = findDate(t)

  const at = (y: number, m: number, d: number): Date =>
    new Date(y, m - 1, d, time ? Math.floor(time.minutes / 60) : 9, time ? time.minutes % 60 : 0, 0, 0)

  if (date) {
    const when = at(date.y, date.m, date.d)
    return {
      at: when.getTime(),
      label: time ? `${date.label} ${time.label}` : date.label,
      hasTime: Boolean(time),
    }
  }

  const m = new RegExp(`\\b(${Object.keys(WEEKDAYS).join('|')}|tomorrow|morgen)\\b`, 'i').exec(t)
  if (!m) return null
  const word = m[1].toLowerCase()
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (word === 'tomorrow' || word === 'morgen') base.setDate(base.getDate() + 1)
  else {
    // Always the NEXT one: 1..7 days ahead, never today or behind. Somebody
    // writing "Thursday" on a Thursday means the one coming.
    const delta = ((WEEKDAYS[word] - base.getDay() + 7) % 7) || 7
    base.setDate(base.getDate() + delta)
  }
  const when = at(base.getFullYear(), base.getMonth() + 1, base.getDate())
  return {
    at: when.getTime(),
    label: time ? `${m[1]} ${time.label}` : m[1],
    hasTime: Boolean(time),
  }
}

/** Kept for callers that only care about the day. */
export function resolveDay(text: string, now = new Date()): { at: number; label: string } | null {
  const w = resolveWhen(text, now)
  return w ? { at: w.at, label: w.label } : null
}

export function readNote(text: string): NoteSignal[] {
  const t = String(text ?? '')
  const out: NoteSignal[] = []

  // "with Maria Schmidt", "meeting with Dr. Anna Weber", "call with Tom"
  const people = new Set<string>()
  const re = /\b(?:with|mit|interview with|call with|meeting with)\s+((?:[A-ZÄÖÜ][\p{L}'’-]+)(?:\s+(?:van|von|de|der|den)\s+)?(?:\s+[A-ZÄÖÜ][\p{L}'’-]+){0,2})/gu
  for (const m of t.matchAll(re)) {
    const name = m[1].trim()
    // One capitalised word is as likely to be a company or a weekday.
    if (name.split(/\s+/).length >= 2) people.add(name)
  }
  for (const name of people) {
    out.push({ kind: 'research-person', label: `Find out who ${name} is`, value: name })
  }

  /*
   * "meeting" belongs here, and its absence was found by running the very
   * sentence this feature was described with: "I have my first meeting with
   * Anna Weber on Tuesday". A prep offer that misses the commonest word for a
   * conversation is a prep offer that is usually absent.
   */
  if (/\b(interview|gespräch|screening|call|meeting|treffen|termin|kennenlernen)\b/i.test(t)) {
    out.push({ kind: 'prepare-interview', label: 'Prepare me for this conversation', value: t.trim() })
  }

  /*
   * The scheduling offer exists again because the calendar can now be written
   * to. It was removed for a day: `calendar.add` registers a FEED, nothing
   * could create an event, and a button that cannot work is the one thing this
   * codebase refuses to ship. `calendar.createEvent` changed the fact, so the
   * offer changed with it.
   *
   * Only a resolvable day counts. "Next week" is a real phrase and an
   * unschedulable one — offering to put it in the calendar would produce an
   * event on a day nobody chose, which is worse than not offering.
   */
  const when = resolveWhen(t)
  if (when) {
    out.push({ kind: 'schedule', label: `Put ${when.label} in the calendar`, value: String(when.at) })
  }

  return out
}

/** The stable name of an offer, so a case can remember taking it up. */
export function signalKey(s: NoteSignal): string {
  return `${s.kind}:${s.value}`
}

/**
 * What this case is still asking for.
 *
 * Read from the notes every time rather than remembered from the moment one was
 * typed. That is the difference between offers being a property of the case —
 * true for an agent's note, true after a restart — and a fringe of the one
 * session that happened to create them.
 *
 * Newest note first, because the thing that just happened is the thing most
 * likely to need doing.
 */
export function openSignals(c: WorkCase): NoteSignal[] {
  const done = new Set(c.acted ?? [])
  const seen = new Set<string>()
  const out: NoteSignal[] = []
  /*
   * Only ONE prepare offer, from the newest note that mentions a conversation.
   *
   * Its key embeds the whole note text, so two notes about meetings survive
   * dedup as two offers — and its label is the same fixed sentence for both, so
   * a real case showed twin "Prepare me for this conversation" buttons with
   * nothing telling them apart. One conversation is coming; the newest mention
   * is the one to prepare for, and taking it up (or having taken it up) retires
   * the older mentions too.
   */
  let prepareSeen = false
  for (const note of [...c.notes].reverse()) {
    // The app's own bookkeeping is not a request — see CaseAuthor.
    if (note.author === 'system') continue
    for (const s of readNote(note.text)) {
      const k = signalKey(s)
      if (seen.has(k)) continue
      if (s.kind === 'prepare-interview') {
        if (prepareSeen) continue
        prepareSeen = true
      }
      if (done.has(k)) continue
      seen.add(k)
      out.push(s)
    }
  }
  return out
}
