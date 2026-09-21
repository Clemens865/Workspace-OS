import { describe, expect, it } from 'vitest'
import {
  initialRichState,
  addExtra,
  moveExtra,
  updateExtra,
  editableKind,
  assembleBlocks,
  blockLabel,
  inlineImageAttachments,
  substituteImageData,
  type RichComposeState,
} from './richComposeModel'
import type { EmailBlock } from '../../types/workspace-api'

const A: EmailBlock = { kind: 'metric', label: 'Revenue', value: '{{metric:rev}}' }
const B: EmailBlock = { kind: 'cta', label: 'Open the report', href: 'https://example.com' }
const C: EmailBlock = { kind: 'chart', title: 'Q3', bars: [{ label: 'Jul', value: 3 }] }

function withExtras(extras: EmailBlock[]): RichComposeState {
  return { ...initialRichState('hello'), extras }
}

describe('moveExtra', () => {
  it('reorders a block to the dropped position', () => {
    const s = moveExtra(withExtras([A, B, C]), 0, 2)
    expect(s.extras).toEqual([B, C, A])
  })

  it('moves a block toward the front too', () => {
    const s = moveExtra(withExtras([A, B, C]), 2, 0)
    expect(s.extras).toEqual([C, A, B])
  })

  /* A bad drop must never lose a block — the whole point of the guard. */
  it('ignores out-of-range and no-op moves without losing anything', () => {
    const s = withExtras([A, B])
    expect(moveExtra(s, 0, 0)).toBe(s)
    expect(moveExtra(s, -1, 1)).toBe(s)
    expect(moveExtra(s, 0, 5)).toBe(s)
    expect(moveExtra(s, 5, 0)).toBe(s)
  })

  it('keeps the typed body as block[0] regardless of ordering', () => {
    const s = moveExtra(withExtras([A, B, C]), 0, 2)
    expect(assembleBlocks(s)[0]).toEqual({ kind: 'text', text: 'hello' })
  })
})

describe('updateExtra', () => {
  it('replaces exactly the edited block', () => {
    const edited: EmailBlock = { kind: 'cta', label: 'Read it', href: 'https://example.com' }
    const s = updateExtra(withExtras([A, B, C]), 1, edited)
    expect(s.extras).toEqual([A, edited, C])
  })

  it('ignores an out-of-range index', () => {
    const s = withExtras([A])
    expect(updateExtra(s, 3, B)).toBe(s)
  })
})

describe('editableKind', () => {
  it('offers editing where human words live, not on live-token machinery', () => {
    expect(editableKind({ kind: 'text', text: 'x' })).toBe(true)
    expect(editableKind(B)).toBe(true)
    expect(editableKind(C)).toBe(true)
    expect(editableKind(A)).toBe(true)
    expect(editableKind({ kind: 'table', rows: [['a']] })).toBe(false)
    expect(editableKind({ kind: 'hosted-link', label: 'x', target: 'y' })).toBe(false)
  })
})

describe('addExtra bound', () => {
  it('still caps the list so a message cannot balloon', () => {
    let s = withExtras([])
    for (let i = 0; i < 40; i++) s = addExtra(s, A)
    expect(s.extras.length).toBe(30)
  })
})

describe('inline images', () => {
  const IMG: EmailBlock = { kind: 'image', cid: 'img-9', alt: 'Team photo', data: 'QUJD', contentType: 'image/png' }

  it('turns image blocks into CID attachments at send', () => {
    expect(inlineImageAttachments([A, IMG, B])).toEqual([
      { filename: 'Team photo', contentType: 'image/png', content: 'QUJD', cid: 'img-9' },
    ])
  })

  it('swaps cid references for data URIs in the local preview only', () => {
    const html = '<img src="cid:img-9" alt="Team photo">'
    expect(substituteImageData(html, [IMG])).toBe('<img src="data:image/png;base64,QUJD" alt="Team photo">')
    // A block list without the image leaves the html untouched.
    expect(substituteImageData(html, [A, B])).toBe(html)
  })

  it('labels and editability for the standard editor blocks', () => {
    expect(blockLabel(IMG)).toBe('Image: Team photo')
    expect(blockLabel({ kind: 'heading', text: 'Update' })).toBe('Heading: Update')
    expect(blockLabel({ kind: 'divider' })).toBe('Divider')
    expect(editableKind(IMG)).toBe(true)
    expect(editableKind({ kind: 'heading', text: 'x' })).toBe(true)
    expect(editableKind({ kind: 'divider' })).toBe(false)
  })
})
