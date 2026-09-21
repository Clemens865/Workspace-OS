import { describe, it, expect } from 'vitest'
import { actionsFor, type ActionContext } from './fileActions'

const baseCtx: Omit<ActionContext, 'category'> = {
  filePath: '',
  isDirty: false,
  isStarred: false,
  refresh: () => {},
  closeFile: () => {},
  toggleStar: () => {},
}

const idsFor = (filePath: string): string[] =>
  actionsFor(filePath, { ...baseCtx, filePath }).map((i) => i.action.id)

describe('actionsFor', () => {
  it('offers universal actions for every file', () => {
    for (const id of ['star', 'copy-path', 'reveal', 'duplicate', 'trash']) {
      expect(idsFor('any.png')).toContain(id)
    }
  })

  it('offers Export as PDF only for office documents', () => {
    expect(idsFor('report.docx')).toContain('export-pdf')
    expect(idsFor('budget.xlsx')).toContain('export-pdf')
    expect(idsFor('notes.md')).not.toContain('export-pdf')
    expect(idsFor('photo.png')).not.toContain('export-pdf')
  })

  it('offers Print only for printable types', () => {
    expect(idsFor('report.docx')).toContain('print')
    expect(idsFor('notes.md')).toContain('print')
    expect(idsFor('photo.png')).not.toContain('print')
    expect(idsFor('clip.mp4')).not.toContain('print')
  })

  it('star label reflects current state', () => {
    const starred = actionsFor('a.png', { ...baseCtx, filePath: 'a.png', isStarred: true })
    const star = starred.find((i) => i.action.id === 'star')!
    expect(star.action.label(star.ctx)).toBe('Unstar')

    const notStarred = actionsFor('a.png', { ...baseCtx, filePath: 'a.png', isStarred: false })
    const star2 = notStarred.find((i) => i.action.id === 'star')!
    expect(star2.action.label(star2.ctx)).toBe('Star')
  })

  it('binds the resolved category into each action context', () => {
    const items = actionsFor('report.docx', { ...baseCtx, filePath: 'report.docx' })
    expect(items[0].ctx.category).toBe('document')
  })
})
