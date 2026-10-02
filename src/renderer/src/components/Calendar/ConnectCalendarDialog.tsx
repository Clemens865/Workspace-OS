import { useCallback, useState } from 'react'
import type { CalendarCollection } from '../../types/workspace-api'
import styles from './ConnectCalendarDialog.module.css'

/**
 * Connect a calendar: a CalDAV account, or a subscribed .ics link.
 *
 * The flow is TEST then SAVE, deliberately. Saving first and discovering the
 * password was wrong on the next sync produces an account that looks connected
 * and silently shows nothing — so the button verifies, reports what it found, and
 * only then offers to add it. The user picks which of the discovered calendars to
 * include before anything is written.
 */
type Kind = 'caldav' | 'ics'

interface Props {
  onClose: () => void
  onConnected: () => void
}

export function ConnectCalendarDialog({ onClose, onConnected }: Props): JSX.Element {
  const [kind, setKind] = useState<Kind>('caldav')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [found, setFound] = useState<CalendarCollection[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())

  const connectOAuth = useCallback(async (provider: 'google' | 'microsoft') => {
    setBusy(true); setError(null)
    try {
      const res = await window.workspace.calendar.connectOAuth(provider, displayName)
      if (res.ok) onConnected()
      else setError(res.error)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [displayName, onConnected])

  const test = useCallback(async () => {
    setBusy(true); setError(null); setFound(null)
    try {
      const res = await window.workspace.calendar.test(
        kind === 'caldav' ? { kind, url, username, password } : { kind, url },
      )
      if (res.ok) {
        setFound(res.calendars)
        setChosen(new Set(res.calendars.map((c) => c.url))) // default: all
        if (!displayName.trim()) setDisplayName(res.calendars[0]?.displayName ?? 'Calendar')
      } else {
        setError(res.error)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [kind, url, username, password, displayName])

  const save = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      await window.workspace.calendar.add({
        kind,
        url,
        displayName,
        ...(kind === 'caldav' ? { username, password } : {}),
        // Only meaningful for CalDAV; an .ics feed is one calendar by definition.
        ...(kind === 'caldav' && found ? { enabledCalendars: [...chosen] } : {}),
      })
      onConnected()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [kind, url, displayName, username, password, found, chosen, onConnected])

  const toggle = (u: string): void => {
    setChosen((prev) => {
      const next = new Set(prev)
      if (next.has(u)) next.delete(u)
      else next.add(u)
      return next
    })
  }

  const canTest = url.trim() !== '' && (kind === 'ics' || (username.trim() !== '' && password !== ''))

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.heading}>Add a calendar</h2>

        {/* Google / Microsoft sign in through the provider's own consent screen —
            no password is ever typed here, and only a refresh token is kept. */}
        <div className={styles.oauth}>
          <button className={styles.oauthBtn} disabled={busy} onClick={() => void connectOAuth('google')}>
            Sign in with Google
          </button>
          <button className={styles.oauthBtn} disabled={busy} onClick={() => void connectOAuth('microsoft')}>
            Sign in with Microsoft
          </button>
        </div>
        <p className={styles.orLine}>or connect it yourself</p>

        <div className={styles.kinds}>
          <button className={kind === 'caldav' ? styles.kindOn : styles.kindOff} onClick={() => { setKind('caldav'); setFound(null) }}>
            CalDAV account
          </button>
          <button className={kind === 'ics' ? styles.kindOn : styles.kindOff} onClick={() => { setKind('ics'); setFound(null) }}>
            Subscribed link
          </button>
        </div>

        <label className={styles.field}>
          <span>{kind === 'caldav' ? 'Server or calendar address' : 'Calendar link (.ics or webcal)'}</span>
          <input
            className={styles.input}
            value={url}
            onChange={(e) => { setUrl(e.target.value); setFound(null) }}
            placeholder={kind === 'caldav' ? 'https://caldav.icloud.com' : 'https://example.com/calendar.ics'}
            spellCheck={false}
            autoFocus
          />
        </label>

        {kind === 'caldav' && (
          <>
            <label className={styles.field}>
              <span>Username</span>
              <input className={styles.input} value={username} onChange={(e) => { setUsername(e.target.value); setFound(null) }} spellCheck={false} />
            </label>
            <label className={styles.field}>
              <span>App password</span>
              <input className={styles.input} type="password" value={password} onChange={(e) => { setPassword(e.target.value); setFound(null) }} />
              <small className={styles.hint}>
                Use an app-specific password, not your account password — iCloud and Fastmail
                require one, and it can be revoked without changing your login.
              </small>
            </label>
          </>
        )}

        <label className={styles.field}>
          <span>Name in Workspace OS</span>
          <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Work" />
        </label>

        {error && <p className={styles.error}>{error}</p>}

        {found && (
          <div className={styles.found}>
            <p className={styles.foundHead}>
              {kind === 'ics'
                ? 'That link works.'
                : `Found ${found.length} calendar${found.length === 1 ? '' : 's'} — choose what to show:`}
            </p>
            {kind === 'caldav' && found.map((c) => (
              <label key={c.url} className={styles.check}>
                <input type="checkbox" checked={chosen.has(c.url)} onChange={() => toggle(c.url)} />
                <span>{c.displayName}</span>
              </label>
            ))}
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.secondary} onClick={onClose} disabled={busy}>Cancel</button>
          {found ? (
            <button className={styles.primary} onClick={() => void save()} disabled={busy || (kind === 'caldav' && chosen.size === 0)}>
              {busy ? 'Adding…' : 'Add calendar'}
            </button>
          ) : (
            <button className={styles.primary} onClick={() => void test()} disabled={busy || !canTest}>
              {busy ? 'Checking…' : 'Check connection'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
