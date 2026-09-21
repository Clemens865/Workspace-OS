/**
 * The Morning Sift — stage 2 of inbox classification.
 *
 * Stage 1 (classify.ts) is free and instant: headers and the person's rules
 * prove what they can prove. But heuristics have a semantic ceiling — a
 * personalized cold-pitch passes every honest header check, because only the
 * MEANING of the mail reveals it's an offer. This module is the semantic
 * stage: ONE batched model call over everything new, returning per mail a
 * zone, a priority, and a one-line plain-language summary.
 *
 * Design constraints, in order:
 *  - One call for the whole batch, never one per mail. Sixty overnight mails
 *    are one prompt of headers + snippets, a few seconds on a light model.
 *  - Pure over its inputs. The prompt builder and the verdict parser know
 *    nothing about IMAP, IPC, or which model runs them — the runner is
 *    injected, so tests feed canned responses and the caller feeds the CLI.
 *  - The model can only ever LOSE to the person's own signals gracefully:
 *    a missing, malformed, or partial response heals to the stage-1 verdict.
 *    A broken model reply must degrade to "what the headers said", never to
 *    an empty inbox view.
 *  - No model name appears here or anywhere in source. The caller passes the
 *    person's configured alias through; absent means the CLI default.
 */

import type { MailCategory } from './classify'

/** Where a mail lands in the sift. The four zones of the morning briefing. */
export type SiftZone =
  /** A person wrote it to you and it needs your reply. */
  | 'answer'
  /** Belongs to one of the person's open cases (named in `caseTitle`). */
  | 'case'
  /** Notifications a human may care about: invites, receipts, alerts. */
  | 'glance'
  /** Newsletters, marketing, cold offers — clearable in one sweep. */
  | 'noise'

export const SIFT_ZONES: readonly SiftZone[] = ['answer', 'case', 'glance', 'noise']

/** What the sift needs to know about one mail — index fields, nothing deep. */
export interface SiftItem {
  uid: number
  folder: string
  fromName: string
  fromAddress: string
  subject: string
  snippet: string
  /** Stage-1 verdict, the healing fallback when the model fails this item. */
  heuristic: MailCategory
}

/** The model's judgment of one mail, healed against the item it describes. */
export interface SiftVerdict {
  uid: number
  folder: string
  zone: SiftZone
  /** 0 (ignorable) … 3 (urgent). */
  priority: number
  /** One plain-language line: what this mail is about / wants from you. */
  summary: string
  /** The open case it belongs to — only when zone is 'case'. */
  caseTitle: string | null
  /** The concrete next step, imperative ("Reply with your availability"), or
   *  null when the mail asks nothing of the person. */
  todo: string | null
  /** The deadline/event the mail names: YYYY-MM-DD, or YYYY-MM-DDTHH:MM when
   *  it names a time. Null when there is none. Feeds "Add to calendar". */
  due: string | null
}

/** Stage-1 category → the zone it defaults to when the model has no verdict. */
export function heuristicZone(category: MailCategory): SiftZone {
  if (category === 'newsletter') return 'noise'
  if (category === 'notification') return 'glance'
  // 'personal' heals toward visibility: wrongly demoting a human's mail to
  // noise costs a missed reply; wrongly promoting noise costs a glance.
  return 'answer'
}

const cap = (s: string, n: number): string => {
  // Control chars collapse to spaces so one mail cannot inject prompt lines.
  const clean = (s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > n ? clean.slice(0, n - 1).trimEnd() + '…' : clean
}

/**
 * The batch prompt. Every mail is one numbered block keyed by uid; the reply
 * contract is a bare JSON array. Case titles are listed so 'case' assignments
 * can only name a case that actually exists (the parser enforces it too).
 */
export function buildSiftPrompt(items: SiftItem[], caseTitles: string[]): string {
  const cases = caseTitles.length
    ? caseTitles.map((t) => `- ${cap(t, 80)}`).join('\n')
    : '(none open)'
  const blocks = items
    .map(
      (m) =>
        `[${m.uid}] From: ${cap(m.fromName, 60)} <${cap(m.fromAddress, 80)}>\n` +
        `Subject: ${cap(m.subject, 120)}\n` +
        `Preview: ${cap(m.snippet, 240)}`,
    )
    .join('\n\n')
  return (
    'You are sorting one person\'s new mail into four zones. Judge each mail by what it MEANS, not how it was sent — a personalized sales pitch is noise even when a human wrote it; a short human mail asking something is answer.\n\n' +
    'Zones:\n' +
    '- "answer": a person wrote to this person and a reply is expected.\n' +
    '- "case": the mail clearly belongs to one of the open cases listed below (a reply from a company they applied to, a thread they are pursuing). Set "case_title" to the matching case title, copied exactly.\n' +
    '- "glance": machine mail worth seeing once — calendar invites, receipts, security alerts, delivery updates.\n' +
    '- "noise": newsletters, marketing, cold outreach, anything clearable unread.\n\n' +
    `Open cases:\n${cases}\n\n` +
    'For every mail return: its uid, the zone, a priority from 0 (ignorable) to 3 (urgent), "summary" — ONE short sentence in the mail\'s own language saying what it is about or wants (e.g. "Anna asks to move Thursday to 14:00"), "todo" — the concrete next step as a short imperative in the same language ("Reply with your availability", "Pay the invoice"), or null when the mail asks nothing, and "due" — the deadline or event the mail names, as YYYY-MM-DD (add the time as "YYYY-MM-DD HH:MM" when the mail names one), or null. Never invent content beyond the preview.\n\n' +
    'Also write "briefing": 2–3 plain sentences a good assistant would say out loud about this batch — lead with who is waiting on the person and for what, name the senders that matter, and wave off the rest in half a sentence. No markdown, no lists.\n\n' +
    'Reply with ONLY this JSON object, no prose, no code fences:\n' +
    '{"briefing": "…", "mails": [{"uid": 123, "zone": "answer", "priority": 2, "summary": "…", "todo": null, "due": null, "case_title": null}, …]}\n\n' +
    `Mail (${items.length}):\n\n${blocks}`
  )
}


const isZone = (z: unknown): z is SiftZone => SIFT_ZONES.includes(z as SiftZone)

/**
 * The reply payload: preferred form is an OBJECT with a briefing and a mails
 * array; a bare array (the v1 contract, and what a stubborn model may still
 * send) is accepted with no briefing. Balanced-walk extraction both ways.
 */
function extractPayload(text: string): { mails: unknown[]; briefing: string | null } | null {
  const objStart = text.indexOf('{')
  const arrStart = text.indexOf('[')
  if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
    const obj = walkBalanced(text, objStart, '{', '}')
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      const o = obj as Record<string, unknown>
      if (Array.isArray(o.mails)) {
        const briefing =
          typeof o.briefing === 'string' && o.briefing.trim() ? cap(o.briefing, 500) : null
        return { mails: o.mails, briefing }
      }
    }
  }
  const arr = arrStart === -1 ? null : walkBalanced(text, arrStart, '[', ']')
  return Array.isArray(arr) ? { mails: arr, briefing: null } : null
}

