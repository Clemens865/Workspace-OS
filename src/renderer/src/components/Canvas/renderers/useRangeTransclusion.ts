import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { LiveRange, RangeLink, RangeRefreshResult } from '../../../types/workspace-api'
import { blockOverlapsSource, countByRange, gridsEqual, parseRangeRef } from '../../../lib/rangesView'

type Parts = { names: string[]; cur: number; type: number }

interface UseRangeTransclusionArgs {
  filePath: string
  parts: Parts
  isCalc: boolean
  cellAddr: string
  loading: boolean
  error: string | null
  /** True while the Metrics panel is open (drives list + badge reloads). */
  panelOpen: boolean
  docWrapRef: MutableRefObject<HTMLDivElement | null>
  setDirty: Dispatch<SetStateAction<boolean>>
  scheduleFullPaint: (delay?: number) => void
  setToast: Dispatch<SetStateAction<string | null>>
}

/**
 * Live-range wiring for the LOK renderer — the grid-sized sibling of
 * useMetricTransclusion (same shape, same fail-safe rules): source-of-truth
 * ranges, this file's block links, the shared write path that stamps each
 * link's current grid into the open sheet, the on-open re-sync, live
 * propagation on source refresh, insert-at-cell, and sync-all-to-disk.
 * Live ranges are Calc-first: blocks anchor in spreadsheets only.
 */
