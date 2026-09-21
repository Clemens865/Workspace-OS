import { useCallback, useEffect, useMemo, useState } from 'react'
import { AgentCard, type AgentCardData } from './AgentCard'
import { useAgentModels } from '../../lib/agentModels'
import styles from './AgentFoundry.module.css'

/** The capability palette entry, as returned by `agents.capabilities()`. */
interface Capability {
  id: string
  label: string
  description: string
  surface: string
  actions: string[]
  toolMode: 'safe' | 'full'
}

/** The spec `agents.build()` authors from a description (a proposal, not saved). */
interface AgentSpec {
  name: string
  description: string
  persona: string
  capabilities: string[]
  surface?: string
  mode: 'safe' | 'full'
}

/** Local, editable draft bound to the preview + fields in step 2. */
interface Draft {
  model?: string
  name: string
  description: string
  persona: string
  capabilities: string[]
  surface: string
  mode: 'safe' | 'full'
}

type Phase = 'describe' | 'building' | 'preview'

const EXAMPLES = [
  { label: 'Prospect Researcher', text: 'researches prospect companies and builds a spreadsheet' },
  { label: 'Inbox Triager', text: 'triages my inbox, drafts replies, and flags what needs me' },
  { label: 'Competitor Analyst', text: 'tracks competitors and writes a weekly briefing document' }
]

const FALLBACK_SURFACES = ['Documents', 'Mail', 'Files', 'Research', 'Knowledge']

/**
 * The Agent Foundry: "describe a specialty → Claude builds the agent → preview →
 * approve". A centered modal opened from the `wos:new-agent` window event.
 *
 * Step 1 (describe): a textarea + example chips + a blue Build button that calls
 * `agents.build(description)` (Claude authors a spec; can take up to a minute).
 * Step 2 (preview): a live <AgentCard> preview beside editable fields bound to a
 * local draft; Approve calls `agents.write({...draft, scope:'global'})` and then
 * dispatches `wos:agents-changed` so the roster re-lists and the new card appears.
 */
export function AgentFoundry(): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('describe')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)

  // Open on the roster/detail event; reset to a clean describe step each time.
  useEffect(() => {
    const onNew = (): void => {
      setPhase('describe')
      setDescription('')
      setError(null)
      setDraft(null)
      setSaving(false)
      setOpen(true)
    }
    window.addEventListener('wos:new-agent', onNew)
    return () => window.removeEventListener('wos:new-agent', onNew)
  }, [])

  // Load the capability palette once the modal is open (used by the toggle chips).
  useEffect(() => {
    if (!open || capabilities.length) return
    window.workspace.agents
      .capabilities()
      .then((caps) => setCapabilities(caps as Capability[]))
      .catch(() => setCapabilities([]))
  }, [open, capabilities.length])

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !saving) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, saving, close])

  const specToDraft = useCallback((spec: AgentSpec): Draft => {
    const caps = spec.capabilities ?? []
    return {
      name: spec.name || 'New specialist',
      description: spec.description || '',
      persona: spec.persona || '',
      capabilities: caps,
      surface: spec.surface || '',
      mode: spec.mode === 'full' ? 'full' : 'safe'
    }
  }, [])

  const runBuild = useCallback(async () => {
    const text = description.trim()
    if (!text) return
    setPhase('building')
    setError(null)
    try {
      const res = await window.workspace.agents.build(text)
      if (res.ok && res.spec) {
        setDraft(specToDraft(res.spec))
        setPhase('preview')
      } else {
        setError(res.error || 'Claude couldn’t author that agent. Try rephrasing the description.')
        setPhase('describe')
      }
    } catch {
      setError('Something went wrong while building. Please try again.')
      setPhase('describe')
    }
  }, [description, specToDraft])

  const patch = useCallback((p: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d))
  }, [])

  const toggleCap = useCallback((id: string) => {
    setDraft((d) => {
      if (!d) return d
      const has = d.capabilities.includes(id)
      return { ...d, capabilities: has ? d.capabilities.filter((c) => c !== id) : [...d.capabilities, id] }
    })
  }, [])

  // The list of home-surface options: the palette's surfaces, plus a small fallback.
  const surfaces = useMemo(() => {
    const fromCaps = capabilities.map((c) => c.surface).filter(Boolean)
    return Array.from(new Set([...fromCaps, ...FALLBACK_SURFACES]))
  }, [capabilities])

  // The live preview object, rebuilt as the draft edits (name drives the avatar).
  const previewAgent: AgentCardData | null = useMemo(() => {
    if (!draft) return null
    const chips = draft.capabilities
      .map((id) => capabilities.find((c) => c.id === id)?.label)
      .filter((x): x is string => Boolean(x))
    return {
      name: draft.name || 'New specialist',
      description: draft.description,
      scope: 'global',
      mode: draft.mode,
      skills: chips
    }
  }, [draft, capabilities])

  const approve = useCallback(async () => {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await window.workspace.agents.write({
        name: draft.name,
        description: draft.description,
        persona: draft.persona,
        capabilities: draft.capabilities,
        surface: draft.surface || undefined,
        mode: draft.mode,
        model: draft.model || undefined,
        scope: 'global'
      })
      window.dispatchEvent(new CustomEvent('wos:agents-changed'))
      close()
    } catch {
      setError('Couldn’t save the agent. Please try again.')
      setSaving(false)
    }
  }, [draft, close])

  if (!open) return null

  return (
    <div className={styles.backdrop} onClick={saving ? undefined : close}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Agent Foundry"
        data-testid="foundry-modal"
      >
        {phase !== 'preview' ? (
          <DescribeStep
            description={description}
            setDescription={setDescription}
            building={phase === 'building'}
            error={error}
            onBuild={runBuild}
            onCancel={close}
          />
        ) : (
          draft &&
          previewAgent && (
            <PreviewStep
              draft={draft}
              previewAgent={previewAgent}
              capabilities={capabilities}
              surfaces={surfaces}
              saving={saving}
              error={error}
              patch={patch}
              toggleCap={toggleCap}
              onRegenerate={runBuild}
              onCancel={close}
              onApprove={approve}
            />
          )
        )}
      </div>
    </div>
  )
}

