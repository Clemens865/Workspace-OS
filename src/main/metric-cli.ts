/*
 * wos-metric — Workspace OS live-metric CLI (backs agent-driven metrics).
 *
 * A standalone `node` CLI (no electron runtime) that reads/updates/propagates
 * the SAME live metrics the app uses. It REUSES the app's engine-free stores +
 * writers/readers (metrics.ts, transclusions.ts, ranges.ts, rangeLinks.ts,
 * xlsx-cell-*, docx/pptx writers) — it only constructs its own store instances
 * pointed at the same userData JSON files (resolved without electron).
 *
 * Commands:
 *   wos-metric list [--json]
 *   wos-metric get <name> [--json]
 *   wos-metric set <name> <value> [--json]          # update + propagate to disk
 *   wos-metric create <name> --value <v> [--json]
 *   wos-metric create <name> --source <file.xlsx!Sheet!A1> [--json]
 *   wos-metric link <name> --file <doc> --target <tag|Sheet!A1> [--json]
 *                                                   # bind metric → an anchor on disk
 *   wos-metric refresh <name> [--json]              # re-read source, propagate
 *   wos-metric refresh-all [--json]
 *   wos-metric sync-all [--json]                    # push every metric to disk
 *   wos-metric ranges [--json]
 *   wos-metric refresh-ranges [--json]
 *
 * Fail-safe: a missing/locked/formula-cell file is skip-and-reported (never
 * corrupts); an unknown metric is a clear error with a non-zero exit.
 */
import { MetricStore, isSourced, planRefresh, type Metric } from './metrics'
import {
  TransclusionStore,
  planSyncAll,
  isValidA1,
  type Link,
} from './transclusions'
import {
  RangeStore,
  isSourcedRange,
  planRangeRefresh,
  type LiveRange,
} from './ranges'
import { RangeLinkStore, planRangeSyncAll, type RangeLink } from './rangeLinks'
import { setCellValue } from './xlsx-cell-writer'
import { readCell } from './xlsx-cell-reader'
import { setContentControlText } from './docx-cc-writer'
import { setShapeText } from './pptx-shape-writer'
import { setRangeValues } from './xlsx-range-writer'
import { readRange } from './xlsx-range-reader'
import { setDocTableCells } from './docx-table-writer'
import { setSlideTableCells } from './pptx-table-writer'
import { userDataFile } from './userdata-path'

// Stores bound to the app's real userData JSON files (same files the app uses).
const metrics = new MetricStore(() => userDataFile('metrics.json'))
const transclusions = new TransclusionStore(() => userDataFile('transclusions.json'))
const ranges = new RangeStore(() => userDataFile('ranges.json'))
const rangeLinks = new RangeLinkStore(() => userDataFile('range-links.json'))

// ---- small output helpers -------------------------------------------------

interface Out {
  json: boolean
  lines: string[]
  data: Record<string, unknown>
}
function say(o: Out, line: string): void {
  o.lines.push(line)
}
function emit(o: Out, code: number): never {
  if (o.json) process.stdout.write(JSON.stringify({ ok: code === 0, ...o.data }, null, 2) + '\n')
  else if (o.lines.length) process.stdout.write(o.lines.join('\n') + '\n')
  process.exit(code)
}
function fail(json: boolean, msg: string, extra: Record<string, unknown> = {}): never {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2) + '\n')
  else process.stderr.write(`error: ${msg}\n`)
  process.exit(1)
}

/** Finds a metric by exact name (case-insensitive), or reports ambiguity. */
function findMetricByName(name: string): { metric?: Metric; error?: string } {
  const all = metrics.list()
  const exact = all.filter((m) => m.name === name)
  if (exact.length === 1) return { metric: exact[0] }
  if (exact.length > 1) return { error: `metric name "${name}" is ambiguous (${exact.length} matches)` }
  const ci = all.filter((m) => m.name.toLowerCase() === name.toLowerCase())
  if (ci.length === 1) return { metric: ci[0] }
  if (ci.length > 1) return { error: `metric name "${name}" is ambiguous (${ci.length} matches)` }
  return { error: `no metric named "${name}"` }
}

