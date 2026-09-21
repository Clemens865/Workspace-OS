import { useCallback, useEffect, useMemo, useState } from 'react'
import { requestNewTab } from '../Browser/browserTabCommands'
import type { RailId } from '../Shell/shellModel'
import type { Connection, ConnectionStatus } from '../../types/workspace-api'
import styles from './ConnectorsView.module.css'

/**
 * CONNECTORS — everything the workspace is signed into, on one page.
 *
 * A connection used to live in one of four places (MCP keys, Connected
 * Accounts, mail, calendar, drive) and nothing said when a session had quietly
 * died. This page is one roster: a row per service, a status that was
 * COMPUTED in main (a refresh tried, a session checked), the honest mechanism
 * in words, what it gives agents, and the one action that fixes it.
 *
 * Warm rows first. Healthy rows stay pale — the rule is the same as on Home.
 * No secret value ever reaches this component; key fields only write.
 */

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  'needs-signin': 'Needs you to sign in again',
  setup: 'Not set up',
  off: 'Off',
}

function statusLine(list: Connection[]): string {
  if (list.length === 0) return 'Nothing is connected yet.'
  const warm = list.filter((c) => c.status === 'needs-signin').length
  const on = list.filter((c) => c.status === 'connected').length
  return `${on} connected · ${warm > 0 ? `${warm} need${warm === 1 ? 's' : ''} you to sign in again` : 'nothing needs you'}.`
}

