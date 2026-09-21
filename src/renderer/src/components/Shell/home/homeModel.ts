/**
 * Pure model for the Home dashboard's widget system.
 *
 * A widget is identity + placement + look, all user-editable: visible or not,
 * a size (columns it spans), an accent from a fixed calm palette, and an
 * order. The layout persists as one small JSON blob; parsing is defensive so
 * a hand-edited or stale blob degrades to defaults instead of a blank Home.
 */

export type WidgetId = 'activity' | 'cases' | 'calendar' | 'agents' | 'files' | 'browser' | 'mail' | 'knowledge' | 'assistant'
export type WidgetSize = 's' | 'm' | 'l'

/** The calm palette — brand hues as identities, applied as soft tints. */
export const ACCENTS = ['indigo', 'violet', 'amber', 'green', 'teal', 'rose'] as const
export type Accent = (typeof ACCENTS)[number]

/** How a strip renders its items — a reading preference, persisted per widget. */
export type WidgetView = 'slider' | 'list' | 'grid'

export interface WidgetConfig {
  id: WidgetId
  visible: boolean
  size: WidgetSize
  accent: Accent
  view: WidgetView
}

export const WIDGET_IDS: readonly WidgetId[] = ['activity', 'cases', 'calendar', 'agents', 'files', 'browser', 'mail', 'knowledge', 'assistant']

/** The out-of-the-box layout: what happened first (coming home), then what needs you. */
export const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: 'activity', visible: true, size: 'm', accent: 'teal', view: 'list' },
  { id: 'cases', visible: true, size: 'm', accent: 'amber', view: 'slider' },
  { id: 'calendar', visible: true, size: 'm', accent: 'indigo', view: 'list' },
  { id: 'agents', visible: true, size: 'm', accent: 'violet', view: 'list' },
  { id: 'files', visible: true, size: 'm', accent: 'teal', view: 'slider' },
  { id: 'browser', visible: true, size: 'm', accent: 'green', view: 'slider' },
  { id: 'mail', visible: true, size: 'm', accent: 'rose', view: 'list' },
  { id: 'knowledge', visible: true, size: 'm', accent: 'indigo', view: 'list' },
  { id: 'assistant', visible: true, size: 'm', accent: 'indigo', view: 'list' },
]

/** Columns a size spans in the 4-column grid. */
export const SIZE_COLS: Record<WidgetSize, number> = { s: 1, m: 2, l: 4 }

/**
 * Parse a persisted layout. Unknown ids are dropped, missing ids are appended
 * with their defaults (so a NEW widget appears for existing users), malformed
 * fields fall back per-widget. Never throws.
 */
export function parseLayout(raw: string | null): WidgetConfig[] {
  let stored: unknown
  try {
    stored = raw ? JSON.parse(raw) : null
  } catch {
    stored = null
  }
  const byId = new Map(DEFAULT_LAYOUT.map((w) => [w.id, w]))
  const out: WidgetConfig[] = []
  if (Array.isArray(stored)) {
    for (const item of stored) {
      const o = item as Partial<WidgetConfig>
      const def = o?.id ? byId.get(o.id as WidgetId) : undefined
      if (!def || out.some((w) => w.id === def.id)) continue
      out.push({
        id: def.id,
        visible: typeof o.visible === 'boolean' ? o.visible : def.visible,
        size: o.size === 's' || o.size === 'm' || o.size === 'l' ? o.size : def.size,
        accent: (ACCENTS as readonly string[]).includes(o.accent as string) ? (o.accent as Accent) : def.accent,
        view: o.view === 'slider' || o.view === 'list' || o.view === 'grid' ? o.view : def.view,
      })
    }
  }
  for (const def of DEFAULT_LAYOUT) {
    if (!out.some((w) => w.id === def.id)) out.push(def)
  }
  return out
}

export function serializeLayout(layout: WidgetConfig[]): string {
  return JSON.stringify(layout)
}

/** Move a widget to a new position (drag-reorder). Out-of-range is clamped. */
export function moveWidget(layout: WidgetConfig[], id: WidgetId, toIndex: number): WidgetConfig[] {
  const from = layout.findIndex((w) => w.id === id)
  if (from === -1) return layout
  const next = layout.slice()
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, item)
  return next
}

/** Cycle S → M → L → S — the one-button size control. */
export function cycleSize(size: WidgetSize): WidgetSize {
  return size === 's' ? 'm' : size === 'm' ? 'l' : 's'
}

/** The greeting the dashboard opens with. */
export function greeting(hour: number): string {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

/* ── "While you were away" — the workspace's own news ─────────────────────── */

export interface ActivityItem {
  at: number
  kind: 'agent' | 'case' | 'file' | 'calendar'
  text: string
}

/**
 * Coming home means the house tells you what happened while you were out — in
 * sentences, not a log. Merges the latest case notes, agent runs and files
 * that appeared into one time-sorted feed, with the next calendar event pinned
 * on top (the one thing that is about the future). Pure, so the sentences are
 * testable.
 */
export function buildActivity(input: {
  cases: { title: string; lastNote: string; lastNoteAt: number; lastNoteAuthor: string }[]
  runs: { agentName: string | null; sessionName: string; status: string; prompt: string; at: number }[]
  files: { path: string; at: number }[]
  nextEvent: { summary: string; start: number } | null
  now?: number
}): ActivityItem[] {
  const now = input.now ?? Date.now()
  const clip = (s: string, n = 72): string => (s.length > n ? s.slice(0, n - 1) + '…' : s)
  const out: ActivityItem[] = []

  for (const c of input.cases) {
    if (!c.lastNote || !c.lastNoteAt) continue
    const text =
      c.lastNoteAuthor === 'system'
        ? `${c.title} — ${clip(c.lastNote.replace(/^Status → /, 'now '))}`
        : c.lastNoteAuthor === 'agent'
          ? `Agent, on ${c.title}: ${clip(c.lastNote)}`
          : `You, on ${c.title}: ${clip(c.lastNote)}`
    out.push({ at: c.lastNoteAt, kind: 'case', text })
  }
  for (const r of input.runs) {
    const who = r.agentName ?? r.sessionName
    const what = clip(r.prompt, 64)
    if (r.status === 'running') out.push({ at: r.at, kind: 'agent', text: `${who} is working: ${what}` })
    else if (r.status === 'error') out.push({ at: r.at, kind: 'agent', text: `${who} hit an error on: ${what}` })
    else out.push({ at: r.at, kind: 'agent', text: `${who} finished: ${what}` })
  }
  for (const f of input.files) {
    out.push({ at: f.at, kind: 'file', text: `New in the workspace: ${f.path.split('/').pop() ?? f.path}` })
  }

  out.sort((a, b) => b.at - a.at)
  const top = out.slice(0, 7)
  if (input.nextEvent && input.nextEvent.start > now) {
    top.unshift({ at: input.nextEvent.start, kind: 'calendar', text: `Coming up: ${clip(input.nextEvent.summary, 56)}` })
  }
  return top.slice(0, 8)
}

/** "just now" / "12 min ago" / "3 h ago" — the card's human clock. */
export function agoLabel(at: number, now = Date.now()): string {
  const s = Math.max(0, (now - at) / 1000)
  if (s < 90) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} h ago`
  const d = h / 24
  return d < 7 ? `${Math.round(d)} d ago` : new Date(at).toLocaleDateString()
}
