import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { Metric, MetricRefreshResult, TransclusionLink } from '../../../types/workspace-api'
import { countByMetric } from '../../../lib/linksView'

type Parts = { names: string[]; cur: number; type: number }

interface UseMetricTransclusionArgs {
  filePath: string
  parts: Parts
  isCalc: boolean
  isDocSurface: boolean
  cellAddr: string
  loading: boolean
  error: string | null
  docWrapRef: MutableRefObject<HTMLDivElement | null>
  setDirty: Dispatch<SetStateAction<boolean>>
  scheduleFullPaint: (delay?: number) => void
  setToast: Dispatch<SetStateAction<string | null>>
}

/**
 * Live-transclusion wiring for the LOK renderer (the "metric" concern, isolated):
 * source-of-truth metrics + the panel state, this file's links (chip + Calc cell
 * markers), the shared write path that pushes each link's current value into the
 * open doc, the on-open re-sync, live propagation on manual edit / source refresh,
 * insert-into-doc, and sync-all-to-disk. Extracted verbatim from LokRenderer —
 * every callback keeps its exact dependency array + toast/dirty/repaint cadence;
 * `applyRefreshResults` is returned so the save path can drive refresh-on-save.
 */
export function useMetricTransclusion({
  filePath,
  parts,
  isCalc,
  isDocSurface,
  cellAddr,
  loading,
  error,
  docWrapRef,
  setDirty,
  scheduleFullPaint,
  setToast,
}: UseMetricTransclusionArgs) {
  // Live-transclusion: source-of-truth metrics + the panel to manage/insert them.
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [showMetrics, setShowMetrics] = useState(false)
  // Live-links visibility: this file's links (chip + Calc cell markers), the
  // per-metric link counts (panel badges), and which metric the panel focuses.
  const [fileLinks, setFileLinks] = useState<TransclusionLink[]>([])
  const [linkCounts, setLinkCounts] = useState<Map<string, number>>(new Map())
  const [focusMetric, setFocusMetric] = useState<string | null>(null)
  // Source-linked metrics whose last read from disk FAILED (kept cached value).
  const [staleMetricIds, setStaleMetricIds] = useState<Set<string>>(new Set())
  // Bumped whenever links change (insert / remove) to refresh the indicators.
  const [linksVersion, setLinksVersion] = useState(0)
  // Guards the re-sync-on-open pass so it runs once per opened file.
  const resyncedRef = useRef<string | null>(null)

  // ---- Live transclusion (metrics → real cells) ----
  const reloadMetrics = useCallback(async () => {
    try { setMetrics(await window.workspace.metrics.list()) } catch { /* store unavailable */ }
  }, [])

  // Live-links visibility (read-only): this file's links drive the in-doc chip +
  // Calc cell markers; the store-wide counts drive the panel's per-metric badges.
  const reloadFileLinks = useCallback(async () => {
    try { setFileLinks(await window.workspace.transclusions.forFile(filePath)) }
    catch { setFileLinks([]) }
  }, [filePath])
  const reloadLinkCounts = useCallback(async () => {
    try { setLinkCounts(countByMetric(await window.workspace.transclusions.allLinks())) }
    catch { /* store unavailable */ }
  }, [])
  const bumpLinks = useCallback(() => setLinksVersion((v) => v + 1), [])
  const forMetric = useCallback(
    (metricId: string) => window.workspace.transclusions.forMetric(metricId),
    [],
  )
  const removeLink = useCallback(
    (id: string) => window.workspace.transclusions.remove(id),
    [],
  )
  const revealFile = useCallback((p: string) => { void window.workspace.fs.reveal(p) }, [])

  // Refresh this file's links on open + whenever links change (insert / remove).
  useEffect(() => {
    if (loading || error || !isDocSurface) { setFileLinks([]); return }
    void reloadFileLinks()
  }, [loading, error, isDocSurface, filePath, linksVersion, reloadFileLinks])

  // Refresh the store-wide counts when the panel is open (badges) or links change.
  useEffect(() => {
    if (showMetrics) void reloadLinkCounts()
  }, [showMetrics, linksVersion, reloadLinkCounts])

  // Shared write path for live transclusion: push each link's CURRENT metric
  // value into its real cell in THE OPEN doc. Skips deleted metrics (fail-safe)
  // and cells already in sync, advances each written link's lastValue, marks
  // dirty + repaints, and returns the count. BOTH the on-open re-sync and the
  // live-on-save propagation go through this, so they can never diverge.
  const applyLinksToOpenDoc = useCallback(
    async (links: TransclusionLink[], metricsById: Map<string, Metric>): Promise<number> => {
      let synced = 0
      for (const link of links) {
        const m = metricsById.get(link.metricId)
        if (!m) continue // fail-safe: deleted/missing metric → leave the anchor as-is
        // Circular safety: never write a sourced metric back into its own source
        // cell (same file + sheet + cell) — that would be a self-reference loop.
        if (
          m.source?.kind === 'xlsx-cell' &&
          link.target.kind === 'xlsx-cell' &&
          m.source.filePath === filePath &&
          m.source.sheet === link.target.sheet &&
          m.source.cell === link.target.cell
        ) {
          continue
        }
        if (m.value === link.lastValue) continue // already in sync
        // Dispatch by anchor kind: a Calc cell (WosSetCell), a Word content
        // control (WosSetContentControl), or an Impress shape by Name
        // (WosSetShapeTextByName). All keep the file a valid document.
        if (link.target.kind === 'xlsx-cell') {
          await window.workspace.lok.macro('WosSetCell', `${link.target.sheet}|${link.target.cell}|${m.value}`)
        } else if (link.target.kind === 'pptx-shape') {
          await window.workspace.lok.macro('WosSetShapeTextByName', `${link.target.tag}|${m.value}`)
        } else {
          await window.workspace.lok.macro('WosSetContentControl', `${link.target.tag}|${m.value}`)
        }
        await window.workspace.transclusions.add({
          metricId: link.metricId, filePath, target: link.target, lastValue: m.value,
        })
        synced++
      }
      if (synced > 0) { setDirty(true); scheduleFullPaint(60) }
      return synced
    },
    [filePath, scheduleFullPaint],
  )

  // Load metrics when the panel opens (Calc only surface).
  useEffect(() => {
    if (showMetrics) void reloadMetrics()
  }, [showMetrics, reloadMetrics])

  const createMetric = useCallback(async (name: string, value: number) => {
    try { await window.workspace.metrics.create(name, value); await reloadMetrics() } catch { /* */ }
  }, [reloadMetrics])

  // Shared live-propagation: push a metric's CURRENT value into every anchor in
  // THE CURRENTLY-OPEN file that transcludes it. The single reused path for a
  // manual edit AND a source-driven refresh, so they can never diverge. Links in
  // OTHER files are left to their own on-open re-sync; no links here is a no-op.
  const propagateToOpenDoc = useCallback(
    async (updated: Metric): Promise<number> => {
      if (parts.type !== 1 && parts.type !== 0 && parts.type !== 2) return 0
      const links = (await window.workspace.transclusions.forFile(filePath)).filter(
        (l) => l.metricId === updated.id,
      )
      if (!links.length) return 0
      return applyLinksToOpenDoc(links, new Map([[updated.id, updated]]))
    },
    [parts.type, filePath, applyLinksToOpenDoc],
  )

  const updateMetric = useCallback(async (id: string, patch: { name?: string; value?: number }) => {
    // Optimistic local update keeps the inputs responsive; persist in the background.
    setMetrics((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
    try {
      const updated = await window.workspace.metrics.update(id, patch)
      if (updated) {
        const n = await propagateToOpenDoc(updated)
        if (n > 0) {
          setToast(`↻ updated ${n} cell${n > 1 ? 's' : ''}`)
          setTimeout(() => setToast(null), 2400)
        }
      }
    } catch { void reloadMetrics() }
  }, [reloadMetrics, propagateToOpenDoc])

  // Apply the outcome(s) of a source refresh: update the local cache, track which
  // metrics are stale (read failed → kept last value), and propagate any that
  // CHANGED into the open doc — exactly like a manual edit (reuses the same path).
  const applyRefreshResults = useCallback(
    async (results: MetricRefreshResult[]): Promise<void> => {
      if (!results.length) return
      setMetrics((prev) => prev.map((m) => results.find((r) => r.id === m.id)?.metric ?? m))
      setStaleMetricIds((prev) => {
        const next = new Set(prev)
        for (const r of results) r.stale ? next.add(r.id) : next.delete(r.id)
        return next
      })
      let total = 0
      for (const r of results) if (r.status === 'updated') total += await propagateToOpenDoc(r.metric)
      if (total > 0) {
        setToast(`↻ refreshed ${total} cell${total > 1 ? 's' : ''} from source`)
        setTimeout(() => setToast(null), 2600)
      }
    },
    [propagateToOpenDoc],
  )

  // Refresh ONE sourced metric from its source cell on disk (panel Refresh btn).
  const refreshMetric = useCallback(
    async (id: string): Promise<MetricRefreshResult> => {
      const res = await window.workspace.metrics.refreshFromSource(id)
      await applyRefreshResults([res])
      return res
    },
    [applyRefreshResults],
  )

  // Refresh EVERY sourced metric (panel "Refresh all" button).
  const refreshAllMetrics = useCallback(async (): Promise<void> => {
    try {
      await applyRefreshResults(await window.workspace.metrics.refreshAllFromSource())
    } catch { /* fail-safe: leave cached values */ }
  }, [applyRefreshResults])

  // Detach a sourced metric → a plain literal, KEEPING its current cached value.
  const detachMetric = useCallback(async (id: string): Promise<void> => {
    try {
      await window.workspace.metrics.update(id, { source: { kind: 'literal' } })
      await reloadMetrics()
      setStaleMetricIds((prev) => { const n = new Set(prev); n.delete(id); return n })
    } catch { /* */ }
  }, [reloadMetrics])

  // Create-from-cell gesture: with a Calc cell selected, make a metric that READS
  // LIVE from it (source = this file + current sheet + active cell). The value is
  // seeded from the cell now; an unreadable cell is rejected (main-process read).
  const createMetricFromCell = useCallback(async (name: string): Promise<void> => {
    if (!isCalc || !cellAddr) return
    const sheet = parts.names[parts.cur] || 'Sheet1'
    try {
      await window.workspace.metrics.createFromSource(name.trim() || cellAddr, {
        kind: 'xlsx-cell', filePath, sheet, cell: cellAddr,
      })
      await reloadMetrics()
      bumpLinks()
      setToast(`New metric reads live from ${sheet}!${cellAddr}`)
      setTimeout(() => setToast(null), 2600)
    } catch { setToast('Could not read that cell'); setTimeout(() => setToast(null), 2000) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCalc, cellAddr, parts.names, parts.cur, filePath, reloadMetrics, bumpLinks])

  const deleteMetric = useCallback(async (id: string) => {
    try { await window.workspace.metrics.delete(id); await reloadMetrics() } catch { /* */ }
  }, [reloadMetrics])

  // Sync-all (explicit, opt-in): dry-run first so the panel can confirm the impact.
  // The currently-open file is passed so the main process skips it — the engine's
  // live path owns it; only CLOSED files are written on disk (fail-safe writer).
  const previewSyncAll = useCallback(
    (metricId: string) => window.workspace.transclusions.previewSyncAll(metricId, filePath),
    [filePath],
  )

  const syncAll = useCallback(async (metricId: string) => {
    const res = await window.workspace.transclusions.syncAll(metricId, filePath)
    const n = res.updated.length
    const k = res.skipped.length
    const parts: string[] = []
    if (n > 0) {
      const files = new Set(res.updated.map((u) => u.file)).size
      parts.push(`↻ updated ${n} cell${n > 1 ? 's' : ''} in ${files} file${files > 1 ? 's' : ''}`)
    } else parts.push('Nothing to update on disk')
    if (k > 0) parts.push(`${k} skipped`)
    setToast(parts.join(' · '))
    setTimeout(() => setToast(null), 3200)
    return res
  }, [filePath])

  // Transclude a metric into the open document: write the LITERAL value into the
  // real file (fidelity floor) AND record a live link keyed to its anchor.
  //   Calc    → set the active cell + link {kind:'xlsx-cell'}
  //   Writer  → insert a tagged content control at the caret + link {kind:'docx-cc'}
  //   Impress → insert a named text shape on the current slide + link {kind:'pptx-shape'}
  const insertMetric = useCallback(async (m: Metric) => {
    if (parts.type === 2) {
      // Impress: a stable anchor for a slide — a text shape whose Name is a fresh
      // unique token (round-trips as a pptx <p:cNvPr name>).
      const tag = `wos-metric-${m.id}-${Math.random().toString(36).slice(2, 8)}`
      try {
        await window.workspace.lok.macro('WosInsertMetricShape', `${tag}|${m.value}`)
        await window.workspace.transclusions.add({
          metricId: m.id, filePath, target: { kind: 'pptx-shape', tag, slide: parts.cur }, lastValue: m.value,
        })
        bumpLinks()
        setDirty(true)
        scheduleFullPaint(60)
        setToast(`Inserted ${m.name} on slide`)
        setTimeout(() => setToast(null), 2200)
      } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
      docWrapRef.current?.focus()
      return
    }
    if (parts.type === 0) {
      // Writer: a stable anchor for text — a content control tagged with a fresh
      // unique token (LibreOffice inserts it as a w:sdt that round-trips MS Word).
      const tag = `wos-metric-${m.id}-${Math.random().toString(36).slice(2, 8)}`
      const alias = m.name.replace(/\|/g, ' ') // '|' is the macro arg delimiter
      try {
        await window.workspace.lok.macro('WosInsertContentControl', `${tag}|${m.value}|${alias}`)
        await window.workspace.transclusions.add({
          metricId: m.id, filePath, target: { kind: 'docx-cc', tag }, lastValue: m.value,
        })
        bumpLinks()
        setDirty(true)
        scheduleFullPaint(60)
        setToast(`Inserted ${m.name} at cursor`)
        setTimeout(() => setToast(null), 2200)
      } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
      docWrapRef.current?.focus()
      return
    }
    const cell = cellAddr
    if (!cell) { setToast('Select a cell first'); setTimeout(() => setToast(null), 1800); return }
    const sheet = parts.names[parts.cur] || 'Sheet1'
    try {
      await window.workspace.lok.macro('WosSetCell', `${sheet}|${cell}|${m.value}`)
      await window.workspace.transclusions.add({
        metricId: m.id, filePath, target: { kind: 'xlsx-cell', sheet, cell }, lastValue: m.value,
      })
      bumpLinks()
      setDirty(true)
      scheduleFullPaint(60)
      setToast(`Inserted ${m.name} → ${cell}`)
      setTimeout(() => setToast(null), 2200)
    } catch { setToast('Insert failed'); setTimeout(() => setToast(null), 1800) }
    docWrapRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cellAddr, parts.type, parts.names, parts.cur, filePath])

  // Re-sync on open (fail-safe): for each link in this file, if its metric still
  // exists and changed, push the new value into the cell; a missing metric is
  // skipped entirely — the cell keeps its last literal value (never blanks).
  useEffect(() => {
    if (loading || error || (parts.type !== 1 && parts.type !== 0 && parts.type !== 2)) return
    if (resyncedRef.current === filePath) return
    resyncedRef.current = filePath
    let cancelled = false
    ;(async () => {
      try {
        const links = await window.workspace.transclusions.forFile(filePath)
        if (!links.length || cancelled) return
        const list = await window.workspace.metrics.list()
        const byId = new Map(list.map((m) => [m.id, m]))
        const synced = await applyLinksToOpenDoc(links, byId)
        if (synced > 0 && !cancelled) {
          setToast(`↻ synced ${synced} live value${synced > 1 ? 's' : ''}`)
          setTimeout(() => { if (!cancelled) setToast(null) }, 2800)
        }
      } catch { /* store unavailable — leave the file exactly as opened */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, parts.type, filePath])

  return {
    metrics, showMetrics, setShowMetrics,
    fileLinks, linkCounts, focusMetric, setFocusMetric, staleMetricIds,
    bumpLinks, forMetric, removeLink, revealFile,
    createMetric, createMetricFromCell, updateMetric,
    refreshMetric, refreshAllMetrics, detachMetric, deleteMetric,
    previewSyncAll, syncAll, insertMetric,
    applyRefreshResults,
  }
}