/* ── Step 1 — Describe ── */
function DescribeStep({
  description,
  setDescription,
  building,
  error,
  onBuild,
  onCancel
}: {
  description: string
  setDescription: (v: string) => void
  building: boolean
  error: string | null
  onBuild: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className={styles.describe}>
      <div className={styles.title}>New specialist</div>
      <p className={styles.sub}>Describe the job in plain language — we’ll author the agent for you.</p>

      <textarea
        className={styles.textarea}
        placeholder="Describe what this agent should be good at… (e.g. 'researches prospect companies and builds a spreadsheet')"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={building}
        rows={4}
        data-testid="foundry-describe"
        autoFocus
      />

      <div className={styles.chips}>
        {EXAMPLES.map((ex) => (
          <button
            key={ex.label}
            type="button"
            className={styles.exampleChip}
            onClick={() => setDescription(ex.text)}
            disabled={building}
          >
            {ex.label}
          </button>
        ))}
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {building ? (
        <div className={styles.building} data-testid="foundry-building">
          <span className={styles.spinner} aria-hidden="true" />
          <div>
            <div className={styles.buildingTitle}>Building your specialist…</div>
            <div className={styles.buildingHint}>Claude is authoring the agent — this can take up to a minute.</div>
          </div>
        </div>
      ) : (
        <div className={styles.footer}>
          <button type="button" className={styles.quiet} onClick={onCancel}>
            Cancel
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.primary}
            onClick={onBuild}
            disabled={!description.trim()}
            data-testid="foundry-build"
          >
            Build agent
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Step 2 — Preview & approve ── */
function PreviewStep({
  draft,
  previewAgent,
  capabilities,
  surfaces,
  saving,
  error,
  patch,
  toggleCap,
  onRegenerate,
  onCancel,
  onApprove
}: {
  draft: Draft
  previewAgent: AgentCardData
  capabilities: Capability[]
  surfaces: string[]
  saving: boolean
  error: string | null
  patch: (p: Partial<Draft>) => void
  toggleCap: (id: string) => void
  onRegenerate: () => void
  onCancel: () => void
  onApprove: () => void
}): JSX.Element {
  const models = useAgentModels()
  return (
    <div className={styles.preview}>
      <div className={styles.title}>Preview your specialist</div>
      <p className={styles.sub}>This is how the agent will appear. Fine-tune anything, then save.</p>

      <div className={styles.columns}>
        {/* LEFT — live card preview (non-interactive) */}
        <div className={styles.previewPane}>
          <div className={styles.cardWrap} aria-hidden="true">
            <AgentCard agent={previewAgent} onOpen={() => {}} onRun={() => {}} />
          </div>
        </div>

        {/* RIGHT — editable fields bound to the draft */}
        <div className={styles.form}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input
              className={styles.input}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Prospect Researcher"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Specialty</span>
            <input
              className={styles.input}
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="One line — what this agent is good at"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Model</span>
            <select className={styles.input} value={draft.model ?? ''} onChange={(e) => patch({ model: e.target.value })}>
              <option value="">Use Settings default</option>
              {models.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Persona</span>
            <textarea
              className={styles.personaArea}
              value={draft.persona}
              onChange={(e) => patch({ persona: e.target.value })}
              rows={5}
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Capabilities</span>
            <div className={styles.capChips}>
              {capabilities.map((c) => {
                const on = draft.capabilities.includes(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${styles.capChip} ${on ? styles.capChipOn : ''}`}
                    onClick={() => toggleCap(c.id)}
                    title={c.description}
                    aria-pressed={on}
                  >
                    {c.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.label}>Home surface</span>
              <select
                className={styles.input}
                value={draft.surface}
                onChange={(e) => patch({ surface: e.target.value })}
              >
                <option value="">None</option>
                {surfaces.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <div className={styles.field}>
              <span className={styles.label}>Mode</span>
              <div className={styles.segment} role="radiogroup" aria-label="Mode">
                <button
                  type="button"
                  className={`${styles.seg} ${draft.mode === 'safe' ? styles.segOn : ''}`}
                  onClick={() => patch({ mode: 'safe' })}
                  aria-pressed={draft.mode === 'safe'}
                >
                  Safe
                </button>
                <button
                  type="button"
                  className={`${styles.seg} ${draft.mode === 'full' ? styles.segOn : ''}`}
                  onClick={() => patch({ mode: 'full' })}
                  aria-pressed={draft.mode === 'full'}
                >
                  Full
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.footer}>
        <button type="button" className={styles.quiet} onClick={onRegenerate} disabled={saving}>
          Regenerate
        </button>
        <span className={styles.spacer} />
        <button type="button" className={styles.quiet} onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={onApprove}
          disabled={saving || !draft.name.trim()}
          data-testid="foundry-approve"
        >
          {saving ? 'Saving…' : 'Approve & Save'}
        </button>
      </div>
    </div>
  )
}
