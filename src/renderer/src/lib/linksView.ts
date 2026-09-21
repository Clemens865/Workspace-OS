/**
 * Pure view helpers for live-links visibility (no React, no DOM). Turns the raw
 * transclusion links into the things the Metrics panel and the in-doc chip show:
 * a human location per anchor, per-file grouping, and per-metric link counts.
 * Kept side-effect-free so it's unit-testable and shared by panel + indicator.
 */
import type { TransclusionLink, LinkTarget } from '../types/workspace-api'

/** File basename from an absolute path (handles both / and \ separators). */
export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

/**
 * A legible, app-appropriate location for one anchor:
 *   - Excel:      `Sheet1!A1` (or just `A1` when the sheet is unknown)
 *   - Word:       `¶ content control`
 *   - PowerPoint: `slide 3 · shape` (slide is stored 0-based → shown 1-based)
 */
export function humanLocation(target: LinkTarget): string {
  if (target.kind === 'xlsx-cell') {
    return target.sheet ? `${target.sheet}!${target.cell}` : target.cell
  }
  if (target.kind === 'pptx-shape') {
    return target.slide != null ? `slide ${target.slide + 1} · shape` : 'shape'
  }
  return '¶ content control'
}

/** One file's worth of a metric's links, for the grouped "where is this linked" view. */
export interface FileLinkGroup {
  filePath: string
  fileName: string
  links: TransclusionLink[]
}

/**
 * Groups a metric's links by file, preserving each file's first-seen order (and
 * the link order within it). One group per distinct filePath.
 */
export function groupLinksByFile(links: TransclusionLink[]): FileLinkGroup[] {
  const groups: FileLinkGroup[] = []
  const byPath = new Map<string, FileLinkGroup>()
  for (const link of links) {
    let g = byPath.get(link.filePath)
    if (!g) {
      g = { filePath: link.filePath, fileName: baseName(link.filePath), links: [] }
      byPath.set(link.filePath, g)
      groups.push(g)
    }
    g.links.push(link)
  }
  return groups
}

/** How many links each metric has, keyed by metricId (0 for metrics with none). */
export function countByMetric(links: TransclusionLink[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const link of links) counts.set(link.metricId, (counts.get(link.metricId) ?? 0) + 1)
  return counts
}
