import { useEffect, useState } from 'react'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { WorkCase } from '../../../types/workspace-api'
import type { AgentPresence } from '../presenceTypes'
import { STATUS_LABEL } from '../presenceTypes'
import { ago } from '../agentPresence'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { FileThumb } from '../../FilePanel/FileThumb'
import { openCase } from '../agentActions'
import { toast } from '../toastStore'
import { SessionPane, useSessions } from './SessionPane'
import styles from '../AgentFocus.module.css'

const chosen = new Map<string, string>()
const openFile = (path: string): void => {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

/**
 * A work card in focus (SESSIONS.md): continue the work right here (its
 * latest session, or a new one in the same case), with the case at a glance
 * beside it: status, the last notes, the files, the other sessions. A session
 * or a case can be deleted from here.
 */
export function WorkFocus({ w }: { w: AgentPresence }): JSX.Element {
  useSessions()
  const caseId = w.caseId
  const sessionKey = w.id.startsWith('session:') ? w.id.slice('session:'.length) : null
  const sessions = sessionStore
    .list()
    .filter((s) => (caseId ? s.caseId === caseId : s.id === sessionKey))
    .sort((a, b) => b.lastAt - a.lastAt)
  const [picked, setPicked] = useState<string | null>(() => chosen.get(w.id) ?? sessions[0]?.id ?? null)
  const current = picked && sessionStore.get(picked) ? picked : null
  const choose = (id: string | null): void => {
    if (id) chosen.set(w.id, id)
    else chosen.delete(w.id)
    setPicked(id)
  }
  const [c, setC] = useState<WorkCase | null>(null)
  useEffect(() => {
    if (!caseId) return
    let live = true
    void window.workspace.cases
      .get(caseId)
      .then((x) => live && setC(x))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [caseId, sessions.length, w.since])
  const [confirm, setConfirm] = useState(false)
  const sess = current ? sessionStore.get(current) : undefined
  const agentName = sess?.agentName ?? sessions[0]?.agentName ?? null

  const remove = async (): Promise<void> => {
    if (caseId) {
      await window.workspace.cases.delete(caseId)
      await sessionStore.removeCase(caseId)
      toast(`Deleted the case "${w.name}". It is in the trash.`)
    } else if (sessionKey) {
      await sessionStore.remove(sessionKey)
      toast(`Deleted the session "${w.name}".`)
    }
    window.dispatchEvent(new CustomEvent('wos:work-changed'))
  }

  return (
    <div className={styles.focus} data-testid="work-focus" data-status={w.status}>
      <header className={styles.head}>
        <div className={styles.who}>
          <div className={styles.name}>{w.name}</div>
          <div className={styles.meta}>
            {caseId ? 'Case' : 'Session'}
            {w.role && w.role !== 'Case' && w.role !== 'Session' ? ` · ${w.role}` : ''}
          </div>
        </div>
        <span className={styles.chip} data-status={w.status}>
          <span className={styles.chipDot} />
          {STATUS_LABEL[w.status]}
          {w.since ? ` · ${ago(w.since)}` : ''}
        </span>
      </header>

      <div className={styles.columns}>
        <div className={styles.work}>
          <SessionPane key={current ?? `new-${w.id}`} sessionId={current} agentName={agentName} caseId={caseId} onCreated={choose} onOpenCase={openCase} placeholder="Continue the work: ask in your own words." />
        </div>

        <aside className={styles.side}>
          {c && (
            <section>
              <div className={styles.labelRow}>
                <h3 className={styles.label}>The case</h3>
                <button className={styles.linkBtn} onClick={() => openCase(c.id)} data-testid="work-open-case">
                  <FolderOpen size={13} /> Open
                </button>
              </div>
              <p className={styles.caseLine}>
                <b>{c.status}</b>
                {c.description ? ` · ${c.description}` : ''}
              </p>
              {c.notes.length > 0 && (
                <ol className={styles.steps} data-testid="work-notes">
                  {c.notes
                    .slice(-4)
                    .reverse()
                    .map((n, i) => (
                      <li key={i}>
                        <span>{n.text}</span>
                        <span className={styles.when}>{ago(Date.parse(n.at) || 0)}</span>
                      </li>
                    ))}
                </ol>
              )}
            </section>
          )}

          {w.outputs.length > 0 && (
            <section>
              <h3 className={styles.label}>Files</h3>
              <ul className={styles.files}>
                {w.outputs.slice(0, 5).map((p) => (
                  <li key={p}>
                    <button className={styles.file} onClick={() => openFile(p)}>
                      <FileThumb entry={{ name: p.split('/').pop() ?? p, path: p, isDirectory: false }} size={18} /> {p.split('/').pop()}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className={styles.labelRow}>
              <h3 className={styles.label}>Sessions</h3>
              {caseId && (
                <button className={styles.linkBtn} onClick={() => choose(null)} data-testid="work-new-session">
                  <Plus size={13} /> New
                </button>
              )}
            </div>
            {sessions.length ? (
              <ul className={styles.sessions}>
                {sessions.map((x) => (
                  <li key={x.id}>
                    <button className={`${styles.sessionRow} ${x.id === current ? styles.sessionOn : ''}`} onClick={() => choose(x.id)} data-session-row={x.id}>
                      <span className={styles.sessionTitle}>{x.agentName ? x.agentName.split(' — ')[0] : 'Assistant'} · {x.title}</span>
                      <span className={styles.when}>{ago(x.lastAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.hint}>No session here yet. Ask on the left to continue the case.</p>
            )}
          </section>

          <div className={styles.danger}>
            {confirm ? (
              <>
                <span>{caseId ? 'Delete this case and its sessions? The case file and its folder go to the trash.' : 'Delete this session?'}</span>
                <button className={styles.dangerBtn} onClick={() => void remove()} data-testid="work-delete-confirm">
                  Delete
                </button>
                <button className={styles.btn} onClick={() => setConfirm(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className={styles.linkBtn} onClick={() => setConfirm(true)} data-testid="work-delete">
                <Trash2 size={13} /> Delete {caseId ? 'case' : 'session'}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
