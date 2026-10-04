import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import JSZip from 'jszip'
import { SearchIndex, askTerms } from './index-db'
import { extractText, locate, slideText } from './extract'

/** An agent's questions against the workspace (knowledge.search / knowledge.read). */
describe('knowledge: asking the workspace', () => {
  let dir: string
  let index: SearchIndex

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-know-'))
    index = new SearchIndex(path.join(dir, 'index.db'))
  })
  afterEach(() => {
    index.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const put = (p: string, ext: string, content: string): void => index.upsert({ path: p, name: path.basename(p), ext, mtimeMs: 1, content })

  it('a question finds files that share any of its words, best fit first', () => {
    put('/ws/offer.pdf', 'pdf', '[Page 1]\nIntro.\n[Page 2]\nNorthwind offers a salary of 120k plus bonus.')
    put('/ws/notes.md', 'md', 'Northwind interview on Friday.')
    put('/ws/other.md', 'md', 'Nothing related here.')
    const hits = index.ask('What salary did Northwind offer?', 8, ['/ws'])
    expect(hits.map((h) => h.path)).toEqual(['/ws/offer.pdf', '/ws/notes.md'])
    expect(hits[0].location).toBe('Page 2')
    expect(hits[0].snippet).toContain('«salary»')
  })

  it('a question in German drops its filler words', () => {
    expect(askTerms('Was hat Northwind für ein Gehalt angeboten?')).toEqual(['northwind', 'gehalt', 'angeboten'])
    expect(askTerms('what is the?')).toEqual([])
    expect(index.ask('what is the?')).toEqual([])
  })

  it('stays in the open workspace', () => {
    put('/other/x.md', 'md', 'budget budget')
    put('/ws/y.md', 'md', 'budget')
    expect(index.ask('budget', 8, ['/ws']).map((h) => h.path)).toEqual(['/ws/y.md'])
  })

  it('reads back a file’s indexed text with the mtime it was read at', () => {
    put('/ws/a.docx', 'docx', 'Hello')
    expect(index.text('/ws/a.docx')).toEqual({ content: 'Hello', mtimeMs: 1 })
    expect(index.text('/ws/none.docx')).toBeNull()
  })

  it('office files indexed by an older extractor are read again', () => {
    put('/ws/a.pdf', 'pdf', 'old text')
    put('/ws/b.md', 'md', 'note')
    index.close()
    const db = new Database(path.join(dir, 'index.db'))
    db.prepare("UPDATE meta SET value = '1' WHERE key = 'extract_version'").run()
    db.close()
    index = new SearchIndex(path.join(dir, 'index.db'))
    expect(index.getMtime('/ws/a.pdf')).toBe(-1)
    expect(index.getMtime('/ws/b.md')).toBe(1)
  })
})

describe('extract: where in the file', () => {
  it('names the page, slide or sheet before the match', () => {
    const t = '[Sheet: Summary]\nTotal\t10\n[Sheet: Budget]\nOps\t42'
    expect(locate(t, ['ops'])).toBe('Sheet: Budget')
    expect(locate(t, ['total'])).toBe('Sheet: Summary')
    expect(locate('no marks here', ['marks'])).toBeNull()
    expect(locate(t, ['absent'])).toBeNull()
  })

  it('the part that holds most of the question, not the first mention', () => {
    const t = '[Page 1]\nNorthwind offer letter\n[Page 2]\nNorthwind offers a salary of 128000.'
    expect(locate(t, ['salary', 'northwind'])).toBe('Page 2')
  })

  it('a slide’s text: one line per paragraph, entities decoded', () => {
    const xml = '<p:sld><a:p><a:r><a:t>Q3 &amp; Q4</a:t></a:r><a:r><a:t> plan</a:t></a:r></a:p><a:p><a:r><a:t>Ops &lt;3</a:t></a:r></a:p></p:sld>'
    expect(slideText(xml)).toBe('Q3 & Q4 plan\nOps <3')
  })

  it('a .pptx reads slide by slide, in order', async () => {
    const zip = new JSZip()
    const slide = (t: string): string => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`
    zip.file('ppt/slides/slide10.xml', slide('Ten'))
    zip.file('ppt/slides/slide2.xml', slide('Two'))
    zip.file('ppt/slides/slide1.xml', slide('One'))
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-pptx-')), 'deck.pptx')
    fs.writeFileSync(f, await zip.generateAsync({ type: 'nodebuffer' }))
    expect(await extractText(f)).toBe('[Slide 1]\nOne\n[Slide 2]\nTwo\n[Slide 10]\nTen')
    fs.rmSync(path.dirname(f), { recursive: true, force: true })
  })
})
