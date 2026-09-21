import { memo, useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Metric,
  MetricRefreshResult,
  SyncAllPreview,
  SyncAllResult,
  TransclusionLink,
} from '../../../types/workspace-api'
import { groupLinksByFile, humanLocation, type FileLinkGroup } from '../../../lib/linksView'
import styles from './MetricsPanel.module.css'

export const baseName = (p: string): string => p.split(/[\\/]/).pop() || p

/** True when a metric reads its value live from a spreadsheet cell. */
export function isSourced(
  m: Metric,
): m is Metric & { source: { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string } } {
  return m.source?.kind === 'xlsx-cell'
}

export interface MetricsPanelProps {
  metrics: Metric[]
  /** Which app surface the panel serves — gates how "Insert" targets the anchor. */
  surface: 'calc' | 'writer' | 'impress'
  /** Active cell A1 address (Calc only; empty when no cell is selected). */
  activeCell: string
  onCreate: (name: string, value: number) => void
  /** Create a metric that reads live from the selected Calc cell (calc only). */
  onCreateFromCell?: (name: string) => void | Promise<void>
  /** Label of the currently-selected cell ("Sheet!A1"); enables create-from-cell. */
  sourceCellLabel?: string
  onUpdate: (id: string, patch: { name?: string; value?: number }) => void | Promise<void>
  /** Re-read one sourced metric from its source cell on disk. */
  onRefresh: (id: string) => Promise<MetricRefreshResult>
  /** Re-read every sourced metric. */
  onRefreshAll: () => void | Promise<void>
  /** Convert a sourced metric back to a literal, keeping its current value. */
  onDetach: (id: string) => void | Promise<void>
  /** Ids of sourced metrics whose last read failed (show a stale indicator). */
  staleMetricIds: Set<string>
  onDelete: (id: string) => void
  /** Write the metric's literal value into the active cell + record the link. */
  onInsert: (m: Metric) => void
  /** Dry-run: which closed files/cells a sync-all would change (no writes). */
  onPreviewSyncAll: (metricId: string) => Promise<SyncAllPreview>
  /** Explicitly push a metric into every CLOSED linked file on disk. */
  onSyncAll: (metricId: string) => Promise<SyncAllResult>
  /** Read-only: every link for a metric across ALL files ("where is this linked"). */
  onForMetric: (metricId: string) => Promise<TransclusionLink[]>
  /** Per-metric link count (for the badge), keyed by metric id. */
  linkCounts: Map<string, number>
  /** Forget one link (sidecar only — the file's value is untouched). */
  onRemoveLink: (linkId: string) => void | Promise<void>
  /** Reveal a linked file in the OS file manager (optional). */
  onRevealFile?: (filePath: string) => void
  /** Fired after a link is removed so the parent refreshes counts + indicators. */
  onLinksChanged?: () => void
  /** When set, auto-expand this metric's locations on mount (focus-this-file). */
  focusMetricId?: string | null
  /** Optional "Live ranges" section (grid-sized transclusion), rendered below. */
  rangesSection?: ReactNode
  /** Optional "Collections" section (records→layout transclusion), below ranges. */
  collectionsSection?: ReactNode
  onClose: () => void
}

/**
 * One editable metric row with an EXPLICIT Save. Name/value edit into local draft
 * state; Save is disabled until something actually changed, commits via onUpdate
 * (which persists AND live-propagates to the open sheet), and flashes "updated ✓".
 * Enter in either field commits too.
 */
