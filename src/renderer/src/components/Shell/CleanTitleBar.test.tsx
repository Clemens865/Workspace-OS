import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CleanTitleBarView } from './CleanTitleBar'

const noop = (): void => {}

describe('the clean window style title bar', () => {
  it('has a drag region with the app name and the three window buttons', () => {
    const html = renderToStaticMarkup(<CleanTitleBarView maximized onMinimize={noop} onMaximize={noop} onClose={noop} />)
    expect(html).toContain('Workspace OS')
    expect(html).toContain('aria-label="Minimise"')
    expect(html).toContain('aria-label="Close"')
  })

  it('offers Restore when maximised and Maximise when not', () => {
    expect(renderToStaticMarkup(<CleanTitleBarView maximized onMinimize={noop} onMaximize={noop} onClose={noop} />)).toContain('aria-label="Restore"')
    expect(renderToStaticMarkup(<CleanTitleBarView maximized={false} onMinimize={noop} onMaximize={noop} onClose={noop} />)).toContain('aria-label="Maximise"')
  })
})
