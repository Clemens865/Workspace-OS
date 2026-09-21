import { memo, useState } from 'react'
import type {
  CardTemplate,
  Collection,
  CollectionLayout,
  CollectionRefreshResult,
  CollectionSyncAllPreview,
  CollectionSyncAllResult,
  CollectionView,
  ViewFilter,
  ViewOp,
} from '../../../types/workspace-api'
import { applyView, summaryLabel, VIEW_OPS } from '../../../lib/collectionsView'
import { baseName } from './MetricRow'
import styles from './MetricsPanel.module.css'

/** Draft rows for the compact view editor (kept as strings until coerced). */
interface ViewDraft {
  filters: { field: string; op: ViewOp; value: string }[]
  sortField: string
  sortDir: 'asc' | 'desc'
  limit: string
}

const EMPTY_DRAFT: ViewDraft = { filters: [], sortField: '', sortDir: 'desc', limit: '' }

/**
 * A compact card-template draft: pick a TITLE field (rendered bold), an optional
 * SUBTITLE (rendered after " — " on the same line) and an optional SECOND-LINE
 * field. Coerced to a CardTemplate on insert. This is the "directory card" shape:
 *   line 1 = **{title}** — {subtitle}
 *   line 2 = {detail}
 */
interface CardDraft {
  title: string
  subtitle: string
  detail: string
}

const EMPTY_CARD: CardDraft = { title: '', subtitle: '', detail: '' }

/** Builds a CardTemplate from the picked fields, or undefined when no title. */
function cardDraftToTemplate(d: CardDraft): CardTemplate | undefined {
  if (!d.title) return undefined
  const line1 = { segments: [{ field: d.title, bold: true } as const] } as CardTemplate['lines'][number]
  if (d.subtitle) {
    line1.segments.push({ literal: ' — ' }, { field: d.subtitle })
  }
  const lines = [line1]
  if (d.detail) lines.push({ segments: [{ field: d.detail }] })
  return { lines }
}

/** Coerces a draft into a CollectionView (or undefined when it's a no-op). */
function draftToView(d: ViewDraft): CollectionView | undefined {
  const view: CollectionView = {}
  const filters: ViewFilter[] = []
  for (const f of d.filters) {
    if (!f.field || !f.value.trim()) continue
    const num = Number(f.value)
    const value = f.value.trim() !== '' && Number.isFinite(num) ? num : f.value
    filters.push({ field: f.field, op: f.op, value })
  }
  if (filters.length) view.filters = filters
  if (d.sortField) view.sort = [{ field: d.sortField, dir: d.sortDir }]
  const lim = Number(d.limit)
  if (d.limit.trim() !== '' && Number.isFinite(lim) && lim >= 0) view.limit = Math.floor(lim)
  return view.filters || view.sort || view.limit !== undefined ? view : undefined
}

export interface CollectionsSectionProps {
  collections: Collection[]
  /** Which app surface the panel serves — creating needs an open sheet. */
  surface: 'calc' | 'writer' | 'impress'
  /** Active cell A1 address (Calc only; empty when no cell is selected). */
  activeCell: string
  /** Create a collection whose records read live from a ref on this sheet. */
  onCreateFromRef: (name: string, ref: string) => Promise<boolean>
  /**
   * Render + stamp the collection's records at the caret/cell + record the link.
   * A `cardTemplate` (Word only) switches the layout to a directory of formatted
   * card blocks; omitting it keeps the default table layout.
   */
  onInsert: (
    c: Collection,
    view?: CollectionView,
    layout?: CollectionLayout,
    cardTemplate?: CardTemplate
  ) => void | Promise<void>
  /** Re-read one sourced collection from its source block on disk. */
  onRefresh: (id: string) => Promise<CollectionRefreshResult>
  /** Re-read every sourced collection. */
  onRefreshAll: () => void | Promise<void>
  /** Ids of sourced collections whose last read failed (stale indicator). */
  staleCollectionIds: Set<string>
  onDelete: (id: string) => void | Promise<void>
  /** Dry-run: which closed files a sync-all would change (no writes). */
  onPreviewSyncAll: (id: string) => Promise<CollectionSyncAllPreview>
  /** Explicitly push a collection's layout into every CLOSED linked file. */
  onSyncAll: (id: string) => Promise<CollectionSyncAllResult>
  /** Per-collection link count (badge), keyed by collection id. */
  linkCounts: Map<string, number>
}

