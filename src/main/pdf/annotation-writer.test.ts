import { describe, it, expect } from 'vitest'
import { PDFDocument, PDFName, rgb } from 'pdf-lib'
/** Read one annotation's entry from a saved page. Assertions go through the
 *  reloaded object graph, never a raw-byte grep: pdf-lib writes object streams
 *  with Flate compression, so the text simply is not there to find. */
function annotValue(doc: PDFDocument, page: number, index: number, key: string): string {
  const annots = doc.getPages()[page - 1].node.Annots()
  if (!annots) return ''
  const dict = annots.lookup(index) as { get(k: PDFName): unknown }
  return String(dict.get(PDFName.of(key)) ?? '')
}

import {
  quadPointsFor, writeAnnotations, reorderPages, rotatePage, mergePdfs,
  readFormFields, fillFormFields, stampImage,
} from './annotation-writer'

/** A real multi-page PDF to operate on — these tests exercise pdf-lib for real,
 *  not a mock, because the failure modes we care about are in the output file. */
async function makePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([600, 800])
    p.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 24, color: rgb(0, 0, 0) })
  }
  return doc.save()
}

describe('quadPointsFor', () => {
  it('emits the spec order: top edge then bottom edge', () => {
    // Acrobat is strict here; a "clockwise" ordering renders bow-ties or nothing.
    expect(quadPointsFor({ x: 10, y: 20, w: 100, h: 12 })).toEqual([
      10, 32, 110, 32, // top-left, top-right
      10, 20, 110, 20, // bottom-left, bottom-right
    ])
  })
})

describe('writeAnnotations', () => {
  it('adds a highlight the document actually carries', async () => {
    const out = await writeAnnotations(await makePdf(), [{
      kind: 'highlight', page: 1, color: '#ffd400',
      quads: [{ x: 50, y: 690, w: 120, h: 20 }],
    }])
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPages()[0].node.Annots()?.size()).toBe(1)
    expect(annotValue(reloaded, 1, 0, 'Subtype')).toBe('/Highlight')
    // Multiply blending keeps the text legible under the colour.
    expect(annotValue(reloaded, 1, 0, 'BM')).toBe('/Multiply')
  })

  it('writes a Text (sticky note) annotation with its contents', async () => {
    const out = await writeAnnotations(await makePdf(), [{
      kind: 'note', page: 2, color: '#ff0000', x: 100, y: 500, text: 'check this clause',
    }])
    const reloaded = await PDFDocument.load(out)
    // Comment text must be a PDF STRING; writing it as a name mangles anything
    // with a space in it.
    expect(annotValue(reloaded, 2, 0, 'Contents')).toContain('check this clause')
    expect(reloaded.getPages()[1].node.Annots()?.size()).toBe(1)
    expect(reloaded.getPages()[0].node.Annots()?.size() ?? 0).toBe(0) // page 1 untouched
  })

  it('writes an ink annotation from strokes', async () => {
    const out = await writeAnnotations(await makePdf(), [{
      kind: 'ink', page: 1, color: '#0000ff', width: 3,
      strokes: [[{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 40, y: 20 }]],
    }])
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPages()[0].node.Annots()?.size()).toBe(1)
    expect(annotValue(reloaded, 1, 0, 'Subtype')).toBe('/Ink')
  })

  it('SKIPS an annotation for a page that no longer exists rather than failing the save', async () => {
    // A sidecar can outlive a page deletion; losing one mark beats refusing to save.
    const out = await writeAnnotations(await makePdf(2), [
      { kind: 'highlight', page: 99, color: '#ffd400', quads: [{ x: 1, y: 1, w: 5, h: 5 }] },
      { kind: 'highlight', page: 1, color: '#ffd400', quads: [{ x: 1, y: 1, w: 5, h: 5 }] },
    ])
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPages()[0].node.Annots()?.size()).toBe(1)
  })

  it('ignores degenerate ink (a single point is not a stroke)', async () => {
    const out = await writeAnnotations(await makePdf(), [{
      kind: 'ink', page: 1, color: '#000000', strokes: [[{ x: 5, y: 5 }]],
    }])
    const reloaded = await PDFDocument.load(out)
    // pdf-lib materialises an EMPTY /Annots array rather than omitting it, so
    // assert on size — "no annotations" is size 0, not an absent key.
    expect(reloaded.getPages()[0].node.Annots()?.size() ?? 0).toBe(0)
  })

  it('leaves the original page content intact — only annotations are added', async () => {
    const before = await makePdf(1)
    const out = await writeAnnotations(before, [{
      kind: 'highlight', page: 1, color: '#ffd400', quads: [{ x: 50, y: 690, w: 120, h: 20 }],
    }])
    // The page's own content must survive untouched: that is the whole point for
    // a signed document. Same page count, same size, plus exactly one annotation.
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
    expect(reloaded.getPages()[0].getSize()).toEqual({ width: 600, height: 800 })
    expect(reloaded.getPages()[0].node.Annots()?.size()).toBe(1)
  })
})

