import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildPptxFromImages } from './pptx-from-images'

/** A tiny real 1×1 PNG so each slide references genuine media bytes. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function open(buf: Buffer): Promise<JSZip> {
  return JSZip.loadAsync(buf)
}

const names = (zip: JSZip): string[] => Object.keys(zip.files)

describe('buildPptxFromImages', () => {
  it('builds a valid 3-slide deck: 3 slides, 3 media, presentation lists 3, rels + content-types present', async () => {
    const buf = await buildPptxFromImages([
      { png: PNG, title: 'One' },
      { png: PNG, title: 'Two' },
      { png: PNG, title: 'Three' },
    ])
    const zip = await open(buf)
    const parts = names(zip)

    // Exactly 3 slide parts.
    const slides = parts.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    expect(slides.sort()).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide3.xml',
    ])

    // Exactly 3 media PNGs.
    const media = parts.filter((p) => /^ppt\/media\/image\d+\.png$/.test(p))
    expect(media.length).toBe(3)

    // Every slide has its own rels part.
    for (let i = 1; i <= 3; i++) {
      expect(parts).toContain(`ppt/slides/_rels/slide${i}.xml.rels`)
    }

    // Content-types + root rels + presentation rels present.
    expect(parts).toContain('[Content_Types].xml')
    expect(parts).toContain('_rels/.rels')
    expect(parts).toContain('ppt/_rels/presentation.xml.rels')

    // presentation.xml lists exactly 3 slide ids.
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect((pres.match(/<p:sldId\b/g) || []).length).toBe(3)

    // content-types has an Override per slide.
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    for (let i = 1; i <= 3; i++) {
      expect(ct).toContain(`/ppt/slides/slide${i}.xml`)
    }

    // Each slide references its media through rId1 in its rels.
    const rel1 = await zip.file('ppt/slides/_rels/slide1.xml.rels')!.async('string')
    expect(rel1).toContain('../media/image1.png')
    const s1 = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(s1).toContain('r:embed="rId1"')
    expect(s1).toContain('name="One"') // title lands on the picture shape name
  })

  it('a 0-image call yields a valid 1-blank-slide deck by default', async () => {
    const buf = await buildPptxFromImages([])
    const zip = await open(buf)
    const slides = names(zip).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    expect(slides).toEqual(['ppt/slides/slide1.xml'])
    const pres = await zip.file('ppt/presentation.xml')!.async('string')
    expect((pres.match(/<p:sldId\b/g) || []).length).toBe(1)
  })

  it('errors cleanly when blankWhenEmpty=false and no images given', async () => {
    await expect(buildPptxFromImages([], { blankWhenEmpty: false })).rejects.toThrow()
  })

  it('rejects an image without png bytes', async () => {
    // @ts-expect-error deliberately malformed
    await expect(buildPptxFromImages([{ title: 'x' }])).rejects.toThrow()
  })
})
