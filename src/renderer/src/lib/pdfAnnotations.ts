/**
 * The PDF annotation model — pure geometry and serialization.
 *
 * Two things make annotations go wrong, and both live here so they are tests
 * rather than visual bugs:
 *
 *  1. COORDINATE ORIGIN. PDF user space has its origin at the BOTTOM-left with y
 *     growing upward; the DOM and canvas have it at the TOP-left with y growing
 *     down. Store viewport pixels and every highlight lands mirrored about the
 *     page's horizontal axis — the classic "my highlights are upside down" bug.
 *     So annotations are stored in PDF user space, converted at the boundary.
 *
 *  2. SCALE. The view renders at a zoom factor. An annotation recorded in screen
 *     pixels silently changes size and position the moment the user zooms, and
 *     is wrong for every other reader. User-space units are zoom-independent by
 *     construction.
 *
 * Anything persisted here is meant to become a REAL PDF annotation, so it stays
 * close to the PDF shapes: a highlight is a quad, a note is a point, ink is a
 * list of paths.
 */

export type AnnotationKind = 'highlight' | 'note' | 'ink'

/** A rectangle in PDF user space (origin bottom-left, y up). */
export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

export interface AnnotationBase {
  id: string
  kind: AnnotationKind
  /** 1-based, matching how PDF pages are numbered everywhere a user sees them. */
  page: number
  color: string
  createdAt: number
  /** Optional author note — the comment attached to a highlight or a sticky. */
  text?: string
}

export interface HighlightAnnotation extends AnnotationBase {
  kind: 'highlight'
  /** One quad per text line; a selection spanning lines produces several. */
  quads: PdfRect[]
}

export interface NoteAnnotation extends AnnotationBase {
  kind: 'note'
  /** Anchor point in PDF user space (bottom-left origin). */
  x: number
  y: number
}

export interface InkAnnotation extends AnnotationBase {
  kind: 'ink'
  /** Freehand strokes, each a polyline in PDF user space. */
  strokes: { x: number; y: number }[][]
  width: number
}

export type Annotation = HighlightAnnotation | NoteAnnotation | InkAnnotation

/** The sidecar document persisted next to the PDF. */
export interface AnnotationDoc {
  version: 1
  /** Basename of the PDF these belong to — guards against a renamed pairing. */
  file: string
  annotations: Annotation[]
}

/**
 * Viewport geometry needed to convert between screen and PDF space.
 * `height` is the rendered page height in CSS px; `scale` the render zoom.
 */
export interface PageViewport {
  width: number
  height: number
  scale: number
}

/**
 * Screen point (top-left origin, CSS px, relative to the page element) → PDF
 * user space (bottom-left origin, unscaled units).
 */
export function toPdfPoint(x: number, y: number, vp: PageViewport): { x: number; y: number } {
  return { x: x / vp.scale, y: (vp.height - y) / vp.scale }
}

/** PDF user-space point → screen point relative to the rendered page. */
export function toScreenPoint(x: number, y: number, vp: PageViewport): { x: number; y: number } {
  return { x: x * vp.scale, y: vp.height - y * vp.scale }
}

/**
 * Screen rect → PDF rect. The screen rect's TOP edge becomes the PDF rect's
 * top (`y + h`), because y flips — getting this wrong shifts a highlight by its
 * own height, which looks like "off by one line".
 */
export function toPdfRect(
  screen: { x: number; y: number; w: number; h: number },
  vp: PageViewport,
): PdfRect {
  const bottomLeft = toPdfPoint(screen.x, screen.y + screen.h, vp)
  return { x: bottomLeft.x, y: bottomLeft.y, w: screen.w / vp.scale, h: screen.h / vp.scale }
}

/** PDF rect → screen rect (top-left origin), for painting the overlay. */
export function toScreenRect(rect: PdfRect, vp: PageViewport): { x: number; y: number; w: number; h: number } {
  const topLeft = toScreenPoint(rect.x, rect.y + rect.h, vp)
  return { x: topLeft.x, y: topLeft.y, w: rect.w * vp.scale, h: rect.h * vp.scale }
}

/** Is a PDF-space point inside a PDF-space rect? Used for click hit-testing. */
export function rectContains(rect: PdfRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h
}

/**
 * Merge the client rects of a text selection into per-line quads.
 *
 * A DOM selection spanning several words on one line yields one rect per text
 * node, which would otherwise become a row of disjoint highlight boxes with
 * visible seams. Rects whose vertical centres are within `tolerance` px are
 * treated as the same line and unioned.
 */
export function mergeLineRects(
  rects: readonly { x: number; y: number; w: number; h: number }[],
  tolerance = 4,
): { x: number; y: number; w: number; h: number }[] {
  const usable = rects.filter((r) => r.w > 0 && r.h > 0)
  if (usable.length === 0) return []
  const lines: { x: number; y: number; w: number; h: number }[] = []
  for (const r of [...usable].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const centre = r.y + r.h / 2
    const line = lines.find((l) => Math.abs(l.y + l.h / 2 - centre) <= tolerance)
    if (!line) { lines.push({ ...r }); continue }
    const right = Math.max(line.x + line.w, r.x + r.w)
    const top = Math.min(line.y, r.y)
    const bottom = Math.max(line.y + line.h, r.y + r.h)
    line.x = Math.min(line.x, r.x)
    line.y = top
    line.w = right - line.x
    line.h = bottom - top
  }
  return lines
}

/** #rrggbb → the 0–1 RGB triple PDF colour operators use. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 1, g: 0.9, b: 0.2 } // a readable default beats throwing
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/** The bounding rect of a set of quads — a highlight's overall /Rect. */
export function boundsOf(quads: readonly PdfRect[]): PdfRect | null {
  if (quads.length === 0) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const q of quads) {
    x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y)
    x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/**
 * Validate an untrusted sidecar file into a usable doc.
 *
 * Sidecars live in the workspace and can be hand-edited or half-written by a
 * crash, so a malformed entry drops rather than taking the whole file — losing
 * one annotation beats losing every annotation on the document.
 */
export function decodeAnnotationDoc(raw: unknown, file: string): AnnotationDoc {
  const empty: AnnotationDoc = { version: 1, file, annotations: [] }
  if (!raw || typeof raw !== 'object') return empty
  const d = raw as Partial<AnnotationDoc>
  if (!Array.isArray(d.annotations)) return empty
  const annotations = d.annotations.filter(isAnnotation)
  return { version: 1, file: typeof d.file === 'string' ? d.file : file, annotations }
}

function isRect(v: unknown): v is PdfRect {
  const r = v as PdfRect
  return !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n))
}

export function isAnnotation(v: unknown): v is Annotation {
  const a = v as Annotation
  if (!a || typeof a !== 'object') return false
  if (typeof a.id !== 'string' || typeof a.color !== 'string') return false
  if (typeof a.page !== 'number' || !Number.isFinite(a.page) || a.page < 1) return false
  if (a.kind === 'highlight') return Array.isArray(a.quads) && a.quads.length > 0 && a.quads.every(isRect)
  if (a.kind === 'note') return typeof a.x === 'number' && typeof a.y === 'number'
  if (a.kind === 'ink') {
    return Array.isArray(a.strokes) && a.strokes.length > 0 &&
      a.strokes.every((s) => Array.isArray(s) && s.every((p) => typeof p?.x === 'number' && typeof p?.y === 'number'))
  }
  return false
}

/** Annotations on one page, oldest first (stable paint order). */
export function forPage(annotations: readonly Annotation[], page: number): Annotation[] {
  return annotations.filter((a) => a.page === page).sort((a, b) => a.createdAt - b.createdAt)
}
