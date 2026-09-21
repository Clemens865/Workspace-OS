import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * Case scopes: a WORKSPACE case belongs to the open folder; a GLOBAL case is a
 * life thread that survives switching roots. These tests drive the real
 * handlers through a fake IpcMain (the mail-rich-email pattern) against temp
 * directories, because the behaviour under test IS the file layout.
 */

const HOME = '/tmp/wos-case-scope-home'
const USERDATA = '/tmp/wos-case-scope-userdata'
const WS_A = '/tmp/wos-case-scope-ws-a'
const WS_B = '/tmp/wos-case-scope-ws-b'

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => HOME }, homedir: () => HOME }
})
vi.mock('electron', () => ({
  default: { app: { getPath: () => USERDATA } },
  app: { getPath: () => USERDATA },
}))

import { registerCaseHandlers } from './cases'
import { setWorkspaceRoot, clearWorkspaceRoot } from '../workspace-root'

function fakeIpcMain(): { ipcMain: { handle: (c: string, h: (...a: unknown[]) => unknown) => void }; invoke: (c: string, ...a: unknown[]) => Promise<unknown> } {
  const handlers = new Map<string, (...a: unknown[]) => unknown>()
  return {
    ipcMain: { handle: (c, h) => void handlers.set(c, h) },
    invoke: async (c, ...a) => {
      const h = handlers.get(c)
      if (!h) throw new Error(`no handler for ${c}`)
      return h({}, ...a)
    },
  }
}

const f = fakeIpcMain()
registerCaseHandlers(f.ipcMain as never)

const GLOBAL_DIR = path.join(HOME, 'Workspace-OS', 'Cases')

beforeAll(() => {
  for (const d of [HOME, USERDATA, WS_A, WS_B]) {
    fs.rmSync(d, { recursive: true, force: true })
    fs.mkdirSync(d, { recursive: true })
  }
  setWorkspaceRoot(WS_A)
})

describe('case scopes', () => {
  it('a new case lands in the workspace by default', async () => {
    const c = (await f.invoke('cases:create', { title: 'Fonio Application' })) as { id: string; scope: string }
    expect(c.scope).toBe('workspace')
    expect(fs.existsSync(path.join(WS_A, 'Cases', 'fonio-application.md'))).toBe(true)
  })

  it('moving to "everywhere" moves the FILE and records it in the notes', async () => {
    const moved = (await f.invoke('cases:set-scope', 'fonio-application', 'global')) as {
      scope: string
      notes: { text: string }[]
    }
    expect(moved.scope).toBe('global')
    expect(fs.existsSync(path.join(GLOBAL_DIR, 'fonio-application.md'))).toBe(true)
    expect(fs.existsSync(path.join(WS_A, 'Cases', 'fonio-application.md'))).toBe(false)
    expect(moved.notes.at(-1)?.text).toBe('Scope → everywhere')
  })

  it('never serializes scope into the file — location is the only truth', () => {
    const md = fs.readFileSync(path.join(GLOBAL_DIR, 'fonio-application.md'), 'utf8')
    expect(md).not.toMatch(/^scope:/m)
  })

  it('a global case survives switching the workspace root', async () => {
    setWorkspaceRoot(WS_B)
    const list = (await f.invoke('cases:list')) as { id: string; scope: string }[]
    expect(list.map((c) => c.id)).toContain('fonio-application')
    expect(list.find((c) => c.id === 'fonio-application')?.scope).toBe('global')
    // ...and the agent's context read resolves it too.
    const ctx = (await f.invoke('cases:as-context', 'fonio-application')) as string
    expect(ctx).toContain('Fonio Application')
  })

  /*
   * Creating a case whose slug matches a GLOBAL one reopens that thread
   * rather than forking a workspace twin — the idempotent-reopen rule working
   * across scopes. A shadowing twin would be exactly the two-threads-one-name
   * confusion a case exists to end.
   */
  it('creating over a global twin reopens the global thread, not a fork', async () => {
    const c = (await f.invoke('cases:create', { title: 'Fonio Application' })) as { scope: string }
    expect(c.scope).toBe('global')
    expect(fs.existsSync(path.join(WS_B, 'Cases', 'fonio-application.md'))).toBe(false)
  })

  /* Files CAN still collide on disk (hand-copied folders). Workspace wins. */
  it('on a genuine on-disk collision the workspace copy wins, once', async () => {
    fs.mkdirSync(path.join(WS_B, 'Cases'), { recursive: true })
    fs.writeFileSync(
      path.join(WS_B, 'Cases', 'fonio-application.md'),
      fs.readFileSync(path.join(GLOBAL_DIR, 'fonio-application.md'), 'utf8').replace('Fonio Application', 'Fonio Application (ws copy)'),
    )
    const list = (await f.invoke('cases:list')) as { id: string; scope: string }[]
    const hits = list.filter((c) => c.id === 'fonio-application')
    expect(hits).toHaveLength(1)
    expect(hits[0].scope).toBe('workspace')
  })

  it('refuses to move onto a name already taken at the destination', async () => {
    // The workspace copy resolves first; global already holds the name.
    await expect(f.invoke('cases:set-scope', 'fonio-application', 'global')).rejects.toThrow(/already exists/)
  })

  it('a note lands on the resolved case, wherever it lives', async () => {
    // The workspace copy shadows the global one — the note must hit IT.
    await f.invoke('cases:add-note', 'fonio-application', 'Sent the follow-up.', 'you')
    const ws = fs.readFileSync(path.join(WS_B, 'Cases', 'fonio-application.md'), 'utf8')
    const global = fs.readFileSync(path.join(GLOBAL_DIR, 'fonio-application.md'), 'utf8')
    expect(ws).toContain('Sent the follow-up.')
    expect(global).not.toContain('Sent the follow-up.')
  })

  it('with no workspace open, a new case lands global instead of failing', async () => {
    clearWorkspaceRoot()
    const c = (await f.invoke('cases:create', { title: 'House Purchase' })) as { scope: string }
    expect(c.scope).toBe('global')
    expect(fs.existsSync(path.join(GLOBAL_DIR, 'house-purchase.md'))).toBe(true)
    setWorkspaceRoot(WS_B)
  })
})

/*
 * Manual case creation (the "New case" button / "start from a file" entry
 * points). The type-aware status default is the subtle part: a hand-started
 * task must begin at its OWN first stage, not the application flow's 'drafted'.
 */
describe('manual cases:create', () => {
  it('starts a task at its first stage (open), not application "drafted"', async () => {
    const c = (await f.invoke('cases:create', {
      title: 'Steuer 2025',
      type: 'task',
      description: 'Tax year prep for the accountant',
    })) as { type: string; status: string; description: string; artifacts: string[] }
    expect(c.type).toBe('task')
    expect(c.status).toBe('open')
    expect(c.description).toBe('Tax year prep for the accountant')
  })

  it('an application still defaults to drafted', async () => {
    const c = (await f.invoke('cases:create', { title: 'Some Job', type: 'application' })) as { status: string }
    expect(c.status).toBe('drafted')
  })

  it('attaches a starting file as the first artifact', async () => {
    const c = (await f.invoke('cases:create', {
      title: 'From A File',
      type: 'task',
      artifacts: ['Reports/budget.xlsx'],
    })) as { artifacts: string[] }
    expect(c.artifacts).toEqual(['Reports/budget.xlsx'])
  })
})
