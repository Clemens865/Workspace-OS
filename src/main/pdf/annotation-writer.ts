import { PDFDocument, degrees, PDFName, PDFString } from 'pdf-lib'

/**
 * Writes annotations into a PDF as REAL PDF objects, and performs page
 * operations.
 *
 * Why real annotations rather than painting shapes onto the page content: markup
 * that only exists in our sidecar is invisible the moment the file is opened in
 * Preview, Acrobat or a browser — which is where a contract actually gets read.
 * A /Highlight with /QuadPoints is understood everywhere, stays selectable and
 * editable, and leaves the original page content byte-untouched. That last part
 * is the whole point for a signed document.
 *
 * Coordinates arriving here are already in PDF user space (bottom-left origin) —
 * see src/renderer/src/lib/pdfAnnotations.ts, which owns that conversion.
 */

export interface PdfRect { x: number; y: number; w: number; h: number }

export interface WriteAnnotation {
  kind: 'highlight' | 'note' | 'ink'
  /** 1-based page number, as the user sees it. */
  page: number
  color: string
  text?: string
  quads?: PdfRect[]
  x?: number
  y?: number
  strokes?: { x: number; y: number }[][]
  width?: number
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 1, g: 0.83, b: 0 }
  const n = parseInt(m[1], 16)
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/**
 * QuadPoints order is the one detail readers disagree about. The spec's ordering
 * is x1 y1 x2 y2 (top edge, left→right) then x3 y3 x4 y4 (bottom edge) — i.e.
 * top-left, top-right, bottom-left, bottom-right. Acrobat is strict about it;
 * emit them in the "obvious" clockwise order and highlights render as bow-ties
 * or vanish entirely.
 */
export function quadPointsFor(rect: PdfRect): number[] {
  const { x, y, w, h } = rect
  const top = y + h
  return [x, top, x + w, top, x, y, x + w, y]
}

/**
 * Burn a set of annotations into `bytes`, returning the new PDF.
 *
 * Annotations for pages that do not exist are skipped rather than throwing: a
 * sidecar can outlive a page deletion, and losing one mark is better than
 * refusing to save the document.
 */
export async function writeAnnotations(bytes: Uint8Array, annotations: readonly WriteAnnotation[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const pages = doc.getPages()

  for (const a of annotations) {
    const page = pages[a.page - 1]
    if (!page) continue
    const c = hexToRgb(a.color)

    if (a.kind === 'highlight' && a.quads?.length) {
      for (const q of a.quads) {
        // A /Highlight annotation with Multiply blending: the text stays legible
        // underneath, exactly as a real highlighter behaves. Drawing an opaque
        // rectangle instead would hide the words it is meant to emphasise.
        const annot = doc.context.obj({
          Type: 'Annot',
          Subtype: 'Highlight',
          Rect: [q.x, q.y, q.x + q.w, q.y + q.h],
          QuadPoints: quadPointsFor(q),
          C: [c.r, c.g, c.b],
          CA: 0.4,
          BM: 'Multiply',
          F: 4, // Print
          ...(a.text ? { Contents: PDFString.of(a.text) } : {}),
        })
        addAnnot(doc, page, annot)
      }
      continue
    }

    if (a.kind === 'note' && typeof a.x === 'number' && typeof a.y === 'number') {
      const size = 18
      const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Text', // the sticky-note annotation every reader shows as an icon
        Rect: [a.x, a.y - size, a.x + size, a.y],
        Name: 'Comment',
        C: [c.r, c.g, c.b],
        F: 4,
        Contents: PDFString.of(a.text ?? ''),
        T: PDFString.of('Workspace OS'),
      })
      addAnnot(doc, page, annot)
      continue
    }

    if (a.kind === 'ink' && a.strokes?.length) {
      const flat = a.strokes.filter((s) => s.length > 1)
      if (flat.length === 0) continue
      const xs = flat.flatMap((s) => s.map((p) => p.x))
      const ys = flat.flatMap((s) => s.map((p) => p.y))
      const pad = (a.width ?? 2) + 1
      const annot = doc.context.obj({
        Type: 'Annot',
        Subtype: 'Ink',
        Rect: [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad],
        InkList: flat.map((s) => s.flatMap((p) => [p.x, p.y])),
        C: [c.r, c.g, c.b],
        BS: doc.context.obj({ W: a.width ?? 2 }),
        F: 4,
        ...(a.text ? { Contents: PDFString.of(a.text) } : {}),
      })
      addAnnot(doc, page, annot)
    }
  }

  return doc.save()
}

/** Append to the page's /Annots, creating the array when the page has none. */
function addAnnot(doc: PDFDocument, page: ReturnType<PDFDocument['getPages']>[number], annot: unknown): void {
  const ref = doc.context.register(annot as never)
  const existing = page.node.Annots()
  if (existing) existing.push(ref)
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]) as never)
}