function walkBalanced(text: string, start: number, open: string, close: string): unknown {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === open) depth++
    else if (ch === close && --depth === 0) {
      try {
        return JSON.parse(text.slice(start, i + 1))
      } catch {
        return null
      }
    }
  }
  return null
}

/**
 * Heals the model's reply against the items that were asked about. Every item
 * gets EXACTLY ONE verdict: the model's where it gave a valid one, stage 1's
 * where it didn't. Verdicts for uids never asked about are dropped; a 'case'
 * zone naming no known case demotes to 'answer' (a person is behind it).
 */
export function parseSiftVerdicts(
  text: string,
  items: SiftItem[],
  caseTitles: string[] = [],
): SiftVerdict[] {
  const byUid = new Map<number, Record<string, unknown>>()
  for (const raw of extractPayload(text)?.mails ?? []) {
    const o = raw as Record<string, unknown>
    const uid = typeof o?.uid === 'number' ? o.uid : Number(o?.uid)
    if (Number.isFinite(uid) && !byUid.has(uid)) byUid.set(uid, o)
  }
  const known = new Set(caseTitles.map((t) => t.trim().toLowerCase()))
  return items.map((item) => {
    const o = byUid.get(item.uid)
    const fallbackZone = heuristicZone(item.heuristic)
    let zone: SiftZone = isZone(o?.zone) ? (o!.zone as SiftZone) : fallbackZone
    let caseTitle: string | null = null
    if (zone === 'case') {
      const t = typeof o?.case_title === 'string' ? o.case_title.trim() : ''
      if (t && known.has(t.toLowerCase())) caseTitle = t
      else zone = 'answer'
    }
    const p = typeof o?.priority === 'number' ? o.priority : Number(o?.priority)
    const summary =
      typeof o?.summary === 'string' && o.summary.trim()
        ? cap(o.summary, 160)
        : cap(item.snippet, 160) || cap(item.subject, 160)
    const todo = typeof o?.todo === 'string' && o.todo.trim() ? cap(o.todo, 120) : null
    // Only a real calendar date survives — "next week" is a summary, not a
    // due. A named time rides along as YYYY-MM-DDTHH:MM; seconds/zones drop.
    const dueRaw = typeof o?.due === 'string' ? o.due.trim() : ''
    const dueMatch = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(dueRaw)
    const due = dueMatch ? (dueMatch[2] ? `${dueMatch[1]}T${dueMatch[2]}` : dueMatch[1]) : null
    return {
      uid: item.uid,
      folder: item.folder,
      zone,
      priority: Number.isFinite(p) ? Math.max(0, Math.min(3, Math.round(p))) : zone === 'answer' ? 2 : 1,
      summary,
      caseTitle,
      todo,
      due,
    }
  })
}

/** The runner the orchestrator injects — claude-oneshot in production. */
export type SiftRunner = (prompt: string) => Promise<string>

export interface SiftResult {
  verdicts: SiftVerdict[]
  /** The assistant's spoken-style overview of this batch, or null. */
  briefing: string | null
  /** True when the model reply was unusable and everything healed to stage 1. */
  degraded: boolean
}

/** One batch, one call, healed output. Empty input never calls the model. */
export async function siftItems(
  items: SiftItem[],
  caseTitles: string[],
  run: SiftRunner,
): Promise<SiftResult> {
  if (items.length === 0) return { verdicts: [], briefing: null, degraded: false }
  let reply = ''
  try {
    reply = await run(buildSiftPrompt(items, caseTitles))
  } catch {
    reply = ''
  }
  const payload = extractPayload(reply)
  const verdicts = parseSiftVerdicts(reply, items, caseTitles)
  return { verdicts, briefing: payload?.briefing ?? null, degraded: payload === null }
}
