import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { cleanTitle, fileNameOf, parsePage, renderPage, type WikiPage } from './wiki-page'
import { parseIngest, pickPages } from './wiki-ingest'
import { check, changes, ingest, readPages, sources, undo, wikiDir } from './wiki-store'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-wiki-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

/** A model that answers with these pages, and remembers what it was asked. */
function model(pages: unknown[]): { run: (p: string) => Promise<string>; asked: string[] } {
  const asked: string[] = []
  return { asked, run: async (p) => (asked.push(p), JSON.stringify({ pages })) }
}
const page = (title: string): string => fs.readFileSync(path.join(wikiDir(root), fileNameOf(title)), 'utf8')
const NORTHWIND = {
  title: 'Northwind',
  type: 'organization',
  summary: 'Logistics company that offered Clara a product role.',
  body: 'Northwind is a logistics company in Hamburg. Contact: [[Anna Berg]], head of product.\n\nOffer: 120k salary, start 1 March.',
}

describe('wiki pages', () => {
  it('round-trip through their file, and a hand-written note still reads as a page', () => {
    const p: WikiPage = { title: 'Anna Berg', type: 'person', summary: 'Head of product: "the" contact', updated: '2026-10-05', sources: ['Work/Offer letter.docx'], body: 'Leads product at [[Northwind]].' }
    const text = renderPage(p)
    expect(text).toContain('# Anna Berg')
    expect(text).toContain('- [Offer letter.docx](<../Work/Offer letter.docx>)')
    expect(parsePage(text, 'whatever')).toEqual(p)
    const hand = parsePage('Just some lines about [[Northwind]].\n', 'My note')
    expect(hand).toMatchObject({ title: 'My note', type: 'topic', sources: [], body: 'Just some lines about [[Northwind]].' })
  })

  it('titles become file names that cannot leave the Wiki folder', () => {
    for (const t of ['../../etc/passwd', 'a/b\\c:d', '...hidden', 'x'.repeat(200)]) {
      const name = fileNameOf(t)
      expect(name).not.toMatch(/[/\\]/)
      expect(name.startsWith('.')).toBe(false)
      expect(path.dirname(path.join(root, 'Wiki', name))).toBe(path.join(root, 'Wiki'))
    }
    expect(cleanTitle('[[Northwind]]#x|y')).toBe('Northwind x y')
  })
})

describe('reading a model answer', () => {
  it('keeps real pages and drops junk, secrets, repeats and a model-written Sources list', () => {
    const drafts = parseIngest(
      'Here you go: ' +
        JSON.stringify({
          pages: [
            { title: 'Northwind', type: 'company', summary: 'x', body: '# Northwind\nA logistics firm in Hamburg.\nPassword: hunter2hunter2\n\n## Sources\n- nope' },
            { title: 'northwind', body: 'duplicate title, dropped entirely' },
            { title: '', body: 'no title' },
            { title: 'Tiny', body: 'short' },
            { title: 'Anna Berg', add: 'Moved to Berlin in May.' },
            'not a page',
          ],
        }),
    )
    expect(drafts).toEqual([
      { title: 'Northwind', type: 'topic', summary: 'x', body: 'A logistics firm in Hamburg.' },
      { title: 'Anna Berg', add: 'Moved to Berlin in May.' },
    ])
    expect(parseIngest('no json at all')).toEqual([])
    expect(parseIngest('{"pages": "nope"}')).toEqual([])
  })

  it('shows the model the pages a source names first', () => {
    const mk = (title: string, summary = ''): WikiPage => ({ title, type: 'topic', summary, updated: '', sources: [], body: '' })
    const picked = pickPages([mk('Northwind'), mk('Contoso', 'remote work offer'), mk('Garden')], 'Northwind wrote again. Northwind wants an answer about the remote offer.')
    expect(picked.map((p) => p.title)).toEqual(['Northwind', 'Contoso'])
  })

  it('also shows the pages that the pages a source names link to', () => {
    const mk = (title: string, body = ''): WikiPage => ({ title, type: 'topic', summary: '', updated: '', sources: [], body })
    const all = [mk('Anna Berg', 'Sent the [[Northwind offer]].'), mk('Northwind offer', 'Salary 120k.'), mk('Garden')]
    // The follow-up names only Anna; the offer it changes is one link away.
    expect(pickPages(all, 'Anna Berg: das Gehalt steigt auf 128k.').map((p) => p.title)).toEqual(['Anna Berg', 'Northwind offer'])
  })
})