// ── Page operations ──────────────────────────────────────────────────────────

/**
 * Reorder / delete pages. `order` is 1-based page numbers in the wanted order;
 * omitting a page deletes it. Built by COPYING into a fresh document rather than
 * mutating in place, because pdf-lib's in-place removal leaves shared resources
 * dangling on some files.
 */
export async function reorderPages(bytes: Uint8Array, order: readonly number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes)
  const count = src.getPageCount()
  const wanted = order.filter((n) => Number.isInteger(n) && n >= 1 && n <= count)
  if (wanted.length === 0) throw new Error('That would remove every page')
  const out = await PDFDocument.create()
  const copied = await out.copyPages(src, wanted.map((n) => n - 1))
  for (const p of copied) out.addPage(p)
  return out.save()
}

/** Rotate one page by a multiple of 90°, relative to its current rotation. */
export async function rotatePage(bytes: Uint8Array, page: number, delta: number): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const p = doc.getPages()[page - 1]
  if (!p) throw new Error('No such page')
  // PDF only defines page rotation in quarter turns, and pdf-lib enforces it —
  // reject rather than silently rounding someone's 45° into something else.
  if (delta % 90 !== 0) throw new Error('Rotation must be a multiple of 90°')
  const next = (((p.getRotation().angle + delta) % 360) + 360) % 360
  p.setRotation(degrees(next))
  return doc.save()
}

/** Append every page of `other` to `bytes`. */
export async function mergePdfs(bytes: Uint8Array, other: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const src = await PDFDocument.load(other)
  const copied = await doc.copyPages(src, src.getPageIndices())
  for (const p of copied) doc.addPage(p)
  return doc.save()
}

// ── Signature / stamp ────────────────────────────────────────────────────────

/**
 * Stamp a PNG signature image onto a page.
 *
 * This is a signature APPEARANCE, not a cryptographic signature: there is no
 * certificate, no trust chain and no timestamp, so it cannot be validated the way
 * a qualified signature can. That is usually fine for day-to-day countersigning
 * and is what most people mean by "sign the PDF" — but the distinction is real
 * and the UI must not imply otherwise.
 */
export async function stampImage(
  bytes: Uint8Array,
  png: Uint8Array,
  page: number,
  rect: PdfRect,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const p = doc.getPages()[page - 1]
  if (!p) throw new Error('No such page')
  const img = await doc.embedPng(png)
  p.drawImage(img, { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
  return doc.save()
}

// ── Form fields ──────────────────────────────────────────────────────────────

export interface FormField {
  name: string
  type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'other'
  value: string
  options?: string[]
}

/** Read the document's AcroForm fields, or [] when it has no form. */
export async function readFormFields(bytes: Uint8Array): Promise<FormField[]> {
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  return form.getFields().map((f) => {
    const name = f.getName()
    const ctor = f.constructor.name
    if (ctor === 'PDFTextField') {
      return { name, type: 'text' as const, value: (f as never as { getText(): string | undefined }).getText() ?? '' }
    }
    if (ctor === 'PDFCheckBox') {
      return { name, type: 'checkbox' as const, value: (f as never as { isChecked(): boolean }).isChecked() ? 'on' : '' }
    }
    if (ctor === 'PDFDropdown') {
      const d = f as never as { getSelected(): string[]; getOptions(): string[] }
      return { name, type: 'dropdown' as const, value: d.getSelected()[0] ?? '', options: d.getOptions() }
    }
    if (ctor === 'PDFRadioGroup') {
      const r = f as never as { getSelected(): string | undefined; getOptions(): string[] }
      return { name, type: 'radio' as const, value: r.getSelected() ?? '', options: r.getOptions() }
    }
    return { name, type: 'other' as const, value: '' }
  })
}

/**
 * Fill form fields by name. Unknown names are skipped rather than throwing — a
 * form can change between reading and filling, and dropping one value beats
 * refusing to save the rest.
 */
export async function fillFormFields(bytes: Uint8Array, values: Record<string, string>): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes)
  const form = doc.getForm()
  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getField(name)
      const ctor = field.constructor.name
      if (ctor === 'PDFTextField') (field as never as { setText(v: string): void }).setText(value)
      else if (ctor === 'PDFCheckBox') {
        const cb = field as never as { check(): void; uncheck(): void }
        if (value && value !== 'off') cb.check()
        else cb.uncheck()
      } else if (ctor === 'PDFDropdown') (field as never as { select(v: string): void }).select(value)
      else if (ctor === 'PDFRadioGroup') (field as never as { select(v: string): void }).select(value)
    } catch {
      // Unknown field, or a value the field rejects (e.g. an option that no
      // longer exists) — skip it and keep the rest of the fill.
    }
  }
  return doc.save()
}
