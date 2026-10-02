import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { useReviewStore } from '../Review/useReviewStore'
import { useCreatedAssets } from '../../hooks/useCreatedAssets'
import { agoLabel } from '../Shell/home/homeModel'
import { STREAM_SEEN_KEY } from '../CalmCockpit/StreamView'
import { buildStream, costLabel, groupStream, streamStatus, STREAM_LENSES, type StreamItem, type StreamLens } from '../CalmCockpit/streamModel'
import type { WorkCase } from '../../types/workspace-api'
import { useGlass } from './backdrop/useBackdrop'
import styles from './HistoryView.module.css'

function readSeen(): number | null {
  try {
    const v = Number(localStorage.getItem(STREAM_SEEN_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * History: the Cockpit's Stream in the landscape, as the Inbox's second tab
 * (ADOPTION.md B2). Every run, case note, file and connection that needed
 * you, one sentence each, grouped by day (or case, agent, kind), with a mark
 * where you last looked. The mark is shared with the Cockpit's Stream and is
 * set when you leave, so everything above it stays fresh for the visit.
 */
export function HistoryView({ onOpenCase }: { onOpenCase: (id: string) => void }): JSX.Element {
  const [seenAt] = useState<number | null>(readSeen)
  const [lens, setLens] = useState<StreamLens>('day')
  const [cases, setCases] = useState<WorkCase[]>([])
  const [connections, setConnections] = useState<{ id: string; name: string; status: string; checkedAt: number }[]>([])
  const { runs } = useReviewStore()
  const files = useCreatedAssets()
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })

  const refresh = useCallback(async () => {
    setCases((await window.workspace.cases.list().catch(() => [])) ?? [])
    try {
      const list = (await window.workspace.connections?.list()) ?? []
      setConnections(list.map((c) => ({ id: c.id, name: c.name, status: c.status, checkedAt: c.checkedAt })))
    } catch {
      setConnections([])
    }
  }, [])
  useEffect(() => {
    void refresh()
    return window.workspace.fs.onRootChanged(() => void refresh())
  }, [refresh])
  useEffect(
    () => () => {
      try {
        localStorage.setItem(STREAM_SEEN_KEY, String(Date.now()))
      } catch {
        /* the mark is a convenience */
      }
    },
    [],
  )

  const items = useMemo(
    () =>
      buildStream({
        cases: cases.map((c) => ({ id: c.id, title: c.title, created: c.created, notes: c.notes })),
        runs: runs.map((r) => ({
          runId: r.runId,
          agentName: r.agentName,
          sessionName: r.sessionName,
          status: r.status,
          origin: r.origin,
          prompt: r.prompt,
          createdAt: r.createdAt,
          resolvedAt: r.resolvedAt,
          costUsd: r.costUsd,
          artifacts: r.artifacts,
        })),
        files,
        connections,
        seenAt,
      }),
    [cases, runs, files, connections, seenAt],
  )
  const groups = useMemo(() => groupStream(items, lens), [items, lens])
  const markBefore = useMemo(() => {
    if (lens !== 'day' || seenAt === null) return null
    const first = items.find((i) => !i.fresh)
    return first && items.some((i) => i.fresh) ? first.id : null
  }, [items, lens, seenAt])

  const open = (it: StreamItem): void => {
    if (it.caseId) onOpenCase(it.caseId)
    else if (it.path) window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: it.path } }))
  }

  return (
    <div className={styles.history} data-testid="history-view">
      <div ref={panel} className={styles.panel}>
        <div className={styles.top}>
          <p className={styles.status} data-testid="history-status">
            {streamStatus(items, seenAt)}
          </p>
          <div className={styles.lenses} role="group" aria-label="Group by">
            {STREAM_LENSES.map((l) => (
              <button key={l} type="button" className={l === lens ? styles.lensOn : ''} onClick={() => setLens(l)} aria-pressed={l === lens} data-lens={l}>
                by {l}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.scroll}>
          {groups.length === 0 && <p className={styles.empty}>The history starts with the first thing that happens: ask an agent for something, or open a case.</p>}
          {groups.map((g) => (
            <section key={g.key} className={styles.group} data-group={g.label}>
              <div className={styles.groupHead}>
                <span>{g.label}</span>
                <span className={styles.groupMeta}>
                  {g.items.length}
                  {costLabel(g.cost) && ` · ${costLabel(g.cost)}`}
                </span>
              </div>
              <ol className={styles.list}>
                {g.items.map((it) => (
                  <li key={it.id}>
                    {markBefore === it.id && (
                      <div className={styles.mark} role="separator" aria-label="You last looked here" data-testid="history-mark">
                        <span>You last looked here</span>
                      </div>
                    )}
                    <div className={`${styles.row} ${it.fresh ? styles.fresh : ''}`} data-kind={it.kind} data-history={it.id}>
                      <span className={styles.dot} data-kind={it.kind} />
                      <span className={styles.text} title={it.text}>
                        {it.text}
                      </span>
                      <span className={styles.when}>{agoLabel(it.at)}</span>
                      {(it.caseId || it.path) && (
                        <button type="button" className={styles.open} onClick={() => open(it)} aria-label={it.caseId ? 'Open the case' : 'Open the file'}>
                          Open <ArrowUpRight size={12} />
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
