import { useMemo, useRef, useState } from 'react'
import { Search, Trash2 } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { useGlass } from '../backdrop/useBackdrop'
import { ago } from '../agentPresence'
import { openCase } from '../agentActions'
import { toast } from '../toastStore'
import { SessionPane, useSessions } from './SessionPane'
import shelf from '../CasesView.module.css'
import styles from './SessionsList.module.css'

/**
 * Every session that is not a case (yet), as a dense list beside the one you
 * are looking at (SESSIONS.md): continue it, keep it as a case, or delete it.
 * The arc shows only the latest work; this is where the rest lives.
 */
export function SessionsList(): JSX.Element {
  useSessions()
  const [q, setQ] = useState('')
  const [pick, setPick] = useState<string | null>(null)
  const [confirm, setConfirm] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  const all = sessionStore
    .list()
    .filter((s) => s.turns > 0 && !s.caseId)
    .sort((a, b) => b.lastAt - a.lastAt)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? all.filter((s) => `${s.title} ${s.agentName ?? ''}`.toLowerCase().includes(t)) : all
  }, [all, q])
  const cur = shown.find((s) => s.id === pick) ?? shown[0] ?? null

  if (!all.length) {
    return (
      <div className={shelf.empty} data-testid="sessions-list" data-count={0}>
        <div className={shelf.emptyTitle}>No loose sessions</div>
        <p className={shelf.emptyText}>Sessions that are not kept as cases appear here. Start one by asking an agent on its card, or in Today.</p>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-testid="sessions-list" data-count={all.length}>
      <div className={styles.list}>
        <label className={shelf.search}>
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sessions…" aria-label="Search sessions" />
        </label>
        <ul className={styles.rows}>
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" className={`${styles.row} ${s.id === cur?.id ? styles.on : ''}`} onClick={() => (setPick(s.id), setConfirm(false))} data-session-item={s.id}>
                <span className={styles.title}>{s.title}</span>
                <span className={styles.meta}>
                  {s.agentName ? s.agentName.split(' — ')[0] : 'Assistant'} · {s.turns} turn{s.turns === 1 ? '' : 's'} · {ago(s.lastAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {cur && (
        <div ref={panel} className={styles.panel}>
          <div className={styles.paneWrap}>
            <SessionPane key={cur.id} sessionId={cur.id} onOpenCase={openCase} />
          </div>
          <div className={styles.foot}>
            {confirm ? (
              <>
                <span>Delete “{cur.title}”?</span>
                <button
                  type="button"
                  className={styles.danger}
                  onClick={() => {
                    void sessionStore.remove(cur.id).then(() => toast(`Deleted the session "${cur.title}".`))
                    setConfirm(false)
                  }}
                  data-testid="session-delete-confirm"
                >
                  Delete
                </button>
                <button type="button" className={styles.quiet} onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className={styles.quiet} onClick={() => setConfirm(true)} data-testid="session-delete">
                <Trash2 size={13} /> Delete session
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
