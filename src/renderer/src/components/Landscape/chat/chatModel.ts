import type { Session } from '../../../lib/sessions/sessionModel'
import { basename as pathBase } from '../../../lib/paths'

/** Chat's pure rules: how history is grouped, what kind of preview a file gets, where a link goes. */

export interface HistoryGroup {
  label: string
  items: Session[]
}

const DAY = 86_400_000
const startOfDay = (t: number): number => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Every conversation in the workspace, newest first, under Today, Yesterday,
 * Previous 7 days and Older. A query keeps those whose title, agent or words
 * contain it (case-insensitive), so a chat is found by what was said in it.
 */
export function historyGroups(sessions: readonly Session[], now: number, query = ''): HistoryGroup[] {
  const q = query.trim().toLowerCase()
  const hit = (s: Session): boolean =>
    !q || s.title.toLowerCase().includes(q) || (s.agentName ?? '').toLowerCase().includes(q) || s.messages.some((m) => m.text.toLowerCase().includes(q))
  const today = startOfDay(now)
  const bins: HistoryGroup[] = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'Previous 7 days', items: [] },
    { label: 'Older', items: [] },
  ]
  for (const s of [...sessions].filter(hit).sort((a, b) => b.lastAt - a.lastAt)) {
    const i = s.lastAt >= today ? 0 : s.lastAt >= today - DAY ? 1 : s.lastAt >= today - 7 * DAY ? 2 : 3
    bins[i].items.push(s)
  }
  return bins.filter((b) => b.items.length)
}

export type ArtifactKind = 'html' | 'svg' | 'markdown' | 'image' | 'csv' | 'code' | 'office' | 'pdf' | 'other'

const CODE = new Set(['txt', 'json', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'swift', 'kt', 'sh', 'sql', 'css', 'scss', 'yaml', 'yml', 'toml', 'xml', 'ini'])

/** What kind of preview a file gets beside the chat. */
export function artifactKind(path: string): ArtifactKind {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'svg') return 'svg'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image'
  if (ext === 'csv' || ext === 'tsv') return 'csv'
  if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'odt', 'ods', 'odp'].includes(ext)) return 'office'
  if (ext === 'pdf') return 'pdf'
  if (CODE.has(ext)) return 'code'
  return 'other'
}

/** A link in a reply: the web (opens in the in-app browser) or a file (absolute, or relative to the workspace). */
export function linkTarget(href: string, root: string | null): { web: string } | { file: string } {
  if (/^(https?:|mailto:)/i.test(href)) return { web: href }
  const clean = decodeURI(href).replace(/^\.\//, '')
  if (clean.startsWith('/')) return { file: clean }
  return { file: root ? `${root.replace(/\/+$/, '')}/${clean}` : clean }
}

/** A small table from CSV/TSV text, for the preview (quoted fields kept simple). */
export function csvRows(text: string, max = 200): string[][] {
  const sep = text.split('\n', 1)[0].includes('\t') ? '\t' : ','
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(0, max)
    .map((l) => l.split(sep).map((c) => c.replace(/^"(.*)"$/, '$1')))
}

export const baseName = (p: string): string => pathBase(p) ?? p
