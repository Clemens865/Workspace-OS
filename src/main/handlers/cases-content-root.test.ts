import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'fs'
import path from 'path'

/**
 * A workspace with a configured content root (host-settings.json →
 * workspaces[root].contentRoot) keeps Cases/ and Work/ under that folder, while
 * case artifacts stay workspace-relative. Real handlers, fake IpcMain, temp dirs.
 */

const HOME = '/tmp/wos-case-content-home'
const USERDATA = '/tmp/wos-case-content-userdata'
const WS = '/tmp/wos-case-content-ws'
const SUB = 'Projects/wos'

vi.mock('os', async (orig) => {
  const actual = await orig<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => HOME }, homedir: () => HOME }
})
vi.mock('electron', () => ({
  default: { app: { getPath: () => USERDATA } },
  app: { getPath: () => USERDATA },
}))

process.env['WOS_USERDATA_DIR'] = USERDATA
for (const d of [HOME, USERDATA, WS]) {
  fs.rmSync(d, { recursive: true, force: true })
  fs.mkdirSync(d, { recursive: true })
}
fs.writeFileSync(path.join(USERDATA, 'host-settings.json'), JSON.stringify({ workspaces: { [WS]: { contentRoot: SUB } } }))

const { registerCaseHandlers } = await import('./cases')
const { setWorkspaceRoot } = await import('../workspace-root')
const { resetHostSettingsCache } = await import('../host-profile')

const handlers = new Map<string, (...a: unknown[]) => unknown>()
registerCaseHandlers({ handle: (c: string, h: (...a: unknown[]) => unknown) => void handlers.set(c, h) } as never)
const invoke = async (c: string, ...a: unknown[]): Promise<unknown> => handlers.get(c)!({}, ...a)

beforeAll(() => {
  resetHostSettingsCache()
  setWorkspaceRoot(WS)
})

describe('cases under a content root', () => {
  it('creates the case file under <contentRoot>/Cases, not at the workspace root', async () => {
    const c = (await invoke('cases:create', { title: 'Quarter Plan' })) as { id: string; scope: string }
    expect(c.scope).toBe('workspace')
    expect(fs.existsSync(path.join(WS, SUB, 'Cases', 'quarter-plan.md'))).toBe(true)
    expect(fs.existsSync(path.join(WS, 'Cases'))).toBe(false)
  })

  it('creates the work folder under <contentRoot>/Work and names it workspace-relative', async () => {
    const r = (await invoke('cases:work-folder', 'quarter-plan')) as { folder: string; guidance: string }
    expect(r.folder).toBe(path.join(WS, SUB, 'Work', 'quarter-plan'))
    expect(fs.existsSync(path.join(r.folder, 'drafts'))).toBe(true)
    expect(r.guidance).toContain(`${SUB}/Work/quarter-plan/`)
    expect(fs.existsSync(path.join(WS, 'Work'))).toBe(false)
  })

  it('still resolves workspace-relative artifacts against the workspace root', async () => {
    fs.mkdirSync(path.join(WS, 'Reports'), { recursive: true })
    fs.writeFileSync(path.join(WS, 'Reports', 'budget.txt'), 'x')
    await invoke('cases:create', { title: 'Budget', artifacts: ['Reports/budget.txt'] })
    expect(await invoke('cases:authorize-artifact', 'budget', 'Reports/budget.txt')).toBe(path.join(WS, 'Reports', 'budget.txt'))
  })
})
