import { memo, useState } from 'react'
import { MetricRow, isSourced, type MetricsPanelProps } from './MetricRow'
import styles from './MetricsPanel.module.css'

/**
 * Metrics panel (live-transclusion demo). Manage source-of-truth values and,
 * with a cell selected, transclude one into it: the literal number lands in the
 * real .xlsx and a live link is recorded. Editing a value + Save propagates the
 * new number LIVE into every linked cell in the currently-open sheet.
 */
export const MetricsPanel = memo(function MetricsPanel({
  metrics,
  surface,
  activeCell,
  onCreate,
  onCreateFromCell,
  sourceCellLabel,
  onUpdate,
  onRefresh,
  onRefreshAll,
  onDetach,
  staleMetricIds,
  onDelete,
  onInsert,
  onPreviewSyncAll,
  onSyncAll,
  onForMetric,
  linkCounts,
  onRemoveLink,
  onRevealFile,
  onLinksChanged,
  focusMetricId,
  rangesSection,
  collectionsSection,
  onClose,
}: MetricsPanelProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [refreshingAll, setRefreshingAll] = useState(false)

  const create = (): void => {
    const v = Number(newValue)
    if (!newName.trim() || !Number.isFinite(v)) return
    onCreate(newName.trim(), v)
    setNewName('')
    setNewValue('')
  }

  const createFromCell = (): void => {
    void onCreateFromCell?.(newName.trim())
    setNewName('')
    setNewValue('')
  }

  const refreshAll = async (): Promise<void> => {
    setRefreshingAll(true)
    try {
      await onRefreshAll()
    } finally {
      setRefreshingAll(false)
    }
  }

  const sourcedCount = metrics.filter(isSourced).length

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span>Metrics</span>
        <button className={styles.x} onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>New metric</div>
        <input
          className={styles.input}
          placeholder="Name (e.g. Q3 Revenue)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <div className={styles.row}>
          <input
            className={styles.input}
            type="number"
            step="any"
            placeholder="Value"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button className={styles.btn} onClick={create} disabled={!newName.trim() || newValue === ''}>
            Add
          </button>
        </div>
        {/* Create-from-cell: turn the SELECTED Calc cell into a live source. The
            value is read from the cell; the name defaults to the cell address. */}
        {onCreateFromCell && sourceCellLabel && (
          <button
            className={`${styles.insertBtn} ${styles.fromCellBtn}`}
            data-testid="metric-from-cell"
            onClick={createFromCell}
            title={`Create a metric that reads live from ${sourceCellLabel}`}
          >
            ↩ Create metric from {sourceCellLabel}
          </button>
        )}
      </div>

      {sourcedCount > 0 && (
        <div className={styles.section}>
          <button
            className={styles.refreshAllBtn}
            data-testid="metric-refresh-all"
            onClick={() => void refreshAll()}
            disabled={refreshingAll}
            title="Re-read every source-linked metric from disk"
          >
            {refreshingAll ? 'Refreshing…' : `↻ Refresh all sources (${sourcedCount})`}
          </button>
        </div>
      )}

      <div className={styles.list}>
        {metrics.length === 0 && <div className={styles.empty}>No metrics yet.</div>}
        {metrics.map((m) => (
          <MetricRow
            key={m.id}
            metric={m}
            surface={surface}
            activeCell={activeCell}
            linkCount={linkCounts.get(m.id) ?? 0}
            startExpanded={focusMetricId === m.id}
            stale={staleMetricIds.has(m.id)}
            onUpdate={onUpdate}
            onRefresh={onRefresh}
            onDetach={onDetach}
            onDelete={onDelete}
            onInsert={onInsert}
            onPreviewSyncAll={onPreviewSyncAll}
            onSyncAll={onSyncAll}
            onForMetric={onForMetric}
            onRemoveLink={onRemoveLink}
            onRevealFile={onRevealFile}
            onLinksChanged={onLinksChanged}
          />
        ))}
      </div>

      {rangesSection}

      {collectionsSection}

      <div className={styles.footNote}>
        Edit a value and press Save to update every linked cell in this sheet live. “Sync all files”
        pushes the value into every linked file on disk (closed files too) as a deliberate action —
        it previews first and never writes a file it can’t update safely. A deleted metric leaves the
        last value untouched.
      </div>
    </div>
  )
})
