import { useEffect, useState } from 'react'
import styles from './HexRenderer.module.css'

interface HexRendererProps {
  filePath: string
}

const BYTES_PER_ROW = 16
const MAX_ROWS = 512

export function HexRenderer({ filePath }: HexRendererProps): JSX.Element {
  const [rows, setRows] = useState<{ offset: string; hex: string; ascii: string }[]>([])
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setRows([])
    setError(null)
    window.workspace.fs.readFileBytes(filePath)
      .then((bytes: Uint8Array) => {
        const limit = Math.min(bytes.length, MAX_ROWS * BYTES_PER_ROW)
        setTruncated(bytes.length > limit)
        const result = []
        for (let i = 0; i < limit; i += BYTES_PER_ROW) {
          const chunk = bytes.slice(i, i + BYTES_PER_ROW)
          const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, '0')).join(' ')
          const ascii = Array.from(chunk).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')
          result.push({ offset: i.toString(16).padStart(8, '0'), hex, ascii })
        }
        setRows(result)
      })
      .catch((e: Error) => setError(e.message))
  }, [filePath])

  if (error) return <div className={styles.error}>Cannot read file: {error}</div>

  return (
    <div className={styles.root}>
      <div className={styles.header}>Unknown file type — hex view</div>
      <div className={styles.content}>
        {rows.map((row) => (
          <div key={row.offset} className={styles.row}>
            <span className={styles.offset}>{row.offset}</span>
            <span className={styles.hex}>{row.hex.padEnd(BYTES_PER_ROW * 3 - 1)}</span>
            <span className={styles.ascii}>{row.ascii}</span>
          </div>
        ))}
        {truncated && <div className={styles.truncated}>… (showing first {MAX_ROWS * BYTES_PER_ROW} bytes)</div>}
      </div>
    </div>
  )
}