describe('adding a file to the wiki', () => {
  it('writes linked pages, an index, and remembers the source', async () => {
    const m = model([NORTHWIND, { title: 'Anna Berg', type: 'person', summary: 'Head of product at Northwind.', body: 'Head of product at [[Northwind]]; sent the offer.' }])
    const r = await ingest(root, 'Work/Offer.docx', 'Offer letter from Northwind…', 111, m.run)
    expect(r.change?.created).toEqual(['Northwind', 'Anna Berg'])
    expect(m.asked[0]).toContain('<<<SOURCE\nOffer letter from Northwind…\nSOURCE>>>')
    expect(page('Northwind')).toContain('Offer: 120k salary, start 1 March.')
    expect(page('Northwind')).toContain('- [Offer.docx](<../Work/Offer.docx>)')
    const index = fs.readFileSync(path.join(wikiDir(root), 'Index.md'), 'utf8')
    expect(index).toContain('## People\n\n- [[Anna Berg]] — Head of product at Northwind.')
    expect(index).toContain('## Organizations\n\n- [[Northwind]] — Logistics company')
    expect(sources(root)['Work/Offer.docx']).toMatchObject({ mtimeMs: 111, pages: ['Northwind', 'Anna Berg'] })
    expect(check(root)).toMatchObject({ pages: 2, unlinked: [], wanted: [], changed: [], missing: ['Work/Offer.docx'] })
  })

  it('rewrites a page it was shown, and only adds to a page it was not', async () => {
    await ingest(root, 'a.md', 'Northwind', 1, model([NORTHWIND, { title: 'Garden', type: 'topic', summary: 'Garden plans.', body: 'Plant tomatoes in April, beans in May.' }]).run)
    const m = model([
      { title: 'Northwind', type: 'organization', summary: 'Logistics company; offer raised.', body: NORTHWIND.body.replace('120k salary, start 1 March', '128k salary (raised from 120k), start 1 March') },
      { title: 'Garden', type: 'topic', summary: 'replaced?', body: 'Only this new paragraph.' },
    ])
    const r = await ingest(root, 'b.md', 'Northwind raised the offer to 128k.', 2, m.run)
    expect(m.asked[0]).toContain('=== Northwind (organization) ===') // shown in full
    expect(m.asked[0]).toContain('- Garden — topic — Garden plans.') // only listed
    expect(r.change?.updated).toEqual(['Northwind', 'Garden'])
    expect(page('Northwind')).toContain('128k salary (raised from 120k)')
    expect(page('Northwind')).not.toContain('Offer: 120k salary')
    expect(readPages(root).get('northwind')?.page.sources).toEqual(['a.md', 'b.md'])
    // Not shown, so not rewritten: the new text is added to what was there.
    expect(page('Garden')).toContain('Plant tomatoes in April, beans in May.\n\nOnly this new paragraph.')
    expect(page('Garden')).toContain('summary: "Garden plans."')
  })

  it('refuses a rewrite that would drop most of a page, and an addition to a page that does not exist', async () => {
    const long = { ...NORTHWIND, body: `${NORTHWIND.body}\n\n${'History of the company and its routes. '.repeat(20)}` }
    await ingest(root, 'a.md', 'Northwind', 1, model([long]).run)
    const r = await ingest(root, 'b.md', 'Northwind', 2, model([{ ...NORTHWIND, body: 'Northwind is a company.' }, { title: 'Nobody', add: 'Some new paragraph here.' }]).run)
    expect(r.change?.kept.map((k) => k.title)).toEqual(['Northwind', 'Nobody'])
    expect(page('Northwind')).toContain('History of the company')
    expect(fs.existsSync(path.join(wikiDir(root), 'Nobody.md'))).toBe(false)
  })

  it('leaves a page the person edits while the model reads', async () => {
    await ingest(root, 'a.md', 'Northwind', 1, model([NORTHWIND]).run)
    const file = path.join(wikiDir(root), 'Northwind.md')
    const r = await ingest(root, 'b.md', 'Northwind', 2, async () => {
      fs.appendFileSync(file, '\nMy own note.\n')
      return JSON.stringify({ pages: [{ ...NORTHWIND, body: `${NORTHWIND.body}\nMore.` }] })
    })
    expect(r.change?.kept).toEqual([{ title: 'Northwind', why: 'it was edited while the source was being read' }])
    expect(page('Northwind')).toContain('My own note.')
  })

  it('changes nothing when a file read again says nothing new', async () => {
    await ingest(root, 'a.md', 'Northwind', 1, model([NORTHWIND]).run)
    const r = await ingest(root, 'a.md', 'Northwind', 2, model([NORTHWIND]).run)
    expect(r.change).toBeNull()
    expect(changes(root)).toHaveLength(1)
  })

  it('records a source with nothing worth a page, so it is not read again', async () => {
    const r = await ingest(root, 'chatter.md', 'hello', 5, model([]).run)
    expect(r.change).toBeNull()
    expect(sources(root)['chatter.md']).toMatchObject({ mtimeMs: 5, pages: [] })
    expect(fs.existsSync(path.join(wikiDir(root), 'Index.md'))).toBe(false)
  })
})

