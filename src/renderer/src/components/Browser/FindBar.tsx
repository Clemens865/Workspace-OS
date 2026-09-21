import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'
import styles from './FindBar.module.css'

/**
 * Find in page (⌘F).
 *
 * An OVERLAY, never a row: the page must not shift when you search it. Losing
 * your place is the one thing find-in-page must never do, and a bar that
 * reflows the document does exactly that.
 *
 * The search itself runs in the guest via Electron's findInPage, so it
 * highlights and scrolls like a real browser's. We only own the input and the
 * match counter.
 */

export interface FindTarget {
  findInPage(text: string, options?: { forward?: boolean; findNext?: boolean }): number
  stopFindInPage(action: 'clearSelection' | 'keepSelection' | 'activateSelection'): void
  addEventListener(type: string, listener: EventListener): void
  removeEventListener(type: string, listener: EventListener): void
}

export function FindBar({
  target,
  onClose,
}: {
  target: FindTarget | null
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState({ active: 0, total: 0 })
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // The guest reports match counts asynchronously.
  useEffect(() => {
    if (!target) return
    const onFound = (e: Event): void => {
      const r = (e as unknown as { result?: { activeMatchOrdinal: number; matches: number } }).result
      if (r) setMatches({ active: r.activeMatchOrdinal, total: r.matches })
    }
    target.addEventListener('found-in-page', onFound)
    return () => target.removeEventListener('found-in-page', onFound)
  }, [target])

  // Re-running the search on every keystroke is what makes it feel live.
  useEffect(() => {
    if (!target) return
    if (!query) {
      target.stopFindInPage('clearSelection')
      setMatches({ active: 0, total: 0 })
      return
    }
    target.findInPage(query)
  }, [query, target])

  const step = (forward: boolean): void => {
    if (!target || !query) return
    target.findInPage(query, { forward, findNext: true })
  }

  /**
   * Closing keeps the selection rather than clearing it, so the match you
   * stopped on stays visible — you searched to get somewhere, and clearing it
   * would take away the thing you were looking for the moment you found it.
   */
  const close = (): void => {
    target?.stopFindInPage('keepSelection')
    onClose()
  }

  return (
    <div className={styles.bar} role="search">
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(!e.shiftKey)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            close()
          }
        }}
        placeholder="Find in page"
        spellCheck={false}
        aria-label="Find in page"
      />
      <span className={styles.count}>
        {query ? (matches.total ? `${matches.active}/${matches.total}` : 'No results') : ''}
      </span>
      <button type="button" className={styles.btn} onClick={() => step(false)} title="Previous (⇧⏎)">
        <ChevronUp size={15} />
      </button>
      <button type="button" className={styles.btn} onClick={() => step(true)} title="Next (⏎)">
        <ChevronDown size={15} />
      </button>
      <button type="button" className={styles.btn} onClick={close} title="Close (Esc)">
        <X size={15} />
      </button>
    </div>
  )
}
