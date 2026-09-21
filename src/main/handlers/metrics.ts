import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { confineToWorkspace } from './sourcePath'
import { metrics, isSourced, planRefresh, coerceSource, type Metric, type RefreshStatus } from '../metrics'
import { transclusions, isValidA1, planSyncAll, coerceTarget, type Link, type LinkTarget } from '../transclusions'
import { setCellValue } from '../xlsx-cell-writer'
import { readCell } from '../xlsx-cell-reader'
import { setContentControlText } from '../docx-cc-writer'
import { setShapeText } from '../pptx-shape-writer'

/** Outcome of refreshing one metric from its source cell (fed to the renderer). */
interface RefreshResult {
  id: string
  status: RefreshStatus
  /** True when the last read failed and the cached value was kept. */
  stale: boolean
  metric: Metric
}

/**
 * Reads a sourced metric's source cell and, when the value CHANGED, updates the
 * metric's cached value via the ordinary metric-update path (so it propagates to
 * consuming docs exactly like a manual edit — the open file live, closed files on
 * their next open). Literal metrics are a no-op; an unreadable source keeps the
 * last value and reports `stale`. Never throws.
 */
async function refreshMetric(id: string): Promise<RefreshResult | undefined> {
  const m = metrics.get(id)
  if (!m) return undefined
  if (!isSourced(m)) return { id, status: 'literal', stale: false, metric: m }
  const read = await readCell(m.source.filePath, m.source.sheet, m.source.cell)
  const plan = planRefresh(m, read)
  if (plan.status === 'updated') {
    const updated = metrics.update(id, { value: plan.value })
    return { id, status: 'updated', stale: false, metric: updated ?? m }
  }
  return { id, status: plan.status, stale: plan.status === 'stale', metric: m }
}

/** Narrows an untrusted metric id at the IPC boundary. */
function readMetricId(id: unknown): string {
  if (typeof id !== 'string' || !/^metric-[\w-]+$/.test(id)) {
    throw new IpcValidationError('Invalid metric id')
  }
  return id
}

/** Narrows an untrusted xlsx-cell source payload (the create-from-cell gesture). */
function readXlsxSource(raw: unknown): { kind: 'xlsx-cell'; filePath: string; sheet: string; cell: string } {
  const src = coerceSource(raw)
  if (!src || src.kind !== 'xlsx-cell') throw new IpcValidationError('Invalid metric source')
  if (!isValidA1(src.cell)) throw new IpcValidationError('Invalid source cell address')
  return src
}

/** Short display label for a link's anchor (cell for xlsx, tag for docx/pptx). */
function targetLabel(t: LinkTarget): string {
  if (t.kind === 'xlsx-cell') return t.cell
  if (t.kind === 'pptx-shape') return t.tag.replace(/^wos-metric-/, '⟨slide⟩ ')
  return t.tag.replace(/^wos-metric-/, '⟨cc⟩ ')
}

/** Writes one closed-file link's anchor to `value` via the engine-free writer. */
async function writeClosedLink(link: Link, value: number): Promise<{ ok: boolean; reason?: string }> {
  if (link.target.kind === 'xlsx-cell') {
    return setCellValue(link.filePath, link.target.sheet, link.target.cell, value)
  }
  if (link.target.kind === 'pptx-shape') {
    return setShapeText(link.filePath, link.target.tag, value)
  }
  return setContentControlText(link.filePath, link.target.tag, value)
}

/** Narrows an untrusted syncAll payload to a valid metricId + optional open path. */
function readSyncAllArgs(id: unknown, openFilePath: unknown): { id: string; open: string | null } {
  if (typeof id !== 'string' || !/^metric-[\w-]+$/.test(id)) {
    throw new IpcValidationError('Invalid metric id')
  }
  const open = typeof openFilePath === 'string' && openFilePath ? openFilePath : null
  return { id, open }
}

/**
 * Live-transclusion IPC (metrics + links). Metrics are the source-of-truth
 * values; links bind a metric to a real cell in a real file. Both stores are
 * pure/userData-JSON (see metrics.ts / transclusions.ts) — this layer only
 * validates the untrusted renderer payloads at the boundary.
 */
