import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AgentAvatar, faceDataUri } from './AgentAvatar'

/**
 * Paint-proof tests. A prior inline-SVG-with-gradient avatar measured 0×0 in
 * the live app, so the avatar now paints an illustrated DiceBear face via an
 * <img src={dataUri}> — the bulletproof route. These tests assert, from the
 * actual server-rendered HTML, that the avatar contains a real face image with
 * a data-URI and honours its size, so a blank avatar can never ship again.
 */
describe('AgentAvatar renders an illustrated face', () => {
  it('renders an <img> whose src is a face data-URI', () => {
    const html = renderToStaticMarkup(<AgentAvatar seed="researcher" size={52} />)
    expect(html).toContain('<img')
    expect(html).toMatch(/src="data:image\/svg\+xml/)
  })

  it('honors the size prop (width/height set to the given px)', () => {
    const html = renderToStaticMarkup(<AgentAvatar seed="coder" size={80} />)
    expect(html).toMatch(/width:\s*80px/)
    expect(html).toMatch(/height:\s*80px/)
  })

  it('is deterministic: same seed → identical rendered markup', () => {
    const a = renderToStaticMarkup(<AgentAvatar seed="Security Auditor" size={44} />)
    const b = renderToStaticMarkup(<AgentAvatar seed="Security Auditor" size={44} />)
    expect(a).toBe(b)
  })

  it('different seeds paint different faces', () => {
    const a = renderToStaticMarkup(<AgentAvatar seed="alpha" size={44} />)
    const b = renderToStaticMarkup(<AgentAvatar seed="omega" size={44} />)
    expect(a).not.toBe(b)
  })

  it('faceDataUri produces a valid, non-empty face data-URI', () => {
    const uri = faceDataUri('data-analyst', 44)
    expect(uri).toMatch(/^data:image\/svg\+xml/)
    expect(uri.length).toBeGreaterThan(100)
  })
})
