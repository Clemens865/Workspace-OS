import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowDownToLine, FolderOpen } from 'lucide-react'
import type { BrowserDownload } from '../../types/workspace-api'
import { applyDownload, progress, sizeLabel, STATE_LABEL } from './downloadsModel'
import styles from './DownloadsButton.module.css'

// One list for the app run: main keeps a download only a minute, the person
// may look later.
let list: BrowserDownload[] = []
const listeners = new Set<() => void>()
let started = false
function start(): void {
  if (started || typeof window === 'undefined' || !window.workspace?.browser?.onDownload) return
  started = true
  void window.workspace.browser
    .downloads()
    .then((l) => {
      for (const d of l) list = applyDownload(list, d)
      listeners.forEach((f) => f())
    })
    .catch(() => {})
  window.workspace.browser.onDownload((d) => {
    list = applyDownload(list, d)
    listeners.forEach((f) => f())
  })
}
const subscribe = (f: () => void): (() => void) => {
  start()
  listeners.add(f)
  return () => listeners.delete(f)
}

/**
 * The browser's Downloads (ADOPTION.md B5): a button in the address bar,
 * counting what is still coming in, and a list of this session's downloads
 * with progress, Open and Show in Files. The list sits over the page, so it
 * is opaque (no glass over a webview).
 */
export function DownloadsButton(): JSX.Element | null {
  const items = useSyncExternalStore(subscribe, () => list, () => list)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const running = items.filter((d) => d.state === 'progressing').length

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  if (!items.length) return null
  return (
    <div ref={box} className={styles.wrap}>
      <button type="button" className={styles.btn} onClick={() => setOpen((v) => !v)} title="Downloads" aria-label="Downloads" aria-expanded={open} data-testid="browser-downloads">
        <ArrowDownToLine size={16} />
        {running > 0 && <b className={styles.badge}>{running}</b>}
      </button>
      {open && (
        <div className={styles.menu} role="dialog" aria-label="Downloads" data-testid="downloads-list">
          <div className={styles.head}>Downloads</div>
          {items.map((d) => {
            const p = progress(d)
            return (
              <div key={d.id} className={styles.row} data-download={d.filename} data-state={d.state}>
                <div className={styles.name} title={d.savePath}>
                  {d.filename}
                </div>
                <div className={styles.meta}>
                  {STATE_LABEL[d.state]}
                  {sizeLabel(d) && ` · ${sizeLabel(d)}`}
                </div>
                {d.state === 'progressing' && p !== null && (
                  <div className={styles.track}>
                    <div className={styles.fill} style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                )}
                {d.state === 'completed' && (
                  <div className={styles.actions}>
                    <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: d.savePath } }))}>
                      Open
                    </button>
                    <button type="button" onClick={() => void window.workspace.fs.reveal(d.savePath)}>
                      <FolderOpen size={12} /> Show in Finder
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