export function ConnectorsView({ active, onNavigate }: { active: boolean; onNavigate?: (rail: RailId) => void }): JSX.Element {
  const [list, setList] = useState<Connection[] | null>(null)
  const [vault, setVault] = useState<{ available: boolean; backend: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [checking, setChecking] = useState(false)
  const [siteDraft, setSiteDraft] = useState('')

  const refresh = useCallback(async (force = false) => {
    if (force) setChecking(true)
    try {
      const [l, v] = await Promise.all([window.workspace.connections.list({ force }), window.workspace.secrets.status()])
      setList(l)
      setVault(v)
    } catch {
      setList((prev) => prev ?? [])
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (active) void refresh()
  }, [active, refresh])

  // A site only becomes connected after the person logs in on another surface;
  // re-read on focus and on a light interval while the page is showing.
  useEffect(() => {
    if (!active) return
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    const t = setInterval(() => void refresh(), 15_000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
    }
  }, [active, refresh])

  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusy((b) => ({ ...b, [id]: true }))
    setErrors((e) => ({ ...e, [id]: '' }))
    try {
      await fn()
      await refresh()
    } catch (err) {
      setErrors((e) => ({ ...e, [id]: (err as Error).message || 'That did not work' }))
    } finally {
      setBusy((b) => ({ ...b, [id]: false }))
    }
  }

  const openSite = async (domain: string): Promise<void> => {
    const url = `https://${domain}`
    window.dispatchEvent(new CustomEvent('wos:browser-navigate', { detail: { url } }))
    await requestNewTab(url, true)
  }

  const addSite = async (): Promise<void> => {
    const url = siteDraft.trim()
    if (!url) return
    await run('site:new', async () => {
      const account = await window.workspace.accounts.add(url)
      setSiteDraft('')
      await openSite(account.domain)
    })
  }

  /** The one action a row offers, by its source and status. */
  const primary = (c: Connection): { label: string; go: () => Promise<void> } | null => {
    const s = c.source
    switch (s.type) {
      case 'mcp': {
        const id = s.connectorId
        if (s.remote) {
          if (c.status === 'needs-signin' || c.status === 'setup')
            return {
              label: c.status === 'setup' ? 'Connect' : 'Sign in again',
              go: async () => {
                const r = await window.workspace.mcp.oauthConnect(id)
                if (!r.ok) throw new Error(r.error || 'Could not connect')
              },
            }
          return c.status === 'off'
            ? { label: 'Turn on', go: async () => void (await window.workspace.mcp.enable(id)) }
            : { label: 'Turn off', go: async () => void (await window.workspace.mcp.disable(id)) }
        }
        if (c.status === 'setup') return { label: 'Add key', go: async () => setOpen(c.id) }
        return c.status === 'off'
          ? { label: 'Turn on', go: async () => void (await window.workspace.mcp.enable(id)) }
          : { label: 'Turn off', go: async () => void (await window.workspace.mcp.disable(id)) }
      }
      case 'site':
        return c.status === 'connected'
          ? { label: 'Sign out', go: async () => void (await window.workspace.connections.signout(c.id)) }
          : { label: 'Sign in again', go: () => openSite(s.domain) }
      case 'mail':
        if (c.status === 'connected') return { label: 'Open Mail', go: async () => onNavigate?.('mail') }
        return { label: c.status === 'setup' ? 'Set up' : 'Sign in again', go: async () => onNavigate?.(c.status === 'setup' ? 'settings' : 'mail') }
      case 'calendar':
        if (c.status === 'connected') return { label: 'Open Calendar', go: async () => onNavigate?.('calendar') }
        return { label: c.status === 'setup' ? 'Set up' : 'Sign in again', go: async () => onNavigate?.(c.status === 'setup' ? 'settings' : 'calendar') }
      case 'drive':
        if (c.status === 'connected') return { label: 'Open Files', go: async () => onNavigate?.('files') }
        if (c.detail === 'needs a Google client id') return { label: 'Set up', go: async () => onNavigate?.('settings') }
        return {
          label: c.status === 'setup' ? 'Connect' : 'Sign in again',
          go: async () => {
            const r = await window.workspace.drive.connect('readOnly')
            if (!r.ok) throw new Error(r.error.message)
          },
        }
    }
  }

  /** Sign-out is destructive for accounts, so it lives in the expanded panel, never on the row. */
  const canSignOut = (c: Connection): boolean =>
    c.source.type !== 'site' && !(c.source.type === 'mcp' && c.status === 'setup' && !c.source.remote) && c.status !== 'setup'

  const sorted = useMemo(() => list ?? [], [list])
  const secureUnavailable = !!vault && !vault.available

  return (
    <div className={`wos ${styles.root}`} data-testid="connectors-view">
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Connectors</h1>
          <p className={styles.status} data-testid="connectors-status">
            {list === null ? 'Checking what is signed in…' : statusLine(sorted)}
          </p>
        </div>
        <button className={styles.quiet} onClick={() => void refresh(true)} disabled={checking} title="Try every sign-in again now">
          {checking ? 'Checking…' : 'Check again'}
        </button>
      </header>

      {secureUnavailable && (
        <p className={styles.warn}>
          Secure storage is unavailable on this system (backend: {vault?.backend}), so keys cannot be stored safely. Install a system
          keychain and restart.
        </p>
      )}

      <div className={styles.scroll}>
        <ol className={styles.list}>
          {sorted.map((c) => {
            const act = primary(c)
            const expanded = open === c.id
            return (
              <li key={c.id} className={`${styles.row} ${styles[`s_${c.status.replace('-', '_')}`]}`} data-testid="connection-row" data-status={c.status}>
                <button className={styles.main} onClick={() => setOpen(expanded ? null : c.id)} aria-expanded={expanded}>
                  <span className={styles.dot} aria-hidden />
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.how}>{c.how}</span>
                  <span className={styles.gives}>{c.gives}</span>
                  <span className={styles.detail} title={STATUS_LABEL[c.status]}>
                    {c.status === 'needs-signin' || c.status === 'setup' ? c.detail || STATUS_LABEL[c.status] : c.detail}
                  </span>
                </button>
                {act && (
                  <button
                    className={`${styles.action} ${c.status === 'needs-signin' || c.status === 'setup' ? styles.actionWarm : ''}`}
                    disabled={!!busy[c.id] || (secureUnavailable && c.source.type === 'mcp')}
                    onClick={() => void run(c.id, act.go)}
                    data-testid="connection-action"
                  >
                    {busy[c.id] ? '…' : act.label}
                  </button>
                )}

                {expanded && (
                  <div className={styles.panel}>
                    <p className={styles.panelLine}>
                      <strong>{STATUS_LABEL[c.status]}.</strong> {c.gives} Connected through {c.how}.
                    </p>
                    {c.source.type === 'mcp' &&
                      c.source.secrets.map((s) => (
                        <div key={s.envVar} className={styles.key}>
                          <label className={styles.keyLabel}>
                            {s.label}
                            {s.stored && <span className={styles.stored}> · stored</span>}
                          </label>
                          <div className={styles.keyField}>
                            <input
                              className={styles.input}
                              type="password"
                              autoComplete="off"
                              placeholder={s.stored ? 'Replace the stored key…' : 'Paste the key…'}
                              value={drafts[s.envVar] ?? ''}
                              disabled={secureUnavailable}
                              onChange={(e) => setDrafts((d) => ({ ...d, [s.envVar]: e.target.value }))}
                            />
                            <button
                              className={styles.quiet}
                              disabled={secureUnavailable || !(drafts[s.envVar] ?? '').trim()}
                              onClick={() =>
                                void run(c.id, async () => {
                                  await window.workspace.secrets.set(s.envVar, drafts[s.envVar])
                                  setDrafts((d) => ({ ...d, [s.envVar]: '' }))
                                })
                              }
                            >
                              {s.stored ? 'Update' : 'Save key'}
                            </button>
                          </div>
                          <p className={styles.hint}>{s.hint}</p>
                        </div>
                      ))}
                    {canSignOut(c) && (
                      <button
                        className={`${styles.quiet} ${styles.danger}`}
                        onClick={() => void run(c.id, async () => void (await window.workspace.connections.signout(c.id)))}
                        data-testid="connection-signout"
                      >
                        {c.source.type === 'mcp' ? 'Forget and turn off' : 'Sign out and remove'}
                      </button>
                    )}
                  </div>
                )}
                {errors[c.id] && <p className={styles.error}>{errors[c.id]}</p>}
              </li>
            )
          })}
        </ol>

        <div className={styles.add}>
          <input
            className={styles.input}
            type="text"
            inputMode="url"
            autoComplete="off"
            placeholder="Sign in to a site — e.g. asana.com"
            value={siteDraft}
            disabled={!!busy['site:new']}
            onChange={(e) => setSiteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addSite()
            }}
            data-testid="connectors-add-site"
          />
          <button className={styles.quiet} disabled={!!busy['site:new'] || !siteDraft.trim()} onClick={() => void addSite()}>
            Sign in to a site
          </button>
        </div>
        {errors['site:new'] && <p className={styles.error}>{errors['site:new']}</p>}
        <p className={styles.hint}>
          You sign in on the real site, in a browser tab here. Only the session is kept, in the encrypted browser store, and
          agents then work there as you. Keys and sign-in tokens live in your OS keychain and never show here again.
        </p>
      </div>
    </div>
  )
}
