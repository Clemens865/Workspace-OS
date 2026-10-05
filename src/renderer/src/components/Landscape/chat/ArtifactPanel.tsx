import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import { FileThumb } from '../../FilePanel/FileThumb'
import { chatMarkdown } from '../../../lib/chatMarkdown'
import { artifactKind, baseName, csvRows } from './chatModel'
import styles from './ChatView.module.css'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

/**
 * What a chat made, beside the conversation: a page runs in a sandboxed frame
 * (scripts, no app bridge, no same origin), an SVG shows as an image (an
 * image cannot run its scripts), a document reads as rendered Markdown, a
 * table as a table, code as text. Office files and PDFs open on the stage.
 */
export function ArtifactPanel({ path, stamp, onClose }: { path: string; stamp: number; onClose: () => void }): JSX.Element {
  const kind = artifactKind(path)
  const [text, setText] = useState<string | null>(null)
  const [img, setImg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    let url: string | null = null
    setError(null)
    setText(null)
    setImg(null)
    if (kind === 'image') {
      void window.workspace.fs
        .readFileBytes(path)
        .then((bytes) => {
          if (!live) return
          url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[(path.split('.').pop() ?? '').toLowerCase()] ?? 'image/png' }))
          setImg(url)
        })
        .catch((e: Error) => live && setError(e.message))
    } else if (kind !== 'office' && kind !== 'pdf' && kind !== 'other') {
      void window.workspace.fs
        .readFile(path)
        .then((t) => live && setText(t))
        .catch((e: Error) => live && setError(e.message))
    }
    return () => {
      live = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path, kind, stamp])

  const md = useMemo(() => (kind === 'markdown' && text !== null ? chatMarkdown(text) : ''), [kind, text])
  const open = (): void => {
    window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
  }

  return (
    <aside className={styles.artifact} data-testid="chat-artifact" data-kind={kind} data-path={path}>
      <div className={styles.artifactHead}>
        <FileThumb entry={{ name: baseName(path), path, isDirectory: false }} size={18} />
        <span className={styles.artifactName} title={path}>
          {baseName(path)}
        </span>
        <button type="button" className={styles.ghostBtn} onClick={open} title="Open it in the workspace" data-testid="chat-artifact-open">
          Open <ArrowUpRight size={13} />
        </button>
        <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close" data-testid="chat-artifact-close">
          <X size={15} />
        </button>
      </div>
      <div className={styles.artifactBody}>
        {error ? (
          <p className={styles.quiet}>Could not read it: {error}</p>
        ) : kind === 'html' ? (
          text !== null && <iframe className={styles.frame} sandbox="allow-scripts" srcDoc={text} title={baseName(path)} data-testid="chat-artifact-frame" />
        ) : kind === 'svg' ? (
          text !== null && <img className={styles.picture} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`} alt={baseName(path)} />
        ) : kind === 'image' ? (
          img && <img className={styles.picture} src={img} alt={baseName(path)} />
        ) : kind === 'markdown' ? (
          <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: md }} />
        ) : kind === 'csv' ? (
          text !== null && (
            <table className={styles.table}>
              <tbody>
                {csvRows(text).map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : kind === 'code' ? (
          text !== null && <pre className={styles.codeView}>{text}</pre>
        ) : (
          <div className={styles.openHere}>
            <FileThumb entry={{ name: baseName(path), path, isDirectory: false }} size={64} />
            <button type="button" className={styles.primaryBtn} onClick={open}>
              Open {baseName(path)}
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
