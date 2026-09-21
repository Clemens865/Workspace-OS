import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import ExcelJS from 'exceljs'
import { MetricStore } from './metrics'
import { TransclusionStore, planSyncAll } from './transclusions'
import { setCellValue } from './xlsx-cell-writer'
import { setContentControlText } from './docx-cc-writer'
import JSZip from 'jszip'

/**
 * End-to-end decision + write proof for sync-all, composed exactly like the IPC
 * handler (metrics.get → planSyncAll → setCellValue on closed files, advance
 * lastValue on success). Uses REAL stores and a REAL .xlsx on disk — the point
 * is to prove a CLOSED file is updated safely while the OPEN file is left alone.
 */
describe('sync-all composition (handler decision + engine-free writes)', () => {
  let dir: string
  let metrics: MetricStore
  let links: TransclusionStore

  const xlsx = (name: string): string => path.join(dir, name)
  const readCell = async (p: string, sheet: string, cell: string): Promise<unknown> => {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(p)
    return wb.getWorksheet(sheet)!.getCell(cell).value
  }
  async function makeBook(name: string, a1: number): Promise<string> {
    const wb = new ExcelJS.Workbook()
    wb.addWorksheet('Sheet1').getCell('A1').value = a1
    const p = xlsx(name)
    await wb.xlsx.writeFile(p)
    return p
  }

  // Replays the handler loop; returns the {updated, skipped} summary.
  async function runSyncAll(metricId: string, openFilePath: string | null) {
    const metric = metrics.get(metricId)
    if (!metric) return { updated: [], skipped: [], noMetric: true as const }
    const plan = planSyncAll(links.forMetric(metricId), metric.value, openFilePath)
    const updated: { file: string; label: string }[] = []
    const skipped: { file: string; label: string; reason: string }[] = []
    for (const link of plan.toWrite) {
      // These fixtures are all xlsx-cell anchors; label is the cell address.
      const cell = link.target.kind === 'xlsx-cell' ? link.target.cell : link.target.tag
      const sheet = link.target.kind === 'xlsx-cell' ? link.target.sheet : ''
      const res = await setCellValue(link.filePath, sheet, cell, metric.value)
      if (res.ok) {
        links.add({ ...link, lastValue: metric.value })
        updated.push({ file: link.filePath, label: cell })
      } else {
        skipped.push({ file: link.filePath, label: cell, reason: res.reason ?? 'unknown' })
      }
    }
    return { updated, skipped, noMetric: false as const }
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-syncall-'))
    metrics = new MetricStore(() => path.join(dir, 'metrics.json'))
    links = new TransclusionStore(() => path.join(dir, 'links.json'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('updates a CLOSED file on disk and advances its link, leaving the OPEN file untouched', async () => {
    const open = await makeBook('open.xlsx', 10)
    const closed = await makeBook('closed.xlsx', 10)
    const m = metrics.create('Q3', 42)
    links.add({ metricId: m.id, filePath: open, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
    links.add({ metricId: m.id, filePath: closed, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })

    const res = await runSyncAll(m.id, open) // open file is currently open

    // Closed file got the new value; open file was NOT written on disk.
    expect(res.updated).toEqual([{ file: closed, label: 'A1' }])
    expect(await readCell(closed, 'Sheet1', 'A1')).toBe(42)
    expect(await readCell(open, 'Sheet1', 'A1')).toBe(10) // engine owns it — left alone

    // The closed link's lastValue advanced; the open link did NOT (handled live).
    const byFile = Object.fromEntries(links.forMetric(m.id).map((l) => [l.filePath, l.lastValue]))
    expect(byFile[closed]).toBe(42)
    expect(byFile[open]).toBe(10)
  })

  it('excludes links already in sync (no redundant write)', async () => {
    const closed = await makeBook('closed.xlsx', 42)
    const m = metrics.create('Q3', 42)
    links.add({ metricId: m.id, filePath: closed, sheet: 'Sheet1', cell: 'A1', lastValue: 42 })
    const res = await runSyncAll(m.id, null)
    expect(res.updated).toEqual([])
  })

  it('missing metric → no writes at all', async () => {
    const closed = await makeBook('closed.xlsx', 10)
    links.add({ metricId: 'metric-gone', filePath: closed, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
    const res = await runSyncAll('metric-gone', null)
    expect(res.noMetric).toBe(true)
    expect(await readCell(closed, 'Sheet1', 'A1')).toBe(10) // untouched
  })

  it('reports (does not corrupt) when a linked file is missing on disk', async () => {
    const m = metrics.create('Q3', 42)
    links.add({ metricId: m.id, filePath: xlsx('ghost.xlsx'), sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
    const res = await runSyncAll(m.id, null)
    expect(res.updated).toEqual([])
    expect(res.skipped).toEqual([{ file: xlsx('ghost.xlsx'), label: 'A1', reason: 'missing' }])
    expect(fs.existsSync(xlsx('ghost.xlsx'))).toBe(false)
  })

  it('syncs a CLOSED .docx anchor (docx-cc) on disk via the engine-free writer', async () => {
    // Cross-app proof: the SAME plan/loop drives a Word content control. Copy the
    // real fixture (tag wos-metric-link-42 @ 23.4) and push a new metric value.
    const docx = xlsx('closed.docx')
    fs.copyFileSync(path.join(__dirname, '__fixtures__', 'metric-cc.docx'), docx)
    const m = metrics.create('Q3', 42)
    links.add({ metricId: m.id, filePath: docx, target: { kind: 'docx-cc', tag: 'wos-metric-link-42' }, lastValue: 23.4 })

    // Mirror the handler's writeClosedLink dispatch for a docx-cc link.
    const plan = planSyncAll(links.forMetric(m.id), m.value, null)
    expect(plan.toWrite).toHaveLength(1)
    const res = await setContentControlText(docx, 'wos-metric-link-42', m.value)
    expect(res).toEqual({ ok: true })

    const zip = await JSZip.loadAsync(fs.readFileSync(docx))
    const xml = await zip.file('word/document.xml')!.async('string')
    expect(xml).toContain('>42<')
    expect(xml).not.toContain('>23.4<')
    expect(xml).toContain('Prefix and') // other content intact → still a valid Word doc
  })

  it('preview mirrors the plan without touching disk', async () => {
    const closed = await makeBook('closed.xlsx', 10)
    const m = metrics.create('Q3', 42)
    links.add({ metricId: m.id, filePath: closed, sheet: 'Sheet1', cell: 'A1', lastValue: 10 })
    const plan = planSyncAll(links.forMetric(m.id), m.value, null)
    expect(plan.toWrite).toHaveLength(1)
    expect(await readCell(closed, 'Sheet1', 'A1')).toBe(10) // preview wrote nothing
  })
})
