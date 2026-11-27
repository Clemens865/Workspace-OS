import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

/** Handler-boundary tests for saving agents: a save meant to create never replaces a file. */

let dir: string
vi.mock('electron', () => ({ default: { app: { getPath: () => os.tmpdir() } }, app: { getPath: () => os.tmpdir() } }))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => dir }))
vi.mock('../agent/foundry', () => ({ buildAgentSpec: vi.fn() }))

import { registerAgentsHandlers } from './agents'
import { IPC } from '../ipc-channels'

type Handler = (event: unknown, ...args: unknown[]) => unknown
const handlers = new Map<string, Handler>()
const write = async (p: Record<string, unknown>): Promise<unknown> => handlers.get(IPC.AGENTS_WRITE)!({}, { scope: 'project', ...p })
const file = (slug: string): string => path.join(dir, '.claude', 'agents', `${slug}.md`)

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-agents-h-'))
  fs.mkdirSync(path.dirname(file('x')), { recursive: true })
  fs.writeFileSync(file('elias'), '---\nname: Elias\ntools: Read, Grep\ncolor: blue\n---\n\nOriginal.\n')
  registerAgentsHandlers({ handle: (c: string, f: Handler) => handlers.set(c, f) } as never)
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('agents:write', () => {
  it('createOnly refuses a name whose file exists, and leaves it as it was', async () => {
    const before = fs.readFileSync(file('elias'), 'utf-8')
    await expect(write({ name: 'ELIAS', persona: 'Replaced', createOnly: true })).rejects.toThrow('already exists')
    expect(fs.readFileSync(file('elias'), 'utf-8')).toBe(before)
  })

  it('a copy keeps the lines another editor put in the original (its tool limits)', async () => {
    await write({ name: 'Elias copy', persona: 'Original.', createOnly: true, copyFrom: { name: 'Elias', scope: 'project' } })
    const copy = fs.readFileSync(file('elias-copy'), 'utf-8')
    expect(copy).toContain('name: Elias copy')
    expect(copy).toContain('tools: Read, Grep')
    expect(copy).toContain('color: blue')
  })

  it('a copy of a file that cannot be read is not written at all', async () => {
    await expect(write({ name: 'Ghost copy', createOnly: true, copyFrom: { name: 'Ghost', scope: 'project' } })).rejects.toThrow()
    expect(fs.existsSync(file('ghost-copy'))).toBe(false)
  })

  it('an edit (no createOnly) saves over its own file and keeps those lines', async () => {
    await write({ name: 'Elias', persona: 'Edited.' })
    const now = fs.readFileSync(file('elias'), 'utf-8')
    expect(now).toContain('Edited.')
    expect(now).toContain('tools: Read, Grep')
  })
})
