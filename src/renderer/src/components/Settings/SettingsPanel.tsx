import { useEffect, useState } from 'react'
import { useAgentModels, refreshCodexModels } from '../../lib/agentModels'
import { X, Check, AlertCircle, Sun, Moon } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { useTheme } from '../../hooks/useTheme'
import { ConnectorsPanel } from './ConnectorsPanel'
import { BrandPanel } from './BrandPanel'
import { AccountsPanel } from './AccountsPanel'
import styles from './SettingsPanel.module.css'

interface SettingsPanelProps {
  onClose: () => void
}

type Status = { engine: boolean; python: boolean; claude: { ok: boolean; path: string | null } }

const FORMATS: { value: 'md' | 'csv' | 'docx' | 'xlsx' | 'pptx'; label: string }[] = [
  { value: 'md', label: 'Markdown (.md)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'pptx', label: 'PowerPoint (.pptx)' },
]

type NotifyPrefs = { approvals: boolean; routines: boolean; cases: boolean; connectors: boolean }
const NOTIFY_ROWS: { key: keyof NotifyPrefs; label: string; hint: string }[] = [
  { key: 'approvals', label: 'An agent is asking', hint: 'A permission request waiting in the dock.' },
  { key: 'routines', label: 'A routine needs a look', hint: 'A scheduled or background run landed for review.' },
  { key: 'cases', label: 'A case is waiting on you', hint: 'Off by default — most status changes are your own.' },
  { key: 'connectors', label: 'A sign-in died', hint: 'A connector needs you to sign in again.' },
]

/** Needs-you notifications — prefs live in main so it can decide with no window open. */
function NotificationsSection(): JSX.Element {
  const [prefs, setPrefs] = useState<(NotifyPrefs & { supported: boolean }) | null>(null)
  const [sent, setSent] = useState('')
  useEffect(() => {
    window.workspace.notify?.prefs().then(setPrefs).catch(() => {})
  }, [])
  const flip = async (key: keyof NotifyPrefs, on: boolean): Promise<void> => {
    const next = await window.workspace.notify.setPrefs({ [key]: on })
    setPrefs((p) => (p ? { ...next, supported: p.supported } : p))
  }
  const test = async (): Promise<void> => {
    const r = await window.workspace.notify.request({ source: 'test', key: `test-${Date.now()}`, title: 'Workspace OS', body: 'This is how a needs-you notification looks.', rail: 'agents' })
    setSent(r.result === 'show' ? 'Sent.' : r.result === 'unsupported' ? 'Notifications are not available on this system.' : r.result)
  }
  return (
    <section className={styles.section} data-testid="settings-notifications">
      <h3 className={styles.sectionTitle}>Notifications</h3>
      <p className={styles.hint}>
        A knock on the door when something needs you and you are not looking. One per thing per ten minutes, never more.
      </p>
      {prefs && !prefs.supported && <p className={styles.errText}>Notifications are not available on this system.</p>}
      {NOTIFY_ROWS.map((row) => (
        <div key={row.key} className={styles.connector}>
          <div className={styles.connectorHead}>
            <span className={styles.connectorName}>{row.label}</span>
            <div className={styles.connectorToggle}>
              <div className={styles.segmented}>
                <button className={prefs?.[row.key] ? styles.segOn : styles.segOff} onClick={() => void flip(row.key, true)} data-testid={`notify-${row.key}-on`}>On</button>
                <button className={prefs && !prefs[row.key] ? styles.segOn : styles.segOff} onClick={() => void flip(row.key, false)} data-testid={`notify-${row.key}-off`}>Off</button>
              </div>
            </div>
          </div>
          <p className={styles.connectorDesc}>{row.hint}</p>
        </div>
      ))}
      <div className={styles.keyField}>
        <button className={styles.btn} onClick={() => void test()} data-testid="notify-test">Send a test notification</button>
        {sent && <span className={styles.keyHint}>{sent}</span>}
      </div>
    </section>
  )
}

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const agentModels = useAgentModels()
  const [codexStatus, setCodexStatus] = useState('')
  const checkCodex = async (): Promise<void> => {
    setCodexStatus('Checking Codex…')
    const status = await refreshCodexModels()
    setCodexStatus(status.error ?? `Codex: ${status.account}`)
  }
  const settings = useSettings()
  const { theme, toggle } = useTheme()
  const [status, setStatus] = useState<Status | null>(null)

  useEffect(() => {
    window.workspace.system.status().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const StatusRow = ({ label, ok, detail }: { label: string; ok: boolean; detail?: string }): JSX.Element => (
    <div className={styles.statusRow}>
      {ok ? <Check size={15} className={styles.ok} /> : <AlertCircle size={15} className={styles.bad} />}
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusDetail}>{detail ?? (ok ? 'Ready' : 'Not found')}</span>
    </div>
  )

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Appearance</h3>
            <div className={styles.segmented}>
              <button className={theme === 'light' ? styles.segOn : styles.segOff} onClick={() => theme !== 'light' && toggle()}>
                <Sun size={14} /> Light
              </button>
              <button className={theme === 'dark' ? styles.segOn : styles.segOff} onClick={() => theme !== 'dark' && toggle()}>
                <Moon size={14} /> Dark
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Design</h3>
            <p className={styles.hint}>
              The new shell — a left rail, Stage tabs, and a Home that surfaces what needs you — is the
              default. Classic brings back the previous layout; Landscape is the Screen Landscape shell,
              in progress. Switch any time, nothing is lost.
            </p>
            <div className={styles.segmented}>
              <button
                className={settings.landscapeShell ? styles.segOn : styles.segOff}
                onClick={() => settings.set('landscapeShell', true)}
                data-testid="shell-landscape"
              >
                Landscape
              </button>
              <button
                className={!settings.landscapeShell && settings.newShell ? styles.segOn : styles.segOff}
                onClick={() => { settings.set('landscapeShell', false); settings.set('newShell', true) }}
              >
                New
              </button>
              <button
                className={!settings.landscapeShell && !settings.newShell ? styles.segOn : styles.segOff}
                onClick={() => { settings.set('landscapeShell', false); settings.set('newShell', false) }}
              >
                Classic
              </button>
            </div>
          </section>

          {settings.newShell && (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Terminal dock</h3>
              <p className={styles.hint}>
                The integrated terminal + agent dock (toggle any time with ⌘J). Choose where it sits.
              </p>
              <div className={styles.segmented}>
                <button
                  className={settings.terminalPlacement === 'bottom' ? styles.segOn : styles.segOff}
                  onClick={() => settings.set('terminalPlacement', 'bottom')}
                >
                  Bottom
                </button>
                <button
                  className={settings.terminalPlacement === 'right' ? styles.segOn : styles.segOff}
                  onClick={() => settings.set('terminalPlacement', 'right')}
                >
                  Right
                </button>
              </div>
            </section>
          )}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Default agent mode</h3>
            <p className={styles.hint}>Applied to new agent sessions. Full allows edits + shell (destructive commands blocked); Safe is read + generate only.</p>
            <div className={styles.segmented}>
              <button className={settings.agentMode === 'full' ? styles.segOn : styles.segOff} onClick={() => settings.set('agentMode', 'full')}>⚡ Full</button>
              <button className={settings.agentMode === 'safe' ? styles.segOn : styles.segOff} onClick={() => settings.set('agentMode', 'safe')}>🛡 Safe</button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Auto-approve reversible actions</h3>
            <p className={styles.hint}>
              When on, reversible requests (a checkpointed edit, a read-only web fetch) are approved automatically across
              all agent lanes — and always logged as a resolved card so it stays auditable. Irreversible or outbound
              actions (shell commands, network connections) still always ask you. Off by default.
            </p>
            <div className={styles.segmented}>
              <button
                className={settings.autoApproveReversible ? styles.segOn : styles.segOff}
                onClick={() => settings.set('autoApproveReversible', true)}
              >
                On
              </button>
              <button
                className={!settings.autoApproveReversible ? styles.segOn : styles.segOff}
                onClick={() => settings.set('autoApproveReversible', false)}
              >
                Off
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Default new-file format</h3>
            <select className={styles.select} value={settings.newFileFormat} onChange={(e) => settings.set('newFileFormat', e.target.value as typeof settings.newFileFormat)}>
              {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Models</h3>
            <p className={styles.hint}>
              The model — and the provider — agents run on: in the dock, on Home, in cases, routines
              and the interactive session. Claude names are aliases that follow the latest generation,
              so a choice never goes stale; Codex runs through its own CLI (sign in with <code>codex login</code>). A specialist's own <code>wos_model</code> and the model chip in the dock override it
              for that agent or session.
            </p>
            <select
              className={styles.select}
              value={settings.agentModel}
              onChange={(e) => settings.set('agentModel', e.target.value)}
              title="Model for agent runs: the dock, the Home assistant, cases, routines and the interactive session. An agent's own wos_model and a per-session pick in the dock override it."
              data-testid="agent-model"
            >
              {agentModels.map((m) => <option key={m.id} value={m.id}>{`${m.label} — ${m.hint}`}</option>)}
            </select>
            <p className={styles.hint} style={{ marginTop: 10 }}>
              Quick background tasks — sorting and summarizing new mail — run on a cheaper model; if an
              alias is ever retired, Claude falls back to its default automatically. With Codex selected above,
              legacy light-model choices follow Codex; select an explicit provider below to pin these tasks.
            </p>
            <select
              className={styles.select}
              value={settings.lightModel}
              onChange={(e) => settings.set('lightModel', e.target.value)}
            >
              <option value="haiku">Light model (haiku) — fastest, cheapest</option>
              <option value="sonnet">Mid model (sonnet)</option>
              <option value="">My default model</option>
              <option value="claude:haiku">Claude · Haiku (always Claude)</option>
              <option value="claude:sonnet">Claude · Sonnet (always Claude)</option>
              {agentModels.filter((m) => m.provider === 'Codex').map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Codex</h3>
            <button onClick={() => void checkCodex().catch((e) => setCodexStatus(e.message))}>Check account and refresh models</button>
            {codexStatus && <p className={styles.hint} role="status">{codexStatus}</p>}
            <p className={styles.hint}>Sign in using <code>codex login</code>. Your Claude account and settings remain separate.</p>
            <label>Reasoning effort
              <select className={styles.select} value={settings.codexEffort} onChange={(e) => settings.set('codexEffort', e.target.value)}>
                <option value="">Codex default</option>
                {(agentModels.find((m) => m.id === settings.agentModel)?.efforts ?? []).map((effort) => <option key={effort} value={effort}>{effort}</option>)}
              </select>
            </label>
          </section>

          <NotificationsSection />

          <BrandPanel />

          {/* In the new shell, connections have their own page on the rail; the
              two Settings sections moved there. The legacy layout has no rail,
              so it keeps them here. */}
          {settings.newShell ? (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Connectors</h3>
              <p className={styles.hint}>
                Everything the workspace is signed into — MCP connectors, mail, calendar, Drive and the
                sites your agents work on — lives on the Connectors page, with a status that says when a
                sign-in needs renewing.
              </p>
              <button
                className={styles.btn}
                onClick={() => {
                  onClose()
                  window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail: 'connectors' } }))
                }}
              >
                Open Connectors
              </button>
            </section>
          ) : (
            <>
              <AccountsPanel />
              <ConnectorsPanel />
            </>
          )}

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Engine &amp; tools</h3>
            {status ? (
              <div className={styles.statusList}>
                <StatusRow label="Office engine (LibreOffice)" ok={status.engine} />
                <StatusRow label="Document generator (Python)" ok={status.python} detail={status.python ? 'Ready' : 'Sets up on first use'} />
                <StatusRow label="Agent (Claude CLI)" ok={status.claude.ok} detail={status.claude.path ?? 'Not found — install Claude Code'} />
              </div>
            ) : (
              <p className={styles.hint}>Checking…</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
