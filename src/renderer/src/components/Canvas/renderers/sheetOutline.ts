/**
 * Calc outline groups (Data ▸ Group) from .uno:SheetGeometryData.
 *
 * The engine encodes each axis's groups as levels separated by spaces, each
 * level a comma-separated list of `start:size:hidden:visible` entries
 * (ScOutlineArray::dumpAsString). Indices are 0-based rows/columns; `hidden`
 * means the group is collapsed. The outline bar draws one bracket per group
 * with a −/+ button at its start.
 */

export interface OutlineGroup {
  /** 1-based level (outer groups first). */
  level: number
  start: number
  /** Number of rows/columns in the group. */
  size: number
  collapsed: boolean
}

export function parseOutlineGroups(raw: string | undefined): OutlineGroup[] {
  if (!raw) return []
  const groups: OutlineGroup[] = []
  raw.trim().split(/\s+/).forEach((levelStr, li) => {
    for (const entry of levelStr.split(',')) {
      if (!entry) continue
      const p = entry.split(':').map(Number)
      if (p.length < 3 || p.some((n, i) => i < 3 && !Number.isFinite(n))) continue
      groups.push({ level: li + 1, start: p[0], size: p[1], collapsed: p[2] === 1 })
    }
  })
  return groups
}

/** Deepest level present (0 when there are no groups). */
export function outlineDepth(groups: OutlineGroup[]): number {
  return groups.reduce((m, g) => Math.max(m, g.level), 0)
}

/** Width (px) of the outline strip for `depth` levels; 0 hides it. */
export const OUTLINE_LEVEL_PX = 14
export function outlineStripSize(depth: number): number {
  return depth > 0 ? depth * OUTLINE_LEVEL_PX + 4 : 0
}

/** The WosOutline op that toggles a group. */
export function outlineToggleArgs(axis: 'row' | 'col', g: OutlineGroup): string {
  return `${g.collapsed ? 'show' : 'hide'}|${axis}|${g.start}|${g.start + g.size - 1}`
}
