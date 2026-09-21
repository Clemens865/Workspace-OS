import { describe, it, expect } from 'vitest'
import { categoryOf, EDITABLE, PRINTABLE, OFFICE } from './fileCategory'

describe('categoryOf', () => {
  it('classifies office documents', () => {
    expect(categoryOf('a/b/report.docx')).toBe('document')
    expect(categoryOf('budget.xlsx')).toBe('spreadsheet')
    expect(categoryOf('deck.pptx')).toBe('presentation')
    expect(categoryOf('contract.pdf')).toBe('pdf')
  })

  it('classifies media and images', () => {
    expect(categoryOf('photo.PNG')).toBe('image')
    expect(categoryOf('clip.mp4')).toBe('video')
    expect(categoryOf('song.mp3')).toBe('audio')
  })

  it('classifies code, data, and text', () => {
    expect(categoryOf('main.ts')).toBe('code')
    expect(categoryOf('config.json')).toBe('data')
    expect(categoryOf('notes.md')).toBe('text')
  })

  it('falls back to unknown for unrecognized extensions', () => {
    expect(categoryOf('archive.zip')).toBe('unknown')
    expect(categoryOf('noext')).toBe('unknown')
  })
})

describe('capability sets', () => {
  it('OFFICE is editable-via-engine but not plain-text editable', () => {
    expect(OFFICE.has('document')).toBe(true)
    expect(OFFICE.has('image')).toBe(false)
    expect(EDITABLE.has('document')).toBe(false)
  })

  it('EDITABLE covers code/text/data', () => {
    expect(EDITABLE.has('code')).toBe(true)
    expect(EDITABLE.has('text')).toBe(true)
    expect(EDITABLE.has('data')).toBe(true)
  })

  it('PRINTABLE excludes media/images', () => {
    expect(PRINTABLE.has('pdf')).toBe(true)
    expect(PRINTABLE.has('document')).toBe(true)
    expect(PRINTABLE.has('image')).toBe(false)
    expect(PRINTABLE.has('video')).toBe(false)
  })
})
