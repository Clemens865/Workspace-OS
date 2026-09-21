import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

// getWorkspaceRoot is mocked so the confinement logic is tested without a real
// open workspace. The path math + escape checks come from the real
// validateFilePath underneath.
let mockRoot: string | null = null
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => mockRoot }))

import { confineToWorkspace } from './sourcePath'

const ROOT = path.join(os.tmpdir(), 'wos-confine-root')

describe('confineToWorkspace', () => {
  beforeEach(() => { mockRoot = ROOT })

  it('accepts an in-workspace file and returns the resolved path', () => {
    expect(confineToWorkspace(path.join(ROOT, 'budget.xlsx'))).toBe(path.join(ROOT, 'budget.xlsx'))
    expect(confineToWorkspace('reports/q3.xlsx')).toBe(path.join(ROOT, 'reports', 'q3.xlsx'))
  })

  it('refuses an out-of-workspace absolute path (the exfil/overwrite vector)', () => {
    expect(() => confineToWorkspace('/Users/victim/Documents/finances.xlsx')).toThrow(/escapes workspace root/)
  })

  it('refuses traversal out of the workspace', () => {
    expect(() => confineToWorkspace('../../etc/passwd')).toThrow(/escapes workspace root/)
  })

  it('refuses a control character in the path', () => {
    expect(() => confineToWorkspace('a' + String.fromCharCode(10) + 'b.xlsx')).toThrow(/control character/)
  })

  it('refuses when no workspace is open', () => {
    mockRoot = null
    expect(() => confineToWorkspace(path.join(ROOT, 'x.xlsx'))).toThrow(/No workspace folder is open/)
  })

  it('refuses a non-string / empty path', () => {
    expect(() => confineToWorkspace(undefined)).toThrow(/Invalid file path/)
    expect(() => confineToWorkspace('')).toThrow(/Invalid file path/)
  })
})
