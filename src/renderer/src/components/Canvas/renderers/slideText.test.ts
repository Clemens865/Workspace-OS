import { describe, expect, it } from 'vitest'
import { parseSlideText, slideTextSetArgs } from './slideText'

describe('slideText', () => {
  it('parses titles and tab-separated bodies', () => {
    const s = parseSlideText('0|Hello title|First point\tSecond point\n1|Two|\n')
    expect(s).toEqual([
      { index: 0, title: 'Hello title', body: ['First point', 'Second point'] },
      { index: 1, title: 'Two', body: [] },
    ])
  })

  it('builds a set op with separators stripped', () => {
    expect(slideTextSetArgs(2, 'A | B', ['x\ty', '', 'z'])).toBe('set|2|A   B|x y\tz')
  })
})
