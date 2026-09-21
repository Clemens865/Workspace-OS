import { useEffect, useState } from 'react'
import { bytesToBlob } from '../../../lib/bytesToBlob'
import styles from './MediaRenderer.module.css'

interface MediaRendererProps {
  filePath: string
  type: 'video' | 'audio'
}

export function MediaRenderer({ filePath, type }: MediaRendererProps): JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    setError(null)

    window.workspace.fs.readFileBytes(filePath)
      .then((bytes: Uint8Array) => {
        const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
        const mimeMap: Record<string, string> = {
          mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
          avi: 'video/x-msvideo', mkv: 'video/x-matroska',
          mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
          aac: 'audio/aac', ogg: 'audio/ogg', m4a: 'audio/mp4',
        }
        setSrc(URL.createObjectURL(bytesToBlob(bytes, mimeMap[ext] ?? `${type}/*`)))
      })
      .catch((e: Error) => setError(e.message))

    return () => { if (src) URL.revokeObjectURL(src) }
  }, [filePath, type])

  if (error) return <div className={styles.error}>Cannot open media: {error}</div>
  if (!src) return <div className={styles.loading}>Loading…</div>

  return (
    <div className={styles.root}>
      {type === 'video' ? (
        <video className={styles.video} src={src} controls autoPlay={false} />
      ) : (
        <div className={styles.audioWrap}>
          <div className={styles.audioLabel}>{filePath.split('/').pop()}</div>
          <audio className={styles.audio} src={src} controls />
        </div>
      )}
    </div>
  )
}
