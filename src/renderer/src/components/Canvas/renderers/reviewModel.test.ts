import { describe, expect, it } from 'vitest'
import { parseComments, parseRedlines, parseRect, plainText, reviewCommands, shortDate, threadsOf } from './reviewModel'

describe('parseComments', () => {
  it('reads Writer comments with anchors, html text and threads', () => {
    const payload = JSON.stringify({ comments: [
      { id: 12, parentId: 0, author: 'Ana', html: '<p>Check <b>this</b></p>', resolved: 'false', dateTime: '2026-09-04T12:00:00', anchorPos: '1418, 2000, 300, 250', textRange: '1418, 2000, 300, 250' },
      { id: 13, parentId: 12, author: 'Ben', text: 'Done', resolved: 'false', dateTime: '2026-09-04T12:05:00', anchorPos: '1418, 2000, 300, 250' },
    ] })
    const cs = parseComments(payload)
    expect(cs).toHaveLength(2)
    expect(cs[0]).toMatchObject({ id: '12', parentId: null, author: 'Ana', text: 'Check this', resolved: false, anchor: { x: 1418, y: 2000, w: 300, h: 250 } })
    expect(cs[1].parentId).toBe('12')
    const threads = threadsOf(cs)
    expect(threads).toHaveLength(1)
    expect(threads[0].replies.map((r) => r.author)).toEqual(['Ben'])
  })
  it('reads Calc notes with a sheet and cell position', () => {
    const cs = parseComments({ comments: [{ id: 3, tab: 1, author: 'Ana', dateTime: '04.09.2026', text: 'Verify total', cellPos: '0, 510, 1280, 255' }] })
    expect(cs[0]).toMatchObject({ id: '3', part: 1, text: 'Verify total', anchor: { x: 0, y: 510, w: 1280, h: 255 } })
  })
  it('tolerates garbage', () => {
    expect(parseComments('nope')).toEqual([])
    expect(parseComments({ comments: [{ author: 'no id' }] })).toEqual([])
  })
})

describe('threadsOf', () => {
  it('keeps an orphaned reply as its own thread rather than dropping it', () => {
    const cs = parseComments({ comments: [{ id: 5, parentId: 99, author: 'X', text: 'orphan' }] })
    expect(threadsOf(cs)).toHaveLength(1)
  })
})

describe('parseRedlines', () => {
  it('reads tracked changes with their index and type', () => {
    const rs = parseRedlines(JSON.stringify({ redlines: [
      { index: 0, author: 'Ana', type: 'Insert', comment: '', description: 'Insert "new text"', dateTime: '2026-09-04T12:00:00', textRange: '1418, 2000, 900, 250; 1418, 2250, 300, 250' },
      { index: 1, author: 'Ana', type: 'Delete', comment: 'why', description: 'Delete "old"', dateTime: '2026-09-04T12:01:00' },
    ] }))
    expect(rs).toHaveLength(2)
    expect(rs[0]).toMatchObject({ index: 0, type: 'Insert', anchor: { x: 1418, y: 2000, w: 900, h: 250 } })
    expect(rs[1].anchor).toBeNull()
  })
})

describe('helpers', () => {
  it('parses rects and strips html', () => {
    expect(parseRect('10, 20, 30, 40')).toEqual({ x: 10, y: 20, w: 30, h: 40 })
    expect(parseRect('bad')).toBeNull()
    expect(plainText('<p>Line one</p><p>Line &amp; two</p>')).toBe('Line one\nLine & two')
  })
  it("drops the engine's own quote from a reply and parses comma-fraction dates", () => {
    expect(plainText('<div>Checked, all goodReply to Unknown Author (09/04/2026, 12:53): &quot;...&quot;</div><div><br/></div>')).toBe('Checked, all good')
    expect(shortDate('2026-09-04T12:53:00,180683000')).not.toContain('T12')
    expect(shortDate('garbage')).toBe('garbage')
  })
  it('builds the engine commands with JSON args', () => {
    expect(reviewCommands.insertComment('Say "hi"')).toBe('.uno:InsertAnnotation {"Text":{"type":"string","value":"Say \\"hi\\""}}')
    expect(reviewCommands.reply('12', 'ok')).toContain('.uno:ReplyComment {"Id":{"type":"string","value":"12"}')
    expect(reviewCommands.deleteComment('3', 'c')).toContain('.uno:DeleteNote')
    expect(reviewCommands.deleteComment('3', 'p')).toContain('.uno:DeleteAnnotation')
    expect(reviewCommands.acceptChange(4)).toBe('.uno:AcceptTrackedChange {"AcceptTrackedChange":{"type":"unsigned short","value":4}}')
  })
})
