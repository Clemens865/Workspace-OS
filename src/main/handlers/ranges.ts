import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { confineToWorkspace } from './sourcePath'
import {
  ranges,
  isSourcedRange,
  planRangeRefresh,
  coerceRangeSource,
  type LiveRange,
  type RangeRefreshStatus,
} from '../ranges'
import { rangeLinks, planRangeSyncAll, coerceRangeTarget, type RangeLink } from '../rangeLinks'
import { readRange } from '../xlsx-range-reader'
import { setRangeValues } from '../xlsx-range-writer'
import { setDocTableCells } from '../docx-table-writer'
import { setSlideTableCells } from '../pptx-table-writer'
import { isValidA1 } from '../transclusions'
import type { RangeGrid } from '../ranges'

/** Outcome of refreshing one range from its source (fed to the renderer). */
interface RangeRefreshResult {
  id: string
  status: RangeRefreshStatus
  /** True when the last read failed and the cached grid was kept. */
  stale: boolean
  range: LiveRange
}

/**
 * Reads a sourced range's source block and, when the grid CHANGED, updates the
 * range's cached values via the ordinary update path (so it propagates to
 * consuming docs exactly like metrics — the open file live, closed files on
 * their next open). Literal ranges are a no-op; an unreadable source keeps the
 * last grid and reports `stale`. Never throws.
 */
async function refreshRange(id: string): Promise<RangeRefreshResult | undefined> {
  const r = ranges.get(id)
  if (!r) return undefined
  if (!isSourcedRange(r)) return { id, status: 'literal', stale: false, range: r }
  const read = await readRange(r.source.filePath, r.source.sheet, r.source.ref)
  const plan = planRangeRefresh(r, read)
  if (plan.status === 'updated') {
    const updated = ranges.update(id, { values: plan.values })
    return { id, status: 'updated', stale: false, range: updated ?? r }
  }
  return { id, status: plan.status, stale: plan.status === 'stale', range: r }
}

/** Narrows an untrusted range id at the IPC boundary. */
function readRangeId(id: unknown): string {
  if (typeof id !== 'string' || !/^range-[\w-]+$/.test(id)) {
    throw new IpcValidationError('Invalid range id')
  }
  return id
}

/** Short display label for a range link's anchor ("Sheet1!E2 (3×2)"). */
function rangeTargetLabel(link: RangeLink): string {
  const t = link.target
  const dims = `${link.lastValues.length}×${link.lastValues[0]?.length ?? 0}`
  if (t.kind === 'xlsx-block') return `${t.sheet ? `${t.sheet}!` : ''}${t.cell} (${dims})`
  if (t.kind === 'pptx-table') return `⟨slide table⟩ (${dims})`
  return `⟨word table⟩ (${dims})`
}

/** Writes one closed-file range link's anchor to `grid` via the engine-free writer. */
async function writeClosedRangeLink(
  link: RangeLink,
  grid: RangeGrid
): Promise<{ ok: boolean; reason?: string }> {
  if (link.target.kind === 'xlsx-block') {
    return setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
  }
  if (link.target.kind === 'pptx-table') {
    return setSlideTableCells(link.filePath, link.target.tag, grid)
  }
  return setDocTableCells(link.filePath, link.target.tag, grid)
}

/**
 * Live-range IPC (ranges + block links) — the grid-sized sibling of
 * handlers/metrics.ts. Ranges are the source-of-truth grids; range links bind
 * a range to a real block in a real file. Both stores are pure/userData-JSON
 * (see ranges.ts / rangeLinks.ts) — this layer only validates the untrusted
 * renderer payloads at the boundary.
 */
