import { useCallback, useEffect, useMemo, useState } from 'react'
import { useReviewStore } from '../Review/useReviewStore'
import { useCreatedAssets } from '../../hooks/useCreatedAssets'
import { agoLabel } from '../Shell/home/homeModel'
import type { WorkCase } from '../../types/workspace-api'
import {
  buildStream,
  groupStream,
  streamStatus,
  costLabel,
  STREAM_LENSES,
  type StreamItem,
  type StreamLens,
} from './streamModel'
import styles from './Stream.module.css'

/** Where the last look is remembered — per machine, like the hero snooze. */
export const STREAM_SEEN_KEY = 'wos:stream-seen'

function readSeen(): number | null {
  try {
    const v = Number(localStorage.getItem(STREAM_SEEN_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}

/**
 * STREAM — the workspace's history as a river.
 *
 * The "While you were away" card on Home is the top of this water. Here it
 * runs all the way back: every note, every run, every file that appeared, one
 * sentence each, grouped by day, with a quiet mark where you last looked.
 *
 * The mark is set when you LEAVE, not when you arrive, so the things above it
 * stay fresh for the whole visit.
 */
export function StreamView({
  onOpenFile,
  onOpenCase,
}: {
  onOpenFile?: (path: string) => void
  /** Jump to a case on Home. */
  onOpenCase?: (id: string) => void
}): JSX.Element {
  const [seenAt] = useState<number | null>(readSeen)
  const [lens, setLens] = useState<StreamLens>('day')
  const [cases, setCases] = useState<WorkCase[]>([])
  const [connections, setConnections] = useState<{ id: string; name: string; status: string; checkedAt: number }[]>([])
  const { runs } = useReviewStore()
  const files = useCreatedAssets()

  const refresh = useCallback(async () => {
    try {
      setCases((await window.workspace.cases.list()) ?? [])
    } catch {
      setCases([])
    }
    // Connections that need the person join the river; the probe is cached in
    // main, so this costs nothing on a second look.
    try {
      const list = (await window.workspace.connections?.list()) ?? []
      setConnections(list.map((c) => ({ id: c.id, name: c.name, status: c.status, checkedAt: c.checkedAt })))
    } catch {
      setConnections([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])
  // Cases are workspace-scoped — a root switch must swap the river too.
  useEffect(() => window.workspace.fs.onRootChanged(() => void refresh()), [refresh])

  // Leaving sets the mark.
  useEffect(
    () => () => {
      try {
        localStorage.setItem(STREAM_SEEN_KEY, String(Date.now()))
      } catch {
        /* private mode — the mark is a convenience, not a record */
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

  // The "you last looked here" line sits before the first thing that is not
  // fresh — only when the stream is in time order, and only when there is
  // something on both sides of it.
  const markBefore = useMemo(() => {
    if (lens !== 'day' || seenAt === null) return null
    const first = items.find((i) => !i.fresh)
    return first && items.some((i) => i.fresh) ? first.id : null
  }, [items, lens, seenAt])

  const open = (it: StreamItem): void => {
    if (it.caseId) onOpenCase?.(it.caseId)
    else if (it.path) onOpenFile?.(it.path)
  }

  return (
    <div className={styles.root} data-testid="cockpit-stream">
      <p className={styles.status}>{streamStatus(items, seenAt)}</p>

      <div className={styles.lensRow} role="group" aria-label="Group the stream by">
        {STREAM_LENSES.map((l) => (
          <button
            key={l}
            className={`${styles.lensChip} ${l === lens ? styles.lensChipOn : ''}`}
            onClick={() => setLens(l)}
            aria-pressed={l === lens}
          >
            by {l}
          </button>
        ))}
      </div>

      {groups.length === 0 && (
        <p className={styles.empty}>
          Ask an agent for something, or open a case — the river starts with the first thing that happens.
        </p>
      )}

      {groups.map((g) => (
        <section key={g.key} className={styles.group}>
          <h2 className={styles.groupTitle}>
            <span>{g.label}</span>
            <span className={styles.groupMeta}>
              {g.items.length}
              {costLabel(g.cost) && <span className={styles.cost}> · {costLabel(g.cost)}</span>}
            </span>
          </h2>
          <ol className={styles.list}>
            {g.items.map((it) => (
              <li key={it.id} className={styles.rowWrap}>
                {markBefore === it.id && (
                  <div className={styles.seenMark} role="separator" aria-label="You last looked here">
                    <span>You last looked here</span>
                  </div>
                )}
                <div className={`${styles.row} ${it.fresh ? styles.rowFresh : ''}`}>
                  <span className={styles.glyph} aria-hidden>
                    {glyph(it.kind)}
                  </span>
                  <span className={styles.text} title={it.text}>
                    {it.text}
                  </span>
                  <span className={styles.when}>{agoLabel(it.at)}</span>
                  {(it.caseId || it.path) && (
                    <button className={styles.open} onClick={() => open(it)} title={it.caseId ? 'Open the case' : 'Open the file'}>
                      → open
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function glyph(kind: StreamItem['kind']): string {
  return kind === 'agent' ? '◦' : kind === 'case' ? '◇' : kind === 'connector' ? '⟟' : '▤'
}
