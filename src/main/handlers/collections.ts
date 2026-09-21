import { IpcMain } from 'electron'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { confineToWorkspace } from './sourcePath'
import { getWorkspaceRoot } from '../workspace-root'
import {
  collections,
  isSourcedCollection,
  planCollectionRefresh,
  coerceCollectionSource,
  gridToRecords,
  type Collection,
  type CollectionRefreshStatus,
} from '../collections'
import {
  collectionLinks,
  planCollectionSyncAll,
  coerceCollectionTarget,
  coerceColumns,
  coerceView,
  coerceLayout,
  applyView,
  type CollectionLink,
} from '../collectionLinks'
import { readRange } from '../xlsx-range-reader'
import { setRangeValues } from '../xlsx-range-writer'
import { setDocTableCells } from '../docx-table-writer'
import { setDocCards, coerceCardTemplate } from '../docx-cards-writer'
import { setSlideTableCells } from '../pptx-table-writer'
import { isValidA1 } from '../transclusions'
import type { RangeGrid } from '../ranges'

/** Outcome of refreshing one collection from its source (fed to the renderer). */
interface CollectionRefreshResult {
  id: string
  status: CollectionRefreshStatus
  /** True when the last read failed and the cached records were kept. */
  stale: boolean
  collection: Collection
}

/**
 * Re-reads a sourced collection's source range and, when the records CHANGED,
 * updates the cached (fields, records) via the ordinary update path (so it
 * propagates to consuming docs exactly like ranges — closed files on the next
 * sync). Literal collections are a no-op; an unreadable source keeps the last
 * records and reports `stale`. Never throws.
 */
async function refreshCollection(id: string): Promise<CollectionRefreshResult | undefined> {
  const c = collections.get(id)
  if (!c) return undefined
  if (!isSourcedCollection(c)) return { id, status: 'literal', stale: false, collection: c }
  const read = await readRange(c.source.filePath, c.source.sheet, c.source.ref)
  const plan = planCollectionRefresh(c, read)
  if (plan.status === 'updated') {
    const updated = collections.update(id, { fields: plan.fields, records: plan.records })
    return { id, status: 'updated', stale: false, collection: updated ?? c }
  }
  return { id, status: plan.status, stale: plan.status === 'stale', collection: c }
}

/** Narrows an untrusted collection id at the IPC boundary. */
function readCollectionId(id: unknown): string {
  if (typeof id !== 'string' || !/^coll-[\w-]+$/.test(id)) {
    throw new IpcValidationError('Invalid collection id')
  }
  return id
}

/** Short display label for a collection link's anchor + rendered dims. */
function collectionTargetLabel(link: CollectionLink): string {
  const t = link.target
  const dims = `${link.lastGrid.length}×${link.lastGrid[0]?.length ?? 0}`
  if (t.kind === 'xlsx-block') return `${t.sheet ? `${t.sheet}!` : ''}${t.cell} (${dims})`
  if (t.kind === 'pptx-table') return `⟨slide table⟩ (${dims})`
  return `⟨word table⟩ (${dims})`
}

/**
 * Writes one closed-file collection link's block via the engine-free writers.
 * A docx CARDS link renders the (view-projected) records as a directory block
 * through setDocCards; every other link stamps its `grid` via the table/range
 * writers. `collection` is threaded so cards can re-project the records.
 */
async function writeClosedCollectionLink(
  link: CollectionLink,
  grid: RangeGrid,
  collection: Collection
): Promise<{ ok: boolean; reason?: string }> {
  if (link.layout === 'cards' && link.target.kind === 'docx-table' && link.cardTemplate) {
    const records = applyView(collection.records, link.view)
    return setDocCards(link.filePath, link.target.tag, records, link.cardTemplate)
  }
  if (link.target.kind === 'xlsx-block') {
    return setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
  }
  if (link.target.kind === 'pptx-table') {
    return setSlideTableCells(link.filePath, link.target.tag, grid)
  }
  return setDocTableCells(link.filePath, link.target.tag, grid)
}

/**
 * Collection IPC (collections + layout links) — the records→layout sibling of
 * handlers/ranges.ts. Collections are the source-of-truth typed record sets;
 * collection links bind a collection to a real block in a real file via a field
 * mapping. Both stores are pure/userData-JSON — this layer only validates the
 * untrusted renderer payloads at the boundary.
 */
