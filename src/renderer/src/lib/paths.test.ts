import { describe, expect, it } from 'vitest'
import { basename, dirname, isInside, joinPath, relPath, segments, sepOf } from './paths'

describe('renderer paths: POSIX', () => {
  it('splits, joins and compares as before', () => {
    expect(basename('/Users/me/ws/Notes/a.md')).toBe('a.md')
    expect(dirname('/Users/me/ws/Notes/a.md')).toBe('/Users/me/ws/Notes')
    expect(dirname('/a')).toBe('/')
    expect(joinPath('/Users/me/ws', 'Notes', 'a.md')).toBe('/Users/me/ws/Notes/a.md')
    expect(isInside('/Users/me/ws', '/Users/me/ws/Notes/a.md')).toBe(true)
    expect(isInside('/Users/me/ws', '/Users/me/wsx/a.md')).toBe(false)
    expect(isInside('/Users/me/ws', '/Users/me/WS/a.md')).toBe(false)
    expect(relPath('/Users/me/ws/Notes/a.md', '/Users/me/ws')).toBe('Notes/a.md')
    expect(relPath('/elsewhere/a.md', '/Users/me/ws')).toBe('/elsewhere/a.md')
  })
})

describe('renderer paths: Windows', () => {
  const root = 'D:\\OBS\\brncx-skills'
  it('never drops a character from a path without a slash', () => {
    expect(dirname(root)).toBe('D:\\OBS')
    expect(dirname('D:\\OBS')).toBe('D:\\')
    expect(dirname(root + '\\Notes\\a.md')).toBe(root + '\\Notes')
    expect(basename(root + '\\Notes\\a.md')).toBe('a.md')
    expect(basename(root + '\\')).toBe('brncx-skills')
  })
  it('joins with backslashes and compares without case', () => {
    expect(sepOf(root)).toBe('\\')
    expect(joinPath(root, 'Notes/a.md')).toBe(root + '\\Notes\\a.md')
    expect(isInside(root, 'd:\\obs\\brncx-skills\\Notes\\a.md')).toBe(true)
    expect(isInside(root, 'D:\\OBS\\brncx-skill')).toBe(false)
    expect(relPath(root + '\\Notes\\a.md', root)).toBe('Notes/a.md')
    expect(segments('Notes\\sub/a.md')).toEqual(['Notes', 'sub', 'a.md'])
  })
})
