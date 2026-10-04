import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceMemory as Mem, MemoryTidyReport } from '../../types/workspace-api'
import styles from './WorkspaceMemory.module.css'

const KINDS = ['fact', 'preference', 'decision', 'entity'] as const

// How recall finds things right now (nothing to say before it is needed).
const MEANING_NOTE: Record<string, string> = {
  loading: 'Getting ready to find memories by meaning, not only by words (a one-time download)…',
  ready: 'Finds memories by meaning as well as by words, in English and German.',
  failed: 'Finds memories by words only: the meaning model could not be loaded.',
}

/** What the daily tidy last did, in a line. */
function tidiedLine(t: MemoryTidyReport | null): string {
  if (!t) return 'Tidied daily: repeats folded, unkept suggestions let go after 30 days.'
  const did = [
    t.folded && `folded ${t.folded} repeat${t.folded === 1 ? '' : 's'}`,
    t.letGo && `let ${t.letGo} unkept suggestion${t.letGo === 1 ? '' : 's'} go`,
    t.imported && `brought in ${t.imported} decision${t.imported === 1 ? '' : 's'} from Pulse`,
  ].filter(Boolean)
  return `Tidied ${new Date(t.at).toLocaleDateString()}: ${did.length ? did.join(', ') : 'nothing to do'}.`
}

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
  const [meaning, setMeaning] = useState<string>('off')
  const [tidied, setTidied] = useState<MemoryTidyReport | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  // The memory being corrected, and its text.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  // Earlier versions of a memory, when asked for.
  const [earlier, setEarlier] = useState<{ id: string; list: Mem[] } | null>(null)

  const load = useCallback(async () => {
    setBusy(true); setError(null)
    try {
      const [rows, s] = await Promise.all([
        query.trim()
          ? window.workspace.memory.search(query, 100)
          : window.workspace.memory.listMemories({ ...(kind ? { kind } : {}), limit: 200 }),
        window.workspace.memory.memStats(),
      ])
      void window.workspace.memory.meaning().then((m) => setMeaning(m.status)).catch(() => {})
      void window.workspace.memory.lastTidy().then(setTidied).catch(() => {})
      setItems(kind ? rows.filter((r) => r.kind === kind) : rows)
      setStats(s)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [query, kind])

  useEffect(() => { void load() }, [load])
  // An agent remembering (or the Inbox keeping) something shows here at once.
  useEffect(() => {
    const on = (): void => void load()
    window.addEventListener('wos:memory-changed', on)
    return () => window.removeEventListener('wos:memory-changed', on)
  }, [load])

  const changed = useCallback(async () => {
    window.dispatchEvent(new CustomEvent('wos:memory-changed'))
    await load()
  }, [load])

  const saveCorrection = useCallback(async () => {
    if (!editing?.text.trim()) return
    setBusy(true); setError(null)
    try {
      await window.workspace.memory.correct(editing.id, editing.text, 'you')
      setEditing(null)
      setEarlier(null)
      await changed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [editing, changed])

  const showEarlier = useCallback(async (id: string) => {
    if (earlier?.id === id) return setEarlier(null)
    setEarlier({ id, list: await window.workspace.memory.history(id) })
  }, [earlier])

  const forget = useCallback(async (id: string) => {
    await window.workspace.memory.forget(id)
    await changed()
  }, [changed])

  const addOwn = useCallback(async () => {
    const text = draft.trim()
    if (!text) return
    setBusy(true); setError(null)
    try {
      // Recorded as "you told me" — the highest-trust provenance there is, and
      // distinguishable from anything an agent inferred.
      await window.workspace.memory.remember({ text, kind: 'fact', source: 'you told me', author: 'you' })
      setDraft('')
      await changed()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }, [draft, changed])

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

      {MEANING_NOTE[meaning] && (
        <p className={styles.source} data-testid="memory-meaning" data-status={meaning}>
          {MEANING_NOTE[meaning]}
        </p>
      )}

      <p className={styles.source} data-testid="memory-tidy">
        {tidiedLine(tidied)}
        {' · '}
        <button
          className={styles.link}
          disabled={busy}
          onClick={() => void window.workspace.memory.tidy().then(setTidied).then(changed)}
          data-testid="memory-tidy-now"
        >
          Tidy now
        </button>
      </p>

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
            <li key={m.id} className={styles.item} data-memory={m.id} data-confirmed={m.confirmed ? 'true' : 'false'}>
              <div className={styles.row}>
                <span className={`${styles.kind} ${styles[`kind_${m.kind}`] ?? ''}`}>{m.kind}</span>
                {m.scope === 'global' && <span className={styles.global}>personal</span>}
                {!m.confirmed && <span className={styles.unconfirmed}>not kept yet</span>}
                <span className={styles.spacer} />
                {m.reinforced > 1 && <span className={styles.seen}>seen {m.reinforced}×</span>}
                {!m.confirmed && (
                  <button className={styles.act} title="Keep this" onClick={() => void window.workspace.memory.confirm(m.id).then(changed)} data-testid="memory-keep">
                    Keep
                  </button>
                )}
                <button className={styles.act} title="Correct this" onClick={() => setEditing({ id: m.id, text: m.text })} data-testid="memory-correct">
                  Correct
                </button>
                <button className={styles.forget} title="Forget this" onClick={() => void forget(m.id)}>×</button>
              </div>
              {editing?.id === m.id ? (
                <div className={styles.edit}>
                  <textarea
                    className={styles.input}
                    value={editing.text}
                    rows={2}
                    autoFocus
                    onChange={(e) => setEditing({ id: m.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void saveCorrection() }
                      if (e.key === 'Escape') setEditing(null)
                    }}
                    data-testid="memory-correct-text"
                  />
                  <button className={styles.add} disabled={busy || !editing.text.trim()} onClick={() => void saveCorrection()} data-testid="memory-correct-save">Save</button>
                </div>
              ) : (
                <p className={styles.text}>{m.text}</p>
              )}
              {/* Provenance is shown, always: a memory you cannot trace is one
                  you cannot judge. */}
              <p className={styles.source}>
                from {m.source}
                {' · '}
                <button className={styles.link} onClick={() => void showEarlier(m.id)} data-testid="memory-earlier">
                  {earlier?.id === m.id ? 'hide earlier' : 'earlier versions'}
                </button>
              </p>
              {earlier?.id === m.id && (
                <ul className={styles.earlier} data-testid="memory-history">
                  {earlier.list.length ? (
                    earlier.list.map((h) => (
                      <li key={h.id}>
                        <s>{h.text}</s> <span className={styles.source}>until {new Date(h.endedAt ?? h.updatedAt).toLocaleDateString()}</span>
                      </li>
                    ))
                  ) : (
                    <li className={styles.source}>No earlier versions.</li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
