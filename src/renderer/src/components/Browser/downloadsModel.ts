/**
 * The browser's downloads for this session (ADOPTION.md B5): main reports
 * each change; this keeps one entry per download, newest first. Pure.
 */
import type { BrowserDownload } from '../../types/workspace-api'

export function applyDownload(list: BrowserDownload[], d: BrowserDownload, max = 30): BrowserDownload[] {
  const rest = list.filter((x) => x.id !== d.id)
  return [d, ...rest].sort((a, b) => b.startedAt - a.startedAt).slice(0, max)
}

/** "2.4 MB of 10 MB", "812 KB", or "" when nothing is known yet. */
export function sizeLabel(d: Pick<BrowserDownload, 'received' | 'total' | 'state'>): string {
  const fmt = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`
  if (d.state === 'progressing' && d.total > 0) return `${fmt(d.received)} of ${fmt(d.total)}`
  if (d.received > 0) return fmt(d.received)
  return ''
}

/** 0..1 while the size is known, null otherwise. */
export function progress(d: Pick<BrowserDownload, 'received' | 'total'>): number | null {
  return d.total > 0 ? Math.min(1, d.received / d.total) : null
}

export const STATE_LABEL: Record<BrowserDownload['state'], string> = {
  progressing: 'Downloading',
  completed: 'Done',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
}
