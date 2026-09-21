import { useState, useEffect } from 'react'
import { X, Check, AlertCircle, Loader2, Sparkles } from 'lucide-react'
import type { MailAccount, MailProviderInfo } from '../../types/workspace-api'
import styles from './MailAccountDialog.module.css'

interface MailAccountDialogProps {
  onClose: () => void
  onSaved: (account: MailAccount) => void
  /** One-click: add the built-in demo mailbox instead of a real account. */
  onTryDemo?: () => void
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string }

/**
 * Renderer-side preset table for the one-click preset buttons. Kept tiny and
 * offline (the buttons must feel instant); the authoritative table with auth
 * notes + ISPDB fallback lives in the main process behind `mail.autoconfig`,
 * which the email-address blur uses to auto-fill any provider (incl. these).
 *
 * Ports follow each provider's documented submission port: 465 (implicit TLS)
 * or 587 (STARTTLS). The main process derives the real `secure` flag from the
 * port at send-time — the renderer only carries host/port + a "use TLS" flag.
 */
interface Preset {
  id: string
  label: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
  note: string
  oauth?: boolean
}

const PRESETS: Preset[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    note: 'Gmail requires an App Password (not your normal password), or sign in with Google below.',
    oauth: true,
  },
  {
    id: 'icloud',
    label: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    note: 'iCloud Mail requires an app-specific password (appleid.apple.com → Sign-In and Security → App-Specific Passwords).',
  },
  {
    id: 'outlook',
    label: 'Outlook',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    note: 'Outlook / Hotmail / Live now require “Sign in with Microsoft” below — Microsoft disabled password sign-in for IMAP/SMTP in 2024.',
    oauth: true,
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    note: 'Yahoo Mail requires an app password (Yahoo Account Security → Generate app password).',
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    imapHost: 'imap.fastmail.com',
    imapPort: 993,
    smtpHost: 'smtp.fastmail.com',
    smtpPort: 465,
    note: 'Fastmail requires an app password (Settings → Privacy & Security → App Passwords).',
  },
]

const GMAIL_HOST = 'imap.gmail.com'
const OUTLOOK_HOST = 'outlook.office365.com'

/**
 * Add-an-IMAP-account dialog. The password uses a secure input, is sent only to
 * the main process on Test/Save, and is never held anywhere but this component's
 * local state (cleared on close). "Test connection" validates before saving.
 *
 * One-click multi-provider setup: a preset row fills every server field, and
 * typing an email address auto-detects the servers via `mail.autoconfig`
 * (curated table → Mozilla ISPDB → heuristic guess) with a per-provider hint.
 */
