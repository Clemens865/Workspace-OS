import { memo, useEffect, useRef, useState } from 'react'
import styles from './NotesPane.module.css'

interface NotesPaneProps {
  /** The current (0-based) slide index, so the header reads "Slide N". */
  slide: number
  /** The notes text loaded from the engine for the current slide. */
  value: string
  /** Persist the edited notes for the current slide (debounced + on blur). */
  onCommit: (text: string) => void
  /** Collapse the pane (the View-tab toggle also controls visibility). */
  onClose: () => void
}

/**
 * Speaker-notes editor for Impress: a collapsible text area below the slide
 * canvas showing/editing the current slide's presenter notes. Edits are
 * debounced while typing and flushed on blur so the note persists into the
 * .pptx (ppt/notesSlides/notesSlideN.xml) via WosSetNotes.
 */
export const NotesPane = memo(function NotesPane({ slide, value, onCommit, onClose }: NotesPaneProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  const editing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync from the engine on slide change (but never clobber an in-progress edit).
  useEffect(() => {
    if (!editing.current) setDraft(value)
  }, [value, slide])

  // Flush any pending debounce when unmounting / switching slides.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const scheduleCommit = (text: string): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { onCommit(text) }, 700)
  }

  return (
    <div className={styles.pane} data-testid="notes-pane">
      <div className={styles.header}>
        <span className={styles.title}>Notes · Slide {slide + 1}</span>
        <button className={styles.close} onClick={onClose} title="Hide notes">×</button>
      </div>
      <textarea
        className={styles.area}
        value={draft}
        spellCheck
        placeholder="Speaker notes for this slide…"
        data-testid="notes-input"
        onFocus={() => { editing.current = true }}
        onChange={(e) => { setDraft(e.target.value); scheduleCommit(e.target.value) }}
        onBlur={() => {
          editing.current = false
          if (timer.current) { clearTimeout(timer.current); timer.current = null }
          if (draft !== value) onCommit(draft)
        }}
      />
    </div>
  )
})
