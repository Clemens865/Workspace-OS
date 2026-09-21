import JSZip from 'jszip'
import {
  SLIDE_W,
  SLIDE_H,
  contentTypesXml,
  ROOT_RELS,
  presentationXml,
  presentationRels,
  THEME1,
  SLIDE_MASTER,
  SLIDE_MASTER_RELS,
  SLIDE_LAYOUT,
  SLIDE_LAYOUT_RELS,
} from './pptx-scaffold'

/**
 * Engine-free .pptx builder — the "frame→slide bridge v1". Each input image
 * becomes one slide holding that image as a single full-bleed picture; the deck
 * is a real, minimal OOXML package the LibreOffice/PowerPoint engine opens
 * without repair. This is the ONE-WAY, IMAGE-BASED half of the canvas→deck
 * bridge: native-shape translation and live-sync are DEFERRED.
 *
 * A .pptx is a zip of XML + media. We generate the whole scaffold in memory
 * (see pptx-scaffold.ts for the static parts): `[Content_Types].xml`,
 * `_rels/.rels`, `ppt/presentation.xml` (+ rels listing every slide), one blank
 * `slideMaster` + `slideLayout`, a `theme1.xml`, then per image a
 * `ppt/media/imageN.png`, a `ppt/slides/slideN.xml` (full-bleed `<p:pic>`
 * referencing that media via its own `slideN.xml.rels`).
 *
 * Pure & deterministic: no I/O, no engine — unit-testable in plain node. The
 * caller (canvas:export-pptx IPC) is responsible for the atomic temp→rename
 * write to disk.
 */

export interface PptxImage {
  /** PNG bytes for one slide's full-bleed picture. */
  png: Buffer | Uint8Array
  /** Optional slide title (used only for the shape Name — no visible text). */
  title?: string
}

export interface BuildPptxOptions {
  /** When true (default), a 0-image call yields a valid 1-blank-slide deck. */
  blankWhenEmpty?: boolean
}

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 1×1 transparent PNG — the placeholder picture for a blank/empty slide. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * One `ppt/slides/slideN.xml`: a single full-bleed picture filling the slide.
 * The picture references the media through rId1 in its own rels part.
 */
function slideXml(index: number, title: string | undefined): string {
  const name = title ? escapeXml(title) : `Slide ${index}`
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    '<p:cSld><p:spTree>' +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>' +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:pic>' +
    '<p:nvPicPr>' +
    `<p:cNvPr id="2" name="${name}"/>` +
    '<p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr>' +
    '<p:nvPr/>' +
    '</p:nvPicPr>' +
    '<p:blipFill><a:blip r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>' +
    '<p:spPr>' +
    `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${SLIDE_W}" cy="${SLIDE_H}"/></a:xfrm>` +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    '</p:spPr>' +
    '</p:pic>' +
    '</p:spTree></p:cSld>' +
    '<p:clrMapOvr><a:overrideClrMapping bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr>' +
    '</p:sld>'
  )
}

/** `ppt/slides/_rels/slideN.xml.rels` — the picture's media + the layout. */
function slideRels(index: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" ' +
    `Target="../media/image${index}.png"/>` +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" ' +
    'Target="../slideLayouts/slideLayout1.xml"/>' +
    '</Relationships>'
  )
}

/**
 * Builds a valid `.pptx` deck from ordered PNG images (one slide per image,
 * full-bleed). Returns the zipped bytes. A 0-image call yields a 1-blank-slide
 * deck by default (opts.blankWhenEmpty), so the output is always a valid,
 * openable presentation. Throws only on genuinely malformed input.
 */
export async function buildPptxFromImages(
  images: PptxImage[],
  opts: BuildPptxOptions = {},
): Promise<Buffer> {
  if (!Array.isArray(images)) throw new Error('images must be an array')
  const blankWhenEmpty = opts.blankWhenEmpty !== false

  // Normalise: empty → one blank placeholder slide (unless disabled).
  let slides: PptxImage[] = images
  if (slides.length === 0) {
    if (!blankWhenEmpty) throw new Error('no images (blankWhenEmpty=false)')
    slides = [{ png: BLANK_PNG, title: 'Blank' }]
  }

  for (const s of slides) {
    if (!s || (!Buffer.isBuffer(s.png) && !(s.png instanceof Uint8Array))) {
      throw new Error('each image must carry a png Buffer/Uint8Array')
    }
  }

  const n = slides.length
  const zip = new JSZip()

  // ---- package-level parts ----
  zip.file('[Content_Types].xml', contentTypesXml(n))
  zip.file('_rels/.rels', ROOT_RELS)

  // ---- presentation + its rels ----
  zip.file('ppt/presentation.xml', presentationXml(n))
  zip.file('ppt/_rels/presentation.xml.rels', presentationRels(n))

  // ---- theme, one blank master + layout ----
  zip.file('ppt/theme/theme1.xml', THEME1)
  zip.file('ppt/slideMasters/slideMaster1.xml', SLIDE_MASTER)
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', SLIDE_MASTER_RELS)
  zip.file('ppt/slideLayouts/slideLayout1.xml', SLIDE_LAYOUT)
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', SLIDE_LAYOUT_RELS)

  // ---- one media + slide + slide-rels per image ----
  for (let i = 0; i < n; i++) {
    const idx = i + 1
    zip.file(`ppt/media/image${idx}.png`, slides[i].png)
    zip.file(`ppt/slides/slide${idx}.xml`, slideXml(idx, slides[i].title))
    zip.file(`ppt/slides/_rels/slide${idx}.xml.rels`, slideRels(idx))
  }

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
