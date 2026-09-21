import { memo, useState } from 'react'
import type { LiveRange, RangeSyncAllPreview, RangeRefreshResult, RangeSyncAllResult } from '../../../types/workspace-api'
import { dimsLabel } from '../../../lib/rangesView'
import { baseName } from './MetricRow'
import styles from './MetricsPanel.module.css'

export interface RangesSectionProps {
  ranges: LiveRange[]
  /** Which app surface the panel serves — Insert anchors blocks in Calc only. */
  surface: 'calc' | 'writer' | 'impress'
  /** Active cell A1 address (Calc only; empty when no cell is selected). */
  activeCell: string
  /** Create a range that reads live from a rectangular ref on this sheet. */
  onCreateFromRef: (name: string, ref: string) => Promise<boolean>
  /** Stamp the range's grid at the active cell + record the live link. */
  onInsert: (r: LiveRange) => void | Promise<void>
  /** Re-read one sourced range from its source block on disk. */
  onRefresh: (id: string) => Promise<RangeRefreshResult>
  /** Re-read every sourced range. */
  onRefreshAll: () => void | Promise<void>
  /** Ids of sourced ranges whose last read failed (show a stale indicator). */
  staleRangeIds: Set<string>
  onDelete: (id: string) => void | Promise<void>
  /** Dry-run: which closed files a sync-all would change (no writes). */
  onPreviewSyncAll: (rangeId: string) => Promise<RangeSyncAllPreview>
  /** Explicitly push a range into every CLOSED linked file on disk. */
  onSyncAll: (rangeId: string) => Promise<RangeSyncAllResult>
  /** Per-range link count (for the badge), keyed by range id. */
  linkCounts: Map<string, number>
}

/**
 * The "Live ranges" section of the Metrics panel — named grids read live from
 * a real spreadsheet block, transcluded as blocks that fail safe to literal
 * cells. Calc-first: creating and inserting need an open sheet; other surfaces
 * see the list read-only.
 */
