import { useEffect, useState } from 'react'
import { AgentAvatar } from './AgentAvatar'
import styles from './AgentDetail.module.css'

export interface AgentDetailData {
  name: string
  description: string
  scope: 'global' | 'project'
  mode?: 'full' | 'safe'
  persona: string
  skills: string[]
}

interface AgentDetailProps {
  name: string
  scope: 'global' | 'project'
  onClose: () => void
  onRun: (name: string) => void
  onDeleted: () => void
}

/**
 * A right-hand drawer with the full persona. Reads the agent lazily via the
 * existing agents API; actions reuse the launch path (Run) and the delete API.
 * Edit/Duplicate are wired to the Foundry event for now (TODO below).
 */
export function AgentDetail({ name, scope, onClose, onRun, onDeleted }: AgentDetailProps): JSX.Element {
  const [data, setData] = useState<AgentDetailData | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.workspace.agents
      .read(name, scope)
      .then((d) => {
        if (!cancelled) setData(d as AgentDetailData)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [name, scope])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const del = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.workspace.agents.delete(name, scope)
      onDeleted()
    } finally {
      setBusy(false)
    }
  }

  const chips = data?.skills?.length
    ? data.skills
    : [data?.mode === 'safe' ? 'Safe mode' : 'Full access']

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <aside
        className={styles.drawer}
        onClick={(e) => e.stopPropagation()}
        data-testid="agent-detail"
        role="dialog"
        aria-label={`${name} details`}
      >
        <button className={styles.close} onClick={onClose} aria-label="Close">
          ✕
        </button>

        <div className={styles.hero}>
          <AgentAvatar seed={name} size={72} />
          <div>
            <div className={styles.name}>{name}</div>
            <div className={styles.meta}>
              <span>{scope === 'project' ? 'Project' : 'Global'}</span>
              <span className={styles.metaDot}>·</span>
              <span>{data?.mode === 'safe' ? 'Safe mode' : 'Full access'}</span>
            </div>
          </div>
        </div>

        <p className={styles.desc}>{data?.description || 'A specialist assistant.'}</p>

        <div className={styles.section}>
          <div className={styles.label}>Capabilities</div>
          <div className={styles.chips}>
            {chips.map((c) => (
              <span key={c} className={styles.chip}>
                {c}
              </span>
            ))}
          </div>
        </div>

        {data?.persona && (
          <div className={styles.section}>
            <div className={styles.label}>Persona</div>
            <pre className={styles.persona}>{data.persona}</pre>
          </div>
        )}

        <div className={styles.actions}>
          <button className={styles.run} onClick={() => onRun(name)} data-testid="agent-detail-run">
            Run
          </button>
          {/* TODO(foundry): Edit + Duplicate open the agent Foundry editor. */}
          <button
            className={styles.quiet}
            onClick={() => window.dispatchEvent(new CustomEvent('wos:new-agent', { detail: { edit: name, scope } }))}
          >
            Edit
          </button>
          <button
            className={styles.quiet}
            onClick={() => window.dispatchEvent(new CustomEvent('wos:new-agent', { detail: { duplicate: name, scope } }))}
          >
            Duplicate
          </button>
          <span className={styles.spacer} />
          {confirming ? (
            <>
              <button className={styles.danger} disabled={busy} onClick={del} data-testid="agent-detail-delete-confirm">
                {busy ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button className={styles.quiet} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button className={styles.dangerQuiet} onClick={() => setConfirming(true)} data-testid="agent-detail-delete">
              Delete
            </button>
          )}
        </div>
      </aside>
    </div>
  )
}
