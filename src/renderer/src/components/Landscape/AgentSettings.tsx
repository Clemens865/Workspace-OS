import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useAgentModels } from '../../lib/agentModels'
import * as act from './agentActions'
import { toast } from './toastStore'
import focus from './AgentFocus.module.css'
import styles from './AgentSettings.module.css'

type Scope = 'global' | 'project'

interface Draft {
  description: string
  persona: string
  mode: 'full' | 'safe'
  /** '' = the app's model (Settings → Models). */
  model: string
  capabilities: string[]
}

interface Capability {
  id: string
  label: string
  description: string
}

/** What a save changes, compared to the file as it was read. */
export function changed(a: Draft, b: Draft): boolean {
  return (
    a.description !== b.description ||
    a.persona !== b.persona ||
    a.mode !== b.mode ||
    a.model !== b.model ||
    [...a.capabilities].sort().join() !== [...b.capabilities].sort().join()
  )
}

/**
 * The agent's settings, on its card: which model it runs on, whether it asks
 * before it changes anything, what it may use, what it says about itself and
 * the instructions it works by. Saves to its `.claude/agents` file (keeping
 * what other editors put there) and the landscape re-reads the roster.
 */
export function AgentSettings({ name, scope }: { name: string; scope: Scope | undefined }): JSX.Element {
  const models = useAgentModels()
  const [caps, setCaps] = useState<Capability[]>([])
  const [rest, setRest] = useState<{ skills: string[]; surface?: string } | null>(null)
  const [saved, setSaved] = useState<Draft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!scope) return
    let live = true
    void Promise.all([window.workspace.agents.read(name, scope), window.workspace.agents.capabilities().catch(() => [])])
      .then(([a, c]) => {
        if (!live) return
        const d: Draft = { description: a.description, persona: a.persona, mode: a.mode ?? 'full', model: a.model ?? '', capabilities: a.capabilities ?? [] }
        setSaved(d)
        setDraft(d)
        setRest({ skills: a.skills, surface: a.surface })
        setCaps(c)
      })
      .catch((e) => live && setError(`Could not read ${name}: ${(e as Error).message}`))
    return () => {
      live = false
    }
  }, [name, scope])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setDraft((d) => (d ? { ...d, [k]: v } : d))
  const dirty = !!draft && !!saved && changed(draft, saved)

  const save = async (): Promise<void> => {
    if (!draft || !scope || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.workspace.agents.write({
        name,
        scope,
        description: draft.description,
        persona: draft.persona,
        mode: draft.mode,
        model: draft.model || undefined,
        capabilities: draft.capabilities,
        skills: rest?.skills,
        surface: rest?.surface,
      })
      setSaved(draft)
      window.dispatchEvent(new CustomEvent('wos:agents-changed'))
      toast(`${name.split(' — ')[0]}'s settings are saved.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !draft) return <p className={focus.note}>{error}</p>
  if (!draft) return <p className={focus.hint}>Reading {name}…</p>

  // A model the file names that this install does not list still shows (and stays) as it is.
  const options = models.filter((m) => m.id !== '')
  const unknown = draft.model && !options.some((m) => m.id === draft.model)

  return (
    <div className={styles.settings} data-testid="agent-settings">
      <div className={styles.main}>
        <label className={styles.field}>
          <span className={focus.label}>About</span>
          <textarea className={styles.about} value={draft.description} rows={3} onChange={(e) => set('description', e.target.value)} data-testid="agent-set-about" />
          <span className={styles.help}>One or two sentences: what it does and what it hands back. Shown on its card.</span>
        </label>
        <label className={`${styles.field} ${styles.grow}`}>
          <span className={focus.label}>Instructions</span>
          <textarea className={styles.persona} value={draft.persona} onChange={(e) => set('persona', e.target.value)} data-testid="agent-set-persona" spellCheck />
          <span className={styles.help}>How it works, in its own voice. It reads these at the start of every session.</span>
        </label>
      </div>

      <aside className={styles.side}>
        <div className={styles.scroll}>
          <section>
            <h3 className={focus.label}>Model</h3>
            <select className={styles.select} value={draft.model} onChange={(e) => set('model', e.target.value)} data-testid="agent-set-model">
              <option value="">Same as Settings → Models</option>
              {unknown && <option value={draft.model}>{draft.model}</option>}
              {options.map((m) => (
                <option key={m.id} value={m.id} title={m.hint}>
                  {m.label}
                </option>
              ))}
            </select>
          </section>

          <section>
            <h3 className={focus.label}>Before it changes things</h3>
            <div className={styles.seg} role="radiogroup">
              {(['safe', 'full'] as const).map((m) => (
                <button key={m} role="radio" aria-checked={draft.mode === m} className={draft.mode === m ? styles.segOn : undefined} onClick={() => set('mode', m)} data-mode={m}>
                  {m === 'safe' ? 'Asks first' : 'Just does it'}
                </button>
              ))}
            </div>
            <p className={styles.help}>
              {draft.mode === 'safe' ? 'It asks you before it edits a file or runs a command.' : 'It edits files and runs commands on its own; you review the result.'}
            </p>
          </section>

          {caps.length > 0 && (
            <section>
              <h3 className={focus.label}>What it can use</h3>
              <div className={styles.caps} data-testid="agent-set-caps">
                {caps.map((c) => {
                  const on = draft.capabilities.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      className={on ? styles.capOn : styles.cap}
                      aria-pressed={on}
                      title={c.description}
                      data-cap={c.id}
                      onClick={() => set('capabilities', on ? draft.capabilities.filter((x) => x !== c.id) : [...draft.capabilities, c.id])}
                    >
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        {error && (
          <p className={focus.note} role="status">
            {error}
          </p>
        )}

        <div className={focus.row}>
          <button className={focus.primary} disabled={!dirty || busy} onClick={() => void save()} data-testid="agent-set-save">
            {busy ? 'Saving…' : 'Save'}
          </button>
          {dirty && (
            <button className={focus.btn} disabled={busy} onClick={() => saved && setDraft(saved)}>
              Undo changes
            </button>
          )}
        </div>

        <div className={styles.foot}>
          {confirmDelete ? (
            <>
              <span>Delete {name.split(' — ')[0]}? Its sessions and cases stay.</span>
              <button
                className={focus.dangerBtn}
                disabled={busy}
                onClick={() =>
                  void act.deleteAgent(name, scope).then(
                    () => toast(`${name} was deleted.`),
                    (e) => setError((e as Error).message),
                  )
                }
                data-testid="agent-delete-confirm"
              >
                Delete
              </button>
              <button className={focus.btn} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className={focus.linkBtn} onClick={() => setConfirmDelete(true)} data-testid="agent-delete">
              <Trash2 size={13} /> Delete agent
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}