export function MailAccountDialog({ onClose, onSaved, onTryDemo }: MailAccountDialogProps): JSX.Element {
  const [displayName, setDisplayName] = useState('')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState(993)
  const [tls, setTls] = useState(true)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(465)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  // OAuth: whether a Google client id is configured, and in-flight sign-in state.
  const [oauthConfigured, setOauthConfigured] = useState<boolean | null>(null)
  const [oauth, setOauth] = useState<TestState>({ kind: 'idle' })
  // OAuth (Microsoft): same two pieces of state for the Outlook path.
  const [msConfigured, setMsConfigured] = useState<boolean | null>(null)
  const [msOauth, setMsOauth] = useState<TestState>({ kind: 'idle' })
  // The active provider hint (from a preset click or an autoconfig lookup).
  const [authNote, setAuthNote] = useState<string | null>(null)
  const [supportsOAuth, setSupportsOAuth] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectSource, setDetectSource] = useState<'table' | 'ispdb' | 'guess' | null>(null)
  // The last email we auto-detected, so we don't re-run on an unchanged blur.
  const [detectedFor, setDetectedFor] = useState('')

  const isGmail = host === GMAIL_HOST
  const isOutlook = host === OUTLOOK_HOST

  useEffect(() => {
    let live = true
    void window.workspace.mail
      .oauthConfigured()
      .then((r) => { if (live) setOauthConfigured(r.configured) })
      .catch(() => { if (live) setOauthConfigured(false) })
    void window.workspace.mail
      .oauthMicrosoftConfigured()
      .then((r) => { if (live) setMsConfigured(r.configured) })
      .catch(() => { if (live) setMsConfigured(false) })
    return () => { live = false }
  }, [])

  /** Apply a resolved provider (from a preset button or autoconfig) to the form. */
  const applyProvider = (p: {
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
    note: string
    oauth: boolean
  }): void => {
    setHost(p.imapHost)
    setPort(p.imapPort)
    setSmtpHost(p.smtpHost)
    setSmtpPort(p.smtpPort)
    setTls(true)
    setAuthNote(p.note)
    setSupportsOAuth(p.oauth)
  }

  const applyPreset = (p: Preset): void => {
    applyProvider({
      imapHost: p.imapHost,
      imapPort: p.imapPort,
      smtpHost: p.smtpHost,
      smtpPort: p.smtpPort,
      note: p.note,
      oauth: p.oauth ?? false,
    })
    setDetectSource(null)
  }

  /** "Other" — clear the servers so the user fills them manually. */
  const applyOther = (): void => {
    setHost('')
    setPort(993)
    setSmtpHost('')
    setSmtpPort(465)
    setAuthNote(null)
    setSupportsOAuth(false)
    setDetectSource(null)
  }

  const fromProviderInfo = (info: MailProviderInfo): void =>
    applyProvider({
      imapHost: info.imap.host,
      imapPort: info.imap.port,
      smtpHost: info.smtp.host,
      smtpPort: info.smtp.port,
      note: info.authNote,
      oauth: info.supportsOAuth,
    })

  /**
   * On email blur/change, ask the main process to resolve the servers. Only runs
   * when the address changed and looks complete; failures are silent (the user
   * can still fill fields by hand or click a preset).
   */
  const detectFromEmail = async (): Promise<void> => {
    const email = user.trim()
    if (!email.includes('@') || !email.split('@')[1]?.includes('.')) return
    if (email === detectedFor) return
    setDetectedFor(email)
    setDetecting(true)
    try {
      const res = await window.workspace.mail.autoconfig(email)
      if (res.ok) {
        fromProviderInfo(res.value.provider)
        setDetectSource(res.value.source)
      }
    } catch {
      /* silent — manual entry still works */
    } finally {
      setDetecting(false)
    }
  }

  const buildPayload = () => ({
    displayName: displayName.trim() || user.trim(),
    user: user.trim(),
    imap: { host: host.trim(), port, tls },
    smtp: smtpHost.trim() ? { host: smtpHost.trim(), port: smtpPort, tls: true } : null,
  })

  const canSubmit = user.trim() && host.trim() && password && !saving

  const runTest = async (): Promise<boolean> => {
    setTest({ kind: 'testing' })
    try {
      const res = await window.workspace.mail.accounts.test(buildPayload(), password)
      if (res.ok) {
        setTest({ kind: 'ok' })
        return true
      }
      setTest({ kind: 'error', message: res.error.message })
      return false
    } catch {
      setTest({ kind: 'error', message: 'Could not run the connection test.' })
      return false
    }
  }

  /**
   * Alternative to the password path: run the Google OAuth loopback flow in the
   * main process. On success an xoauth2 account is created (secret = refresh
   * token, stored encrypted) and we hand the record back like a normal save.
   */
  const handleGoogleSignIn = async (): Promise<void> => {
    if (!user.trim()) {
      setOauth({ kind: 'error', message: 'Enter your Gmail address first.' })
      return
    }
    setOauth({ kind: 'testing' })
    try {
      const res = await window.workspace.mail.oauthGoogle({
        displayName: displayName.trim() || user.trim(),
        user: user.trim(),
        imap: { host: 'imap.gmail.com', port: 993, tls: true },
        smtp: { host: 'smtp.gmail.com', port: 465, tls: true },
      })
      if (res.ok) {
        setOauth({ kind: 'ok' })
        onSaved(res.value)
      } else {
        setOauth({ kind: 'error', message: res.error.message })
      }
    } catch {
      setOauth({ kind: 'error', message: 'Google sign-in could not be started.' })
    }
  }

  /**
   * Microsoft sign-in — the ONLY working path for consumer Outlook/Hotmail/Live/
   * MSN since Microsoft disabled basic auth in 2024. Runs the loopback flow in the
   * main process; on success an xoauth2 account (authProvider: microsoft, secret =
   * refresh token, stored encrypted) is created and handed back like a save.
   */
  const handleMicrosoftSignIn = async (): Promise<void> => {
    if (!user.trim()) {
      setMsOauth({ kind: 'error', message: 'Enter your Outlook address first.' })
      return
    }
    setMsOauth({ kind: 'testing' })
    try {
      const res = await window.workspace.mail.oauthMicrosoft({
        displayName: displayName.trim() || user.trim(),
        user: user.trim(),
        imap: { host: 'outlook.office365.com', port: 993, tls: true },
        smtp: { host: 'smtp-mail.outlook.com', port: 587, tls: true },
      })
      if (res.ok) {
        setMsOauth({ kind: 'ok' })
        onSaved(res.value)
      } else {
        setMsOauth({ kind: 'error', message: res.error.message })
      }
    } catch {
      setMsOauth({ kind: 'error', message: 'Microsoft sign-in could not be started.' })
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!canSubmit) return
    setSaving(true)
    // Guard the save with a live connection test so we never persist creds that
    // don't work — the user gets a clear reason instead of a broken account.
    const ok = await runTest()
    if (!ok) {
      setSaving(false)
      return
    }
    try {
      const account = await window.workspace.mail.accounts.add(buildPayload(), password)
      setPassword('') // drop the plaintext from renderer memory immediately
      onSaved(account)
    } catch {
      setTest({ kind: 'error', message: 'Saving the account failed.' })
      setSaving(false)
    }
  }

  // OAuth is offered per-provider: Google for Gmail, Microsoft for Outlook.
  const showOAuth = isGmail && supportsOAuth
  const showMsOAuth = isOutlook && supportsOAuth

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Add mail account</span>
          <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          {onTryDemo && (
            <button
              className={styles.demoRow}
              onClick={onTryDemo}
              title="Explore the whole mail client on a seeded, offline mailbox — no credentials needed"
            >
              <Sparkles size={14} />
              <span><strong>Try a demo mailbox</strong> — no credentials, no network. Explore the full client on seeded mail.</span>
            </button>
          )}

          <div className={styles.presetRow}>
            <span className={styles.hint}>Provider:</span>
            {PRESETS.map((p) => (
              <button key={p.id} className={styles.preset} onClick={() => applyPreset(p)}>{p.label}</button>
            ))}
            <button className={styles.preset} onClick={applyOther}>Other</button>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>Display name</span>
            <input className={styles.input} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Work mail" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Email / username</span>
            <input
              className={styles.input}
              value={user}
              autoComplete="off"
              onChange={(e) => setUser(e.target.value)}
              onBlur={() => void detectFromEmail()}
              placeholder="you@example.com"
            />
            {detecting && <span className={styles.hint}><Loader2 size={12} className={styles.spin} /> Detecting servers…</span>}
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Password</span>
            <input className={styles.input} type="password" value={password} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} placeholder="App password" />
          </label>
          {authNote && (
            <p className={styles.note}>
              {authNote}
              {detectSource === 'ispdb' && ' (Servers were detected automatically — please verify.)'}
              {detectSource === 'guess' && ' (Servers are a best guess from your domain — please verify.)'}
            </p>
          )}

          {showOAuth && oauthConfigured && (
            <div className={styles.oauthRow}>
              <span className={styles.hint}>or</span>
              <button
                className={styles.oauthBtn}
                onClick={() => void handleGoogleSignIn()}
                disabled={oauth.kind === 'testing' || !user.trim()}
                title="Sign in with Google (OAuth) instead of an App Password"
              >
                {oauth.kind === 'testing'
                  ? <><Loader2 size={13} className={styles.spin} /> Waiting for Google…</>
                  : 'Sign in with Google'}
              </button>
            </div>
          )}
          {showOAuth && oauthConfigured === false && (
            <ClientIdSetup
              provider="google"
              title="Sign in with Google"
              help="Paste the OAuth client id from your Google Cloud project (APIs & Services ▸ Credentials ▸ OAuth client ID, type “Desktop app”). It ends in .apps.googleusercontent.com. An App Password still works below."
              placeholder="1234567890-abc.apps.googleusercontent.com"
              onSaved={() => setOauthConfigured(true)}
            />
          )}
          {oauth.kind === 'error' && (
            <div className={`${styles.testResult} ${styles.testError}`}><AlertCircle size={14} /> {oauth.message}</div>
          )}

          {showMsOAuth && msConfigured && (
            <div className={styles.oauthRow}>
              <span className={styles.hint}>or</span>
              <button
                className={styles.oauthBtn}
                onClick={() => void handleMicrosoftSignIn()}
                disabled={msOauth.kind === 'testing' || !user.trim()}
                title="Sign in with Microsoft (OAuth) — required for Outlook / Hotmail / Live"
              >
                {msOauth.kind === 'testing'
                  ? <><Loader2 size={13} className={styles.spin} /> Waiting for Microsoft…</>
                  : 'Sign in with Microsoft'}
              </button>
            </div>
          )}
          {showMsOAuth && msConfigured === false && (
            <ClientIdSetup
              provider="microsoft"
              title="Sign in with Microsoft"
              help="Microsoft turned off password sign-in for Outlook/Hotmail over IMAP in 2024, so a password cannot work here. Register a free app at portal.azure.com (App registrations ▸ New registration ▸ any org + personal accounts ▸ redirect “Mobile and desktop” → http://localhost, then Authentication ▸ allow public client flows = Yes) and paste its Application (client) ID."
              placeholder="11111111-2222-3333-4444-555555555555"
              onSaved={() => setMsConfigured(true)}
            />
          )}
          {msOauth.kind === 'error' && (
            <div className={`${styles.testResult} ${styles.testError}`}><AlertCircle size={14} /> {msOauth.message}</div>
          )}

          <div className={styles.row}>
            <label className={`${styles.field} ${styles.grow}`}>
              <span className={styles.label}>IMAP host</span>
              <input className={styles.input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="imap.example.com" />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Port</span>
              <input className={`${styles.input} ${styles.portInput}`} type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 993)} />
            </label>
          </div>

          <label className={styles.checkRow}>
            <input type="checkbox" checked={tls} onChange={(e) => setTls(e.target.checked)} />
            <span>Use TLS/SSL (recommended)</span>
          </label>

          <details className={styles.advanced}>
            <summary>SMTP (for sending)</summary>
            <div className={styles.row}>
              <label className={`${styles.field} ${styles.grow}`}>
                <span className={styles.label}>SMTP host</span>
                <input className={styles.input} value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Port</span>
                <input className={`${styles.input} ${styles.portInput}`} type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value) || 465)} />
              </label>
            </div>
            <p className={styles.note}>
              Port 465 uses implicit TLS; port 587 uses STARTTLS. Both are secure — pick the one your provider lists.
            </p>
          </details>

          {test.kind === 'ok' && (
            <div className={`${styles.testResult} ${styles.testOk}`}><Check size={14} /> Connection succeeded</div>
          )}
          {test.kind === 'error' && (
            <div className={`${styles.testResult} ${styles.testError}`}><AlertCircle size={14} /> {test.message}</div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.secondary} onClick={() => void runTest()} disabled={!user.trim() || !host.trim() || !password || test.kind === 'testing'}>
            {test.kind === 'testing' ? <><Loader2 size={13} className={styles.spin} /> Testing…</> : 'Test connection'}
          </button>
          <div className={styles.footerRight}>
            <button className={styles.ghost} onClick={onClose}>Cancel</button>
            <button className={styles.primary} onClick={() => void handleSave()} disabled={!canSubmit}>
              {saving ? <><Loader2 size={13} className={styles.spin} /> Saving…</> : 'Add account'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Collects an OAuth client id in the dialog instead of sending the user off to
 * hand-create a JSON file in a folder they cannot see.
 *
 * The client id is PUBLIC — an installed-app id with no client secret (PKCE) —
 * so there is nothing sensitive about typing it here. What was actually broken
 * was the instruction: the app's own error told people to go and write JSON
 * somewhere invisible, which is where connecting Outlook stopped for most users.
 */
function ClientIdSetup({
  provider,
  title,
  help,
  placeholder,
  onSaved,
}: {
  provider: 'google' | 'microsoft'
  title: string
  help: string
  placeholder: string
  onSaved: () => void
}): JSX.Element {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.workspace.mail.oauthSetClientId(provider, value)
      onSaved()
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+':\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.note}>
      <p style={{ marginTop: 0 }}>
        To enable <strong>{title}</strong>, this app needs a one-time client id. {help}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input
          className={styles.input}
          style={{ flex: 1 }}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) void save() }}
        />
        <button className={styles.oauthBtn} disabled={busy || !value.trim()} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && (
        <div className={`${styles.testResult} ${styles.testError}`} style={{ marginTop: 8 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  )
}
