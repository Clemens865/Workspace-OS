import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn(), print: vi.fn(), destroy: vi.fn(), isDestroyed: vi.fn(),
  setWindowOpenHandler: vi.fn(), on: vi.fn(), options: [] as unknown[],
}))
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) { mocks.options.push(options) }
    loadURL = mocks.loadURL
    destroy = mocks.destroy
    isDestroyed = mocks.isDestroyed
    webContents = { print: mocks.print, setWindowOpenHandler: mocks.setWindowOpenHandler, on: mocks.on }
  },
}))

import { printDocument, printDocumentHtml } from './printing'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.length = 0
  mocks.loadURL.mockResolvedValue(undefined)
  mocks.isDestroyed.mockReturnValue(false)
})

describe('isolated document print window', () => {
  it('loads only the document and keeps the window alive until the native dialog finishes', async () => {
    let complete!: (success: boolean, reason: string) => void
    mocks.print.mockImplementation((_options, callback) => { complete = callback })
    const printing = printDocument('report.md', '<h1>Report</h1><p>Final paragraph</p>')
    await vi.waitFor(() => expect(mocks.print).toHaveBeenCalledTimes(1))
    expect(mocks.destroy).not.toHaveBeenCalled()
    expect(mocks.print.mock.calls[0][0]).toEqual({ silent: false, printBackground: true })
    expect(mocks.options[0]).toMatchObject({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    })
    const html = decodeURIComponent(mocks.loadURL.mock.calls[0][0])
    expect(html).toContain('<title>report.md</title>')
    expect(html).toContain('<h1>Report</h1><p>Final paragraph</p>')
    complete(true, '')
    await printing
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('treats cancellation as normal and destroys the print window', async () => {
    mocks.print.mockImplementation((_options, callback) => callback(false, 'Print job canceled'))
    await expect(printDocument('report.md', '<p>Report</p>')).resolves.toBeUndefined()
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('reports printer failures and still destroys the print window', async () => {
    mocks.print.mockImplementation((_options, callback) => callback(false, 'Printer unavailable'))
    await expect(printDocument('report.md', '')).rejects.toThrow('Printer unavailable')
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('cleans up if the document cannot load', async () => {
    mocks.loadURL.mockRejectedValueOnce(new Error('Load failed'))
    await expect(printDocument('report.md', '')).rejects.toThrow('Load failed')
    expect(mocks.print).not.toHaveBeenCalled()
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  it('escapes filenames and places the restrictive CSP before file HTML', () => {
    const html = printDocumentHtml('<report & notes>.md', '<script>window.print()</script>')
    expect(html).toContain('<title>&lt;report &amp; notes&gt;.md</title>')
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<script>'))
    expect(html).toContain("default-src 'none'")
  })
})