export const RangesSection = memo(function RangesSection({
  ranges,
  surface,
  activeCell,
  onCreateFromRef,
  onInsert,
  onRefresh,
  onRefreshAll,
  staleRangeIds,
  onDelete,
  onPreviewSyncAll,
  onSyncAll,
  linkCounts,
}: RangesSectionProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newRef, setNewRef] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  // Sync-all confirm flow: which range is confirming + its fetched dry-run.
  const [confirm, setConfirm] = useState<{ id: string; preview: RangeSyncAllPreview } | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)

  const isCalc = surface === 'calc'
  const sourcedCount = ranges.filter((r) => r.source?.kind === 'xlsx-range').length

  const create = async (): Promise<void> => {
    if (!newRef.trim()) return
    if (await onCreateFromRef(newName, newRef.trim())) {
      setNewName('')
      setNewRef('')
    }
  }

  const refreshAll = async (): Promise<void> => {
    setRefreshingAll(true)
    try { await onRefreshAll() } finally { setRefreshingAll(false) }
  }

  const startSync = async (id: string): Promise<void> => {
    setBusyId(id)
    try { setConfirm({ id, preview: await onPreviewSyncAll(id) }) }
    catch { /* preview unavailable */ }
    finally { setBusyId(null) }
  }

  const applySync = async (id: string): Promise<void> => {
    setBusyId(id)
    try { await onSyncAll(id) } finally { setBusyId(null); setConfirm(null) }
  }

  return (
    <>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Live ranges</div>
        {isCalc ? (
          <>
            <input
              className={styles.input}
              data-testid="range-name"
              placeholder="Name (e.g. Regional KPIs)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className={styles.row}>
              <input
                className={styles.input}
                data-testid="range-ref"
                placeholder="Range (e.g. A1:C4)"
                value={newRef}
                onChange={(e) => setNewRef(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
              <button
                className={styles.btn}
                data-testid="range-create"
                onClick={() => void create()}
                disabled={!newRef.trim()}
                title="Create a range that reads live from this sheet's saved file"
              >
                Add
              </button>
            </div>
          </>
        ) : (
          <div className={styles.empty}>Ranges are created and inserted in a spreadsheet.</div>
        )}
        {sourcedCount > 0 && (
          <button
            className={styles.refreshAllBtn}
            data-testid="range-refresh-all"
            onClick={() => void refreshAll()}
            disabled={refreshingAll}
            title="Re-read every source-linked range from disk"
          >
            {refreshingAll ? 'Refreshing…' : `↻ Refresh all ranges (${sourcedCount})`}
          </button>
        )}
      </div>

      <div className={styles.list}>
        {ranges.length === 0 && <div className={styles.empty}>No ranges yet.</div>}
        {ranges.map((r) => (
          <div key={r.id} className={styles.metric} data-testid="range-row">
            <div className={styles.row}>
              <span className={styles.sourceLoc}>{r.name}</span>
              <span className={styles.sourceValue}>{dimsLabel(r.values)}</span>
              {(linkCounts.get(r.id) ?? 0) > 0 && (
                <span className={styles.sourceValue}>⛓ {linkCounts.get(r.id)}</span>
              )}
              <button
                className={styles.del}
                data-testid="range-delete"
                onClick={() => void onDelete(r.id)}
                title="Delete range (linked blocks keep their last values)"
              >
                ✕
              </button>
            </div>
            {r.source?.kind === 'xlsx-range' && (
              <div className={styles.sourceLine}>
                <span className={styles.sourceLoc} title={r.source.filePath}>
                  ⇠ {baseName(r.source.filePath)} · {r.source.sheet}!{r.source.ref}
                </span>
                {staleRangeIds.has(r.id) && (
                  <span className={styles.staleTag} title="Last read failed — showing the cached grid">
                    stale
                  </span>
                )}
                <button
                  className={styles.refreshBtn}
                  data-testid="range-refresh"
                  onClick={() => void onRefresh(r.id)}
                  title="Re-read this range from its source file now"
                >
                  ↻
                </button>
              </div>
            )}
            <div className={styles.row}>
              {isCalc ? (
                <button
                  className={styles.insertBtn}
                  data-testid="range-insert"
                  onClick={() => void onInsert(r)}
                  disabled={!activeCell}
                  title={activeCell ? `Stamp this ${dimsLabel(r.values)} block at ${activeCell}` : 'Select a cell first'}
                >
                  ⬇ Insert at {activeCell || '…'}
                </button>
              ) : (
                // Writer/Impress: insert the grid as a real table at the caret/slide.
                <button
                  className={styles.insertBtn}
                  data-testid="range-insert"
                  onClick={() => void onInsert(r)}
                  title={`Insert this ${dimsLabel(r.values)} range as a ${surface === 'impress' ? 'slide' : 'Word'} table`}
                >
                  ⬇ Insert table
                </button>
              )}
              {(linkCounts.get(r.id) ?? 0) > 0 && (
                <button
                  className={styles.syncBtn}
                  data-testid="range-sync"
                  onClick={() => void startSync(r.id)}
                  disabled={busyId === r.id}
                  title="Push this range into every linked file on disk (closed files too)"
                >
                  ⇊ Sync files
                </button>
              )}
            </div>
            {confirm?.id === r.id && (
              <div className={styles.confirm}>
                <div className={styles.confirmTitle}>
                  {confirm.preview.willUpdate.length > 0
                    ? `Update ${confirm.preview.willUpdate.length} closed file${confirm.preview.willUpdate.length > 1 ? 's' : ''}?`
                    : 'Everything is already in sync.'}
                </div>
                {confirm.preview.willUpdate.length > 0 && (
                  <div className={styles.fileList}>
                    {confirm.preview.willUpdate.map((u, i) => (
                      <div key={i} className={styles.fileItem} title={u.file}>
                        {baseName(u.file)} · {u.label}
                      </div>
                    ))}
                  </div>
                )}
                <div className={styles.confirmNote}>
                  {confirm.preview.unchanged} in sync · {confirm.preview.openSkipped} in the open file (updated live)
                </div>
                <div className={styles.confirmRow}>
                  {confirm.preview.willUpdate.length > 0 && (
                    <button
                      className={styles.btn}
                      data-testid="range-sync-apply"
                      onClick={() => void applySync(r.id)}
                      disabled={busyId === r.id}
                    >
                      {busyId === r.id ? 'Syncing…' : 'Sync now'}
                    </button>
                  )}
                  <button className={styles.btn} onClick={() => setConfirm(null)}>
                    {confirm.preview.willUpdate.length > 0 ? 'Cancel' : 'OK'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
})
