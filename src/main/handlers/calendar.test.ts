import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const source = { current: { id: 's1', kind: 'google' } }

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/wos-calendar-test' } }))
vi.mock('../calendar/account-store', () => ({
  isOAuthKind: (k: string) => k === 'google' || k === 'microsoft',
  CalendarSourceStore: class {
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

import { probeCalendarSource } from './calendar'

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