describe('undo and the check', () => {
  it('undo restores updated pages, removes created ones, and leaves pages edited since', async () => {
    await ingest(root, 'a.md', 'Northwind', 1, model([NORTHWIND]).run)
    const first = page('Northwind')
    await ingest(root, 'b.md', 'Northwind and Anna Berg', 2, model([{ ...NORTHWIND, body: `${NORTHWIND.body}\nRaised to 128k.` }, { title: 'Anna Berg', type: 'person', summary: 'Contact.', body: 'Head of product at [[Northwind]].' }]).run)
    const [latest] = changes(root)
    expect(latest.source).toBe('b.md')
    const u = undo(root, latest.id)
    expect(u).toEqual({ ok: true, restored: ['Northwind', 'Anna Berg'], left: [] })
    expect(page('Northwind')).toBe(first)
    expect(fs.existsSync(path.join(wikiDir(root), 'Anna Berg.md'))).toBe(false)
    expect(sources(root)['b.md']).toBeUndefined() // can be added again
    expect(fs.readFileSync(path.join(wikiDir(root), 'Index.md'), 'utf8')).not.toContain('Anna Berg')

    const [again] = changes(root)
    fs.appendFileSync(path.join(wikiDir(root), 'Northwind.md'), 'mine\n')
    expect(undo(root, again.id)).toEqual({ ok: true, restored: [], left: ['Northwind'] })
    expect(page('Northwind')).toContain('mine')
    expect(undo(root, 'no-such-change').ok).toBe(false)
  })

  it('names changed and missing sources, lone pages, and pages linked to but not written', async () => {
    fs.writeFileSync(path.join(root, 'a.md'), 'x')
    const mtime = fs.statSync(path.join(root, 'a.md')).mtimeMs
    await ingest(root, 'a.md', 'x', mtime, model([NORTHWIND, { title: 'Garden', type: 'topic', summary: '', body: 'Tomatoes, see [[Seed list]] and [[Anna Berg]].' }]).run)
    expect(check(root)).toMatchObject({ changed: [], missing: [], unlinked: ['Garden', 'Northwind'], wanted: [{ title: 'Anna Berg', refs: 2 }, { title: 'Seed list', refs: 1 }] })
    fs.utimesSync(path.join(root, 'a.md'), new Date(), new Date(Date.now() + 60_000))
    expect(check(root).changed).toEqual(['a.md'])
  })
})
