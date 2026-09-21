import { useEffect, useState } from 'react'
import styles from './Altitude.module.css'

/**
 * The 16:10 tile in the agent-altitude "Taking shape" card.
 *
 * For an HTML deliverable this renders the page ITSELF, scaled down — you watch
 * the thing the agent is building take shape rather than a generic file glyph.
 * Everything else keeps the glyph, since a .pptx/.xlsx can't be shown without
 * the engine (a thumbnail path for those would go through the existing slide
 * thumbnail pipeline, not here).
 *
 * The preview uses the SAME sandbox as the canvas HtmlRenderer — `allow-scripts`
 * with srcDoc, so the page runs in a null origin and can reach neither the app
 * nor the filesystem. `pointer-events: none` keeps the tile a display surface:
 * clicks belong to the card's "open" action, and the page can't steal focus or
 * scroll inside a preview this small.
 */
export function ArtifactThumb({ path, name }: { path: string; name: string }): JSX.Element {
  const isHtml = /\.html?$/i.test(path)
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    if (!isHtml) return
    let cancelled = false
    // Re-read whenever the path changes; the agent rewrites the file as it works,
    // so reopening the zoom shows the current state rather than a stale capture.
    window.workspace.fs
      .readFile(path)
      .then((text: string) => { if (!cancelled) setHtml(text) })
      .catch(() => { if (!cancelled) setHtml(null) })
    return () => { cancelled = true }
  }, [path, isHtml])

  if (isHtml && html !== null) {
    return (
      <div className={styles.thumb}>
        <iframe
          className={styles.thumbFrame}
          title={`Preview of ${name}`}
          sandbox="allow-scripts"
          srcDoc={html}
          tabIndex={-1}
          aria-hidden
        />
      </div>
    )
  }

  return (
    <div className={styles.thumb} aria-hidden>
      <span className={styles.thumbGlyph}>▤</span>
    </div>
  )
}
