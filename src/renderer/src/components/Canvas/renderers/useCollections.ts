import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type {
  CardTemplate,
  Collection,
  CollectionLayout,
  CollectionRefreshResult,
  CollectionSyncAllPreview,
  CollectionSyncAllResult,
  CollectionView,
} from '../../../types/workspace-api'
import { parseRangeRef } from '../../../lib/rangesView'
import { applyView, countByCollection, defaultColumns, viewedGrid } from '../../../lib/collectionsView'

type Parts = { names: string[]; cur: number; type: number }

interface UseCollectionsArgs {
  filePath: string
  parts: Parts
  isCalc: boolean
  cellAddr: string
  /** True while the Metrics panel is open (drives list + badge reloads). */
  panelOpen: boolean
  docWrapRef: MutableRefObject<HTMLDivElement | null>
  setDirty: Dispatch<SetStateAction<boolean>>
  scheduleFullPaint: (delay?: number) => void
  setToast: Dispatch<SetStateAction<string | null>>
}

/**
 * Collections wiring for the LOK renderer — the records→layout sibling of
 * useRangeTransclusion. A collection is a typed record set; inserting it renders
 * its records through a default identity mapping (every field a column) into a
 * real block/table AND records a live layout link. Refresh re-reads the records
 * from source; sync-all pushes the rendered layout into closed files. Fail-safe
 * throughout (a deleted collection / unreadable source never blanks a doc).
 */
