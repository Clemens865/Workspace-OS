// Frame → native-slide mapping (frame→live-slide bridge v1).
//
// Pure translation of a tldraw frame's child shapes into an ordered list of
// SlideShapeSpec — the neutral, engine-agnostic description the LOK handler
// turns into REAL, editable PPTX shapes (com.sun.star.drawing.*). This is the
// differentiated "canvas becomes real office, not a picture" seam: a rect keeps
// being a rect you can select/recolour in PowerPoint, not a flattened image.
//
// Shapes we can faithfully round-trip (geo rectangle/ellipse, text, line) map to
// native specs. Everything else (draw/arrow/image/frame/complex geo) is collected
// into `imageFallback` so the handler can drop those as pictures — nothing on the
// frame is silently lost.
//
// UNITS: specs are in 1/100 mm (the UNO drawing unit — oShape.Size/Position use
// com.sun.star.awt.Size/Point in 1/100 mm). tldraw page coordinates are treated
// as CSS px ≈ points; we convert px → 1/100 mm with PT_TO_MM100 and express every
// shape RELATIVE to the frame's top-left, so the frame's own origin becomes the
// slide origin.
//
// Pure + unit-testable: no DOM, no engine, no tldraw runtime — the `editor` is
// used only through a tiny structural interface so the unit test can pass a stub.

/** 1 tldraw px (≈1 pt) → 1/100 mm.  2540 (1/100mm per inch) / 72 (pt per inch). */
export const PT_TO_MM100 = 2540 / 72

/** A native shape the LOK engine can build on a real slide (geometry in 1/100 mm). */
export interface SlideShapeSpec {
  kind: 'rect' | 'ellipse' | 'text' | 'line'
  /** Top-left, frame-relative, in 1/100 mm. */
  x: number
  y: number
  /** Size in 1/100 mm.  For a line, (w,h) is the end point delta from (x,y). */
  w: number
  h: number
  /** Text content (text shapes; also drawn inside a rect/ellipse if present). */
  text?: string
  /** Fill colour as 0xRRGGBB, or omitted / -1 for no fill. */
  fill?: number
  /** Stroke colour as 0xRRGGBB, or omitted for the shape default. */
  stroke?: number
  /** Font size in points (text shapes). */
  fontSize?: number
}

/** One shape that could NOT be mapped natively — the handler renders it as a picture. */
export interface ImageFallbackSpec {
  /** The tldraw shape id, so the caller can rasterise exactly that shape. */
  id: string
  /** Why it fell back (diagnostics / reporting). */
  reason: string
}

export interface SlideSpec {
  /** Slide size in 1/100 mm (the frame's own bounds). */
  slideW: number
  slideH: number
  /** Ordered native shapes (frame child z-order preserved). */
  shapes: SlideShapeSpec[]
  /** Shapes that must be dropped as pictures instead. */
  imageFallback: ImageFallbackSpec[]
}

// tldraw's named palette → 0xRRGGBB. Mirrors tldraw's default light theme so a
// blue rect on the canvas stays visibly blue on the slide.
const TLDRAW_COLORS: Record<string, number> = {
  black: 0x1d1d1d,
  grey: 0x9fa8b2,
  'light-violet': 0xe085f4,
  violet: 0xae3ec9,
  blue: 0x4465e9,
  'light-blue': 0x4ba1f1,
  yellow: 0xf1ac4b,
  orange: 0xe16919,
  green: 0x099268,
  'light-green': 0x4cb05e,
  'light-red': 0xf87777,
  red: 0xe03131,
  white: 0xffffff,
}

function colorOf(name: unknown, fallback: number): number {
  if (typeof name === 'string' && name in TLDRAW_COLORS) return TLDRAW_COLORS[name]
  return fallback
}

// The minimal structural surface of the tldraw editor this module needs. Keeping
// it local (rather than importing tldraw types) is what makes the module pure and
// trivially stubbable in the unit test.
export interface FrameSource {
  getShape(id: string): TlShape | undefined
  getSortedChildIdsForParent(id: string): string[]
}

export interface TlShape {
  id: string
  type: string
  x: number
  y: number
  props?: Record<string, unknown>
}

/** Extract the plain-text string from a tldraw shape's props (text or richText). */
function textOf(props: Record<string, unknown> | undefined): string {
  if (!props) return ''
  if (typeof props.text === 'string') return props.text
  // tldraw@5 text/geo shapes carry richText (a ProseMirror doc). Flatten its
  // text leaves — enough to round-trip the words onto the slide.
  const rich = props.richText as { content?: unknown } | undefined
  if (rich && Array.isArray(rich.content)) {
    const out: string[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as { type?: string; text?: string; content?: unknown[] }
      if (n.type === 'text' && typeof n.text === 'string') out.push(n.text)
      if (Array.isArray(n.content)) n.content.forEach(walk)
    }
    rich.content.forEach(walk)
    return out.join(' ').trim()
  }
  return ''
}

/**
 * Map ONE tldraw child shape (frame-relative) to a native spec, or return a
 * fallback marker. `ox`/`oy` are the frame's page-space origin (subtracted so the
 * result is frame-relative).
 */
