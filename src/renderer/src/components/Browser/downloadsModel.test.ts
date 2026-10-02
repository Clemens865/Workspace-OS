import { describe, expect, it } from 'vitest'
import { applyDownload, progress, sizeLabel } from './downloadsModel'

const d = (id: string, startedAt: number, over = {}) => ({
  id,
  filename: `${id}.pdf`,
  savePath: `/w/Downloads/${id}.pdf`,
  url: 'https://example.com',
  received: 0,
  total: 0,
  state: 'progressing' as const,
  startedAt,
  ...over,
})

describe('applyDownload', () => {
  it('keeps one entry per download, newest first, updated in place', () => {
    let list = applyDownload([], d('a', 1))
    list = applyDownload(list, d('b', 2))
    list = applyDownload(list, d('a', 1, { state: 'completed', received: 10 }))
    expect(list.map((x) => [x.id, x.state])).toEqual([
      ['b', 'progressing'],
      ['a', 'completed'],
    ])
  })
})

describe('sizeLabel / progress', () => {
  it('says how far a download is', () => {
    expect(sizeLabel({ received: 512 * 1024, total: 2 * 1024 * 1024, state: 'progressing' })).toBe('512 KB of 2.0 MB')
    expect(sizeLabel({ received: 2048, total: 0, state: 'completed' })).toBe('2 KB')
    expect(sizeLabel({ received: 0, total: 0, state: 'progressing' })).toBe('')
    expect(progress({ received: 1, total: 4 })).toBe(0.25)
    expect(progress({ received: 1, total: 0 })).toBeNull()
  })
})
