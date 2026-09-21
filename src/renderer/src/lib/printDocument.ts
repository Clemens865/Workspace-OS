import { buildPreviewHtml, metricLookupFrom } from './markdownPreview'

export function escapePrintText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Build from the complete editor buffer, never Monaco's virtualized DOM or
 * the preview iframe (both are limited to the visible viewport). */
export async function printTextDocument(filePath: string, source: string): Promise<void> {
  let html: string
  if (/\.md$/i.test(filePath)) {
    const metrics = await window.workspace.metrics.list().catch(() => [])
    html = (await buildPreviewHtml(source, metricLookupFrom(metrics))).html
  } else if (/\.html?$/i.test(filePath)) {
    html = source
  } else {
    html = `<pre>${escapePrintText(source)}</pre>`
  }
  await window.workspace.print.document(filePath.split(/[\\/]/).pop() ?? filePath, html)
}

export function isPrintRequestFor(event: Event, filePath: string): boolean {
  return (event as CustomEvent<{ filePath?: string }>).detail?.filePath === filePath
}
