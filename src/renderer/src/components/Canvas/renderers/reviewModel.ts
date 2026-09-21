/**
 * Comments and tracked changes, as the engine reports them.
 *
 * `getCommandValues('.uno:ViewAnnotations')` lists every comment: Writer
 * fields id / parentId / author / text or html / resolved / dateTime /
 * anchorPos ("x, y, w, h" twips) / textRange; Calc notes carry tab + cellPos;
 * Impress annotations carry the slide's part. `.uno:AcceptTrackedChanges`
 * lists redlines: index / author / type (Insert, Delete, Format, …) /
 * comment / description / dateTime / textRange. LOK_CALLBACK_COMMENT and the
 * REDLINE_TABLE callbacks say when to ask again. Pure; unit-tested.
 */

export interface Rect { x: number; y: number; w: number; h: number }

export interface ReviewComment {
  id: string
  parentId: string | null
  author: string
  text: string
  dateTime: string
  resolved: boolean
  /** Anchor in document twips (Writer anchorPos / Calc cellPos), when known. */
  anchor: Rect | null
  /** Calc sheet / Impress slide index, when the engine says. */
  part: number | null
}

export interface CommentThread {
  root: ReviewComment
  replies: ReviewComment[]
}

export interface Redline {
  index: number
  author: string
  type: string
  description: string
  comment: string
  dateTime: string
  /** First rectangle of the change in document twips, when known. */
  anchor: Rect | null
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v)
  return null
}

/** "x, y, w, h" (twips) → rect; the first of "a; b; c" when several. */
export function parseRect(s: unknown): Rect | null {
  if (typeof s !== 'string') return null
  const first = s.split(';')[0]
  const n = first.split(',').map((t) => parseInt(t.trim(), 10))
  if (n.length < 4 || n.some((x) => Number.isNaN(x))) return null
  return { x: n[0], y: n[1], w: n[2], h: n[3] }
}

/** Strip tags from the engine's html rendering of a comment (Writer sends html when present). */
export function plainText(v: unknown): string {
  if (typeof v !== 'string') return ''
  const t = v.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<\/div>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  // A reply carries LibreOffice's own quote of the parent ("Reply to <author> (<date>): "…""); the thread already shows the parent.
  return t.replace(/\s*Reply to [^\n]*?\(\d{2}\/\d{2}\/\d{4}, \d{2}:\d{2}\):\s*"[^"]*"\s*/g, '\n').trim()
}

function toComment(raw: unknown): ReviewComment | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = o.id === undefined || o.id === null ? '' : String(o.id)
  if (!id) return null
  const parent = o.parentId ?? o.parent
  const parentId = parent === undefined || parent === null || String(parent) === '0' || String(parent) === '' ? null : String(parent)
  return {
    id,
    parentId,
    author: typeof o.author === 'string' ? o.author : '',
    text: plainText(o.html) || plainText(o.text),
    dateTime: typeof o.dateTime === 'string' ? o.dateTime : '',
    resolved: o.resolved === true || o.resolved === 'true',
    anchor: parseRect(o.anchorPos) ?? parseRect(o.cellPos) ?? parseRect(o.textRange),
    part: num(o.tab) ?? num(o.parthash) ?? null,
  }
}

/** Parse the ViewAnnotations payload (object or JSON string). */
export function parseComments(payload: unknown): ReviewComment[] {
  let o: unknown = payload
  if (typeof payload === 'string') { try { o = JSON.parse(payload) } catch { return [] } }
  const list = (o as { comments?: unknown })?.comments
  if (!Array.isArray(list)) return []
  return list.map(toComment).filter((c): c is ReviewComment => !!c)
}

/** Group replies under their root, keeping the engine's order. */
export function threadsOf(comments: ReviewComment[]): CommentThread[] {
  const byId = new Map(comments.map((c) => [c.id, c]))
  const threads: CommentThread[] = []
  const index = new Map<string, CommentThread>()
  for (const c of comments) {
    let rootId = c.id
    let cur = c
    // Walk to the root; a missing parent makes this comment its own root.
    const seen = new Set<string>()
    while (cur.parentId && byId.has(cur.parentId) && !seen.has(cur.parentId)) { seen.add(cur.id); cur = byId.get(cur.parentId)!; rootId = cur.id }
    if (rootId === c.id) {
      const t = { root: c, replies: [] }
      threads.push(t)
      index.set(c.id, t)
    } else {
      const t = index.get(rootId)
      if (t) t.replies.push(c)
      else { const nt = { root: c, replies: [] }; threads.push(nt); index.set(c.id, nt) }
    }
  }
  return threads
}

/** Parse the AcceptTrackedChanges payload. */
export function parseRedlines(payload: unknown): Redline[] {
  let o: unknown = payload
  if (typeof payload === 'string') { try { o = JSON.parse(payload) } catch { return [] } }
  const list = (o as { redlines?: unknown })?.redlines
  if (!Array.isArray(list)) return []
  const out: Redline[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const index = num(r.index)
    if (index === null) continue
    out.push({
      index,
      author: typeof r.author === 'string' ? r.author : '',
      type: typeof r.type === 'string' ? r.type : '',
      description: typeof r.description === 'string' ? r.description : '',
      comment: typeof r.comment === 'string' ? r.comment : '',
      dateTime: typeof r.dateTime === 'string' ? r.dateTime : '',
      anchor: parseRect(r.textRange),
    })
  }
  return out
}

/** Commands with JSON args for the review operations, per app. */
export const reviewCommands = {
  insertComment: (text: string): string => `.uno:InsertAnnotation {"Text":{"type":"string","value":${JSON.stringify(text)}}}`,
  reply: (id: string, text: string): string => `.uno:ReplyComment {"Id":{"type":"string","value":${JSON.stringify(id)}},"Text":{"type":"string","value":${JSON.stringify(text)}}}`,
  resolve: (id: string): string => `.uno:ResolveComment {"Id":{"type":"string","value":${JSON.stringify(id)}}}`,
  deleteComment: (id: string, app: 'w' | 'c' | 'p'): string =>
    app === 'c'
      ? `.uno:DeleteNote {"Id":{"type":"string","value":${JSON.stringify(id)}}}`
      : app === 'p'
        ? `.uno:DeleteAnnotation {"Id":{"type":"string","value":${JSON.stringify(id)}}}`
        : `.uno:DeleteComment {"Id":{"type":"string","value":${JSON.stringify(id)}}}`,
  // The index item is SfxUInt32Item; the engine accepts it only as "unsigned short" (proven on the engine — "unsigned long" is ignored).
  acceptChange: (index: number): string => `.uno:AcceptTrackedChange {"AcceptTrackedChange":{"type":"unsigned short","value":${index}}}`,
  rejectChange: (index: number): string => `.uno:RejectTrackedChange {"RejectTrackedChange":{"type":"unsigned short","value":${index}}}`,
}

/** Short, readable date for the panel ("Sep 4, 14:02"); the raw string when unparsable. */
export function shortDate(iso: string): string {
  // The engine writes fractional seconds with a comma ("12:53:00,180683000"); JS Date wants none.
  const d = new Date(iso.replace(/([T ]\d{2}:\d{2}:\d{2})[,.]\d+/, '$1'))
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
