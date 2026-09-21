/**
 * MAP — how the work connects.
 *
 * Home asks what needs you now; Stream asks what happened; Map asks what is
 * joined to what. Nothing here is invented: every edge already exists on disk.
 *
 *   case  → document   a case's own artifact list
 *   agent → document   the run that produced it (review store)
 *   file  → file       a live link — a metric that lives in one spreadsheet
 *                      and flows into a deck or a memo (transclusions)
 *
 * Cases are TERRITORIES holding their documents. Documents an agent made that
 * no case has claimed sit in one loose region, so nothing produced is hidden.
 * Live links are drawn between documents across territories; one that has
 * fallen out of step runs warm, the same rule as everywhere else.
 *
 * Pure: takes the raw lists, returns a drawable model.
 */

import type { Metric, TransclusionLink, WorkCase } from '../../types/workspace-api'

export interface MapFile {
  /** Workspace-relative key — the identity that lets a run's absolute path and a case's relative one meet. */
  key: string
  name: string
  /** Extension without the dot, for the glyph. */
  kind: string
  /** Absolute path when one is known (runs, links); else null and the case root resolves it. */
  abs: string | null
  /** Agents that produced or touched it. */
  agents: string[]
  /** Part of a live link that is out of step. */
  warm: boolean
}

export interface MapTerritory {
  id: string
  title: string
  status: string
  /** Waiting on the person. */
  warm: boolean
  /** Finished; rendered settled and last. */
  settled: boolean
  files: MapFile[]
  updated: number
}

export interface MapLink {
  id: string
  metricId: string
  metricName: string
  /** The file the metric is READ from; null for a hand-typed metric. */
  from: string | null
  /** The file the value flows INTO. */
  to: string
  /** The file's copy no longer matches the metric. */
  stale: boolean
}

export interface MapMetric {
  id: string
  name: string
  value: number
  /** Where the value is read from, when it has a source. */
  sourceKey: string | null
  links: number
  stale: number
}

export interface MapModel {
  status: string
  territories: MapTerritory[]
  /** Documents agents made that no case holds. */
  loose: MapFile[]
  metrics: MapMetric[]
  links: MapLink[]
}

export interface MapInput {
  root: string | null
  cases: WorkCase[]
  runs: { agentName: string | null; sessionName: string; artifacts: { path: string; name: string }[] }[]
  metrics: Metric[]
  links: TransclusionLink[]
  /** Case statuses that mean "waiting on the person". */
  waiting: ReadonlySet<string>
  /** Case statuses that end a case. */
  terminal: ReadonlySet<string>
}

/** Workspace-relative identity for any path, absolute or already relative. */
export function relKey(p: string, root: string | null): string {
  let s = p.replace(/\\/g, '/')
  if (root) {
    const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
    if (s === r) return ''
    if (s.startsWith(r + '/')) s = s.slice(r.length + 1)
  }
  return s.replace(/^\.\//, '').replace(/^\/+/, '')
}

function base(p: string): string {
  return p.split('/').pop() ?? p
}

function ext(p: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(p)
  return m ? m[1].toLowerCase() : ''
}

export function buildMap(input: MapInput): MapModel {
  const { root } = input
  const files = new Map<string, MapFile>()
  const file = (p: string, abs: string | null): MapFile => {
    const key = relKey(p, root)
    let f = files.get(key)
    if (!f) {
      f = { key, name: base(key) || base(p), kind: ext(key), abs: null, agents: [], warm: false }
      files.set(key, f)
    }
    if (abs && !f.abs) f.abs = abs
    return f
  }

  // Agents → documents. Run paths are absolute.
  for (const r of input.runs) {
    const who = r.agentName || r.sessionName || 'Agent'
    for (const a of r.artifacts) {
      const f = file(a.path, a.path.startsWith('/') ? a.path : null)
      if (!f.agents.includes(who)) f.agents.push(who)
    }
  }

  // Live links: metric (maybe from a file) → file.
  const byMetric = new Map(input.metrics.map((m) => [m.id, m]))
  const links: MapLink[] = []
  const metricStats = new Map<string, MapMetric>()
  for (const m of input.metrics) {
    const sourceKey = m.source && m.source.kind === 'xlsx-cell' ? file(m.source.filePath, m.source.filePath).key : null
    metricStats.set(m.id, { id: m.id, name: m.name, value: m.value, sourceKey, links: 0, stale: 0 })
  }
  for (const l of input.links) {
    const m = byMetric.get(l.metricId)
    if (!m) continue
    const to = file(l.filePath, l.filePath)
    const stat = metricStats.get(m.id)!
    const stale = l.lastValue !== m.value
    if (stale) to.warm = true
    stat.links += 1
    if (stale) stat.stale += 1
    links.push({ id: l.id, metricId: m.id, metricName: m.name, from: stat.sourceKey, to: to.key, stale })
  }

  // Cases → documents. Case artifacts are workspace-relative.
  const claimed = new Set<string>()
  const territories: MapTerritory[] = input.cases.map((c) => {
    const tf = c.artifacts.map((a) => {
      const f = file(a, null)
      claimed.add(f.key)
      return f
    })
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      warm: input.waiting.has(c.status),
      settled: input.terminal.has(c.status),
      files: tf,
      updated: Date.parse(c.updated) || 0,
    }
  })
  territories.sort(
    (a, b) => (a.settled ? 1 : 0) - (b.settled ? 1 : 0) || (b.warm ? 1 : 0) - (a.warm ? 1 : 0) || b.updated - a.updated,
  )

  const loose = [...files.values()].filter((f) => !claimed.has(f.key)).sort((a, b) => a.name.localeCompare(b.name))
  const metrics = [...metricStats.values()].filter((m) => m.links > 0 || m.sourceKey).sort((a, b) => b.links - a.links || a.name.localeCompare(b.name))

  const docCount = files.size
  const staleCount = links.filter((l) => l.stale).length
  return {
    status: mapStatus(input.cases.length, docCount, links.length, staleCount),
    territories,
    loose,
    metrics,
    links,
  }
}

/** One plain line above the map. */
export function mapStatus(cases: number, docs: number, links: number, stale: number): string {
  if (cases === 0 && docs === 0) return 'Nothing to map yet — the first case or document will appear here.'
  const parts: string[] = []
  parts.push(`${cases} case${cases === 1 ? '' : 's'}`)
  parts.push(`${docs} document${docs === 1 ? '' : 's'}`)
  if (links > 0) parts.push(`${links} live link${links === 1 ? '' : 's'}`)
  let s = parts.join(' · ')
  if (stale > 0) s += ` · ${stale} out of step`
  return s + '.'
}

/** The glyph a document wears, by kind. Same vocabulary as the landed band. */
export function fileGlyph(kind: string): string {
  switch (kind) {
    case 'pptx':
      return '◧'
    case 'xlsx':
    case 'csv':
      return '▦'
    case 'docx':
    case 'md':
      return '▤'
    case 'pdf':
      return '▯'
    case 'png':
    case 'jpg':
    case 'jpeg':
      return '▣'
    default:
      return '•'
  }
}