export function useCollections({
  filePath,
  parts,
  isCalc,
  cellAddr,
  panelOpen,
  docWrapRef,
  setDirty,
  scheduleFullPaint,
  setToast,
}: UseCollectionsArgs) {
  const isSurface = parts.type === 0 || parts.type === 1 || parts.type === 2
  const [collections, setCollections] = useState<Collection[]>([])
  const [collectionLinkCounts, setCollectionLinkCounts] = useState<Map<string, number>>(new Map())
  const [staleCollectionIds, setStaleCollectionIds] = useState<Set<string>>(new Set())
  const [linksVersion, setLinksVersion] = useState(0)

  const refreshCollections = useCallback(async () => {
    try { setCollections(await window.workspace.collections.list()) } catch { /* store unavailable */ }
  }, [])

  const reloadCounts = useCallback(async () => {
    try { setCollectionLinkCounts(countByCollection(await window.workspace.collectionLinks.allLinks())) }
    catch { /* store unavailable */ }
  }, [])

  useEffect(() => {
    if (panelOpen) void refreshCollections()
  }, [panelOpen, refreshCollections])
  useEffect(() => {
    if (panelOpen) void reloadCounts()
  }, [panelOpen, linksVersion, reloadCounts])

  const applyRefreshResults = useCallback((results: CollectionRefreshResult[]): void => {
    if (!results.length) return
    setCollections((prev) => prev.map((c) => results.find((x) => x.id === c.id)?.collection ?? c))
    setStaleCollectionIds((prev) => {
      const next = new Set(prev)
      for (const r of results) r.stale ? next.add(r.id) : next.delete(r.id)
      return next
    })
  }, [])

  const refreshCollection = useCallback(
    async (id: string): Promise<CollectionRefreshResult> => {
      const res = await window.workspace.collections.refresh(id)
      applyRefreshResults([res])
      return res
    },
    [applyRefreshResults],
  )

  const refreshAllCollections = useCallback(async (): Promise<void> => {
    try { applyRefreshResults(await window.workspace.collections.refreshAll()) }
    catch { /* fail-safe: keep cached records */ }
  }, [applyRefreshResults])

  // Create-from-range gesture (Calc): name a rectangular ref whose ROW 0 is the
  // field names and rows 1..n are records. Seeded from disk now; unreadable → reject.
  const createCollectionFromRef = useCallback(async (name: string, ref: string): Promise<boolean> => {
    if (!isCalc) return false
    if (!parseRangeRef(ref)) {
      setToast('Enter a range like A1:C10')
      setTimeout(() => setToast(null), 2000)
      return false
    }
    const sheet = parts.names[parts.cur] || 'Sheet1'
    try {
      await window.workspace.collections.createFromSource(name.trim() || ref.toUpperCase(), {
        kind: 'xlsx-range', filePath, sheet, ref,
      })
      await refreshCollections()
      setToast(`New collection reads records from ${sheet}!${ref.toUpperCase()}`)
      setTimeout(() => setToast(null), 2600)
      return true
    } catch {
      setToast('Could not read that range as records — needs a header row; save first?')
      setTimeout(() => setToast(null), 3000)
      return false
    }
  }, [isCalc, parts.names, parts.cur, filePath, refreshCollections, setToast])

  const deleteCollection = useCallback(async (id: string) => {
    try { await window.workspace.collections.delete(id); await refreshCollections() } catch { /* */ }
  }, [refreshCollections])

  // Insert a collection into the open doc with the DEFAULT identity mapping (every
  // field → a column). The rendered grid (header + a row per record) is written as
  // a real block/table AND a live layout link is recorded. Dispatched by surface.
  const insertCollection = useCallback(async (
    c: Collection,
    view?: CollectionView,
    layout?: CollectionLayout,
    cardTemplate?: CardTemplate,
  ) => {
    const columns = defaultColumns(c.fields)
    // Render + link with the optional live query: the grid is the VIEWED records
    // (filter/sort/limit) and the link carries the view so re-sync stays a query.
    const grid = viewedGrid(c, view)
    const shown = applyView(c.records, view).length
    const tag = `wos-collection-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    // Cards is a Word-only directory layout. The insert GESTURE that seeds the
    // `wos-cards-<tag>-start/end` bookmark PAIR is a LOK macro (WosInsertDocCards)
    // and is DEFERRED — until it lands, a cards insert is declined here so we
    // never record a link whose region doesn't exist in the file (fail-safe).
    const wantsCards = layout === 'cards' && parts.type === 0 && !!cardTemplate
    if (wantsCards) {
      setToast('Word directory cards: region insert is coming soon')
      setTimeout(() => setToast(null), 2600)
      docWrapRef.current?.focus()
      return
    }
    try {
      if (parts.type === 2) {
        await window.workspace.lok.setTable({ macro: 'WosInsertSlideTable', tag, values: grid })
        await window.workspace.collectionLinks.add({
          collectionId: c.id, filePath, target: { kind: 'pptx-table', tag, slide: parts.cur }, columns, view, lastGrid: grid,
        })
      } else if (parts.type === 0) {
        await window.workspace.lok.setTable({ macro: 'WosInsertDocTable', tag, values: grid })
        await window.workspace.collectionLinks.add({
          collectionId: c.id, filePath, target: { kind: 'docx-table', tag }, columns, view, lastGrid: grid,
        })
      } else {
        const cell = cellAddr
        if (!cell) { setToast('Select a cell first'); setTimeout(() => setToast(null), 1800); return }
        const sheet = parts.names[parts.cur] || 'Sheet1'
        await window.workspace.lok.setRangeBlock({ sheet, cell, values: grid })
        await window.workspace.collectionLinks.add({
          collectionId: c.id, filePath, target: { kind: 'xlsx-block', sheet, cell }, columns, view, lastGrid: grid,
        })
      }
      setLinksVersion((v) => v + 1)
      setDirty(true)
      scheduleFullPaint(60)
      setToast(`Inserted ${c.name} (${shown} record${shown === 1 ? '' : 's'})`)
      setTimeout(() => setToast(null), 2400)
    } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts.type, cellAddr, parts.names, parts.cur, filePath])

  const previewSyncAllCollection = useCallback(
    (id: string): Promise<CollectionSyncAllPreview> =>
      window.workspace.collectionLinks.previewSyncAll(id, filePath),
    [filePath],
  )

  const syncAllCollection = useCallback(async (id: string): Promise<CollectionSyncAllResult> => {
    const res = await window.workspace.collectionLinks.syncAll(id, filePath)
    const n = res.updated.length
    const k = res.skipped.length
    const msg: string[] = []
    msg.push(n > 0 ? `↻ updated ${n} layout${n > 1 ? 's' : ''} on disk` : 'Nothing to update on disk')
    if (k > 0) msg.push(`${k} skipped`)
    setToast(msg.join(' · '))
    setTimeout(() => setToast(null), 3200)
    return res
  }, [filePath, setToast])

  return {
    collections, refreshCollections, collectionLinkCounts, staleCollectionIds,
    createCollectionFromRef, refreshCollection, refreshAllCollections, deleteCollection,
    insertCollection, previewSyncAllCollection, syncAllCollection,
    isCollectionSurface: isSurface,
  }
}
