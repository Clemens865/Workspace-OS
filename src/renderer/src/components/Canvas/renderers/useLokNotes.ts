import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react'

interface UseLokNotesArgs {
  /** True only for Impress docs — the notes pane is presentation-only. */
  isImpress: boolean
  /** Whether the notes pane is currently shown (gates loading). */
  visible: boolean
  /** The current 0-based slide index. */
  slide: number
  /** Mark the document dirty after a notes edit so Save re-enables. */
  setDirty: Dispatch<SetStateAction<boolean>>
}

/**
 * Owns the current slide's speaker-notes text + the load/save wiring against the
 * engine. On slide change (or when the pane opens) it loads that slide's notes
 * via WosGetNotes; `commit` persists via WosSetNotes and marks the doc dirty.
 * Kept out of LokRenderer to keep that component under budget.
 */
export function useLokNotes({ isImpress, visible, slide, setDirty }: UseLokNotesArgs): {
  notes: string
  commitNotes: (text: string) => void
} {
  const [notes, setNotes] = useState('')

  // Load the current slide's notes when the pane is open and the slide changes.
  useEffect(() => {
    if (!isImpress || !visible) return
    let cancelled = false
    void (async () => {
      try {
        const r = await window.workspace.lok.getNotes(slide)
        if (!cancelled) setNotes(r?.text ?? '')
      } catch {
        if (!cancelled) setNotes('')
      }
    })()
    return () => { cancelled = true }
  }, [isImpress, visible, slide])

  const commitNotes = useCallback((text: string) => {
    setNotes(text)
    void (async () => {
      try {
        const ok = await window.workspace.lok.setNotes(slide, text)
        if (ok) setDirty(true)
      } catch { /* fail-safe: a notes-save failure must never crash the editor */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slide])

  return { notes, commitNotes }
}
