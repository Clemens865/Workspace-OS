import { describe, it, expect } from 'vitest'
import { buildConnections, connectionsStatus, connectionLine, type ConnectionInputs } from './registry'

const NOW = 1_800_000_000_000

function input(over: Partial<ConnectionInputs> = {}): ConnectionInputs {
  return { now: NOW, mcp: [], sites: [], mail: [], calendar: [], drive: null, googleConfigured: true, ...over }
}

const key = (stored: boolean) => ({ envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN', label: 'GitHub token', hint: '', stored })

describe('MCP connectors', () => {
  it('a token connector is connected only when on AND every key is stored', () => {
    const list = buildConnections(
      input({
        mcp: [
          { id: 'github', displayName: 'GitHub', description: 'Repos', remote: false, enabled: true, secrets: [key(true)], oauth: 'none' },
          { id: 'slack', displayName: 'Slack', description: 'Channels', remote: false, enabled: true, secrets: [key(false)], oauth: 'none' },
          { id: 'notion', displayName: 'Notion', description: 'Pages', remote: false, enabled: false, secrets: [key(true)], oauth: 'none' },
          { id: 'fs', displayName: 'Filesystem', description: 'Files', remote: false, enabled: true, secrets: [], oauth: 'none' },
        ],
      }),
    )
    const by = Object.fromEntries(list.map((c) => [c.id, c]))
    expect(by['mcp:github'].status).toBe('connected')
    expect(by['mcp:github'].how).toBe('key · keychain')
    expect(by['mcp:slack'].status).toBe('setup')
    expect(by['mcp:slack'].detail).toBe('needs GitHub token')
    expect(by['mcp:notion'].status).toBe('off')
    expect(by['mcp:notion'].detail).toBe('key stored')
    expect(by['mcp:fs'].status).toBe('connected')
    expect(by['mcp:fs'].how).toBe('no key needed')
  })

  it('a remote OAuth connector turns warm when its refresh failed, never "connected" on a stored record alone', () => {
    const mk = (id: string, enabled: boolean, oauth: 'none' | 'ok' | 'fail') => ({
      id, displayName: id, description: '', remote: true, enabled, secrets: [], oauth,
    })
    const list = buildConnections(input({ mcp: [mk('ok', true, 'ok'), mk('dead', true, 'fail'), mk('new', true, 'none'), mk('off', false, 'ok')] }))
    const by = Object.fromEntries(list.map((c) => [c.id, c]))
    expect(by['mcp:ok'].status).toBe('connected')
    expect(by['mcp:dead'].status).toBe('needs-signin')
    expect(by['mcp:dead'].detail).toBe('the sign-in could not be renewed')
    expect(by['mcp:new'].status).toBe('setup')
    expect(by['mcp:off'].status).toBe('off')
    expect(by['mcp:off'].kind).toBe('oauth')
  })
})

describe('accounts', () => {
  it('mail: OAuth accounts follow the probe; password accounts are connected without one', () => {
    const list = buildConnections(
      input({
        mail: [
          { id: 'a', displayName: 'Work', user: 'me@corp.com', authKind: 'xoauth2', provider: 'microsoft', probe: 'ok' },
          { id: 'b', displayName: 'Gmail', user: 'me@gmail.com', authKind: 'xoauth2', provider: 'google', probe: 'fail' },
          { id: 'c', displayName: 'Old', user: 'me@old.net', authKind: 'xoauth2', provider: 'google', probe: 'unconfigured' },
          { id: 'd', displayName: 'IMAP', user: 'me@host.net', authKind: 'basic', probe: 'skip' },
        ],
      }),
    )
    const by = Object.fromEntries(list.map((c) => [c.id, c]))
    expect(by['mail:a']).toMatchObject({ name: 'Microsoft 365 · Mail', status: 'connected', detail: 'me@corp.com', how: 'oauth · system browser' })
    expect(by['mail:b']).toMatchObject({ name: 'Google · Mail', status: 'needs-signin', detail: 'Google would not renew the sign-in' })
    expect(by['mail:c']).toMatchObject({ status: 'setup', detail: 'Google sign-in needs a client id' })
    expect(by['mail:d']).toMatchObject({ name: 'IMAP', status: 'connected', how: 'password · keychain' })
    expect(by['mail:a'].gives).toBe('Read and send mail as me@corp.com')
  })

  it('calendar: feeds and CalDAV are connected; cloud sources follow the probe', () => {
    const list = buildConnections(
      input({
        calendar: [
          { id: 'x', displayName: 'Holidays', kind: 'ics', probe: 'skip' },
          { id: 'y', displayName: 'iCloud', kind: 'caldav', probe: 'skip' },
          { id: 'z', displayName: 'Work', kind: 'microsoft', probe: 'fail' },
        ],
      }),
    )
    const by = Object.fromEntries(list.map((c) => [c.id, c]))
    expect(by['calendar:x']).toMatchObject({ status: 'connected', how: 'public feed' })
    expect(by['calendar:y']).toMatchObject({ status: 'connected', how: 'password · keychain' })
    expect(by['calendar:z']).toMatchObject({ name: 'Microsoft 365 · Calendar', status: 'needs-signin' })
  })

  it('drive is always one row: set up without a client id, then connect, then the probe', () => {
    const none = buildConnections(input({ googleConfigured: false })).find((c) => c.id === 'drive')!
    expect(none).toMatchObject({ status: 'setup', detail: 'needs a Google client id' })
    const idle = buildConnections(input({ drive: null })).find((c) => c.id === 'drive')!
    expect(idle).toMatchObject({ status: 'setup', detail: 'not connected yet' })
    const ok = buildConnections(input({ drive: { email: 'me@gmail.com', probe: 'ok' } })).find((c) => c.id === 'drive')!
    expect(ok).toMatchObject({ status: 'connected', detail: 'me@gmail.com' })
    const dead = buildConnections(input({ drive: { email: 'me@gmail.com', probe: 'fail' } })).find((c) => c.id === 'drive')!
    expect(dead.status).toBe('needs-signin')
  })
})

describe('sites and ordering', () => {
  it('a site with no session needs sign-in; everything sorts warm first, then connected, setup, off', () => {
    const list = buildConnections(
      input({
        sites: [
          { domain: 'asana.com', label: 'Asana', session: false },
          { domain: 'github.com', label: 'GitHub', session: true },
        ],
        mcp: [
          { id: 'notion', displayName: 'Notion', description: '', remote: false, enabled: false, secrets: [], oauth: 'none' },
          { id: 'slack', displayName: 'Slack', description: '', remote: false, enabled: true, secrets: [key(false)], oauth: 'none' },
        ],
        googleConfigured: false,
      }),
    )
    expect(list.map((c) => c.status)).toEqual(['needs-signin', 'connected', 'setup', 'setup', 'off'])
    expect(list[0].id).toBe('site:asana.com')
    expect(list[0].detail).toBe('no session for asana.com')
  })

  it('status line and stream sentence', () => {
    expect(connectionsStatus([])).toBe('Nothing is connected yet.')
    const list = buildConnections(
      input({
        sites: [
          { domain: 'asana.com', label: 'Asana', session: false },
          { domain: 'github.com', label: 'GitHub', session: true },
        ],
      }),
    )
    expect(connectionsStatus(list)).toBe('1 connected · 1 needs you to sign in again.')
    expect(connectionLine(list[0])).toBe('Asana needs you to sign in again')
    expect(connectionLine(list[1])).toBe('')
  })
})
