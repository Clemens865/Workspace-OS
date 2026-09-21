import { useEffect, useState, useCallback } from 'react'
import { MonacoRenderer } from './MonacoRenderer'
import { useFilePrint } from '../../../hooks/useFilePrint'
import { printTextDocument } from '../../../lib/printDocument'
import styles from './HtmlRenderer.module.css'

interface HtmlRendererProps {
  filePath: string
  onDirty: (dirty: boolean) => void
}

type View = 'preview' | 'code'

export function HtmlRenderer({ filePath, onDirty }: HtmlRendererProps): JSX.Element {
  const [view, setView] = useState<View>('preview')
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useFilePrint(filePath, view === 'preview' ? async () => {
    if (html === null || error) throw new Error(error || 'The document is still loading')
    await printTextDocument(filePath, html)
  } : null)

  const loadPreview = useCallback(() => {
    setError(null)
    window.workspace.fs.readFile(filePath)
      .then((text: string) => setHtml(text))
      .catch((e: Error) => setError(e.message))
  }, [filePath])

  useEffect(() => {
    if (view === 'preview') loadPreview()
  }, [view, loadPreview])

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <div className={styles.toggle}>
          <button
            className={`${styles.toggleBtn} ${view === 'preview' ? styles.active : ''}`}
            onClick={() => setView('preview')}
          >
            Preview
          </button>
          <button
            className={`${styles.toggleBtn} ${view === 'code' ? styles.active : ''}`}
            onClick={() => setView('code')}
          >
            Code
          </button>
        </div>
        {view === 'preview' && (
          <button className={styles.refresh} onClick={loadPreview} title="Reload preview">⟳</button>
        )}
      </div>

      <div className={styles.body}>
        {view === 'code' ? (
          <MonacoRenderer filePath={filePath} onDirty={onDirty} />
        ) : error ? (
          <div className={styles.error}>Cannot load HTML: {error}</div>
        ) : html === null ? (
          <div className={styles.loading}>Loading…</div>
        ) : (
          // Sandboxed: scripts run in a null origin and cannot reach the app,
          // the file system, or the parent window. Self-contained HTML renders;
          // external/relative resources won't resolve (expected for a preview).
          <iframe
            className={styles.frame}
            title="HTML preview"
            sandbox="allow-scripts"
            srcDoc={html}
          />
        )}
      </div>
    </div>
  )
}
