import { useEffect, useState } from 'react'
import styles from './UpdateBanner.module.css'

/**
 * Subtle "update ready — restart" affordance. Stays out of the way until the
 * updater (main process) reports a downloaded update, then offers a one-click
 * restart. Dismissible — the update still installs on the next quit either way.
 */
export function UpdateBanner(): JSX.Element | null {
  const [version, setVersion] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.workspace.updater.onUpdateReady(({ version }) => {
      setVersion(version)
      setDismissed(false)
    })
  }, [])

  if (!version || dismissed) return null

  return (
    <div className={styles.banner} role="status">
      <span className={styles.dot} />
      <span className={styles.text}>Update ready ({version})</span>
      <button className={styles.restart} onClick={() => void window.workspace.updater.install()}>
        Restart
      </button>
      <button className={styles.dismiss} onClick={() => setDismissed(true)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