function findRangeByName(name: string): { range?: LiveRange; error?: string } {
  const all = ranges.list()
  const exact = all.filter((r) => r.name === name)
  if (exact.length === 1) return { range: exact[0] }
  if (exact.length > 1) return { error: `range name "${name}" is ambiguous` }
  const ci = all.filter((r) => r.name.toLowerCase() === name.toLowerCase())
  if (ci.length === 1) return { range: ci[0] }
  if (ci.length > 1) return { error: `range name "${name}" is ambiguous` }
  return { error: `no range named "${name}"` }
}

function sourceLabel(m: Metric): string {
  return isSourced(m) ? `${m.source.filePath}!${m.source.sheet || '?'}!${m.source.cell}` : 'literal'
}

function targetLabel(t: Link['target']): string {
  if (t.kind === 'xlsx-cell') return `${t.sheet ? `${t.sheet}!` : ''}${t.cell}`
  if (t.kind === 'pptx-shape') return '⟨slide shape⟩'
  return '⟨word field⟩'
}

/** Writes one closed-file link's anchor to `value` — mirrors handlers/metrics.ts. */
async function writeClosedLink(link: Link, value: number): Promise<{ ok: boolean; reason?: string }> {
  if (link.target.kind === 'xlsx-cell') return setCellValue(link.filePath, link.target.sheet, link.target.cell, value)
  if (link.target.kind === 'pptx-shape') return setShapeText(link.filePath, link.target.tag, value)
  return setContentControlText(link.filePath, link.target.tag, value)
}

async function writeClosedRangeLink(link: RangeLink, grid: LiveRange['values']): Promise<{ ok: boolean; reason?: string }> {
  if (link.target.kind === 'xlsx-block') return setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
  if (link.target.kind === 'pptx-table') return setSlideTableCells(link.filePath, link.target.tag, grid)
  return setDocTableCells(link.filePath, link.target.tag, grid)
}

/**
 * Pushes a metric's CURRENT value into every closed linked file on disk (the
 * CLI's own "sync-all" — no open file to skip since we run headless). Mirrors
 * transclusion:syncAll in handlers/metrics.ts: reuse planSyncAll + the writers,
 * advance lastValue on success, skip-and-report on any write failure.
 */
async function propagate(
  metric: Metric
): Promise<{ updated: { file: string; label: string }[]; skipped: { file: string; label: string; reason: string }[]; unchanged: number }> {
  const plan = planSyncAll(transclusions.forMetric(metric.id), metric.value, null, metric.source)
  const updated: { file: string; label: string }[] = []
  const skipped: { file: string; label: string; reason: string }[] = []
  for (const link of plan.toWrite) {
    const label = targetLabel(link.target)
    const res = await writeClosedLink(link, metric.value)
    if (res.ok) {
      transclusions.add({ metricId: link.metricId, filePath: link.filePath, target: link.target, lastValue: metric.value })
      updated.push({ file: link.filePath, label })
    } else {
      skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
    }
  }
  return { updated, skipped, unchanged: plan.unchanged.length + plan.selfSkipped.length }
}

async function propagateRange(
  range: LiveRange
): Promise<{ updated: { file: string; label: string }[]; skipped: { file: string; label: string; reason: string }[]; unchanged: number }> {
  const plan = planRangeSyncAll(rangeLinks.forRange(range.id), range, null)
  const updated: { file: string; label: string }[] = []
  const skipped: { file: string; label: string; reason: string }[] = []
  for (const link of plan.toWrite) {
    const label = `${link.lastValues.length}×${link.lastValues[0]?.length ?? 0}`
    const res = await writeClosedRangeLink(link, range.values)
    if (res.ok) {
      rangeLinks.add({ rangeId: link.rangeId, filePath: link.filePath, target: link.target, lastValues: range.values })
      updated.push({ file: link.filePath, label })
    } else {
      skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
    }
  }
  return { updated, skipped, unchanged: plan.unchanged.length + plan.selfSkipped.length }
}

/** Re-reads a sourced metric from its cell; if changed, updates the store. Mirrors refreshMetric. */
async function refreshMetric(m: Metric): Promise<{ status: string; metric: Metric }> {
  if (!isSourced(m)) return { status: 'literal', metric: m }
  const read = await readCell(m.source.filePath, m.source.sheet, m.source.cell)
  const plan = planRefresh(m, read)
  if (plan.status === 'updated') {
    const updated = metrics.update(m.id, { value: plan.value })
    return { status: 'updated', metric: updated ?? m }
  }
  return { status: plan.status, metric: m }
}

