import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
const state = vi.hoisted(() => ({ root: '' }))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => state.root }))
vi.mock('../docgen', () => ({ docgenBinDir: () => '/unused' }))
import { documentAction, validateDocumentSpec } from './documentActions'
beforeEach(() => { state.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-doc-test-')) })
afterEach(() => { fs.rmSync(state.root, { recursive: true, force: true }) })
/** Windows allows file symlinks only with Developer Mode or elevation. */
function canLinkFiles(): boolean {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-link-probe-'))
  try {
    fs.writeFileSync(path.join(dir, 'a'), '')
    fs.symlinkSync(path.join(dir, 'a'), path.join(dir, 'b'))
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EPERM') return false
    throw e
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

describe('main-process document transport', () => {
  it('creates a reviewable artifact and refuses to overwrite the original', async () => {
    expect((await documentAction('document.generate', { format: 'md', name: 'Report', content: '# Report' })).ok).toBe(true)
    expect((await documentAction('document.generate', { format: 'md', name: 'Report', content: 'replacement' })).ok).toBe(false)
    expect(fs.readFileSync(path.join(state.root, 'Report.md'), 'utf8')).toBe('# Report')
  })
  it('rejects traversal, hidden files and assets outside the workspace', async () => {
    for (const name of ['../escape', '/tmp/escape', '.hidden', 'sub/file']) expect((await documentAction('document.generate', { format: 'md', name, content: 'x' })).ok).toBe(false)
    expect(() => validateDocumentSpec({ slides: [{ imagePath: '/etc/passwd' }] }, state.root)).toThrow()
  })
  it.skipIf(!canLinkFiles())('refuses a symlink target without changing its contents', async () => {
    const original = path.join(state.root, 'original.md'); fs.writeFileSync(original, 'keep')
    fs.symlinkSync(original, path.join(state.root, 'Report.md'))
    expect((await documentAction('document.generate', { format: 'md', name: 'Report', content: 'replace' })).ok).toBe(false)
    expect(fs.readFileSync(original, 'utf8')).toBe('keep')
  })
})