function mapShape(s: TlShape, ox: number, oy: number): SlideShapeSpec | ImageFallbackSpec {
  const props = s.props ?? {}
  const x = Math.round((s.x - ox) * PT_TO_MM100)
  const y = Math.round((s.y - oy) * PT_TO_MM100)
  const w = Math.round((Number(props.w) || 0) * PT_TO_MM100)
  const h = Math.round((Number(props.h) || 0) * PT_TO_MM100)

  if (s.type === 'geo') {
    const geo = props.geo
    const fill = props.fill === 'none' ? -1 : colorOf(props.color, 0x4465e9)
    const stroke = colorOf(props.color, 0x1d1d1d)
    const text = textOf(props)
    if (geo === 'rectangle') return { kind: 'rect', x, y, w, h, fill, stroke, text: text || undefined }
    if (geo === 'ellipse' || geo === 'oval') return { kind: 'ellipse', x, y, w, h, fill, stroke, text: text || undefined }
    // Other geo kinds (triangle, diamond, star, cloud…) have no 1:1 native
    // rectangle/ellipse — fall back to a picture rather than misrepresent them.
    return { id: s.id, reason: `unsupported geo "${String(geo)}"` }
  }

  if (s.type === 'text') {
    const size = typeof props.size === 'string' ? FONT_PT[props.size] ?? 18 : 18
    return { kind: 'text', x, y, w, h, text: textOf(props), fontSize: size, fill: colorOf(props.color, 0x1d1d1d) }
  }

  if (s.type === 'line') {
    // A tldraw line's geometry lives in props.points (a map of {x,y}); take the
    // bounding delta so the native LineShape spans the same extent. Frame-relative
    // origin is the shape's own (x,y); (w,h) is the end delta.
    const pts = Object.values((props.points as Record<string, { x: number; y: number }>) ?? {})
    if (pts.length >= 2) {
      const xs = pts.map((p) => p.x)
      const ys = pts.map((p) => p.y)
      const dw = Math.round((Math.max(...xs) - Math.min(...xs)) * PT_TO_MM100)
      const dh = Math.round((Math.max(...ys) - Math.min(...ys)) * PT_TO_MM100)
      return { kind: 'line', x, y, w: dw || 1, h: dh || 1, stroke: colorOf(props.color, 0x1d1d1d) }
    }
    return { id: s.id, reason: 'degenerate line' }
  }

  // draw, arrow, image, frame, embed, note, highlight, group, … → picture.
  return { id: s.id, reason: `unsupported type "${s.type}"` }
}

// tldraw text-size token → points.
const FONT_PT: Record<string, number> = { s: 14, m: 18, l: 24, xl: 36 }

function isFallback(x: SlideShapeSpec | ImageFallbackSpec): x is ImageFallbackSpec {
  return (x as ImageFallbackSpec).reason !== undefined
}

/**
 * Translate a frame into a SlideSpec: ordered native shapes + an image-fallback
 * list. Pure — drives `editor` only through {@link FrameSource}. An empty/absent
 * frame yields an empty spec (no shapes, no fallback).
 */
export function frameToSlideSpec(editor: FrameSource, frameId: string): SlideSpec {
  const frame = editor.getShape(frameId)
  const fw = Number(frame?.props?.w) || 0
  const fh = Number(frame?.props?.h) || 0
  const ox = frame?.x ?? 0
  const oy = frame?.y ?? 0

  const spec: SlideSpec = {
    slideW: Math.round(fw * PT_TO_MM100),
    slideH: Math.round(fh * PT_TO_MM100),
    shapes: [],
    imageFallback: [],
  }
  if (!frame) return spec

  for (const childId of editor.getSortedChildIdsForParent(frameId)) {
    const child = editor.getShape(childId)
    if (!child) continue
    const mapped = mapShape(child, ox, oy)
    if (isFallback(mapped)) spec.imageFallback.push(mapped)
    else spec.shapes.push(mapped)
  }
  return spec
}

/**
 * Serialise a SlideSpec's native shapes into the line-delimited payload the
 * WosBuildSlide macro reads from /tmp/wos-slide-in.txt. Line 1 = "slideW|slideH";
 * then one line per shape = "kind|x|y|w|h|fill|stroke|fontSize|text". Colours are
 * decimal 0xRRGGBB (or -1); text is last so it may contain any non-newline char.
 * Kept next to the mapping so the payload contract lives in one place.
 */
export function encodeSlidePayload(spec: SlideSpec): string {
  const esc = (t: string): string => t.replace(/[\r\n|]/g, ' ')
  const lines = [`${spec.slideW}|${spec.slideH}`]
  for (const s of spec.shapes) {
    lines.push(
      [
        s.kind,
        s.x,
        s.y,
        s.w,
        s.h,
        s.fill ?? -1,
        s.stroke ?? -1,
        s.fontSize ?? 0,
        esc(s.text ?? ''),
      ].join('|'),
    )
  }
  return lines.join('\n') + '\n'
}
