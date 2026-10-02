import { useEffect, useRef, useState } from 'react'
import { useAgentModels, refreshCodexModels } from '../../lib/agentModels'
import { X, Check, AlertCircle, Sun, Moon, Monitor } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import { useTheme } from '../../hooks/useTheme'
import { BrandPanel } from './BrandPanel'
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
      <h3 className={styles.sectionTitle}>Needs you</h3>
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

/** The groups, in order: what the left column lists and the page scrolls to. */
const GROUPS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'agents', label: 'Agents' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'brand', label: 'Brand' },
  { id: 'system', label: 'System' },
] as const

/** Quick background work (sorting and summarising mail): three plain choices. */
const LIGHT_MODELS: { value: string; label: string }[] = [
  { value: 'haiku', label: 'Fast (Claude Haiku)' },
  { value: 'sonnet', label: 'Balanced (Claude Sonnet)' },
  { value: '', label: 'Same as my agents' },
]

export function SettingsPanel({ onClose }: SettingsPanelProps): JSX.Element {
  const agentModels = useAgentModels()
  const [codexStatus, setCodexStatus] = useState('')
  const checkCodex = async (): Promise<void> => {
    setCodexStatus('Checking Codex…')
    const status = await refreshCodexModels()
    setCodexStatus(status.error ?? `Codex: ${status.account}`)
  }
  const settings = useSettings()
  const { pref, setPref } = useTheme()
  const [status, setStatus] = useState<Status | null>(null)
  const [group, setGroup] = useState<string>('appearance')
  const body = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.workspace.system.status().then(setStatus).catch(() => {})
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // The left column follows the scroll: the group whose heading is nearest the top.
  const onScroll = (): void => {
    const el = body.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    let current: string = GROUPS[0].id
    for (const g of GROUPS) {
      const h = el.querySelector<HTMLElement>(`[data-group="${g.id}"]`)
      if (h && h.getBoundingClientRect().top - top < 80) current = g.id
    }
    setGroup(current)
  }
  const goTo = (id: string): void => {
    setGroup(id)
    body.current?.querySelector<HTMLElement>(`[data-group="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const codexModels = agentModels.filter((m) => m.provider === 'Codex' && m.id !== 'codex:')
  const selected = agentModels.find((m) => m.id === settings.agentModel)
  const usingCodex = selected?.provider === 'Codex'
  const lightOptions = [...LIGHT_MODELS, ...(LIGHT_MODELS.some((o) => o.value === settings.lightModel) ? [] : [{ value: settings.lightModel, label: settings.lightModel.replace(/^claude:/, 'Claude · ').replace(/^codex:/, 'Codex · ') }])]

  const StatusRow = ({ label, ok, detail }: { label: string; ok: boolean; detail?: string }): JSX.Element => (
    <div className={styles.statusRow}>
      {ok ? <Check size={15} className={styles.ok} /> : <AlertCircle size={15} className={styles.bad} />}
      <span className={styles.statusLabel}>{label}</span>
      <span className={styles.statusDetail}>{detail ?? (ok ? 'Ready' : 'Not found')}</span>
    </div>
  )
  const GroupHead = ({ id, label }: { id: string; label: string }): JSX.Element => (
    <h2 className={styles.groupHead} data-group={id}>
      {label}
    </h2>
  )

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} data-testid="settings-panel">
        <div className={styles.header}>
          <span className={styles.heading}>Settings</span>
          <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.columns}>
          <nav className={styles.groups} aria-label="Settings groups">
            {GROUPS.map((g) => (
              <button key={g.id} type="button" className={group === g.id ? styles.groupOn : styles.groupBtn} onClick={() => goTo(g.id)} data-settings-group={g.id}>
                {g.label}
              </button>
            ))}
          </nav>

          <div ref={body} className={styles.body} onScroll={onScroll}>
            <GroupHead id="appearance" label="Appearance" />
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Theme</h3>
              <p className={styles.hint}>Light, dark, or whatever macOS is showing. Documents and web pages keep their own colours.</p>
              <div className={styles.segmented}>
                <button className={pref === 'light' ? styles.segOn : styles.segOff} onClick={() => setPref('light')} data-testid="theme-light">
                  <Sun size={14} /> Light
                </button>
                <button className={pref === 'dark' ? styles.segOn : styles.segOff} onClick={() => setPref('dark')} data-testid="theme-dark">
                  <Moon size={14} /> Dark
                </button>
                <button className={pref === 'system' ? styles.segOn : styles.segOff} onClick={() => setPref('system')} data-testid="theme-system">
                  <Monitor size={14} /> Match macOS
                </button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Landscape graphics</h3>
              <p className={styles.hint}>
                The mist landscape and Liquid Glass draw only when something changes and stop while you work on the stage.
                Auto uses Full on power and Light on battery or with reduced motion; Light freezes the mist; Off is flat,
                with no GPU use.
              </p>
              <div className={styles.segmented}>
                {(['auto', 'full', 'light', 'off'] as const).map((q) => (
                  <button key={q} className={settings.landscapeQuality === q ? styles.segOn : styles.segOff} onClick={() => settings.set('landscapeQuality', q)} data-testid={`landscape-quality-${q}`}>
                    {q[0].toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Open on</h3>
              <p className={styles.hint}>
                Where Workspace OS opens: the landscape (your team, the Inbox, your cases) or straight on the stage with your
                documents and apps. Overview in the dock always leads to the landscape.
              </p>
              <div className={styles.segmented}>
                <button className={settings.startOn !== 'stage' ? styles.segOn : styles.segOff} onClick={() => settings.set('startOn', 'landscape')} data-testid="start-landscape">Landscape</button>
                <button className={settings.startOn === 'stage' ? styles.segOn : styles.segOff} onClick={() => settings.set('startOn', 'stage')} data-testid="start-stage">Stage</button>
              </div>
            </section>

            <GroupHead id="workspace" label="Workspace" />
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Terminal</h3>
              <p className={styles.hint}>
                Where the terminal sits (⌘J or Terminal in the dock): docked at the bottom or right, or floating as a window
                you can move and resize, over the landscape too.
              </p>
              <div className={styles.segmented}>
                {(['bottom', 'right', 'float'] as const).map((p) => (
                  <button key={p} className={settings.terminalPlacement === p ? styles.segOn : styles.segOff} onClick={() => settings.set('terminalPlacement', p)} data-testid={`terminal-place-${p}`}>
                    {p === 'float' ? 'Floating' : p[0].toUpperCase() + p.slice(1)}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>⌘N in Files creates</h3>
              <select className={styles.select} value={settings.newFileFormat} onChange={(e) => settings.set('newFileFormat', e.target.value as typeof settings.newFileFormat)}>
                {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </section>

            <GroupHead id="agents" label="Agents" />
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>New sessions start in</h3>
              <p className={styles.hint}>Full may edit files and run commands (destructive ones are blocked); Safe only reads and generates.</p>
              <div className={styles.segmented}>
                <button className={settings.agentMode === 'full' ? styles.segOn : styles.segOff} onClick={() => settings.set('agentMode', 'full')}>Full</button>
                <button className={settings.agentMode === 'safe' ? styles.segOn : styles.segOff} onClick={() => settings.set('agentMode', 'safe')}>Safe</button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Keep sessions as cases</h3>
              <p className={styles.hint}>
                A case is the workspace's memory of a piece of work: what you asked, what the agent did, the files it made.
                Always: every session becomes a case. Suggested: the app offers it once a session produced a file or ran a
                few turns. Manually: only when you choose "Keep as a case".
              </p>
              <div className={styles.segmented}>
                {(['always', 'suggest', 'manual'] as const).map((m) => (
                  <button key={m} className={settings.sessionCases === m ? styles.segOn : styles.segOff} onClick={() => settings.set('sessionCases', m)} data-testid={`session-cases-${m}`}>
                    {m === 'always' ? 'Always' : m === 'suggest' ? 'Suggested' : 'Manually'}
                  </button>
                ))}
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Approve undoable steps automatically</h3>
              <p className={styles.hint}>
                Steps that can be undone (a checkpointed edit, a read-only web fetch) are approved for you and still logged.
                Commands and outbound connections always ask.
              </p>
              <div className={styles.segmented}>
                <button className={settings.autoApproveReversible ? styles.segOn : styles.segOff} onClick={() => settings.set('autoApproveReversible', true)}>On</button>
                <button className={!settings.autoApproveReversible ? styles.segOn : styles.segOff} onClick={() => settings.set('autoApproveReversible', false)}>Off</button>
              </div>
            </section>

            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Model</h3>
              <p className={styles.hint}>
                What your agents run on. Claude names follow the latest generation. An agent's own model, or the model chip
                in the terminal, overrides this for that agent or session.
              </p>
              <select className={styles.select} value={settings.agentModel} onChange={(e) => settings.set('agentModel', e.target.value)} data-testid="agent-model">
                {agentModels.map((m) => <option key={m.id} value={m.id}>{`${m.label} — ${m.hint}`}</option>)}
              </select>
              <h3 className={styles.sectionTitle} style={{ marginTop: 14 }}>Background tasks</h3>
              <p className={styles.hint}>Sorting and summarising new mail. A faster model keeps it cheap.</p>
              <select className={styles.select} value={settings.lightModel} onChange={(e) => settings.set('lightModel', e.target.value)} data-testid="light-model">
                {lightOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </section>

            {(codexModels.length > 0 || usingCodex) && (
              <section className={styles.section} data-testid="settings-codex">
                <h3 className={styles.sectionTitle}>Codex</h3>
                <p className={styles.hint}>Codex signs in on its own (<code>codex login</code>); your Claude account stays separate.</p>
                <button className={styles.btn} onClick={() => void checkCodex().catch((e) => setCodexStatus(e.message))}>Check account and refresh models</button>
                {codexStatus && <p className={styles.hint} role="status">{codexStatus}</p>}
                {usingCodex && (selected?.efforts?.length ?? 0) > 0 && (
                  <label className={styles.field}>
                    Reasoning effort
                    <select className={styles.select} value={settings.codexEffort} onChange={(e) => settings.set('codexEffort', e.target.value)}>
                      <option value="">Codex default</option>
                      {selected!.efforts!.map((effort) => <option key={effort} value={effort}>{effort}</option>)}
                    </select>
                  </label>
                )}
              </section>
            )}

            <GroupHead id="notifications" label="Notifications" />
            <NotificationsSection />

            <GroupHead id="brand" label="Brand" />
            <BrandPanel />

            <GroupHead id="system" label="System" />
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
              <p className={styles.hint} style={{ marginTop: 10 }}>Accounts, mail, calendars and MCP connectors: Menu → Connectors.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
