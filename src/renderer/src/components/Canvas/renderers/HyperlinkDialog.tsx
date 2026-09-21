import { useEffect, useRef, useState } from 'react'
import styles from './HyperlinkDialog.module.css'

interface HyperlinkDialogProps {
  onConfirm: (text: string, url: string) => void
  onCancel: () => void
}

/** Native replacement for LibreOffice's Hyperlink dialog. Collects display text
 * + URL and inserts via the parameterized `.uno:SetHyperlink`. */
export function HyperlinkDialog({ onConfirm, onCancel }: HyperlinkDialogProps): JSX.Element {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    urlRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const normalizedUrl = (): string => {
    const u = url.trim()
    if (!u) return ''
    if (/^(https?|mailto|ftp|file):/i.test(u)) return u
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(u)) return `mailto:${u}`
    return `https://${u}`
  }

  const canSubmit = url.trim().length > 0
  const submit = (): void => { if (canSubmit) onConfirm(text.trim(), normalizedUrl()) }

  return (
    <div className={styles.backdrop} onMouseDown={onCancel}>
      <form
        className={styles.modal}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit() }}
      >
        <div className={styles.header}>
          <span className={styles.title}>Insert hyperlink</span>
          <button type="button" className={styles.close} onClick={onCancel} aria-label="Close">×</button>
        </div>

        <label className={styles.field}>
          <span>Address</span>
          <input
            ref={urlRef}
            type="text"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>

        <label className={styles.field}>
          <span>Text to display <em>(optional)</em></span>
          <input
            type="text"
            placeholder="Leave blank to show the address"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {url.trim() && <div className={styles.preview}>→ {normalizedUrl()}</div>}

        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={styles.btnPrimary} disabled={!canSubmit}>Insert</button>
        </div>
      </form>
    </div>
  )
}
