import { describe, it, expect } from 'vitest'
import {
  breadcrumbs,
  canGoBack,
  canGoForward,
  EMPTY_FILTER,
  extensionOf,
  filterEntries,
  formatModified,
  formatSize,
  goBack,
  goForward,
  isFilterActive,
  kindOf,
  navigate,
  newHistory,
  currentPath,
  sortEntries,
  isViewMode,
  columnChain,
  isThumbnailable,
} from './fileBrowserModel'
import type { FileEntry } from '../../types/fs'

const DAY = 86_400_000
const NOW = new Date('2026-08-10T15:00:00Z').getTime()

function f(name: string, over: Partial<FileEntry> = {}): FileEntry {
  return { name, path: `/w/${name}`, isDirectory: false, size: 100, mtimeMs: NOW, ...over }
}
const dir = (name: string, over: Partial<FileEntry> = {}): FileEntry => f(name, { isDirectory: true, ...over })

describe('kind', () => {
  it('buckets the formats an office user actually has', () => {
    expect(kindOf(f('Report.docx'))).toBe('document')
    expect(kindOf(f('Budget.xlsx'))).toBe('spreadsheet')
    expect(kindOf(f('Deck.pptx'))).toBe('presentation')
    expect(kindOf(f('Scan.pdf'))).toBe('pdf')
    expect(kindOf(f('photo.HEIC'))).toBe('image')
    expect(kindOf(f('notes.md'))).toBe('text')
    expect(kindOf(f('archive.zip'))).toBe('other')
    expect(kindOf(dir('Invoices'))).toBe('folder')
  })

  it('treats a leading dot as a dotfile, not an extension', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(kindOf(f('.gitignore'))).toBe('other')
  })

  it('is case-insensitive about the extension', () => {
    expect(kindOf(f('LETTER.DOCX'))).toBe('document')
  })
})

describe('sorting', () => {
  it('keeps folders first even when the sort is reversed', () => {
    // Interleaving folders by size or date scatters the structure of the folder
    // through the list, and reversing should not push them to the bottom.
    const entries = [f('b.txt', { size: 9000 }), dir('Zed'), f('a.txt', { size: 10 })]
    for (const dirn of ['asc', 'desc'] as const) {
      for (const key of ['name', 'size', 'modified', 'kind'] as const) {
        expect(sortEntries(entries, key, dirn)[0].name).toBe('Zed')
      }
    }
  })

  it('sorts by name naturally, so 10 comes after 9', () => {
    const names = sortEntries([f('item10.txt'), f('item9.txt'), f('item1.txt')], 'name', 'asc').map((e) => e.name)
    expect(names).toEqual(['item1.txt', 'item9.txt', 'item10.txt'])
  })

  it('sorts by size, largest first when descending', () => {
    const entries = [f('small', { size: 10 }), f('big', { size: 9999 }), f('mid', { size: 500 })]
    expect(sortEntries(entries, 'size', 'desc').map((e) => e.name)).toEqual(['big', 'mid', 'small'])
  })

  it('sorts by modified date', () => {
    const entries = [
      f('old', { mtimeMs: NOW - 10 * DAY }),
      f('new', { mtimeMs: NOW }),
      f('mid', { mtimeMs: NOW - DAY }),
    ]
    expect(sortEntries(entries, 'modified', 'desc').map((e) => e.name)).toEqual(['new', 'mid', 'old'])
  })

  it('falls back to name when the key ties', () => {
    // Copied folders give every file the same mtime — without a tiebreaker the
    // order would be whatever the filesystem happened to return.
    const entries = [f('c', { mtimeMs: NOW }), f('a', { mtimeMs: NOW }), f('b', { mtimeMs: NOW })]
    expect(sortEntries(entries, 'modified', 'asc').map((e) => e.name)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    const entries = [f('b'), f('a')]
    sortEntries(entries, 'name', 'asc')
    expect(entries.map((e) => e.name)).toEqual(['b', 'a'])
  })

  it('treats a missing size or mtime as zero rather than throwing', () => {
    const entries = [f('known', { size: 5 }), f('unknown', { size: undefined })]
    expect(() => sortEntries(entries, 'size', 'asc')).not.toThrow()
    expect(sortEntries(entries, 'size', 'asc')[0].name).toBe('unknown')
  })
})

describe('filtering', () => {
  const listing = [
    dir('Invoices'),
    dir('Photos'),
    f('Report.docx', { mtimeMs: NOW }),
    f('Budget.xlsx', { mtimeMs: NOW - 60 * DAY }),
    f('holiday.jpg', { mtimeMs: NOW - 2 * DAY }),
  ]

  it('matches a name substring, case-insensitively', () => {
    const out = filterEntries(listing, { ...EMPTY_FILTER, text: 'repo' }, NOW)
    expect(out.map((e) => e.name)).toEqual(['Report.docx'])
  })

  it('filters by kind', () => {
    const out = filterEntries(listing, { ...EMPTY_FILTER, kinds: ['spreadsheet'] }, NOW)
    expect(out.map((e) => e.name)).toEqual(['Invoices', 'Photos', 'Budget.xlsx'])
  })

  it('filters by age', () => {
    const out = filterEntries(listing, { ...EMPTY_FILTER, withinDays: 7 }, NOW)
    expect(out.map((e) => e.name)).not.toContain('Budget.xlsx')
    expect(out.map((e) => e.name)).toContain('Report.docx')
  })

  it('KEEPS folders under a kind or age filter — they are the route to a match', () => {
    // Filtering the folders away leaves the user unable to reach a match that
    // lives one level down, which makes the filter worse than no filter.
    const out = filterEntries(listing, { ...EMPTY_FILTER, kinds: ['image'], withinDays: 1 }, NOW)
    expect(out.map((e) => e.name)).toEqual(['Invoices', 'Photos'])
  })

  it('still applies the NAME filter to folders', () => {
    const out = filterEntries(listing, { ...EMPTY_FILTER, text: 'photo' }, NOW)
    expect(out.map((e) => e.name)).toEqual(['Photos'])
  })

  it('an empty filter keeps everything', () => {
    expect(filterEntries(listing, EMPTY_FILTER, NOW)).toHaveLength(listing.length)
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, text: '  ' })).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, kinds: ['pdf'] })).toBe(true)
  })
})