export const MetricRow = memo(function MetricRow({
  metric,
  surface,
  activeCell,
  linkCount,
  startExpanded,
  stale,
  onUpdate,
  onRefresh,
  onDetach,
  onDelete,
  onInsert,
  onPreviewSyncAll,
  onSyncAll,
  onForMetric,
  onRemoveLink,
  onRevealFile,
  onLinksChanged,
}: {
  metric: Metric
  surface: 'calc' | 'writer' | 'impress'
  activeCell: string
  linkCount: number
  startExpanded: boolean
  stale: boolean
  onUpdate: MetricsPanelProps['onUpdate']
  onRefresh: MetricsPanelProps['onRefresh']
  onDetach: MetricsPanelProps['onDetach']
  onDelete: MetricsPanelProps['onDelete']
  onInsert: MetricsPanelProps['onInsert']
  onPreviewSyncAll: MetricsPanelProps['onPreviewSyncAll']
  onSyncAll: MetricsPanelProps['onSyncAll']
  onForMetric: MetricsPanelProps['onForMetric']
  onRemoveLink: MetricsPanelProps['onRemoveLink']
  onRevealFile: MetricsPanelProps['onRevealFile']
  onLinksChanged: MetricsPanelProps['onLinksChanged']
}): JSX.Element {
  const [name, setName] = useState(metric.name)
  const [value, setValue] = useState(String(metric.value))
  const [saved, setSaved] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Sync-all confirm flow: null = idle; otherwise the fetched dry-run to confirm.
  const [preview, setPreview] = useState<SyncAllPreview | null>(null)
  const [busy, setBusy] = useState(false)
  // "Where is this linked" disclosure: expanded state + the loaded, grouped links.
  const [expanded, setExpanded] = useState(startExpanded)
  const [groups, setGroups] = useState<FileLinkGroup[] | null>(null)

  const loadLinks = useCallback(async (): Promise<void> => {
    try {
      setGroups(groupLinksByFile(await onForMetric(metric.id)))
    } catch {
      setGroups([])
    }
  }, [onForMetric, metric.id])

  const toggleExpanded = useCallback((): void => {
    setExpanded((prev) => {
      const next = !prev
      if (next && groups === null) void loadLinks()
      return next
    })
  }, [groups, loadLinks])

  // Auto-expand + load when asked to focus this metric (from the in-doc chip),
  // including when the panel is already open and the focus target changes.
  useEffect(() => {
    if (startExpanded) { setExpanded(true); void loadLinks() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startExpanded])

  const removeLink = useCallback(
    async (linkId: string): Promise<void> => {
      await onRemoveLink(linkId)
      await loadLinks() // reflect the removal in the grouped list
      onLinksChanged?.() // refresh the parent's counts + in-doc indicators
    },
    [onRemoveLink, loadLinks, onLinksChanged],
  )

  const openPreview = async (): Promise<void> => {
    setBusy(true)
    try {
      setPreview(await onPreviewSyncAll(metric.id))
    } catch {
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  const confirmSync = async (): Promise<void> => {
    setBusy(true)
    try {
      await onSyncAll(metric.id) // parent toasts the result
    } finally {
      setBusy(false)
      setPreview(null)
    }
  }

  // Re-baseline the draft when the stored metric changes underneath (a save
  // commits optimistically → this resets `changed` so Save disables again, which
  // is itself the "it persisted" signal).
  useEffect(() => {
    setName(metric.name)
    setValue(String(metric.value))
    setPreview(null) // a value change underneath invalidates any open dry-run
  }, [metric.name, metric.value])

  // A sourced metric's value is READ-ONLY (it comes from its source cell); only
  // the name is editable. A literal metric keeps the classic name+value Save UX.
  const sourced = isSourced(metric)
  const num = Number(value)
  const nameOk = name.trim().length > 0
  const valueChanged = !sourced && num !== metric.value
  const changed = name.trim() !== metric.name || valueChanged
  const canSave = changed && nameOk && (sourced || Number.isFinite(num))

  const save = (): void => {
    if (!canSave) return
    void onUpdate(metric.id, sourced ? { name: name.trim() } : { name: name.trim(), value: num })
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1600)
  }

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try {
      await onRefresh(metric.id)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className={styles.metric}>
      <input
        className={styles.nameEdit}
        value={name}
        onChange={(e) => {
          setName(e.target.value)
          setSaved(false)
        }}
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <div className={styles.row}>
        <input
          className={styles.valueEdit}
          data-testid="metric-value"
          type={sourced ? 'text' : 'number'}
          step="any"
          value={sourced ? String(metric.value) : value}
          readOnly={sourced}
          title={sourced ? 'Value is read live from the source cell' : undefined}
          onChange={(e) => {
            if (sourced) return
            setValue(e.target.value)
            setSaved(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button
          className={styles.btn}
          data-testid="metric-save"
          onClick={save}
          disabled={!canSave}
          title={canSave ? 'Save & update linked cells' : 'No changes to save'}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
        <button className={styles.del} onClick={() => onDelete(metric.id)} title="Delete metric">
          🗑
        </button>
      </div>

      {/* Sourced metric: where the value is read from, plus Refresh / stale /
          Detach. The value above is read-only — it originates in this cell. */}
      {sourced && (
        <div className={styles.sourceLine} data-testid="metric-source">
          <span
            className={styles.sourceLoc}
            title={`Reads live from ${metric.source.filePath} › ${metric.source.sheet}!${metric.source.cell}`}
          >
            ↩ {baseName(metric.source.filePath)} › {metric.source.sheet}!{metric.source.cell}
          </span>
          {stale && (
            <span className={styles.staleTag} data-testid="metric-stale" title="Last read failed — showing the last good value">
              stale
            </span>
          )}
          <button
            className={`${styles.btn} ${styles.refreshBtn}`}
            data-testid="metric-refresh"
            onClick={() => void refresh()}
            disabled={refreshing}
            title="Re-read the value from the source cell"
          >
            {refreshing ? '…' : '↻'}
          </button>
          <button
            className={styles.del}
            data-testid="metric-detach"
            onClick={() => void onDetach(metric.id)}
            title="Detach — convert to a plain value, keeping the current number"
          >
            ⛓✕
          </button>
        </div>
      )}

      <div className={styles.row}>
        {surface === 'writer' || surface === 'impress' ? (
          <button
            className={styles.insertBtn}
            data-testid="metric-insert"
            onClick={() => onInsert(metric)}
            title={
              surface === 'impress'
                ? 'Insert the value on the current slide (as a live named shape)'
                : 'Insert the value at the cursor (as a live content control)'
            }
          >
            {surface === 'impress' ? 'Insert on slide' : 'Insert at cursor'}
          </button>
        ) : (
          <button
            className={styles.insertBtn}
            data-testid="metric-insert"
            onClick={() => onInsert(metric)}
            disabled={!activeCell}
            title={activeCell ? `Insert into ${activeCell}` : 'Select a cell first'}
          >
            {activeCell ? `Insert → ${activeCell}` : 'Insert here'}
          </button>
        )}
      </div>

      {/* "Where is this linked": a count badge that discloses the locations,
          grouped by file, each with its last-synced value + a forget affordance. */}
      <button
        className={linkCount > 0 ? styles.linkBadge : styles.linkBadgeEmpty}
        data-testid="metric-links-toggle"
        onClick={toggleExpanded}
        disabled={linkCount === 0}
        title={linkCount > 0 ? 'Show where this metric is linked' : 'Not linked anywhere yet'}
      >
        <span className={linkCount > 0 ? styles.dotLive : styles.dotIdle}>●</span>{' '}
        {linkCount > 0 ? `${linkCount} linked` : 'Not linked'}
        {linkCount > 0 && <span className={styles.caretGlyph}>{expanded ? ' ▾' : ' ▸'}</span>}
      </button>
      {expanded && linkCount > 0 && (
        <div className={styles.links} data-testid="metric-links">
          {groups === null ? (
            <div className={styles.confirmNote}>Loading…</div>
          ) : (
            groups.map((g) => (
              <div key={g.filePath} className={styles.linkGroup}>
                <div className={styles.linkFile}>
                  <span className={styles.linkFileName} title={g.filePath}>
                    {g.fileName}
                  </span>
                  {onRevealFile && (
                    <button
                      className={styles.revealBtn}
                      onClick={() => onRevealFile(g.filePath)}
                      title="Reveal this file in Finder"
                    >
                      ⤴
                    </button>
                  )}
                </div>
                {g.links.map((l) => (
                  <div key={l.id} className={styles.linkItem}>
                    <span className={styles.linkLoc}>{humanLocation(l.target)}</span>
                    <span className={styles.linkVal} title="Value last synced into this anchor">
                      {l.lastValue}
                    </span>
                    <button
                      className={styles.linkRemove}
                      data-testid="metric-link-remove"
                      onClick={() => void removeLink(l.id)}
                      title="Stop syncing this cell — its current value stays"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}

      {/* Deliberate, opt-in propagation to files that AREN'T open — distinct from
          the per-open-file live Save above. Shows a dry-run confirm first. */}
      {!preview && (
        <button
          className={styles.syncBtn}
          data-testid="metric-syncall"
          onClick={openPreview}
          disabled={busy}
          title="Push this value into every linked file on disk (preview first)"
        >
          {busy ? 'Checking…' : '↻ Sync all files'}
        </button>
      )}
      {preview && (
        <div className={styles.confirm} data-testid="metric-syncall-confirm">
          {preview.willUpdate.length > 0 ? (
            <>
              <div className={styles.confirmTitle}>
                Update {preview.willUpdate.length} cell
                {preview.willUpdate.length > 1 ? 's' : ''} across{' '}
                {new Set(preview.willUpdate.map((u) => u.file)).size} file
                {new Set(preview.willUpdate.map((u) => u.file)).size > 1 ? 's' : ''}?
              </div>
              <ul className={styles.fileList}>
                {preview.willUpdate.map((u, i) => (
                  <li key={i} className={styles.fileItem} title={`${u.file} · ${u.label}`}>
                    {baseName(u.file)} · {u.label}
                  </li>
                ))}
              </ul>
              {preview.openSkipped > 0 && (
                <div className={styles.confirmNote}>
                  {preview.openSkipped} in the open file (kept live).
                </div>
              )}
              <div className={styles.confirmRow}>
                <button
                  className={styles.btn}
                  data-testid="metric-syncall-confirm-btn"
                  onClick={confirmSync}
                  disabled={busy}
                >
                  {busy ? 'Syncing…' : 'Sync now'}
                </button>
                <button className={styles.del} onClick={() => setPreview(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className={styles.confirmNote}>
                Nothing to sync — all linked files are up to date.
              </div>
              <div className={styles.confirmRow}>
                <button className={styles.del} onClick={() => setPreview(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {saved && <div className={styles.savedNote}>updated ✓</div>}
    </div>
  )
})
