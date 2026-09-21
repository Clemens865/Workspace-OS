import { describe, it, expect, afterEach } from 'vitest'
import { sofficeCandidates } from './libreoffice'

const ORIGINAL = process.env['SOFFICE_BIN']

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env['SOFFICE_BIN']
  else process.env['SOFFICE_BIN'] = ORIGINAL
})

describe('sofficeCandidates', () => {
  it('puts an explicit SOFFICE_BIN override first', () => {
    process.env['SOFFICE_BIN'] = '/custom/soffice'
    expect(sofficeCandidates()[0]).toBe('/custom/soffice')
  })

  it('prefers a bundled engine over a system install when packaged', () => {
    delete process.env['SOFFICE_BIN']
    // process.resourcesPath is set in a packaged Electron app; emulate it.
    const prev = process.resourcesPath
    ;(process as { resourcesPath: string }).resourcesPath = '/app/Resources'
    try {
      const list = sofficeCandidates()
      const bundled = list.findIndex((c) => c.startsWith('/app/Resources/libreoffice/'))
      const system = list.indexOf('/Applications/LibreOffice.app/Contents/MacOS/soffice')
      expect(bundled).toBeGreaterThanOrEqual(0)
      expect(bundled).toBeLessThan(system)
    } finally {
      ;(process as { resourcesPath: string | undefined }).resourcesPath = prev
    }
  })

  it('falls back to system paths when nothing is bundled', () => {
    delete process.env['SOFFICE_BIN']
    const prev = process.resourcesPath
    ;(process as { resourcesPath: string | undefined }).resourcesPath = undefined
    try {
      expect(sofficeCandidates()).toContain('/Applications/LibreOffice.app/Contents/MacOS/soffice')
    } finally {
      ;(process as { resourcesPath: string | undefined }).resourcesPath = prev
    }
  })
})