export function registerMetricHandlers(ipcMain: IpcMain): void {
  // ---- metrics ----
  ipcHandle(ipcMain, 'metric:list', () => metrics.list())

  ipcHandle(ipcMain, 'metric:create', (_event, name: unknown, value: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new IpcValidationError('Metric name must be a non-empty string')
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new IpcValidationError('Metric value must be a finite number')
    }
    return metrics.create(name, value)
  })

  ipcHandle(ipcMain, 'metric:update', (_event, id: unknown, patch: unknown) => {
    readMetricId(id)
    const p = (patch ?? {}) as { name?: unknown; value?: unknown; source?: unknown }
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new IpcValidationError('Invalid metric name')
    }
    if (p.value !== undefined && (typeof p.value !== 'number' || !Number.isFinite(p.value))) {
      throw new IpcValidationError('Invalid metric value')
    }
    // `source` is optional; passing it (even a literal) DETACHES to a literal
    // (keeping the current cached value) — the store coerces the shape.
    const nextPatch: { name?: string; value?: unknown; source?: unknown } = {
      name: p.name as string | undefined,
      value: p.value,
    }
    if ('source' in p) nextPatch.source = p.source
    const updated = metrics.update(id as string, nextPatch)
    if (!updated) throw new IpcValidationError('Unknown metric')
    return updated
  })

  // Create-from-cell: a metric whose value is READ LIVE from a real spreadsheet
  // cell. The cell is read once now to seed the cache; a source we can't read is
  // rejected (you're pointing at a real cell — no point creating a dead link).
  ipcHandle(ipcMain, 'metric:createFromSource', async (_event, name: unknown, source: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new IpcValidationError('Metric name must be a non-empty string')
    }
    const src = readXlsxSource(source)
    // The source path is untrusted — confine it to the workspace before reading
    // (an out-of-workspace read is an exfiltration channel for any .xlsx on disk).
    src.filePath = confineToWorkspace(src.filePath)
    const read = await readCell(src.filePath, src.sheet, src.cell)
    if (!read.ok || typeof read.value !== 'number') {
      throw new IpcValidationError(`Source cell not readable: ${read.reason ?? 'unknown'}`)
    }
    return metrics.create(name, read.value, src)
  })

  // Refresh ONE sourced metric from disk; propagates downstream if the value
  // changed (via the ordinary update path). Returns a stale flag on read failure.
  ipcHandle(ipcMain, 'metric:refreshFromSource', async (_event, id: unknown) => {
    const res = await refreshMetric(readMetricId(id))
    if (!res) throw new IpcValidationError('Unknown metric')
    return res
  })

  // Refresh EVERY sourced metric ("refresh all"). Literal metrics are skipped.
  ipcHandle(ipcMain, 'metric:refreshAllFromSource', async () => {
    const out: RefreshResult[] = []
    for (const m of metrics.list()) {
      if (!isSourced(m)) continue
      const res = await refreshMetric(m.id)
      if (res) out.push(res)
    }
    return out
  })

  // Refresh only metrics sourced FROM a given file (the auto-refresh-on-save
  // hook — cheap: touches nothing sourced from elsewhere). Fail-safe per metric.
  //
  // The incoming filePath is untrusted: validate it stays WITHIN the workspace
  // root (rejecting `../../etc/...` traversal and symlink escapes) before using
  // it — a refresh must never be steered at a path outside the workspace. The
  // stored source filePaths are compared against the resolved, in-root path.
  ipcHandle(ipcMain, 'metric:refreshForFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) throw new IpcValidationError('Invalid file path')
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const resolved = validateFilePath(filePath, root) // throws on traversal/escape
    const out: RefreshResult[] = []
    for (const m of metrics.list()) {
      if (isSourced(m) && m.source.filePath === resolved) {
        const res = await refreshMetric(m.id)
        if (res) out.push(res)
      }
    }
    return out
  })

  ipcHandle(ipcMain, 'metric:delete', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^metric-[\w-]+$/.test(id)) {
      throw new IpcValidationError('Invalid metric id')
    }
    metrics.remove(id)
  })

  // ---- transclusion links ----
  ipcHandle(ipcMain, 'transclusion:forFile', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new IpcValidationError('Invalid file path')
    }
    return transclusions.forFile(filePath)
  })

  // Read-only: every link bound to one metric, across ALL files (the "where is
  // this linked" view — group-by-file happens in the renderer).
  ipcHandle(ipcMain, 'transclusion:forMetric', (_event, metricId: unknown) => {
    if (typeof metricId !== 'string' || !/^metric-[\w-]+$/.test(metricId)) {
      throw new IpcValidationError('Invalid metric id')
    }
    return transclusions.forMetric(metricId)
  })

  // Read-only: every link in the store (drives the per-metric link-count badges).
  ipcHandle(ipcMain, 'transclusion:allLinks', () => transclusions.allLinks())

  ipcHandle(ipcMain, 'transclusion:add', (_event, input: unknown) => {
    const i = (input ?? {}) as {
      metricId?: unknown
      filePath?: unknown
      sheet?: unknown
      cell?: unknown
      tag?: unknown
      target?: unknown
      lastValue?: unknown
    }
    if (typeof i.metricId !== 'string' || !/^metric-[\w-]+$/.test(i.metricId)) {
      throw new IpcValidationError('Invalid metric id')
    }
    // Confine to the workspace before storing — syncAll later WRITES this path,
    // so an out-of-workspace link is an arbitrary-file-overwrite primitive.
    const linkFilePath = confineToWorkspace(i.filePath)
    if (typeof i.lastValue !== 'number' || !Number.isFinite(i.lastValue)) {
      throw new IpcValidationError('Invalid link value')
    }
    // Resolve the anchor: either a discriminated target, a flat {sheet, cell}
    // (xlsx), or a {tag} (docx). coerceTarget validates all shapes.
    const target = coerceTarget(i)
    if (!target) throw new IpcValidationError('Invalid link target')
    // Defensive: a docx/pptx tag must be our own namespaced anchor; an xlsx cell A1.
    if (target.kind === 'xlsx-cell' && !isValidA1(target.cell)) {
      throw new IpcValidationError('Invalid cell address')
    }
    if (target.kind === 'docx-cc' && !/^wos-metric-[\w-]+$/.test(target.tag)) {
      throw new IpcValidationError('Invalid content-control tag')
    }
    if (target.kind === 'pptx-shape' && !/^wos-metric-[\w-]+$/.test(target.tag)) {
      throw new IpcValidationError('Invalid shape tag')
    }
    return transclusions.add({ metricId: i.metricId, filePath: linkFilePath, target, lastValue: i.lastValue })
  })

  ipcHandle(ipcMain, 'transclusion:remove', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^link-[\w-]+$/.test(id)) {
      throw new IpcValidationError('Invalid link id')
    }
    transclusions.remove(id)
  })

  // ---- explicit sync-all: push a metric into every linked file on disk ----
  //
  // PREVIEW (no writes): report the impact so the UI can confirm first. The open
  // file is excluded (the engine's live path owns it); unchanged links are shown
  // as such; everything else is a closed-file cell that WOULD change.
  ipcHandle(ipcMain, 'transclusion:previewSyncAll', (_event, id: unknown, openFilePath: unknown) => {
    const { id: metricId, open } = readSyncAllArgs(id, openFilePath)
    const metric = metrics.get(metricId)
    if (!metric) throw new IpcValidationError('Unknown metric')
    const plan = planSyncAll(transclusions.forMetric(metricId), metric.value, open, metric.source)
    return {
      value: metric.value,
      willUpdate: plan.toWrite.map((l) => ({
        file: l.filePath,
        label: targetLabel(l.target),
        from: l.lastValue,
      })),
      // Self-referential links (a metric written back into its own source cell)
      // need no write — fold them into "unchanged" so the count stays honest.
      unchanged: plan.unchanged.length + plan.selfSkipped.length,
      openSkipped: plan.openSkipped.length,
    }
  })

  // APPLY (writes closed files only): for each closed-file link whose value drifts
  // from lastValue, set the cell directly in the .xlsx via the engine-free writer
  // (atomic + verified). On success we advance the link's lastValue. The OPEN file
  // is never written here — it is handled live by the renderer. STRICT fail-safe:
  // any file we can't safely write is skipped and reported, never corrupted.
  ipcHandle(ipcMain, 'transclusion:syncAll', async (_event, id: unknown, openFilePath: unknown) => {
    const { id: metricId, open } = readSyncAllArgs(id, openFilePath)
    const metric = metrics.get(metricId)
    if (!metric) throw new IpcValidationError('Unknown metric')

    const plan = planSyncAll(transclusions.forMetric(metricId), metric.value, open, metric.source)
    const updated: { file: string; label: string }[] = []
    const skipped: { file: string; label: string; reason: string }[] = []

    for (const link of plan.toWrite) {
      const label = targetLabel(link.target)
      const res = await writeClosedLink(link, metric.value)
      if (res.ok) {
        transclusions.add({
          metricId: link.metricId,
          filePath: link.filePath,
          target: link.target,
          lastValue: metric.value,
        })
        updated.push({ file: link.filePath, label })
      } else {
        skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
      }
    }

    return { updated, skipped }
  })
}
