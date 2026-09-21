import { describe, it, expect } from 'vitest'
import { isAsset, applyEvent, labelFor, baseOf, MAX_ASSETS, type CreatedAsset } from './createdAssets'

const ROOT = '/Users/x/ws'
const p = (rel: string): string => `${ROOT}/${rel}`
const T = 1_800_000_000_000

describe('what is worth announcing', () => {
  it('announces documents a person would open', () => {
    for (const f of ['cv.docx', 'cover-letter.pdf', 'data.xlsx', 'notes.md', 'deck.pptx', 'chart.png']) {
      expect(isAsset(p(f)), f).toBe(true)
    }
  })

  it('ignores the app\'s own bookkeeping', () => {
    // .workspace-os is where this app leaves agent-context.json and
    // current-page.md — announcing our own files as the user's new assets
    // would be both wrong and constant.
    expect(isAsset(p('.workspace-os/agent-context.json'))).toBe(false)
    expect(isAsset(p('.workspace-os/current-page.md'))).toBe(false)
  })

  it('ignores dotfiles and anything inside a dot-directory', () => {
    expect(isAsset(p('.env'))).toBe(false)
    expect(isAsset(p('.git/COMMIT_EDITMSG'))).toBe(false)
  })

  it('ignores the temporaries that exist only mid-save', () => {
    // Word and LibreOffice leave these beside the real file; browsers leave
    // .crdownload. They appear, live a moment, and vanish.
    for (const f of ['~$cv.docx', '.~lock.cv.docx#', 'report.pdf.crdownload', 'x.md.tmp', 'a.txt.swp']) {
      expect(isAsset(p(f)), f).toBe(false)
    }
  })

  it('ignores code and config, which are not assets a person opens from a cockpit', () => {
    for (const f of ['index.ts', 'package.json', 'a.lock', 'x.log']) {
      expect(isAsset(p(f)), f).toBe(false)
    }
  })
})

describe('folding watcher events', () => {
  it('adds a newly created asset', () => {
    const out = applyEvent([], 'add', p('cv.docx'), T)
    expect(out.map((a) => a.path)).toEqual([p('cv.docx')])
  })

  it('does NOT treat an edit as a creation', () => {
    // Editing a document you have had for a year does not make it new; if it
    // did, the list would fill with whatever you are working on.
    expect(applyEvent([], 'change', p('cv.docx'), T)).toHaveLength(0)
  })

  it('puts the newest first', () => {
    let l: CreatedAsset[] = []
    l = applyEvent(l, 'add', p('a.pdf'), T)
    l = applyEvent(l, 'add', p('b.pdf'), T + 1000)
    expect(l.map((a) => baseOf(a.path))).toEqual(['b.pdf', 'a.pdf'])
  })

  it('moves a re-created file to the front rather than listing it twice', () => {
    // Several tools write a file by replacing it outright.
    let l: CreatedAsset[] = []
    l = applyEvent(l, 'add', p('cv.docx'), T)
    l = applyEvent(l, 'add', p('letter.pdf'), T + 1)
    l = applyEvent(l, 'add', p('cv.docx'), T + 2)
    expect(l).toHaveLength(2)
    expect(baseOf(l[0].path)).toBe('cv.docx')
  })

  it('removes a file that is deleted again', () => {
    // A save-via-temp-file looks exactly like create-then-delete, and a link to
    // a file that no longer exists is worse than no link.
    let l = applyEvent([], 'add', p('cv.docx'), T)
    l = applyEvent(l, 'unlink', p('cv.docx'), T + 500)
    expect(l).toHaveLength(0)
  })

  it('keeps the list short', () => {
    let l: CreatedAsset[] = []
    for (let i = 0; i < MAX_ASSETS + 5; i++) l = applyEvent(l, 'add', p(`f${i}.pdf`), T + i)
    expect(l).toHaveLength(MAX_ASSETS)
    expect(baseOf(l[0].path)).toBe(`f${MAX_ASSETS + 4}.pdf`)
  })

  it('returns the SAME array when nothing changed', () => {
    // Identity matters: the watcher is chatty, and a new array on every
    // irrelevant event would re-render the cockpit constantly.
    const l = applyEvent([], 'add', p('cv.docx'), T)
    expect(applyEvent(l, 'change', p('cv.docx'), T + 1)).toBe(l)
    expect(applyEvent(l, 'add', p('index.ts'), T + 2)).toBe(l)
    expect(applyEvent(l, 'unlink', p('never-listed.pdf'), T + 3)).toBe(l)
  })
})

describe('labels', () => {
  it('keeps the folder, so two CVs are tellable apart', () => {
    // The case that actually matters: applications/revolut/cv.docx and
    // applications/acme/cv.docx are both "cv.docx", and a list of identical
    // labels is a list you cannot use.
    expect(labelFor(p('applications/revolut/cv.docx'))).toBe('revolut/cv.docx')
    expect(labelFor(p('applications/acme/cv.docx'))).toBe('acme/cv.docx')
  })

  it('works for a file sitting at the workspace root', () => {
    expect(labelFor(p('cv.docx'))).toBe('ws/cv.docx')
  })

  it('does not fall over on a bare filename', () => {
    expect(labelFor('cv.docx')).toBe('cv.docx')
  })
})
