import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPreviewHtml, metricLookupFrom } from '../../lib/markdownPreview'
import { useTheme } from '../../hooks/useTheme'
import styles from './MarkdownPreview.module.css'

interface MarkdownPreviewProps {
  /** The CURRENT editor content (already live-updating from Canvas). */
  source: string
}

/**
 * Read-only markdown preview. Runs the pure pipeline (resolve live tokens →
 * marked → sanitize) then renders the result inside a SANDBOXED, CSP-locked
 * iframe — the exact defence-in-depth pattern used by the mail reader. A local
 * .md is lower-risk than email, but we render it just as safely.
 *
 * Live-data: `{{metric:<id>}}` tokens resolve against the metric store at render
 * time (and re-resolve when the window regains focus, in case a metric changed
 * elsewhere), so a note's numbers stay true without re-typing.
 */
export function MarkdownPreview({ source }: MarkdownPreviewProps): JSX.Element {
  const { theme } = useTheme()
  const [html, setHtml] = useState('')
  const [metricsVersion, setMetricsVersion] = useState(0)
  // The latest metrics list, loaded on mount / focus / metrics-changed.
  const lookupRef = useRef(metricLookupFrom([]))

  // Load the live metric values; re-load on focus so an externally-changed
  // metric is reflected the next time the preview re-renders.
  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      try {
        const list = await window.workspace.metrics.list()
        if (cancelled) return
        lookupRef.current = metricLookupFrom(list)
        setMetricsVersion((v) => v + 1)
      } catch {
        /* store unavailable — tokens fall back to visible placeholders */
      }
    }
    void load()
    window.addEventListener('focus', load)
    return () => {
      cancelled = true
      window.removeEventListener('focus', load)
    }
  }, [])

  // Rebuild the sanitized HTML whenever the source (debounced upstream) or the
  // live metric values change. The pipeline is async (marked is lazy-loaded).
  useEffect(() => {
    let cancelled = false
    void buildPreviewHtml(source, lookupRef.current).then((res) => {
      if (!cancelled) setHtml(res.html)
    })
    return () => {
      cancelled = true
    }
  }, [source, metricsVersion])

  const srcDoc = useMemo(() => {
    const dark = theme === 'dark'
    // Landscape materials: paper page, ink text, serif headings. The fonts are
    // named, not loaded (CSP allows data: fonts only), so the stacks fall back
    // to Georgia / system-ui when Newsreader / Inter are not installed.
    const fg = dark ? '#e6e6e6' : '#3b4a55'
    const ink = dark ? '#f2f2f2' : '#1b2730'
    const bg = dark ? '#1e1e1e' : '#fbfcfd'
    const link = dark ? '#9fc3d9' : '#1b2730'
    const codeBg = dark ? '#2a2a2a' : 'rgba(27,39,48,.05)'
    const border = dark ? '#3a3a3a' : 'rgba(27,39,48,.09)'
    const muted = dark ? '#aaa' : '#7a8893'
    // default-src 'none' + no scripts / no network: nothing loads or runs.
    const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"
    const css = `html,body{margin:0;padding:28px 36px;color:${fg};background:${bg};font:14px/1.65 Inter,-apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}`
      + `body{max-width:760px}`
      + `h1,h2,h3,h4{font-family:Newsreader,Georgia,serif;font-weight:400;color:${ink};letter-spacing:-.01em;line-height:1.25}`
      + `h1{font-size:30px}h2{font-size:23px}h3{font-size:18px}`
      + `a{color:${link};text-decoration-color:${border};text-underline-offset:2px}img{max-width:100%;border-radius:12px}`
      + `pre{background:${codeBg};padding:12px 14px;border-radius:12px;overflow:auto}`
      + `code{background:${codeBg};padding:.15em .4em;border-radius:6px;font-family:'JetBrains Mono',ui-monospace,'SF Mono',monospace;font-size:.88em}`
      + `pre code{background:none;padding:0}`
      + `table{border-collapse:collapse}th,td{border:1px solid ${border};padding:7px 10px}th{font-weight:500;color:${ink}}`
      + `blockquote{margin:0;padding-left:14px;border-left:2px solid ${border};color:${muted}}`
      + `hr{border:0;border-top:1px solid ${border}}`
      + `h1,h2{border-bottom:1px solid ${border};padding-bottom:.3em}`
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>${css}</style></head><body>${html}</body></html>`
  }, [html, theme])

  // Never mount the frame on an empty document. A sandboxed srcdoc iframe
  // that navigates from its empty first document to the real one at the SAME
  // size does not repaint in Chromium — the Split view came up blank until a
  // mode change resized it (Preview → Split "fixed" it). Waiting for the first
  // build means the frame's first document is the real one.
  if (!html) return <div className={styles.frame} aria-busy="true" />
  return (
    <iframe
      className={styles.frame}
      title="Markdown preview"
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={srcDoc}
    />
  )
}
