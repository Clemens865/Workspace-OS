import { describe, it, expect } from 'vitest'
import { buildFolderTree, detectDelimiter, flattenTree, sortFolders } from './folder-tree'

const f = (path: string, over: Partial<{ name: string; specialUse: string }> = {}) => ({
  path,
  name: over.name ?? path.split(/[/.\\]/).pop()!,
  specialUse: over.specialUse,
  selectable: true,
})

describe('detectDelimiter', () => {
  it('detects "/" (Gmail-style)', () => {
    expect(detectDelimiter([f('INBOX'), f('INBOX/Sub'), f('INBOX/Sub/Deep')])).toBe('/')
  })

  it('detects "." (Dovecot-style)', () => {
    // Assuming "/" here would flatten the whole tree into an unsorted pile.
    expect(detectDelimiter([f('INBOX'), f('INBOX.Sub'), f('INBOX.Sub.Deep')])).toBe('.')
  })

  it('detects "\\\\" (Exchange-style)', () => {
    expect(detectDelimiter([f('INBOX'), f('INBOX\\Sub'), f('INBOX\\Sub\\Deep')])).toBe('\\')
  })

  it('falls back harmlessly when nothing nests', () => {
    expect(detectDelimiter([f('INBOX'), f('Sent')])).toBe('/')
  })
})

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const roots = buildFolderTree([f('INBOX'), f('INBOX/Projects'), f('INBOX/Projects/2026')])
    expect(roots).toHaveLength(1)
    expect(roots[0].children[0].label).toBe('Projects')
    expect(roots[0].children[0].children[0].label).toBe('2026')
  })

  it('labels a node with its last segment, not the whole path', () => {
    const roots = buildFolderTree([f('INBOX/Projects/2026')])
    const deep = roots[0].children[0].children[0]
    expect(deep.label).toBe('2026')
    expect(deep.path).toBe('INBOX/Projects/2026')
  })

  it('SYNTHESISES a missing intermediate instead of dropping the subtree', () => {
    // Servers really do report A/B/C with no A/B. A builder that only attaches
    // to existing parents loses the whole branch silently.
    const roots = buildFolderTree([f('A/B/C')])
    expect(roots).toHaveLength(1)
    expect(roots[0].path).toBe('A')
    expect(roots[0].synthetic).toBe(true)
    expect(roots[0].children[0].path).toBe('A/B')
    expect(roots[0].children[0].children[0].path).toBe('A/B/C')
    expect(roots[0].children[0].children[0].synthetic).toBe(false)
  })

  it('upgrades a synthesised placeholder when the real folder arrives later', () => {
    // Input order must not decide what counts as a real folder.
    const roots = buildFolderTree([f('A/B'), f('A', { specialUse: '\\Archive' })])
    expect(roots[0].synthetic).toBe(false)
    expect(roots[0].specialUse).toBe('\\Archive')
  })

  it('records depth for indentation', () => {
    const roots = buildFolderTree([f('A/B/C')])
    expect(roots[0].depth).toBe(0)
    expect(roots[0].children[0].depth).toBe(1)
    expect(roots[0].children[0].children[0].depth).toBe(2)
  })

  it('handles a flat mailbox', () => {
    const roots = buildFolderTree([f('INBOX'), f('Sent'), f('Trash')])
    expect(roots.map((r) => r.path)).toEqual(['INBOX', 'Sent', 'Trash'])
  })

  it('handles an empty list', () => {
    expect(buildFolderTree([])).toEqual([])
  })
})

describe('flattenTree', () => {
  const roots = buildFolderTree([f('INBOX'), f('INBOX/A'), f('INBOX/A/B'), f('Sent')])

  it('returns every node when nothing is collapsed', () => {
    expect(flattenTree(roots, new Set()).map((n) => n.path)).toEqual([
      'INBOX', 'INBOX/A', 'INBOX/A/B', 'Sent',
    ])
  })

  it('hides descendants of a collapsed node', () => {
    expect(flattenTree(roots, new Set(['INBOX/A'])).map((n) => n.path)).toEqual([
      'INBOX', 'INBOX/A', 'Sent',
    ])
  })

  it('hides a whole subtree when the root is collapsed', () => {
    expect(flattenTree(roots, new Set(['INBOX'])).map((n) => n.path)).toEqual(['INBOX', 'Sent'])
  })
})

describe('sortFolders', () => {
  it('puts the special folders in their conventional order, not alphabetical', () => {
    // Alphabetical is correct and useless: "Archiv" above "INBOX".
    const roots = buildFolderTree([
      f('Archiv', { specialUse: '\\Archive' }),
      f('Trash', { specialUse: '\\Trash' }),
      f('INBOX', { specialUse: '\\Inbox' }),
      f('Sent', { specialUse: '\\Sent' }),
    ])
    expect(sortFolders(roots).map((n) => n.label)).toEqual(['INBOX', 'Sent', 'Archiv', 'Trash'])
  })

  it('treats INBOX as first even with no special-use flag', () => {
    const roots = buildFolderTree([f('Alpha'), f('INBOX')])
    expect(sortFolders(roots)[0].path).toBe('INBOX')
  })

  it('lifts favourites above ordinary folders', () => {
    const roots = buildFolderTree([f('Zebra'), f('Alpha')])
    expect(sortFolders(roots, new Set(['Zebra']))[0].label).toBe('Zebra')
  })

  it('sorts the rest alphabetically', () => {
    const roots = buildFolderTree([f('Zeta'), f('Alpha'), f('Mu')])
    expect(sortFolders(roots).map((n) => n.label)).toEqual(['Alpha', 'Mu', 'Zeta'])
  })

  it('sorts children too, not only roots', () => {
    const roots = buildFolderTree([f('P'), f('P/Zeta'), f('P/Alpha')])
    expect(sortFolders(roots)[0].children.map((n) => n.label)).toEqual(['Alpha', 'Zeta'])
  })
})