async function refreshRange(r: LiveRange): Promise<{ status: string; range: LiveRange }> {
  if (!isSourcedRange(r)) return { status: 'literal', range: r }
  const read = await readRange(r.source.filePath, r.source.sheet, r.source.ref)
  const plan = planRangeRefresh(r, read)
  if (plan.status === 'updated') {
    const updated = ranges.update(r.id, { values: plan.values })
    return { status: 'updated', range: updated ?? r }
  }
  return { status: plan.status, range: r }
}

// ---- arg parsing ----------------------------------------------------------

interface Args {
  _: string[]
  json: boolean
  value?: number
  source?: string
  file?: string
  target?: string
}
function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], json: false }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t === '--json') a.json = true
    else if (t === '--value') a.value = Number(argv[++i])
    else if (t === '--source') a.source = argv[++i]
    else if (t === '--file') a.file = argv[++i]
    // --target and --tag are aliases (an anchor tag, or Sheet!A1 for xlsx).
    else if (t === '--target' || t === '--tag') a.target = argv[++i]
    else a._.push(t)
  }
  return a
}

/**
 * Resolves a `link` target against the target FILE. Mirrors the app's link
 * anchors (transclusions.ts LinkTarget): a .pptx/.docx binds to a named shape/
 * content-control tag; a .xlsx binds to a cell (`Sheet!A1` or `A1`). The tag is
 * normalized to the `wos-metric-<tag>` namespace the writers + gen.py agree on.
 */
function parseLinkTarget(
  file: string,
  raw: string
): { kind: 'pptx-shape'; tag: string } | { kind: 'docx-cc'; tag: string } | { kind: 'xlsx-cell'; sheet: string; cell: string } | null {
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase()
  if (ext === '.xlsx') {
    const parts = raw.split('!')
    const sheet = parts.length === 2 ? parts[0] : ''
    const cell = parts.length === 2 ? parts[1] : parts[0]
    return { kind: 'xlsx-cell', sheet, cell }
  }
  // A pptx/docx anchor tag; accept it with or without the wos-metric- prefix.
  const tag = raw.startsWith('wos-metric-') ? raw : `wos-metric-${raw}`
  if (ext === '.pptx') return { kind: 'pptx-shape', tag }
  if (ext === '.docx') return { kind: 'docx-cc', tag }
  return null
}

/** Parses "file.xlsx!Sheet!A1" (sheet optional: "file.xlsx!A1"). */
function parseSourceSpec(spec: string): { filePath: string; sheet: string; cell: string } | null {
  const parts = spec.split('!')
  if (parts.length === 3) return { filePath: parts[0], sheet: parts[1], cell: parts[2] }
  if (parts.length === 2) return { filePath: parts[0], sheet: '', cell: parts[1] }
  return null
}

// ---- commands -------------------------------------------------------------