export function useRangeTransclusion({
  filePath,
  parts,
  isCalc,
  cellAddr,
  loading,
  error,
  panelOpen,
  docWrapRef,
  setDirty,
  scheduleFullPaint,
  setToast,
}: UseRangeTransclusionArgs) {
  // A live-range block/table anchors on any of the three office surfaces:
  // Calc block (type 1), Writer table (type 0), Impress table (type 2).
  const isRangeSurface = parts.type === 0 || parts.type === 1 || parts.type === 2
  const [ranges, setRanges] = useState<LiveRange[]>([])
  const [fileRangeLinks, setFileRangeLinks] = useState<RangeLink[]>([])
  const [rangeLinkCounts, setRangeLinkCounts] = useState<Map<string, number>>(new Map())
  // Source-linked ranges whose last read from disk FAILED (kept cached grid).
  const [staleRangeIds, setStaleRangeIds] = useState<Set<string>>(new Set())
  // Bumped whenever range links change (insert / remove) to refresh indicators.
  const [rangeLinksVersion, setRangeLinksVersion] = useState(0)
  // Guards the re-sync-on-open pass so it runs once per opened file.
  const resyncedRef = useRef<string | null>(null)

  const reloadRanges = useCallback(async () => {
    try { setRanges(await window.workspace.ranges.list()) } catch { /* store unavailable */ }
  }, [])

  const reloadFileRangeLinks = useCallback(async () => {
    try { setFileRangeLinks(await window.workspace.rangeLinks.forFile(filePath)) }
    catch { setFileRangeLinks([]) }
  }, [filePath])

  const reloadRangeLinkCounts = useCallback(async () => {
    try { setRangeLinkCounts(countByRange(await window.workspace.rangeLinks.allLinks())) }
    catch { /* store unavailable */ }
  }, [])

  const bumpRangeLinks = useCallback(() => setRangeLinksVersion((v) => v + 1), [])
  const forRange = useCallback((rangeId: string) => window.workspace.rangeLinks.forRange(rangeId), [])
  const removeRangeLink = useCallback((id: string) => window.workspace.rangeLinks.remove(id), [])

  // Refresh this file's range links on open + whenever links change.
  useEffect(() => {
    if (loading || error || !isRangeSurface) { setFileRangeLinks([]); return }
    void reloadFileRangeLinks()
  }, [loading, error, isRangeSurface, filePath, rangeLinksVersion, reloadFileRangeLinks])

  // Load ranges when the panel opens; refresh badges when links change.
  useEffect(() => {
    if (panelOpen) void reloadRanges()
  }, [panelOpen, reloadRanges])
  useEffect(() => {
    if (panelOpen) void reloadRangeLinkCounts()
  }, [panelOpen, rangeLinksVersion, reloadRangeLinkCounts])

  /**
   * Shared write path: stamp each link's CURRENT range grid into its block in
   * THE OPEN sheet. Skips deleted ranges (fail-safe), blocks already in sync,
   * and self-source overlaps (loop-safe); advances each written link's
   * lastValues, marks dirty + repaints, and returns the count. BOTH the
   * on-open re-sync and the refresh propagation go through this, so they can
   * never diverge.
   */
  const applyRangeLinksToOpenDoc = useCallback(
    async (links: RangeLink[], rangesById: Map<string, LiveRange>): Promise<number> => {
      let synced = 0
      for (const link of links) {
        const r = rangesById.get(link.rangeId)
        if (!r) continue // fail-safe: deleted/missing range → leave the anchor as-is
        // Self-source overlap only exists for a Calc block over its own xlsx source.
        if (link.target.kind === 'xlsx-block' && blockOverlapsSource(r.source, filePath, link.target, r.values)) continue
        if (gridsEqual(r.values, link.lastValues)) continue // already in sync
        // Dispatch by anchor kind: a Calc block (setRangeBlock), a Word table
        // (WosSetDocTable), or an Impress slide table (WosSetSlideTable). All keep
        // the file a valid document.
        if (link.target.kind === 'xlsx-block') {
          await window.workspace.lok.setRangeBlock({
            sheet: link.target.sheet, cell: link.target.cell, values: r.values,
          })
        } else if (link.target.kind === 'docx-table') {
          await window.workspace.lok.setTable({ macro: 'WosSetDocTable', tag: link.target.tag, values: r.values })
        } else {
          await window.workspace.lok.setTable({ macro: 'WosSetSlideTable', tag: link.target.tag, values: r.values })
        }
        await window.workspace.rangeLinks.add({
          rangeId: link.rangeId, filePath, target: link.target, lastValues: r.values,
        })
        synced++
      }
      if (synced > 0) { setDirty(true); scheduleFullPaint(60) }
      return synced
    },
    [filePath, scheduleFullPaint, setDirty],
  )

  // Live propagation: stamp a range's CURRENT grid into every block in THE
  // CURRENTLY-OPEN sheet that transcludes it (links in other files are left to
  // their own on-open re-sync).
  const propagateRangeToOpenDoc = useCallback(
    async (updated: LiveRange): Promise<number> => {
      if (!isRangeSurface) return 0
      const links = (await window.workspace.rangeLinks.forFile(filePath)).filter(
        (l) => l.rangeId === updated.id,
      )
      if (!links.length) return 0
      return applyRangeLinksToOpenDoc(links, new Map([[updated.id, updated]]))
    },
    [isRangeSurface, filePath, applyRangeLinksToOpenDoc],
  )

  // Apply the outcome(s) of a source refresh: update the local cache, track
  // stale ranges, and propagate any that CHANGED into the open sheet.
  const applyRangeRefreshResults = useCallback(
    async (results: RangeRefreshResult[]): Promise<void> => {
      if (!results.length) return
      setRanges((prev) => prev.map((r) => results.find((x) => x.id === r.id)?.range ?? r))
      setStaleRangeIds((prev) => {
        const next = new Set(prev)
        for (const r of results) r.stale ? next.add(r.id) : next.delete(r.id)
        return next
      })
      let total = 0
      for (const r of results) if (r.status === 'updated') total += await propagateRangeToOpenDoc(r.range)
      if (total > 0) {
        setToast(`↻ refreshed ${total} range block${total > 1 ? 's' : ''} from source`)
        setTimeout(() => setToast(null), 2600)
      }
    },
    [propagateRangeToOpenDoc, setToast],
  )

  // Refresh ONE sourced range from its source block on disk.
  const refreshRange = useCallback(
    async (id: string): Promise<RangeRefreshResult> => {
      const res = await window.workspace.ranges.refreshFromSource(id)
      await applyRangeRefreshResults([res])
      return res
    },
    [applyRangeRefreshResults],
  )

  // Refresh EVERY sourced range (panel "Refresh all" button).
  const refreshAllRanges = useCallback(async (): Promise<void> => {
    try {
      await applyRangeRefreshResults(await window.workspace.ranges.refreshAllFromSource())
    } catch { /* fail-safe: leave cached grids */ }
  }, [applyRangeRefreshResults])

  // Create-from-range gesture: with the sheet open, name a rectangular ref
  // ("A1:C4") that a new range READS LIVE from. The grid is seeded from the
  // file on disk now; an unreadable block is rejected (main-process read).
  const createRangeFromRef = useCallback(async (name: string, ref: string): Promise<boolean> => {
    if (!isCalc) return false
    const parsed = parseRangeRef(ref)
    if (!parsed) {
      setToast('Enter a range like A1:C4')
      setTimeout(() => setToast(null), 2000)
      return false
    }
    const sheet = parts.names[parts.cur] || 'Sheet1'
    try {
      await window.workspace.ranges.createFromSource(name.trim() || ref.toUpperCase(), {
        kind: 'xlsx-range', filePath, sheet, ref,
      })
      await reloadRanges()
      setToast(`New range reads live from ${sheet}!${ref.toUpperCase()}`)
      setTimeout(() => setToast(null), 2600)
      return true
    } catch {
      setToast('Could not read that range — save the sheet first?')
      setTimeout(() => setToast(null), 2600)
      return false
    }
  }, [isCalc, parts.names, parts.cur, filePath, reloadRanges, setToast])

  const deleteRange = useCallback(async (id: string) => {
    try { await window.workspace.ranges.delete(id); await reloadRanges() } catch { /* */ }
  }, [reloadRanges])

  // Transclude a range into the open doc. The literal grid is written (fidelity
  // floor) AND a live link keyed to its anchor is recorded — dispatched by surface:
  //   Calc    → stamp the block at the active cell + link {kind:'xlsx-block'}
  //   Writer  → insert a named Word table at the caret     + link {kind:'docx-table'}
  //   Impress → insert a named slide table on the slide    + link {kind:'pptx-table'}
  const insertRange = useCallback(async (r: LiveRange) => {
    // Impress: a slide table whose frame Name round-trips as a pptx <p:cNvPr name>.
    if (parts.type === 2) {
      // Keep the tag SHORT: LibreOffice truncates a Writer bookmark name to 40
      // chars, and a docx/pptx anchor must round-trip verbatim. The link's rangeId
      // (stored separately) is the range identity; the tag is only a unique anchor.
      const tag = `wos-range-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      try {
        await window.workspace.lok.setTable({ macro: 'WosInsertSlideTable', tag, values: r.values })
        await window.workspace.rangeLinks.add({
          rangeId: r.id, filePath, target: { kind: 'pptx-table', tag, slide: parts.cur }, lastValues: r.values,
        })
        bumpRangeLinks(); setDirty(true); scheduleFullPaint(60)
        setToast(`Inserted ${r.name} on slide`)
        setTimeout(() => setToast(null), 2200)
      } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
      docWrapRef.current?.focus()
      return
    }
    // Writer: a Word text table anchored by a bookmark named with a fresh token
    // (round-trips as <w:bookmarkStart w:name> + a <w:tbl>).
    if (parts.type === 0) {
      // Keep the tag SHORT: LibreOffice truncates a Writer bookmark name to 40
      // chars, and a docx/pptx anchor must round-trip verbatim. The link's rangeId
      // (stored separately) is the range identity; the tag is only a unique anchor.
      const tag = `wos-range-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
      try {
        await window.workspace.lok.setTable({ macro: 'WosInsertDocTable', tag, values: r.values })
        await window.workspace.rangeLinks.add({
          rangeId: r.id, filePath, target: { kind: 'docx-table', tag }, lastValues: r.values,
        })
        bumpRangeLinks(); setDirty(true); scheduleFullPaint(60)
        setToast(`Inserted ${r.name} at cursor`)
        setTimeout(() => setToast(null), 2200)
      } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
      docWrapRef.current?.focus()
      return
    }
    if (!isCalc) return
    const cell = cellAddr
    if (!cell) { setToast('Select a cell first'); setTimeout(() => setToast(null), 1800); return }
    const sheet = parts.names[parts.cur] || 'Sheet1'
    if (blockOverlapsSource(r.source, filePath, { sheet, cell }, r.values)) {
      setToast('That block overlaps this range’s own source')
      setTimeout(() => setToast(null), 2400)
      return
    }
    try {
      await window.workspace.lok.setRangeBlock({ sheet, cell, values: r.values })
      await window.workspace.rangeLinks.add({
        rangeId: r.id, filePath, target: { kind: 'xlsx-block', sheet, cell }, lastValues: r.values,
      })
      bumpRangeLinks()
      setDirty(true)
      scheduleFullPaint(60)
      setToast(`Inserted ${r.name} → ${cell}`)
      setTimeout(() => setToast(null), 2200)
    } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalc, parts.type, cellAddr, parts.names, parts.cur, filePath])

  // Sync-all (explicit, opt-in): dry-run first so the panel can confirm the
  // impact; only CLOSED files are written on disk (fail-safe block writer).
  const previewSyncAllRange = useCallback(
    (rangeId: string) => window.workspace.rangeLinks.previewSyncAll(rangeId, filePath),
    [filePath],
  )

  const syncAllRange = useCallback(async (rangeId: string) => {
    const res = await window.workspace.rangeLinks.syncAll(rangeId, filePath)
    const n = res.updated.length
    const k = res.skipped.length
    const msg: string[] = []
    if (n > 0) msg.push(`↻ updated ${n} block${n > 1 ? 's' : ''} on disk`)
    else msg.push('Nothing to update on disk')
    if (k > 0) msg.push(`${k} skipped`)
    setToast(msg.join(' · '))
    setTimeout(() => setToast(null), 3200)
    return res
  }, [filePath, setToast])

  // Re-sync on open (fail-safe): for each range link in this file, if its range
  // still exists and its grid changed, stamp the new grid into the block; a
  // missing range is skipped entirely — the block keeps its last literal values.
  useEffect(() => {
    if (loading || error || !isRangeSurface) return
    if (resyncedRef.current === filePath) return
    resyncedRef.current = filePath
    let cancelled = false
    ;(async () => {
      try {
        const links = await window.workspace.rangeLinks.forFile(filePath)
        if (!links.length || cancelled) return
        const list = await window.workspace.ranges.list()
        const byId = new Map(list.map((r) => [r.id, r]))
        const synced = await applyRangeLinksToOpenDoc(links, byId)
        if (synced > 0 && !cancelled) {
          setToast(`↻ synced ${synced} live range${synced > 1 ? 's' : ''}`)
          setTimeout(() => { if (!cancelled) setToast(null) }, 2800)
        }
      } catch { /* store unavailable — leave the file exactly as opened */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, isRangeSurface, filePath])

  return {
    ranges, reloadRanges,
    fileRangeLinks, rangeLinkCounts, reloadRangeLinkCounts, staleRangeIds,
    bumpRangeLinks, forRange, removeRangeLink,
    createRangeFromRef, refreshRange, refreshAllRanges, deleteRange, insertRange,
    previewSyncAllRange, syncAllRange, applyRangeRefreshResults,
  }
}
