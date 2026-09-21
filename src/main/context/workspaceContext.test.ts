import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('electron', () => ({
  default: { app: { getPath: () => os.tmpdir() } },
  app: { getPath: () => os.tmpdir() },
}))

import {
  setContext,
  getContext,
  getContextEnv,
  contextPrompt,
} from './workspaceContext'

describe('workspaceContext', () => {
  let root: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-ctx-'))
    setContext({ root, surface: null, folder: null, openFile: null })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('merges partial updates', () => {
    setContext({ surface: 'files' })
    setContext({ openFile: path.join(root, 'a.md') })
    const c = getContext()
    expect(c.surface).toBe('files')
    expect(c.openFile).toBe(path.join(root, 'a.md'))
    expect(c.root).toBe(root)
  })

  it('exposes harness env vars for shell spawns', () => {
    setContext({ surface: 'mail', openFile: path.join(root, 'x.docx') })
    const env = getContextEnv()
    expect(env.WOS_WORKSPACE).toBe(root)
    expect(env.WOS_SURFACE).toBe('mail')
    expect(env.WOS_OPEN_FILE).toBe(path.join(root, 'x.docx'))
    expect(env.WOS_CAN_DO.split(',')).toContain('edit-office')
  })

  it('builds a human context prompt for agent tabs', () => {
    setContext({ surface: 'knowledge', openFile: path.join(root, 'note.md') })
    const prompt = contextPrompt()
    expect(prompt).toContain('Workspace-OS')
    expect(prompt).toContain('knowledge')
    expect(prompt).toContain('note.md')
  })

  it('writes the best-effort agent-context.json under the root', () => {
    setContext({ surface: 'home' })
    const file = path.join(root, '.workspace-os', 'agent-context.json')
    expect(fs.existsSync(file)).toBe(true)
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(parsed.surface).toBe('home')
  })
})