export function registerCollectionHandlers(ipcMain: IpcMain): void {
  // ---- collections ----
  ipcHandle(ipcMain, 'collection:list', () => collections.list())

  // Create-from-range: a collection whose records are READ LIVE from a real
  // spreadsheet block (row 0 = field names, rows 1..n = records). The block is
  // read once now to seed the cache; a source we can't read (or one without a
  // usable header row) is rejected.
  ipcHandle(ipcMain, 'collection:createFromSource', async (_event, name: unknown, source: unknown) => {
    if (typeof name !== 'string' || !name.trim()) {
      throw new IpcValidationError('Collection name must be a non-empty string')
    }
    const src = coerceCollectionSource(source)
    if (src.kind !== 'xlsx-range') throw new IpcValidationError('Invalid collection source')
    // Untrusted source path → confine to the workspace before reading.
    src.filePath = confineToWorkspace(src.filePath)
    const read = await readRange(src.filePath, src.sheet, src.ref)
    if (!read.ok || !read.values) {
      throw new IpcValidationError(`Source range not readable: ${read.reason ?? 'unknown'}`)
    }
    const parsed = gridToRecords(read.values)
    if (!parsed) throw new IpcValidationError('Source range has no header row')
    return collections.create(name, parsed.fields, parsed.records, src)
  })

  // Rename / detach (passing `source` — even a literal one — detaches to a
  // literal set, keeping the current cached records). Records are only ever set
  // by the refresh path, never directly by the renderer.
  ipcHandle(ipcMain, 'collection:update', (_event, id: unknown, patch: unknown) => {
    readCollectionId(id)
    const p = (patch ?? {}) as { name?: unknown; source?: unknown }
    if (p.name !== undefined && typeof p.name !== 'string') {
      throw new IpcValidationError('Invalid collection name')
    }
    const nextPatch: { name?: string; source?: unknown } = { name: p.name as string | undefined }
    if ('source' in p) nextPatch.source = p.source
    const updated = collections.update(id as string, nextPatch)
    if (!updated) throw new IpcValidationError('Unknown collection')
    return updated
  })

  // Refresh ONE sourced collection from disk; propagates downstream if the
  // records changed. Returns a stale flag on read failure.
  ipcHandle(ipcMain, 'collection:refresh', async (_event, id: unknown) => {
    const res = await refreshCollection(readCollectionId(id))
    if (!res) throw new IpcValidationError('Unknown collection')
    return res
  })

  // Refresh EVERY sourced collection ("refresh all"). Literal ones are skipped.
  ipcHandle(ipcMain, 'collection:refreshAll', async () => {
    const out: CollectionRefreshResult[] = []
    for (const c of collections.list()) {
      if (!isSourcedCollection(c)) continue
      const res = await refreshCollection(c.id)
      if (res) out.push(res)
    }
    return out
  })

  // Refresh only collections sourced FROM a given file (the auto-refresh-on-save
  // hook — cheap: touches nothing sourced from elsewhere). The incoming filePath
  // is untrusted: validate it stays WITHIN the workspace root before using it.
  ipcHandle(ipcMain, 'collection:refreshForFile', async (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) throw new IpcValidationError('Invalid file path')
    const root = getWorkspaceRoot()
    if (!root) throw new IpcValidationError('No workspace folder is open')
    const resolved = validateFilePath(filePath, root) // throws on traversal/escape
    const out: CollectionRefreshResult[] = []
    for (const c of collections.list()) {
      if (isSourcedCollection(c) && c.source.filePath === resolved) {
        const res = await refreshCollection(c.id)
        if (res) out.push(res)
      }
    }
    return out
  })

  ipcHandle(ipcMain, 'collection:delete', (_event, id: unknown) => {
    collections.remove(readCollectionId(id))
  })

  // ---- collection links ----
  ipcHandle(ipcMain, 'collectionLink:forFile', (_event, filePath: unknown) => {
    if (typeof filePath !== 'string' || !filePath) throw new IpcValidationError('Invalid file path')
    return collectionLinks.forFile(filePath)
  })

  ipcHandle(ipcMain, 'collectionLink:forCollection', (_event, collectionId: unknown) => {
    return collectionLinks.forCollection(readCollectionId(collectionId))
  })

  ipcHandle(ipcMain, 'collectionLink:allLinks', () => collectionLinks.allLinks())

  ipcHandle(ipcMain, 'collectionLink:add', (_event, input: unknown) => {
    const i = (input ?? {}) as {
      collectionId?: unknown
      filePath?: unknown
      target?: unknown
      columns?: unknown
      view?: unknown
      lastGrid?: unknown
      layout?: unknown
      cardTemplate?: unknown
    }
    readCollectionId(i.collectionId)
    // Confine to the workspace before storing — syncAll later writes this path.
    const linkFilePath = confineToWorkspace(i.filePath)
    const target = coerceCollectionTarget(i)
    if (!target) throw new IpcValidationError('Invalid collection link target')
    if (!coerceColumns(i.columns)) throw new IpcValidationError('Invalid field mapping')
    // Per-kind anchor validation: an xlsx block anchors at an A1 cell; a
    // docx/pptx table anchors at our own namespaced tag (wos-collection-<id>).
    if (target.kind === 'xlsx-block' && !isValidA1(target.cell)) {
      throw new IpcValidationError('Invalid anchor cell')
    }
    if (
      (target.kind === 'docx-table' || target.kind === 'pptx-table') &&
      !/^wos-collection-[\w-]+$/.test(target.tag)
    ) {
      throw new IpcValidationError('Invalid table tag')
    }
    // Cards layout is docx-only and needs a renderable template; reject early so
    // the store never has to (keeps the failure at the boundary, not mid-write).
    const layout = coerceLayout(i.layout)
    if (layout === 'cards') {
      if (target.kind !== 'docx-table') throw new IpcValidationError('Cards layout is Word-only')
      if (!coerceCardTemplate(i.cardTemplate)) throw new IpcValidationError('Invalid card template')
    }
    try {
      return collectionLinks.add({
        collectionId: i.collectionId as string,
        filePath: linkFilePath,
        target: i.target,
        columns: i.columns,
        // Optional live query — strictly coerced at the boundary (unknown ops,
        // control-char field names and non-numeric limits are dropped here).
        view: coerceView(i.view),
        lastGrid: i.lastGrid,
        layout: i.layout,
        cardTemplate: i.cardTemplate,
      })
    } catch (e) {
      throw new IpcValidationError(e instanceof Error ? e.message : 'Invalid collection link')
    }
  })

  ipcHandle(ipcMain, 'collectionLink:remove', (_event, id: unknown) => {
    if (typeof id !== 'string' || !/^clink-[\w-]+$/.test(id)) {
      throw new IpcValidationError('Invalid collection link id')
    }
    collectionLinks.remove(id)
  })

  // ---- explicit sync-all: push a collection's layout into every linked file ----
  //
  // PREVIEW (no writes): report the impact so the UI can confirm first. The open
  // file is excluded (the engine owns it); in-sync links are counted; everything
  // else is a closed-file block that WOULD change.
  ipcHandle(ipcMain, 'collectionLink:previewSyncAll', (_event, id: unknown, openFilePath: unknown) => {
    const collectionId = readCollectionId(id)
    const open = typeof openFilePath === 'string' && openFilePath ? openFilePath : null
    const collection = collections.get(collectionId)
    if (!collection) throw new IpcValidationError('Unknown collection')
    const plan = planCollectionSyncAll(collectionLinks.forCollection(collectionId), collection, open)
    return {
      willUpdate: plan.toWrite.map((a) => ({ file: a.link.filePath, label: collectionTargetLabel(a.link) })),
      unchanged: plan.unchanged.length,
      openSkipped: plan.openSkipped.length,
    }
  })

  // APPLY (writes closed files only): for each closed-file link whose rendered
  // grid drifts from lastGrid, stamp the block directly via the engine-free
  // writer (atomic + verified). On success we advance the link's lastGrid. The
  // OPEN file is never written here. STRICT fail-safe: any file we can't safely
  // write is skipped and reported, never corrupted.
  ipcHandle(ipcMain, 'collectionLink:syncAll', async (_event, id: unknown, openFilePath: unknown) => {
    const collectionId = readCollectionId(id)
    const open = typeof openFilePath === 'string' && openFilePath ? openFilePath : null
    const collection = collections.get(collectionId)
    if (!collection) throw new IpcValidationError('Unknown collection')

    const plan = planCollectionSyncAll(collectionLinks.forCollection(collectionId), collection, open)
    const updated: { file: string; label: string }[] = []
    const skipped: { file: string; label: string; reason: string }[] = []

    for (const { link, grid } of plan.toWrite) {
      const label = collectionTargetLabel(link)
      const res = await writeClosedCollectionLink(link, grid, collection)
      if (res.ok) {
        collectionLinks.add({
          collectionId: link.collectionId,
          filePath: link.filePath,
          target: link.target,
          columns: link.columns,
          view: link.view, // preserve the live query across the lastGrid advance
          lastGrid: grid,
          layout: link.layout, // preserve the render mode + card template
          cardTemplate: link.cardTemplate,
        })
        updated.push({ file: link.filePath, label })
      } else {
        skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
      }
    }

    return { updated, skipped }
  })
}
