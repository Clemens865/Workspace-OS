import { describe, it, expect } from 'vitest'
import path from 'path'
import { safeFilename, resolveSavePath, uniqueName } from './attachments'

/**
 * An attachment filename is chosen by whoever sent the mail. These tests are
 * weighted almost entirely toward hostile input, because the failure mode is
 * not a bad filename — it is writing outside the folder the user picked.
 */

describe('safeFilename — traversal', () => {
  it('strips POSIX traversal', () => {
    expect(safeFilename('../../../../etc/passwd')).toBe('passwd')
    expect(safeFilename('/etc/passwd')).toBe('passwd')
  })

  it('strips WINDOWS traversal, which POSIX basename() ignores', () => {
    // The subtle one: path.posix.basename('..\\..\\x') returns the whole string
    // unchanged, so a backslash payload sails through a naive guard.
    expect(safeFilename('..\\..\\..\\Windows\\System32\\evil.dll')).toBe('evil.dll')
    expect(safeFilename('C:\\Users\\me\\secret.txt')).toBe('secret.txt')
  })

  it('refuses the bare traversal names', () => {
    expect(safeFilename('..')).toBe('attachment')
    expect(safeFilename('.')).toBe('attachment')
    expect(safeFilename('../..')).toBe('attachment')
  })

  it('does not leave a leading dot, which hides the file', () => {
    expect(safeFilename('.bashrc')).toBe('bashrc')
    expect(safeFilename('...hidden')).toBe('hidden')
  })

  it('strips shell- and filesystem-significant characters', () => {
    expect(safeFilename('re|port*.pdf')).toBe('report.pdf')
    expect(safeFilename('a:b?c"d.txt')).toBe('abcd.txt')
  })

  it('strips control characters', () => {
    expect(safeFilename('evil\u0000.pdf')).toBe('evil.pdf')
    expect(safeFilename('a\nb.txt')).toBe('ab.txt')
  })

  it('falls back rather than returning an empty name', () => {
    expect(safeFilename('')).toBe('attachment')
    expect(safeFilename('   ')).toBe('attachment')
    expect(safeFilename('///')).toBe('attachment')
    expect(safeFilename('<<<>>>')).toBe('attachment')
  })

  it('keeps an ordinary filename intact', () => {
    expect(safeFilename('Q3 Report.pdf')).toBe('Q3 Report.pdf')
    expect(safeFilename('Angebot_2026-08.xlsx')).toBe('Angebot_2026-08.xlsx')
    expect(safeFilename('Übersicht.docx')).toBe('Übersicht.docx')
  })

  it('bounds an absurd length while keeping the extension', () => {
    const long = 'a'.repeat(5000) + '.pdf'
    const out = safeFilename(long)
    expect(out.length).toBeLessThanOrEqual(200)
    expect(out.endsWith('.pdf')).toBe(true)
  })
})

describe('resolveSavePath', () => {
  const dir = path.resolve('/tmp/wos-att')

  it('resolves inside the chosen directory', () => {
    expect(resolveSavePath(dir, 'report.pdf')).toBe(path.join(dir, 'report.pdf'))
  })

  it('never escapes, whatever the filename claims', () => {
    for (const evil of ['../escape.txt', '../../escape.txt', '/etc/passwd', '..\\..\\escape.txt']) {
      const out = resolveSavePath(dir, evil)
      expect(out).not.toBeNull()
      expect(out!.startsWith(dir + path.sep)).toBe(true)
      expect(out).not.toContain('..')
    }
  })

  it('produces a direct child, never a nested path', () => {
    const out = resolveSavePath(dir, 'sub/dir/file.txt')
    expect(out).toBe(path.join(dir, 'file.txt'))
  })
})

describe('uniqueName', () => {
  it('returns the name when nothing collides', () => {
    expect(uniqueName('a.pdf', () => false)).toBe('a.pdf')
  })

  it('suffixes rather than overwriting an existing file', () => {
    // Saving two attachments called "invoice.pdf" must not destroy the first.
    const taken = new Set(['invoice.pdf'])
    expect(uniqueName('invoice.pdf', (c) => taken.has(c))).toBe('invoice (2).pdf')
  })

  it('keeps counting past the first collision', () => {
    const taken = new Set(['a.pdf', 'a (2).pdf', 'a (3).pdf'])
    expect(uniqueName('a.pdf', (c) => taken.has(c))).toBe('a (4).pdf')
  })

  it('handles a name with no extension', () => {
    const taken = new Set(['README'])
    expect(uniqueName('README', (c) => taken.has(c))).toBe('README (2)')
  })
})
