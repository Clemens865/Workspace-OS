import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const source = { current: { id: 's1', kind: 'google' } }
const workspace = { root: '' }
const setDefaultTarget = vi.fn(async (_id: string | null) => {})
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => workspace.root }))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wos-calendar-test' } }))
vi.mock('../calendar/account-store', () => ({
  isOAuthKind: (k: string) => k === 'google' || k === 'microsoft',
  CalendarSourceStore: class {
    async list() {
      return []
    }
    async getDefaultTarget() {
      return null
    }
    setDefaultTarget = setDefaultTarget
    async get() {
      return source.current
    }
    async getSecret() {
      return 'stored-refresh-token'
    }
  },
}))
vi.mock('../mail/oauth/client-config', () => ({
  resolveGoogleClientId: () => 'google-client',
  resolveMicrosoftClientId: () => 'ms-client',
}))

import { probeCalendarSource, registerCalendarHandlers } from './calendar'
import { readLocal, localCalendarPath } from '../calendar/local-calendar'

const fetchMock = vi.fn(async (_url: string, _init?: { body?: unknown }) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: 'access', expires_in: 3600 }),
}))

beforeEach(() => {
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('cloud calendar token refresh', () => {
  it.each([
    ['google', 'g1', 'google-client'],
    ['microsoft', 'm1', 'ms-client'],
  ])('sends the stored refresh token and client id to %s', async (kind, id, clientId) => {
    source.current = { id, kind }

    await expect(probeCalendarSource(id)).resolves.toBe('ok')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = new URLSearchParams(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('stored-refresh-token')
    expect(body.get('client_id')).toBe(clientId)
  })
})

describe('repeating events over IPC (local calendar)', () => {
  type Handler = (event: unknown, ...args: unknown[]) => Promise<unknown>
  const handlers = new Map<string, Handler>()
  const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    handlers.get(channel)!({}, ...args) as Promise<T>

  const LOCAL = 'workspace-os-local'
  const week = (n: number, h = 9): number => new Date(2026, 7, 5 + 7 * n, h).getTime() // Wednesdays
  const base = {
    summary: 'Weekly', start: week(0), end: week(0, 10),
    recurrence: { freq: 'WEEKLY', interval: 1, byWeekday: [3], count: 4 },
  }
  type Shown = { uid: string; recurringUid?: string; summary: string; start: number; sourceId: string }
  const shown = async (): Promise<Shown[]> =>
    (await invoke<{ events: Shown[] }>('calendar:events', week(-1), week(6))).events
  const create = (): Promise<{ uid: string }> => invoke<{ uid: string }>('calendar:create-event', base)
  const ref = (uid: string, extra: object = {}): object => ({ uid, sourceId: LOCAL, ...extra })

  beforeAll(() => {
    registerCalendarHandlers({ handle: (c: string, f: Handler) => handlers.set(c, f) } as never)
  })
  beforeEach(() => {
    workspace.root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cal-ipc-'))
    setDefaultTarget.mockClear()
  })
  afterEach(() => fs.rmSync(workspace.root, { recursive: true, force: true }))

  it.each([
    ['a raw rule', 'FREQ=DAILY'],
    ['null', null],
    ['a bad interval', { freq: 'DAILY', interval: -1 }],
    ['an injected line', { freq: 'DAILY', interval: 1, until: '2026-09-01\r\nX-EVIL:1' }],
    ['weekdays that omit the start', { freq: 'WEEKLY', interval: 1, byWeekday: [1] }],
  ])('refuses %s before anything is written', async (_label, recurrence) => {
    await expect(invoke('calendar:create-event', { ...base, recurrence })).rejects.toMatchObject({
      name: 'IpcValidationError',
    })
    expect(fs.existsSync(localCalendarPath(workspace.root))).toBe(false)
    expect(setDefaultTarget).not.toHaveBeenCalled()
  })

  it('creates a series and returns its occurrences from calendar:events', async () => {
    const { uid } = await create()
    const events = await shown()
    expect(events.map((e) => e.start)).toEqual([week(0), week(1), week(2), week(3)])
    expect(events.every((e) => e.sourceId === LOCAL && e.recurringUid === uid)).toBe(true)
  })

  it('edits one occurrence, then the series', async () => {
    const { uid } = await create()
    await invoke('calendar:update-event', ref(uid, { scope: 'occurrence', occurrence: week(1) }),
      { summary: 'Later', start: week(1, 15), end: week(1, 16) })
    await invoke('calendar:update-event', ref(uid, { scope: 'series', occurrence: week(0) }),
      { summary: 'Renamed', start: week(0), end: week(0, 10) })
    expect((await shown()).map((e) => [e.summary, e.start])).toEqual([
      ['Renamed', week(0)], ['Later', week(1, 15)], ['Renamed', week(2)], ['Renamed', week(3)],
    ])
  })

  it('deletes one occurrence, then the series', async () => {
    const { uid } = await create()
    await invoke('calendar:remove-event', ref(uid, { scope: 'occurrence', occurrence: week(2) }))
    expect((await shown()).map((e) => e.start)).toEqual([week(0), week(1), week(3)])
    await invoke('calendar:remove-event', ref(uid))
    expect(await shown()).toEqual([])
  })

  it('refuses an occurrence the series does not have', async () => {
    const { uid } = await create()
    const bogus = ref(uid, { scope: 'occurrence', occurrence: week(0) + 60_000 })
    await expect(invoke('calendar:remove-event', bogus)).rejects.toThrow(/occurrence/i)
    await expect(
      invoke('calendar:update-event', bogus, { summary: 'X', start: week(0), end: week(0, 10) }),
    ).rejects.toThrow(/occurrence/i)
    await expect(
      invoke('calendar:remove-event', ref(uid, { scope: 'occurrence', occurrence: 1e20 })),
    ).rejects.toThrow(/occurrence/i)
    expect(readLocal(workspace.root)).toHaveLength(1)
    expect(readLocal(workspace.root)[0].exdates).toBeUndefined()
  })
})