export function registerRangeHandlers(ipcMain: IpcMain): void {
  // ---- ranges ----
  ipcHandle(ipcMain, 'range:list', () => ranges.list())

  // Create-from-range: a range whose grid is READ LIVE from a real spreadsheet
  // block. The block is read once now to seed the cache; a source we can't read
  // is rejected (you're pointing at real cells — no point creating a dead link).
  ipcHandle(ipcMain, 'range:createFromSource', async (_event, name: unknown, source: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new IpcValidationError('Range name must be a non-empty string')
    }
    const src = coerceRangeSource(source)
    if (!src) throw new IpcValidationError('Invalid range source')
    // Untrusted source path → confine to the workspace before reading.
    src.filePath = confineToWorkspace(src.filePath)
    const read = await readRange(src.filePath, src.sheet, src.ref)
    if (!read.ok || !read.values) {
      throw new IpcValidationError(`Source range not readable: ${read.reason ?? 'unknown'}`)
    }
    return ranges.create(name, read.values, src)
  })

  // Rename / detach (passing `source` — even a literal one — detaches to a
  // literal grid, keeping the current cached values). Grid values are only ever
  // set by the refresh path, never directly by the renderer.
  ipcHandle(ipcMain, 'range:update', (_event, id: unknown, patch: unknown) => {
    readRangeId(id)
    const p = (patch ?? {}) as { name?: unknown; source?: unknown }
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new IpcValidationError('Invalid range name')
    }
    const nextPatch: { name?: string; source?: unknown } = { name: p.name as string | undefined }
    if ('source' in p) nextPatch.source = p.source
    const updated = ranges.update(id as string, nextPatch)
    if (!updated) throw new IpcValidationError('Unknown range')
    return updated
  })

  // Refresh ONE sourced range from disk; propagates downstream if the grid
  // changed (via the ordinary update path). Returns a stale flag on read failure.
  ipcHandle(ipcMain, 'range:refreshFromSource', async (_event, id: unknown) => {
    const res = await refreshRange(readRangeId(id))
    if (!res) throw new IpcValidationError('Unknown range')
    return res
  })

  // Refresh EVERY sourced range ("refresh all"). Literal ranges are skipped.
  ipcHandle(ipcMain, 'range:refreshAllFromSource', async () => {
    const out: RangeRefreshResult[] = []
    for (const r of ranges.list()) {
      if (!isSourcedRange(r)) continue
      const res = await refreshRange(r.id)
      if (res) out.push(res)
    }
    return out
  })

  // Refresh only ranges sourced FROM a given file (the auto-refresh-on-save
  // hook — cheap: touches nothing sourced from elsewhere). Fail-safe per range.
  ipcHandle(ipcMain, 'range:refreshForFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) throw new IpcValidationError('Invalid file path')
    const out: RangeRefreshResult[] = []
    for (const r of ranges.list()) {
      if (isSourcedRange(r) && r.source.filePath === filePath) {
        const res = await refreshRange(r.id)
        if (res) out.push(res)
      }
    }
    return out
  })

  ipcHandle(ipcMain, 'range:delete', (_event, id: unknown) => {
    ranges.remove(readRangeId(id))
  })

  // ---- range links ----
  ipcHandle(ipcMain, 'rangeLink:forFile', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new IpcValidationError('Invalid file path')
    }
    return rangeLinks.forFile(filePath)
  })

  // Read-only: every link bound to one range, across ALL files.
  ipcHandle(ipcMain, 'rangeLink:forRange', (_event, rangeId: unknown) => {
    return rangeLinks.forRange(readRangeId(rangeId))
  })

  // Read-only: every link in the store (drives the per-range link-count badges).
  ipcHandle(ipcMain, 'rangeLink:allLinks', () => rangeLinks.allLinks())

  ipcHandle(ipcMain, 'rangeLink:add', (_event, input: unknown) => {
    const i = (input ?? {}) as { rangeId?: unknown; filePath?: unknown; target?: unknown; lastValues?: unknown }
    readRangeId(i.rangeId)
    // Confine to the workspace before storing — syncAll later writes this path.
    const linkFilePath = confineToWorkspace(i.filePath)
    const target = coerceRangeTarget(i)
    if (!target) throw new IpcValidationError('Invalid range link target')
    // Per-kind anchor validation: an xlsx block anchors at an A1 cell; a docx/pptx
    // table anchors at our own namespaced tag (wos-range-<id>).
    if (target.kind === 'xlsx-block' && !isValidA1(target.cell)) {
      throw new IpcValidationError('Invalid anchor cell')
    }
    if ((target.kind === 'docx-table' || target.kind === 'pptx-table') && !/^wos-range-[\w-]+$/.test(target.tag)) {
      throw new IpcValidationError('Invalid table tag')
    }
    try {
      return rangeLinks.add({
        rangeId: i.rangeId as string,
        filePath: linkFilePath,
        target: i.target,
        lastValues: i.lastValues,
      })
    } catch (e) {
      throw new IpcValidationError(e instanceof Error ? e.message : 'Invalid range link')
    }
  })

  ipcHandle(ipcMain, 'rangeLink:remove', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^rlink-[\w-]+$/.test(id)) {
      throw new IpcValidationError('Invalid range link id')
    }
    rangeLinks.remove(id)
  })

  // ---- explicit sync-all: push a range into every linked file on disk ----
  //
  // PREVIEW (no writes): report the impact so the UI can confirm first. The open
  // file is excluded (the engine's live path owns it); unchanged links are shown
  // as such; everything else is a closed-file block that WOULD change.
  ipcHandle(ipcMain, 'rangeLink:previewSyncAll', (_event, id: unknown, openFilePath: unknown) => {
    const rangeId = readRangeId(id)
    const open = typeof openFilePath === 'string' && openFilePath ? openFilePath : null
    const range = ranges.get(rangeId)
    if (!range) throw new IpcValidationError('Unknown range')
    const plan = planRangeSyncAll(rangeLinks.forRange(rangeId), range, open)
    return {
      willUpdate: plan.toWrite.map((l) => ({ file: l.filePath, label: rangeTargetLabel(l) })),
      // Self-referential links (a range written back over its own source block)
      // need no write — fold them into "unchanged" so the count stays honest.
      unchanged: plan.unchanged.length + plan.selfSkipped.length,
      openSkipped: plan.openSkipped.length,
    }
  })

  // APPLY (writes closed files only): for each closed-file link whose grid drifts
  // from lastValues, stamp the block directly in the .xlsx via the engine-free
  // writer (atomic + verified). On success we advance the link's lastValues. The
  // OPEN file is never written here — it is handled live by the renderer. STRICT
  // fail-safe: any file we can't safely write is skipped and reported, never
  // corrupted.
  ipcHandle(ipcMain, 'rangeLink:syncAll', async (_event, id: unknown, openFilePath: unknown) => {
    const rangeId = readRangeId(id)
    const open = typeof openFilePath === 'string' && openFilePath ? openFilePath : null
    const range = ranges.get(rangeId)
    if (!range) throw new IpcValidationError('Unknown range')

    const plan = planRangeSyncAll(rangeLinks.forRange(rangeId), range, open)
    const updated: { file: string; label: string }[] = []
    const skipped: { file: string; label: string; reason: string }[] = []

    for (const link of plan.toWrite) {
      const label = rangeTargetLabel(link)
      const res = await writeClosedRangeLink(link, range.values)
      if (res.ok) {
        rangeLinks.add({
          rangeId: link.rangeId,
          filePath: link.filePath,
          target: link.target,
          lastValues: range.values,
        })
        updated.push({ file: link.filePath, label })
      } else {
        skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
      }
    }

    return { updated, skipped }
  })
}