describe('formatting', () => {
  it('shows sizes people can read', () => {
    expect(formatSize(f('a', { size: 512 }))).toBe('512 B')
    expect(formatSize(f('a', { size: 1024 }))).toBe('1.0 KB')
    expect(formatSize(f('a', { size: 1536 }))).toBe('1.5 KB')
    expect(formatSize(f('a', { size: 20 * 1024 * 1024 }))).toBe('20 MB')
  })

  it('shows a dash for folders and unknown sizes', () => {
    expect(formatSize(dir('x'))).toBe('—')
    expect(formatSize(f('a', { size: undefined }))).toBe('—')
  })

  it('shows a time for today and a date for older files', () => {
    const today = formatModified(f('a', { mtimeMs: NOW }), NOW)
    const old = formatModified(f('a', { mtimeMs: NOW - 400 * DAY }), NOW)
    expect(today).not.toBe('—')
    expect(old).toMatch(/2025|2026/)
    expect(old).not.toBe(today)
  })

  it('shows a dash when there is no timestamp', () => {
    expect(formatModified(f('a', { mtimeMs: undefined }), NOW)).toBe('—')
  })
})

describe('breadcrumbs', () => {
  it('walks from the workspace root down to the folder', () => {
    expect(breadcrumbs('/Users/me/Workspace', '/Users/me/Workspace/Clients/Acme')).toEqual([
      { label: 'Workspace', path: '/Users/me/Workspace' },
      { label: 'Clients', path: '/Users/me/Workspace/Clients' },
      { label: 'Acme', path: '/Users/me/Workspace/Clients/Acme' },
    ])
  })

  it('is just the root when that is where you are', () => {
    expect(breadcrumbs('/w', '/w')).toEqual([{ label: 'w', path: '/w' }])
  })

  it('does not walk outside the root', () => {
    expect(breadcrumbs('/w', '/somewhere/else')).toEqual([{ label: 'w', path: '/w' }])
  })
})

describe('back / forward', () => {
  it('moves through visited folders', () => {
    let h = newHistory('/w')
    h = navigate(h, '/w/a')
    h = navigate(h, '/w/a/b')
    expect(currentPath(h)).toBe('/w/a/b')
    h = goBack(h)
    expect(currentPath(h)).toBe('/w/a')
    h = goForward(h)
    expect(currentPath(h)).toBe('/w/a/b')
  })

  it('discards the forward entries once you branch — the browser rule', () => {
    // Keeping them would offer a "forward" to a place already branched away from.
    let h = newHistory('/w')
    h = navigate(h, '/w/a')
    h = goBack(h)
    h = navigate(h, '/w/other')
    expect(canGoForward(h)).toBe(false)
    expect(h.stack).toEqual(['/w', '/w/other'])
  })

  it('re-entering the same folder is not a move', () => {
    let h = newHistory('/w')
    h = navigate(h, '/w')
    expect(h.stack).toEqual(['/w'])
    expect(canGoBack(h)).toBe(false)
  })

  it('cannot go back past the start or forward past the end', () => {
    let h = newHistory('/w')
    expect(canGoBack(h)).toBe(false)
    expect(currentPath(goBack(h))).toBe('/w')
    h = navigate(h, '/w/a')
    expect(canGoForward(h)).toBe(false)
    expect(currentPath(goForward(h))).toBe('/w/a')
  })
})

describe('view modes', () => {
  it('accepts the four modes and rejects anything else', () => {
    for (const m of ['list', 'icon', 'gallery', 'column']) expect(isViewMode(m)).toBe(true)
    // A persisted value from an older build, or a corrupted one, must not be
    // trusted into the switch — it would render nothing at all.
    for (const m of ['', 'tiles', null, 7, undefined]) expect(isViewMode(m)).toBe(false)
  })
})

describe('column chain', () => {
  it('lists each folder from the root down to where you are', () => {
    expect(columnChain('/w', '/w/Clients/Acme')).toEqual(['/w', '/w/Clients', '/w/Clients/Acme'])
  })

  it('is just the root at the root', () => {
    expect(columnChain('/w', '/w')).toEqual(['/w'])
  })

  it('refuses a path outside the root rather than rendering someone else’s folders', () => {
    expect(columnChain('/w', '/etc/passwd')).toEqual(['/w'])
    // A prefix match is not a path match: /w2 is not inside /w.
    expect(columnChain('/w', '/w2/Clients')).toEqual(['/w'])
  })

  it('has nothing to show before the root resolves', () => {
    expect(columnChain('', '/w/a')).toEqual([])
  })
})

describe('thumbnails', () => {
  it('offers a real preview only for formats the renderer can decode', () => {
    for (const n of ['a.png', 'b.JPG', 'c.webp', 'd.svg']) expect(isThumbnailable(f(n))).toBe(true)
    for (const n of ['a.docx', 'b.pdf', 'c.zip']) expect(isThumbnailable(f(n))).toBe(false)
  })

  it('never treats a folder as previewable', () => {
    expect(isThumbnailable(dir('Photos'))).toBe(false)
  })
})