describe('page operations', () => {
  it('reorders pages', async () => {
    const out = await reorderPages(await makePdf(3), [3, 1, 2])
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3)
  })

  it('deletes a page by omitting it', async () => {
    const out = await reorderPages(await makePdf(3), [1, 3])
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2)
  })

  it('ignores out-of-range page numbers', async () => {
    const out = await reorderPages(await makePdf(2), [1, 5, 2])
    expect((await PDFDocument.load(out)).getPageCount()).toBe(2)
  })

  it('refuses to remove every page', async () => {
    await expect(reorderPages(await makePdf(2), [])).rejects.toThrow(/every page/i)
    await expect(reorderPages(await makePdf(2), [9])).rejects.toThrow(/every page/i)
  })

  it('rotates a page relative to its current rotation, normalised', async () => {
    let out = await rotatePage(await makePdf(1), 1, 90)
    expect((await PDFDocument.load(out)).getPages()[0].getRotation().angle).toBe(90)
    out = await rotatePage(out, 1, 270)
    expect((await PDFDocument.load(out)).getPages()[0].getRotation().angle).toBe(0)
    // Negative deltas normalise rather than going out of range.
    out = await rotatePage(out, 1, -90)
    expect((await PDFDocument.load(out)).getPages()[0].getRotation().angle).toBe(270)
  })

  it('rejects a rotation that is not a quarter turn', async () => {
    // PDF only defines quarter turns; silently rounding someone's 45 would be worse.
    await expect(rotatePage(await makePdf(1), 1, 45)).rejects.toThrow(/multiple of 90/i)
  })

  it('rejects rotating a page that does not exist', async () => {
    await expect(rotatePage(await makePdf(1), 7, 90)).rejects.toThrow(/No such page/)
  })

  it('merges two documents', async () => {
    const out = await mergePdfs(await makePdf(2), await makePdf(3))
    expect((await PDFDocument.load(out)).getPageCount()).toBe(5)
  })
})

describe('signature stamp', () => {
  it('draws a PNG onto the page', async () => {
    // 1x1 transparent PNG.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    )
    const out = await stampImage(await makePdf(1), new Uint8Array(png), 1, { x: 100, y: 100, w: 120, h: 40 })
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1)
  })

  it('rejects an unknown page', async () => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
    await expect(stampImage(await makePdf(1), new Uint8Array(png), 4, { x: 0, y: 0, w: 1, h: 1 })).rejects.toThrow(/No such page/)
  })
})

describe('form fields', () => {
  async function makeForm(): Promise<Uint8Array> {
    const doc = await PDFDocument.create()
    const page = doc.addPage([600, 800])
    const form = doc.getForm()
    const name = form.createTextField('applicant.name')
    name.setText('')
    name.addToPage(page, { x: 50, y: 700, width: 200, height: 20 })
    const agree = form.createCheckBox('agree')
    agree.addToPage(page, { x: 50, y: 650, width: 15, height: 15 })
    return doc.save()
  }

  it('reads the fields with their types', async () => {
    const fields = await readFormFields(await makeForm())
    expect(fields.map((f) => f.name).sort()).toEqual(['agree', 'applicant.name'])
    expect(fields.find((f) => f.name === 'agree')?.type).toBe('checkbox')
  })

  it('returns [] for a document with no form instead of throwing', async () => {
    expect(await readFormFields(await makePdf(1))).toEqual([])
  })

  it('fills text and checks a box', async () => {
    const out = await fillFormFields(await makeForm(), { 'applicant.name': 'Ada Lovelace', agree: 'on' })
    const fields = await readFormFields(out)
    expect(fields.find((f) => f.name === 'applicant.name')?.value).toBe('Ada Lovelace')
    expect(fields.find((f) => f.name === 'agree')?.value).toBe('on')
  })

  it('unchecks with an empty value', async () => {
    const checked = await fillFormFields(await makeForm(), { agree: 'on' })
    const out = await fillFormFields(checked, { agree: '' })
    expect((await readFormFields(out)).find((f) => f.name === 'agree')?.value).toBe('')
  })

  it('SKIPS an unknown field rather than dropping the whole fill', async () => {
    const out = await fillFormFields(await makeForm(), { nope: 'x', 'applicant.name': 'Kept' })
    expect((await readFormFields(out)).find((f) => f.name === 'applicant.name')?.value).toBe('Kept')
  })
})
