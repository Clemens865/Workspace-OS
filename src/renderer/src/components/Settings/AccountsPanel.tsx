import { useCallback, useEffect, useState } from 'react'
import { Globe, ShieldCheck } from 'lucide-react'
import styles from './SettingsPanel.module.css'
import { requestNewTab } from '../Browser/browserTabCommands'
import type { ConnectedAccountView } from '../../types/workspace-api'

/**
 * "Connected Accounts" — the user signs into a website ONCE by hand, in the real
 * site's own login form, on the in-app browser's persistent session. We record
 * only a non-secret entry (domain/label/addedAt) and show it here as a card they
 * can see + sign out of. The tab-driving agent inherits the authenticated session
 * automatically (shared partition).
 *
 * SECURITY: Workspace never sees, stores, or autofills a password. "Sign out"
 * clears that site's session data from the partition. Mirrors the Connectors/
 * Brand panel pattern: load on mount, act, reflect what main stored back.
 *
 * Sign-in flow: user types e.g. "linkedin.com" → we `add` (record intent) → we
 * dispatch `wos:browser-navigate` (switches to the Browser surface) and open a
 * fresh tab at the site → the user logs in themselves → once cookies exist for
 * the domain the card flips to "Active" (re-checked on focus + a short poll).
 */

/** The favicon for a domain via Google's service (display-only, no tracking of us). */
function faviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
}

export function AccountsPanel(): JSX.Element {
  const [accounts, setAccounts] = useState<ConnectedAccountView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const refresh = useCallback(async () => {
    try {
      setAccounts(await window.workspace.accounts.list())
    } catch {
      /* leave as-is */
    }
  }, [])

  useEffect(() => {
    refresh().catch(() => {})
  }, [refresh])

  // The session only becomes "Active" after the user logs in on the real site
  // (in another surface). Re-check when Settings regains focus and on a light
  // interval so the card flips without a manual reload.
  useEffect(() => {
    const onFocus = (): void => {
      refresh().catch(() => {})
    }
    window.addEventListener('focus', onFocus)
    const t = setInterval(() => refresh().catch(() => {}), 4000)
    return () => {
      window.removeEventListener('focus', onFocus)
      clearInterval(t)
    }
  }, [refresh])

  const signIn = async (): Promise<void> => {
    const url = draft.trim()
    if (!url) return
    setBusy(true)
    setErr('')
    try {
      const account = await window.workspace.accounts.add(url)
      setDraft('')
      await refresh()
      // Switch to the Browser surface and open a login tab at the site. Same
      // renderer-event + tab-command bus the agent's browser drive uses.
      const target = `https://${account.domain}`
      window.dispatchEvent(new CustomEvent('wos:browser-navigate', { detail: { url: target } }))
      await requestNewTab(target, true)
    } catch (e) {
      setErr((e as Error).message || 'Could not add that site')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (domain: string): Promise<void> => {
    try {
      await window.workspace.accounts.signout(domain)
      await refresh()
    } catch {
      /* ignore */
    }
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Connected Accounts</h3>
      <p className={styles.hint}>
        Sign into a website once and your agent can work there for you. You sign in on the real
        site — Workspace never sees your password. Signing out clears that site’s session here.
      </p>

      {accounts.map((a) => (
        <div key={a.domain} className={styles.connector}>
          <div className={styles.connectorHead}>
            <img
              src={faviconUrl(a.domain)}
              alt=""
              width={16}
              height={16}
              style={{ flex: 'none', borderRadius: 3 }}
              onError={(e) => {
                ;(e.currentTarget as HTMLImageElement).style.visibility = 'hidden'
              }}
            />
            <span className={styles.connectorName}>{a.label}</span>
            <span
              className={`${styles.badge} ${a.hasSession ? styles.badgeReady : styles.badgeNeeds}`}
            >
              {a.hasSession ? 'Active' : 'Signed out'}
            </span>
            <div className={styles.connectorToggle}>
              <button
                className={`${styles.btn} ${styles.btnDanger}`}
                onClick={() => signOut(a.domain)}
              >
                Sign out
              </button>
            </div>
          </div>
          <p className={styles.connectorDesc}>{a.domain}</p>
        </div>
      ))}

      <div className={styles.keyField} style={{ marginTop: accounts.length ? 10 : 4 }}>
        <input
          className={styles.pwInput}
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="Sign in to a site — e.g. linkedin.com"
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') signIn()
          }}
        />
        <button
          className={styles.btn}
          disabled={busy || !draft.trim()}
          onClick={() => signIn()}
        >
          <Globe size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          {busy ? 'Opening…' : 'Sign in to a site'}
        </button>
      </div>
      {err && <p className={styles.errText}>{err}</p>}
      <p className={styles.keyHint}>
        <ShieldCheck size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
        We open the real site in a browser tab so you can log in yourself. Only the session
        (a cookie in the encrypted browser store) is kept — never your password.
      </p>
    </section>
  )
}