function reportPropagation(
  o: Out,
  res: { updated: { file: string; label: string }[]; skipped: { file: string; label: string; reason: string }[]; unchanged: number }
): void {
  o.data['updated'] = res.updated
  o.data['skipped'] = res.skipped
  o.data['unchanged'] = res.unchanged
  say(o, `propagated: ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.unchanged} already in sync`)
  for (const u of res.updated) say(o, `  ✓ ${u.file} (${u.label})`)
  for (const s of res.skipped) say(o, `  ✗ ${s.file} (${s.label}) — ${s.reason}`)
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const o: Out = { json: args.json, lines: [], data: {} }

  switch (cmd) {
    case 'list': {
      const list = metrics.list()
      o.data['metrics'] = list.map((m) => ({
        name: m.name,
        value: m.value,
        source: sourceLabel(m),
        links: transclusions.forMetric(m.id).length,
      }))
      say(o, `${list.length} metric(s):`)
      for (const m of list) {
        say(o, `  ${m.name} = ${m.value}  [${sourceLabel(m)}]  ${transclusions.forMetric(m.id).length} link(s)`)
      }
      emit(o, 0)
      break
    }
    case 'get': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-metric get <name>')
      const { metric, error } = findMetricByName(name)
      if (!metric) fail(args.json, error!)
      const links = transclusions.forMetric(metric.id)
      o.data['metric'] = { name: metric.name, value: metric.value, source: sourceLabel(metric), links: links.length }
      say(o, `${metric.name} = ${metric.value}`)
      say(o, `source: ${sourceLabel(metric)}`)
      say(o, `${links.length} linked file(s):`)
      for (const l of links) say(o, `  ${l.filePath} (${targetLabel(l.target)}) = ${l.lastValue}`)
      emit(o, 0)
      break
    }
    case 'set': {
      const name = args._[1]
      const raw = args._[2]
      if (!name || raw === undefined) fail(args.json, 'usage: wos-metric set <name> <value>')
      const value = Number(raw)
      if (!Number.isFinite(value)) fail(args.json, `not a finite number: ${raw}`)
      const { metric, error } = findMetricByName(name)
      if (!metric) fail(args.json, error!)
      const updated = metrics.update(metric.id, { value })
      if (!updated) fail(args.json, 'metric vanished during update')
      o.data['name'] = updated.name
      o.data['value'] = updated.value
      say(o, `set ${updated.name} = ${updated.value}`)
      const res = await propagate(updated)
      reportPropagation(o, res)
      emit(o, 0)
      break
    }
    case 'create': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-metric create <name> --value <v> | --source <file.xlsx!Sheet!A1>')
      if (args.source) {
        const src = parseSourceSpec(args.source)
        if (!src) fail(args.json, `bad --source (want file.xlsx!Sheet!A1): ${args.source}`)
        const read = await readCell(src.filePath, src.sheet, src.cell)
        if (!read.ok || typeof read.value !== 'number') {
          fail(args.json, `source cell not readable: ${read.reason ?? 'unknown'}`)
        }
        const m = metrics.create(name, read.value, { kind: 'xlsx-cell', ...src })
        o.data['name'] = m.name
        o.data['value'] = m.value
        o.data['source'] = sourceLabel(m)
        say(o, `created ${m.name} = ${m.value}  [${sourceLabel(m)}]`)
        emit(o, 0)
      } else {
        if (args.value === undefined || !Number.isFinite(args.value)) {
          fail(args.json, 'create needs --value <number> or --source <spec>')
        }
        const m = metrics.create(name, args.value)
        o.data['name'] = m.name
        o.data['value'] = m.value
        say(o, `created ${m.name} = ${m.value}  [literal]`)
        emit(o, 0)
      }
      break
    }
    case 'link': {
      // Headless equivalent of the app/LOKit "insert metric anchor" op: register
      // a transclusion link between a metric and an EXISTING anchor in a file on
      // disk, by writing the SAME transclusions.json store the app uses. After
      // `link`, `wos-metric sync-all` updates that anchor whenever the metric
      // changes — no app UI. The anchor must already exist (gen.py emits pptx/
      // docx anchors via `metrics`/`metricTag`; an xlsx cell always exists).
      const name = args._[1]
      if (!name) {
        fail(args.json, 'usage: wos-metric link <metric> --file <doc> --target <tag|Sheet!A1>')
      }
      if (!args.file) fail(args.json, 'link needs --file <doc>')
      if (!args.target) fail(args.json, 'link needs --target <tag|Sheet!A1>')
      const { metric, error } = findMetricByName(name)
      if (!metric) fail(args.json, error!)
      const target = parseLinkTarget(args.file, args.target)
      if (!target) fail(args.json, `unsupported file type for link: ${args.file} (want .pptx/.docx/.xlsx)`)
      if (target.kind === 'xlsx-cell' && !isValidA1(target.cell)) {
        fail(args.json, `bad cell address: ${target.cell}`)
      }
      let link: Link
      try {
        // Seed lastValue with a value that DIFFERS from the metric's, so the
        // FIRST sync-all diverges and actually stamps the current value into the
        // file (the anchor was written with its own literal at generation time).
        link = transclusions.add({
          metricId: metric.id,
          filePath: args.file,
          target,
          lastValue: metric.value + 1,
        })
      } catch (e) {
        fail(args.json, e instanceof Error ? e.message : 'invalid link target')
      }
      o.data['linkId'] = link.id
      o.data['metric'] = metric.name
      o.data['file'] = link.filePath
      o.data['target'] = targetLabel(link.target)
      say(o, `linked ${metric.name} → ${link.filePath} (${targetLabel(link.target)})`)
      say(o, `run 'wos-metric sync-all' to push the value into the file`)
      emit(o, 0)
      break
    }
    case 'refresh': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-metric refresh <name>')
      const { metric, error } = findMetricByName(name)
      if (!metric) fail(args.json, error!)
      const r = await refreshMetric(metric)
      o.data['status'] = r.status
      o.data['value'] = r.metric.value
      say(o, `refresh ${r.metric.name}: ${r.status} (value = ${r.metric.value})`)
      if (r.status === 'updated') reportPropagation(o, await propagate(r.metric))
      emit(o, 0)
      break
    }
    case 'refresh-all': {
      const sourced = metrics.list().filter(isSourced)
      const results: { name: string; status: string; value: number }[] = []
      let propagatedFiles = 0
      for (const m of sourced) {
        const r = await refreshMetric(m)
        results.push({ name: r.metric.name, status: r.status, value: r.metric.value })
        if (r.status === 'updated') {
          const p = await propagate(r.metric)
          propagatedFiles += p.updated.length
          say(o, `updated ${r.metric.name} = ${r.metric.value} → ${p.updated.length} file(s)`)
          for (const s of p.skipped) say(o, `  ✗ ${s.file} — ${s.reason}`)
        }
      }
      o.data['results'] = results
      o.data['propagatedFiles'] = propagatedFiles
      say(o, `refresh-all: ${sourced.length} sourced metric(s), ${results.filter((r) => r.status === 'updated').length} changed, ${propagatedFiles} file(s) updated`)
      emit(o, 0)
      break
    }
    case 'sync-all': {
      const list = metrics.list()
      let totalUpdated = 0
      let totalSkipped = 0
      const perMetric: { name: string; updated: number; skipped: number; unchanged: number }[] = []
      for (const m of list) {
        const res = await propagate(m)
        totalUpdated += res.updated.length
        totalSkipped += res.skipped.length
        if (res.updated.length || res.skipped.length) {
          say(o, `${m.name} = ${m.value}: ${res.updated.length} updated, ${res.skipped.length} skipped`)
          for (const s of res.skipped) say(o, `  ✗ ${s.file} (${s.label}) — ${s.reason}`)
        }
        perMetric.push({ name: m.name, updated: res.updated.length, skipped: res.skipped.length, unchanged: res.unchanged })
      }
      o.data['perMetric'] = perMetric
      o.data['totalUpdated'] = totalUpdated
      o.data['totalSkipped'] = totalSkipped
      say(o, `sync-all: ${totalUpdated} file(s) updated, ${totalSkipped} skipped across ${list.length} metric(s)`)
      emit(o, 0)
      break
    }
    case 'ranges': {
      const list = ranges.list()
      o.data['ranges'] = list.map((r) => ({
        name: r.name,
        dims: `${r.values.length}×${r.values[0]?.length ?? 0}`,
        source: isSourcedRange(r) ? `${r.source.filePath}!${r.source.sheet || '?'}!${r.source.ref}` : 'literal',
        links: rangeLinks.forRange(r.id).length,
      }))
      say(o, `${list.length} range(s):`)
      for (const r of list) {
        const src = isSourcedRange(r) ? `${r.source.filePath}!${r.source.sheet || '?'}!${r.source.ref}` : 'literal'
        say(o, `  ${r.name} (${r.values.length}×${r.values[0]?.length ?? 0})  [${src}]  ${rangeLinks.forRange(r.id).length} link(s)`)
      }
      emit(o, 0)
      break
    }
    case 'refresh-ranges': {
      const sourced = ranges.list().filter(isSourcedRange)
      let changed = 0
      let propagatedFiles = 0
      for (const r of sourced) {
        const res = await refreshRange(r)
        if (res.status === 'updated') {
          changed++
          const p = await propagateRange(res.range)
          propagatedFiles += p.updated.length
          say(o, `updated ${res.range.name} → ${p.updated.length} file(s)`)
          for (const s of p.skipped) say(o, `  ✗ ${s.file} — ${s.reason}`)
        }
      }
      o.data['changed'] = changed
      o.data['propagatedFiles'] = propagatedFiles
      say(o, `refresh-ranges: ${sourced.length} sourced range(s), ${changed} changed, ${propagatedFiles} file(s) updated`)
      emit(o, 0)
      break
    }
    default:
      fail(
        args.json,
        `unknown command "${cmd ?? ''}". Commands: list, get, set, create, link, refresh, refresh-all, sync-all, ranges, refresh-ranges`
      )
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).message}\n`)
  process.exit(1)
})