/**
 * The "Collections" section of the Metrics panel — typed record sets read live
 * from a real spreadsheet block (row 0 = fields, rows below = records), inserted
 * as field-mapped tables that fail safe to literals. Calc-first: creating needs
 * an open sheet; inserting works on any surface (Word/slide tables too).
 */
export const CollectionsSection = memo(function CollectionsSection({
  collections,
  surface,
  activeCell,
  onCreateFromRef,
  onInsert,
  onRefresh,
  onRefreshAll,
  staleCollectionIds,
  onDelete,
  onPreviewSyncAll,
  onSyncAll,
  linkCounts,
}: CollectionsSectionProps): JSX.Element {
  const [newName, setNewName] = useState('')
  const [newRef, setNewRef] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ id: string; preview: CollectionSyncAllPreview } | null>(null)
  const [refreshingAll, setRefreshingAll] = useState(false)
  // Per-collection view draft (which one is open + its filter/sort/limit rows).
  const [viewFor, setViewFor] = useState<string | null>(null)
  const [draft, setDraft] = useState<ViewDraft>(EMPTY_DRAFT)
  // Per-collection layout choice + card-template draft (Word directory cards).
  const [layoutFor, setLayoutFor] = useState<Record<string, CollectionLayout>>({})
  const [cardDraft, setCardDraft] = useState<CardDraft>(EMPTY_CARD)

  const openView = (id: string): void => {
    setViewFor((cur) => (cur === id ? null : id))
    setDraft(EMPTY_DRAFT)
  }

  const isCalc = surface === 'calc'
  const sourcedCount = collections.filter((c) => c.source?.kind === 'xlsx-range').length

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
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Collections</div>
      {isCalc ? (
        <>
          <input
            className={styles.input}
            data-testid="collection-name"
            placeholder="Name (e.g. Team roster)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <div className={styles.row}>
            <input
              className={styles.input}
              data-testid="collection-ref"
              placeholder="Range incl. header row (e.g. A1:C12)"
              value={newRef}
              onChange={(e) => setNewRef(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void create()}
            />
            <button
              className={styles.btn}
              data-testid="collection-create"
              onClick={() => void create()}
              disabled={!newRef.trim()}
              title="Create a collection whose row 0 is field names and rows below are records"
            >
              Add
            </button>
          </div>
        </>
      ) : (
        <div className={styles.empty}>Collections are created from a spreadsheet range.</div>
      )}
      {sourcedCount > 0 && (
        <button
          className={styles.refreshAllBtn}
          data-testid="collection-refresh-all"
          onClick={() => void refreshAll()}
          disabled={refreshingAll}
          title="Re-read every source-linked collection from disk"
        >
          {refreshingAll ? 'Refreshing…' : `↻ Refresh all collections (${sourcedCount})`}
        </button>
      )}

      <div className={styles.list}>
        {collections.length === 0 && <div className={styles.empty}>No collections yet.</div>}
        {collections.map((c) => (
          <div key={c.id} className={styles.metric} data-testid="collection-row">
            <div className={styles.row}>
              <span className={styles.sourceLoc}>{c.name}</span>
              <span className={styles.sourceValue}>{summaryLabel(c)}</span>
              {(linkCounts.get(c.id) ?? 0) > 0 && (
                <span className={styles.sourceValue}>⛓ {linkCounts.get(c.id)}</span>
              )}
              <button
                className={styles.del}
                data-testid="collection-delete"
                onClick={() => void onDelete(c.id)}
                title="Delete collection (linked layouts keep their last values)"
              >
                ✕
              </button>
            </div>
            {c.source?.kind === 'xlsx-range' && (
              <div className={styles.sourceLine}>
                <span className={styles.sourceLoc} title={c.source.filePath}>
                  ⇠ {baseName(c.source.filePath)} · {c.source.sheet}!{c.source.ref}
                </span>
                {staleCollectionIds.has(c.id) && (
                  <span className={styles.staleTag} title="Last read failed — showing the cached records">
                    stale
                  </span>
                )}
                <button
                  className={styles.refreshBtn}
                  data-testid="collection-refresh"
                  onClick={() => void onRefresh(c.id)}
                  title="Re-read this collection from its source now"
                >
                  ↻
                </button>
              </div>
            )}
            <div className={styles.sourceLine}>
              <span className={styles.sourceValue} title={c.fields.join(', ')}>
                {c.fields.join(' · ')}
              </span>
            </div>
            <div className={styles.row}>
              <button
                className={styles.insertBtn}
                data-testid="collection-insert"
                onClick={() => {
                  const view = viewFor === c.id ? draftToView(draft) : undefined
                  const cards =
                    surface === 'writer' && (layoutFor[c.id] ?? 'table') === 'cards'
                      ? cardDraftToTemplate(cardDraft)
                      : undefined
                  void onInsert(c, view, cards ? 'cards' : 'table', cards)
                }}
                disabled={
                  (isCalc && !activeCell) ||
                  (surface === 'writer' &&
                    (layoutFor[c.id] ?? 'table') === 'cards' &&
                    !cardDraft.title)
                }
                title={
                  isCalc
                    ? activeCell
                      ? `Stamp this collection as a table at ${activeCell}`
                      : 'Select a cell first'
                    : `Insert this collection as a ${surface === 'impress' ? 'slide' : 'Word'} ${
                        surface === 'writer' && (layoutFor[c.id] ?? 'table') === 'cards'
                          ? 'directory'
                          : 'table'
                      }`
                }
              >
                {isCalc
                  ? `⬇ Insert at ${activeCell || '…'}`
                  : surface === 'writer' && (layoutFor[c.id] ?? 'table') === 'cards'
                    ? '⬇ Insert cards'
                    : '⬇ Insert table'}
              </button>
              {surface === 'writer' && (
                <button
                  className={styles.syncBtn}
                  data-testid="collection-layout-toggle"
                  onClick={() =>
                    setLayoutFor((m) => ({
                      ...m,
                      [c.id]: (m[c.id] ?? 'table') === 'cards' ? 'table' : 'cards',
                    }))
                  }
                  title="Switch between a Word table and a directory of formatted cards"
                >
                  {(layoutFor[c.id] ?? 'table') === 'cards' ? '▤ Cards' : '▦ Table'}
                </button>
              )}
              <button
                className={styles.syncBtn}
                data-testid="collection-view-toggle"
                onClick={() => openView(c.id)}
                title="Add a live view: filter, sort or limit which records land in the table"
              >
                {viewFor === c.id ? '⊟ View' : '⊞ View'}
              </button>
              {(linkCounts.get(c.id) ?? 0) > 0 && (
                <button
                  className={styles.syncBtn}
                  data-testid="collection-sync"
                  onClick={() => void startSync(c.id)}
                  disabled={busyId === c.id}
                  title="Push this collection's layout into every linked file on disk"
                >
                  ⇊ Sync files
                </button>
              )}
            </div>
            {viewFor === c.id && (
              <div className={styles.confirm} data-testid="collection-view-editor">
                <div className={styles.confirmTitle}>Live view (optional)</div>
                {draft.filters.map((f, i) => (
                  <div className={styles.row} key={i}>
                    <select
                      className={styles.input}
                      data-testid="view-filter-field"
                      value={f.field}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          filters: d.filters.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)),
                        }))
                      }
                    >
                      <option value="">field…</option>
                      {c.fields.map((fn) => (
                        <option key={fn} value={fn}>{fn}</option>
                      ))}
                    </select>
                    <select
                      className={styles.input}
                      data-testid="view-filter-op"
                      value={f.op}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          filters: d.filters.map((x, j) => (j === i ? { ...x, op: e.target.value as ViewOp } : x)),
                        }))
                      }
                    >
                      {VIEW_OPS.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    <input
                      className={styles.input}
                      data-testid="view-filter-value"
                      placeholder="value"
                      value={f.value}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          filters: d.filters.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        }))
                      }
                    />
                    <button
                      className={styles.del}
                      onClick={() => setDraft((d) => ({ ...d, filters: d.filters.filter((_, j) => j !== i) }))}
                      title="Remove filter"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  className={styles.refreshBtn}
                  data-testid="view-add-filter"
                  onClick={() =>
                    setDraft((d) => ({ ...d, filters: [...d.filters, { field: '', op: 'eq', value: '' }] }))
                  }
                >
                  + filter
                </button>
                <div className={styles.row}>
                  <select
                    className={styles.input}
                    data-testid="view-sort-field"
                    value={draft.sortField}
                    onChange={(e) => setDraft((d) => ({ ...d, sortField: e.target.value }))}
                  >
                    <option value="">sort by…</option>
                    {c.fields.map((fn) => (
                      <option key={fn} value={fn}>{fn}</option>
                    ))}
                  </select>
                  <select
                    className={styles.input}
                    data-testid="view-sort-dir"
                    value={draft.sortDir}
                    onChange={(e) => setDraft((d) => ({ ...d, sortDir: e.target.value as 'asc' | 'desc' }))}
                  >
                    <option value="desc">desc</option>
                    <option value="asc">asc</option>
                  </select>
                  <input
                    className={styles.input}
                    data-testid="view-limit"
                    placeholder="limit"
                    value={draft.limit}
                    onChange={(e) => setDraft((d) => ({ ...d, limit: e.target.value }))}
                  />
                </div>
                <div className={styles.confirmNote}>
                  {applyView(c.records, draftToView(draft)).length} of {c.records.length} records will land
                </div>
              </div>
            )}
            {surface === 'writer' && (layoutFor[c.id] ?? 'table') === 'cards' && (
              <div className={styles.confirm} data-testid="collection-card-editor">
                <div className={styles.confirmTitle}>Card fields (**Title** — Subtitle / Detail)</div>
                <div className={styles.row}>
                  <select
                    className={styles.input}
                    data-testid="card-title-field"
                    value={cardDraft.title}
                    onChange={(e) => setCardDraft((d) => ({ ...d, title: e.target.value }))}
                  >
                    <option value="">Title (bold)…</option>
                    {c.fields.map((fn) => (
                      <option key={fn} value={fn}>{fn}</option>
                    ))}
                  </select>
                  <select
                    className={styles.input}
                    data-testid="card-subtitle-field"
                    value={cardDraft.subtitle}
                    onChange={(e) => setCardDraft((d) => ({ ...d, subtitle: e.target.value }))}
                  >
                    <option value="">— Subtitle…</option>
                    {c.fields.map((fn) => (
                      <option key={fn} value={fn}>{fn}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.row}>
                  <select
                    className={styles.input}
                    data-testid="card-detail-field"
                    value={cardDraft.detail}
                    onChange={(e) => setCardDraft((d) => ({ ...d, detail: e.target.value }))}
                  >
                    <option value="">2nd line…</option>
                    {c.fields.map((fn) => (
                      <option key={fn} value={fn}>{fn}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.confirmNote}>
                  {cardDraft.title
                    ? 'One card block per record will be written into the directory region.'
                    : 'Pick a Title field to enable the cards layout.'}
                </div>
              </div>
            )}
            {confirm?.id === c.id && (
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
                  {confirm.preview.unchanged} in sync · {confirm.preview.openSkipped} in the open file
                </div>
                <div className={styles.confirmRow}>
                  {confirm.preview.willUpdate.length > 0 && (
                    <button
                      className={styles.btn}
                      data-testid="collection-sync-apply"
                      onClick={() => void applySync(c.id)}
                      disabled={busyId === c.id}
                    >
                      {busyId === c.id ? 'Syncing…' : 'Sync now'}
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
    </div>
  )
})
