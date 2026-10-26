import { useEffect, useRef, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import styles from './CleanTitleBar.module.css'

/**
 * The clean window style (Settings → Appearance → Window, Windows and Linux):
 * the window has no title bar, and pointing at the top edge slides in a thin
 * bar to drag the window by, with minimise, maximise and close. It goes away
 * once the pointer moves down into the app.
 *
 * The bar is mounted only while it shows: a drag region the person cannot see
 * would still swallow clicks on whatever sits beneath it.
 */
export function CleanTitleBar(): JSX.Element | null {
  const [clean, setClean] = useState(false)
  useEffect(() => {
    window.workspace.window?.style?.().then((s) => setClean(s.current === 'clean')).catch(() => {})
  }, [])
  return clean ? <CleanTitleBarHost /> : null
}

const BAR_HEIGHT = 34
/** How far below the bar the pointer may go before it starts to hide. */
const HIDE_MARGIN = 18
const HIDE_DELAY_MS = 600

function CleanTitleBarHost(): JSX.Element {
  const [shown, setShown] = useState(false)
  const [maximized, setMaximized] = useState(true)
  const timer = useRef<number | null>(null)

  const cancelHide = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const show = (): void => {
    cancelHide()
    setShown(true)
    window.workspace.window.isMaximized().then(setMaximized).catch(() => {})
  }

  // While shown, only the pointer moving down into the app hides it. Over the
  // drag region the page gets no pointer events (the system owns that area, and
  // may even report the pointer as gone), so nothing there may hide the bar.
  useEffect(() => {
    if (!shown) return
    const onMove = (e: MouseEvent): void => {
      if (e.clientY > BAR_HEIGHT + HIDE_MARGIN) {
        if (timer.current === null) timer.current = window.setTimeout(() => { timer.current = null; setShown(false) }, HIDE_DELAY_MS)
      } else cancelHide()
    }
    document.addEventListener('mousemove', onMove)
    return () => {
      document.removeEventListener('mousemove', onMove)
      cancelHide()
    }
  }, [shown])

  return (
    <>
      <div className={styles.zone} onMouseEnter={show} onMouseMove={show} data-testid="clean-titlebar-zone" />
      {shown && (
        <CleanTitleBarView
          maximized={maximized}
          onMinimize={() => void window.workspace.window.minimize()}
          onMaximize={() => {
            void window.workspace.window.maximize().then(() => window.workspace.window.isMaximized().then(setMaximized))
          }}
          onClose={() => void window.workspace.window.close()}
        />
      )}
    </>
  )
}

/** The bar itself: a drag region with the app's name, then the three window buttons. */
export function CleanTitleBarView({
  maximized,
  onMinimize,
  onMaximize,
  onClose,
}: {
  maximized: boolean
  onMinimize: () => void
  onMaximize: () => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className={styles.bar} role="toolbar" aria-label="Window" data-testid="clean-titlebar">
      <div className={styles.drag}>Workspace OS</div>
      <button type="button" className={styles.btn} onClick={onMinimize} aria-label="Minimise" title="Minimise">
        <Minus size={15} />
      </button>
      <button type="button" className={styles.btn} onClick={onMaximize} aria-label={maximized ? 'Restore' : 'Maximise'} title={maximized ? 'Restore' : 'Maximise'}>
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button type="button" className={`${styles.btn} ${styles.close}`} onClick={onClose} aria-label="Close" title="Close">
        <X size={16} />
      </button>
    </div>
  )
}
