import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { useAgentModels } from '../../lib/agentModels'
import styles from './NewAgentForm.module.css'

interface NewAgentFormProps {
  onClose: () => void
  onSaved: (name: string) => void
}

/**
 * Create a custom agent (persona). Persisted as a native ~/.claude/agents/<name>.md
 * via agents.write — usable both in the app and the bare claude CLI.
 */
export function NewAgentForm({ onClose, onSaved }: NewAgentFormProps): JSX.Element {
  const models = useAgentModels()
  const [model, setModel] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [persona, setPersona] = useState('')
  const [mode, setMode] = useState<'full' | 'safe'>('full')
  const [skills, setSkills] = useState<string[]>([])
  const [available, setAvailable] = useState<{ name: string; description: string }[]>([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.workspace.skills.list(model).then(setAvailable).catch(() => {})
  }, [model])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const toggleSkill = (s: string) =>
    setSkills((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))

  const canSave = name.trim().length > 0 && !saving
  const save = async (): Promise<void> => {
    if (!canSave) return
    setSaving(true)
    try {
      await window.workspace.agents.write({ name: name.trim(), description, persona, mode, skills, model: model || undefined })
      onSaved(name.trim())
      onClose()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>New agent</span>
          <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          <label className={styles.field}>
            <span className={styles.label}>Name</span>
            <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pitch-deck builder" autoFocus />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Description</span>
            <input className={styles.input} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="One line — what this agent is for" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Instructions (persona)</span>
            <textarea className={styles.textarea} value={persona} onChange={(e) => setPersona(e.target.value)} rows={6}
              placeholder="How this agent should behave. e.g. 'Always produce Yorizon-branded decks using the yorizon-pptx-v2 skill. Keep slides to 5 bullets max.'" />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Model</span>
            <select className={styles.input} value={model} onChange={(e) => { setModel(e.target.value); setSkills([]) }}>
              <option value="">Use Settings default</option>
              {models.filter((m) => m.id).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>

          <div className={styles.field}>
            <span className={styles.label}>Default mode</span>
            <div className={styles.modeRow}>
              <button className={mode === 'full' ? styles.modeOn : styles.modeOff} onClick={() => setMode('full')}>⚡ Full</button>
              <button className={mode === 'safe' ? styles.modeOn : styles.modeOff} onClick={() => setMode('safe')}>🛡 Safe</button>
            </div>
          </div>

          {available.length > 0 && (
            <div className={styles.field}>
              <span className={styles.label}>Pinned skills (optional)</span>
              <div className={styles.skills}>
                {available.map((s) => (
                  <button key={s.name} className={skills.includes(s.name) ? styles.skillOn : styles.skillOff}
                    title={s.description} onClick={() => toggleSkill(s.name)}>
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancel} onClick={onClose}>Cancel</button>
          <button className={styles.save} disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : 'Create agent'}</button>
        </div>
      </div>
    </div>
  )
}
