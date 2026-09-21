import { useState, useEffect, useCallback } from 'react'
import { WorkspaceMemoryView } from './WorkspaceMemory'
import { Brain, Lightbulb, TrendingUp, AlertTriangle, Wrench, BookOpen, RefreshCw } from 'lucide-react'
import type { PulseInsight, PulseInsightType } from '../../types/workspace-api'
import styles from './MemoryPanel.module.css'

interface MemoryPanelProps {
  /** True while this view is the visible sidebar tab — triggers a refresh. */
  active: boolean
}

/** Display order + labels + icon per category. Order = importance for recall. */
const GROUPS: { type: PulseInsightType; label: string; Icon: typeof Brain }[] = [
  { type: 'decision', label: 'Decisions', Icon: Lightbulb },
  { type: 'blocked', label: 'Blockers', Icon: AlertTriangle },
  { type: 'progress', label: 'Progress', Icon: TrendingUp },
  { type: 'pattern', label: 'Patterns', Icon: Brain },
  { type: 'fix', label: 'Fixes', Icon: Wrench },
  { type: 'context', label: 'Context', Icon: BookOpen },
]

/** Compact relative time ("3d", "2h", "just now") from an ISO timestamp. */
function relTime(iso: string): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, (Date.now() - t) / 1000)
  if (secs < 60) return 'just now'
  const mins = secs / 60
  if (mins < 60) return `${Math.floor(mins)}m`
  const hrs = mins / 60
  if (hrs < 24) return `${Math.floor(hrs)}h`
  const days = hrs / 24
  if (days < 30) return `${Math.floor(days)}d`
  const months = days / 30
  if (months < 12) return `${Math.floor(months)}mo`
  return `${Math.floor(months / 12)}y`
}

/**
 * Sidebar Memory view — surfaces the workspace's own prior insights (decisions,
 * blockers, progress, patterns) mined from Claude Code sessions and stored in
 * the local Pulse DB. Read-only: the compounding memory made visible in-app.
 */
export function MemoryPanel({ active }: MemoryPanelProps): JSX.Element {
  const [insights, setInsights] = useState<PulseInsight[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'available' | 'absent' | 'incompatible' | 'error' | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rows, st] = await Promise.all([
        window.workspace.memory.recent(150),
        window.workspace.memory.status(),
      ])
      setInsights(rows)
      setStatus(st.status)
    } catch {
      setInsights([])
      setStatus('error')
    }
    setLoading(false)
  }, [])

  // Refresh whenever the panel becomes visible — insights accrue continuously.
  useEffect(() => {
    if (active) void load()
  }, [active, load])

  const grouped = GROUPS.map((g) => ({
    ...g,
    items: insights.filter((i) => i.type === g.type),
  })).filter((g) => g.items.length > 0)

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Brain size={14} strokeWidth={1.75} className={styles.headerIcon} />
          <span>Memory</span>
          {insights.length > 0 && <span className={styles.count}>{insights.length}</span>}
        </div>
        <button className={styles.refresh} onClick={() => void load()} title="Refresh" disabled={loading}>
          <RefreshCw size={13} strokeWidth={2} className={loading ? styles.spin : ''} />
        </button>
      </div>

      <div className={styles.body}>
        {/* What THIS workspace has learned comes first: it is the actionable
            half, and unlike the Pulse history below it can be corrected here. */}
        <WorkspaceMemoryView />

        {loading && insights.length === 0 ? (
          <div className={styles.status}>Loading…</div>
        ) : status !== null && status !== 'available' ? (
          <div className={styles.empty}>
            <Brain size={28} strokeWidth={1.25} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No memory available</p>
            <p className={styles.emptyHint}>
              {status === 'absent'
                ? 'The Pulse insight database was not found on this machine.'
                : 'The Pulse database is present but could not be read.'}
            </p>
          </div>
        ) : insights.length === 0 ? (
          <div className={styles.empty}>
            <Brain size={28} strokeWidth={1.25} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No insights yet</p>
            <p className={styles.emptyHint}>Prior decisions, blockers and progress for this workspace will appear here.</p>
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.type}>
              <div className={styles.sectionLabel}>
                <g.Icon size={11} strokeWidth={2} /> {g.label}
                <span className={styles.sectionCount}>{g.items.length}</span>
              </div>
              {g.items.map((i) => (
                <div key={i.id} className={`${styles.card} ${styles[g.type] ?? ''}`}>
                  <div className={styles.cardText}>{i.text}</div>
                  <div className={styles.cardMeta}>
                    {i.reasoning && <span className={styles.reasoning}>{i.reasoning}</span>}
                    <span className={styles.time}>{relTime(i.timestamp)}</span>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
