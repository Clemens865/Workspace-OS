import { useSyncExternalStore } from 'react'
import { Check, X } from 'lucide-react'
import { toastStore } from './toastStore'
import styles from './Toasts.module.css'

/**
 * The toast layer, over the landscape and the stage alike. Opaque (it can sit
 * over a browser page, where glass is not allowed), bottom right, out of the
 * dock's way.
 */
export function Toasts(): JSX.Element {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot, toastStore.getSnapshot)
  return (
    <div className={styles.layer} aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} data-tone={t.tone} role="status" data-testid="toast">
          <span className={styles.mark}>{t.tone === 'ok' ? <Check size={13} /> : <X size={13} />}</span>
          <span className={styles.text}>{t.text}</span>
          <button type="button" className={styles.close} onClick={() => toastStore.dismiss(t.id)} aria-label="Dismiss">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
