import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceMemory as Mem } from '../../types/workspace-api'
import styles from './WorkspaceMemory.module.css'

const KINDS = ['fact', 'preference', 'decision', 'entity'] as const

/**
 * What the workspace has LEARNED — the write side of memory, shown next to the
 * read-only Pulse history.
 *
 * This exists so memory is not a black box. An agent that silently accumulates
 * beliefs about your work and gives you no way to see or correct them is a
 * liability: the panel is where a wrong memory gets found and removed. Every row
 * therefore shows its PROVENANCE and a forget button, and forgetting really
 * deletes rather than hiding.
 */
export function WorkspaceMemoryView(): JSX.Element {
  const [items, setItems] = useState<Mem[]>([])
  const [stats, setStats] = useState<{ workspace: number; global: number } | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const [rows, s] = await Promise.all([
        query.trim()
          ? window.workspace.memory.search(query, 100)
          : window.workspace.memory.listMemories({ ...(kind ? { kind } : {}), limit: 200 }),
        window.workspace.memory.memStats(),
      ])
      setItems(kind ? rows.filter((r) => r.kind === kind) : rows)
      setStats(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [query, kind])

  useEffect(() => { void load() }, [load])

  const forget = useCallback(async (id: string) => {
    await window.workspace.memory.forget(id)
    await load()
  }, [load])

  const addOwn = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    setBusy(true); setError(null)
    try {
      // Recorded as "you told me" — the highest-trust provenance there is, and
      // distinguishable from anything an agent inferred.
      await window.workspace.memory.remember({ text, kind: 'fact', source: 'you told me' })
      setDraft('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, load])

  return (
    <div className={styles.root}>
      <div className={styles.head}>
        <h3 className={styles.heading}>What this workspace knows</h3>
        {stats && (
          <span className={styles.count}>
            {stats.workspace} here · {stats.global} personal
          </span>
        )}
      </div>

      <div className={styles.tell}>
        <input
          className={styles.input}
          placeholder="Tell it something worth remembering…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void addOwn() }}
        />
        <button className={styles.add} onClick={() => void addOwn()} disabled={busy || !draft.trim()}>Remember</button>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Search memory…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select className={styles.select} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {items.length === 0 && !busy ? (
        <p className={styles.empty}>
          Nothing remembered yet. Agents record what they learn as they work, and you
          can add anything above.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((m) => (
            <li key={m.id} className={styles.item}>
              <div className={styles.row}>
                <span className={`${styles.kind} ${styles[`kind_${m.kind}`] ?? ''}`}>{m.kind}</span>
                {m.scope === 'global' && <span className={styles.global}>personal</span>}
                <span className={styles.spacer} />
                {m.reinforced > 1 && <span className={styles.seen}>seen {m.reinforced}×</span>}
                <button className={styles.forget} title="Forget this" onClick={() => void forget(m.id)}>×</button>
              </div>
              <p className={styles.text}>{m.text}</p>
              {/* Provenance is shown, always: a memory you cannot trace is one
                  you cannot judge. */}
              <p className={styles.source}>from {m.source}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
