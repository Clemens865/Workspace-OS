import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** "Export as a Markdown file": the reporter's way out when no repository is set. */

const h = vi.hoisted(() => ({
  userData: '',
  showSaveDialog: vi.fn(),
  analyzeBug: vi.fn(),
}))

vi.mock('electron', () => {
  const app = {
    getPath: () => h.userData,
    getVersion: () => '9.9.9',
    getAppPath: () => h.userData,
    isPackaged: true,
  }
  return { default: { app }, app, dialog: { showSaveDialog: h.showSaveDialog } }
})
vi.mock('../bugs/bug-analyzer', async (original) => ({
  ...(await original<typeof import('../bugs/bug-analyzer')>()),
  analyzeBug: h.analyzeBug,
}))

import { registerBugHandlers } from './bugs'
import { IpcValidationError } from '../ipc-validator'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-bugexport-'))
h.userData = dir
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

const handlers = new Map<string, (...a: unknown[]) => unknown>()
registerBugHandlers({ handle: (c: string, fn: (...a: unknown[]) => unknown) => void handlers.set(c, fn) } as never)
const exportReport = async (...a: unknown[]): Promise<{ path: string | null }> =>
  (await handlers.get('bug:export')!({}, ...a)) as { path: string | null }

describe('bug:export', () => {
  const target = path.join(dir, 'out.md')
  beforeEach(() => {
    fs.rmSync(target, { force: true })
    h.showSaveDialog.mockReset().mockResolvedValue({ canceled: false, filePath: target })
  })

  it('writes the report, in the reporter’s words, where the person chose', async () => {
    await expect(exportReport('No cursor in a new document\nSecond line', 'canvas', null, 'bug')).resolves.toEqual({ path: target })
    const md = fs.readFileSync(target, 'utf-8')
    expect(md).toContain('## Bug · No cursor in a new document')
    expect(md).toContain('- **Surface:** canvas')
    expect(md).toContain('- **Build:** 9.9.9')
    expect(md).toContain('> No cursor in a new document\n> Second line')
    expect(h.showSaveDialog.mock.calls[0][0].defaultPath).toMatch(/bug-report-\d{4}-\d{2}-\d{2}\.md$/)
  })

  it('writes an idea as an idea', async () => {
    await exportReport('Open mail links in the app', null, null, 'idea')
    const md = fs.readFileSync(target, 'utf-8')
    expect(md).toContain('## Idea · Open mail links in the app')
    expect(md).not.toContain('Severity')
  })

  it('writes nothing when the dialog is dismissed', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(exportReport('text', null, null, 'bug')).resolves.toEqual({ path: null })
    expect(fs.existsSync(target)).toBe(false)
  })

  it('never takes the destination from the renderer, and analyzes nothing', async () => {
    await exportReport('text', null, null, path.join(dir, 'elsewhere.md'))
    expect(fs.existsSync(path.join(dir, 'elsewhere.md'))).toBe(false)
    expect(h.analyzeBug).not.toHaveBeenCalled()
  })

  it('refuses an empty or oversized report before asking where to save', async () => {
    for (const bad of ['', '  ', 42, 'x'.repeat(100_001)]) {
      await expect(exportReport(bad, null, null, 'bug')).rejects.toBeInstanceOf(IpcValidationError)
    }
    expect(h.showSaveDialog).not.toHaveBeenCalled()
  })
})
