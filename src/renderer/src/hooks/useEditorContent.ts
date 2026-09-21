import { useEffect, useState } from 'react'
import type { CodeEditor } from '../components/Canvas/renderers/MonacoRenderer'

/**
 * Track a Monaco editor's CURRENT text, debounced, so a live preview can
 * re-render as the user types without thrashing on every keystroke. Returns ''
 * until an editor is mounted. `enabled=false` skips the subscription entirely
 * (e.g. when no preview is showing), so there's no cost in plain edit mode.
 */
export function useEditorContent(editor: CodeEditor | null, enabled: boolean, delay = 180): string {
  const [text, setText] = useState('')

  useEffect(() => {
    if (!editor || !enabled) return
    setText(editor.getValue())
    let timer: ReturnType<typeof setTimeout> | undefined
    const sub = editor.onDidChangeModelContent(() => {
      clearTimeout(timer)
      timer = setTimeout(() => setText(editor.getValue()), delay)
    })
    return () => {
      clearTimeout(timer)
      sub.dispose()
    }
  }, [editor, enabled, delay])

  return text
}
