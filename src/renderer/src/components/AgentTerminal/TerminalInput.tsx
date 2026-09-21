import { useState, useRef, useCallback, useMemo, KeyboardEvent } from 'react'
import { matchCommands } from './slashCommands'
import styles from './TerminalInput.module.css'

interface TerminalInputProps {
  history: string[]
  onSubmit: (raw: string) => void
}

export function TerminalInput({ history, onSubmit }: TerminalInputProps): JSX.Element {
  const [value, setValue] = useState('')
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [autocompleteIndex, setAutocompleteIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Slash autocomplete only when the input is a single `/token` with no space yet.
  const suggestions = useMemo(() => {
    if (!value.startsWith('/') || value.includes(' ')) return []
    return matchCommands(value.slice(1))
  }, [value])

  const applySuggestion = useCallback((name: string) => {
    setValue(`/${name} `)
    setAutocompleteIndex(0)
    inputRef.current?.focus()
  }, [])

  const submit = useCallback(() => {
    if (!value.trim()) return
    onSubmit(value)
    setValue('')
    setHistoryIndex(null)
    setAutocompleteIndex(0)
  }, [value, onSubmit])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Accept an autocomplete suggestion.
    if (suggestions.length > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) {
      if (e.key === 'Tab') {
        e.preventDefault()
        applySuggestion(suggestions[autocompleteIndex].name)
        return
      }
    }
    if (suggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault()
      setAutocompleteIndex((i) =>
        e.key === 'ArrowDown'
          ? (i + 1) % suggestions.length
          : (i - 1 + suggestions.length) % suggestions.length
      )
      return
    }

    // Submit on Enter (Shift+Enter inserts a newline for multi-line prompts).
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
      return
    }

    // History navigation when not autocompleting.
    if (suggestions.length === 0 && e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
      setHistoryIndex(idx)
      setValue(history[idx])
      return
    }
    if (suggestions.length === 0 && e.key === 'ArrowDown' && historyIndex !== null) {
      e.preventDefault()
      const idx = historyIndex + 1
      if (idx >= history.length) {
        setHistoryIndex(null)
        setValue('')
      } else {
        setHistoryIndex(idx)
        setValue(history[idx])
      }
    }
  }, [suggestions, autocompleteIndex, applySuggestion, submit, history, historyIndex])

  return (
    <div className={styles.wrap}>
      {suggestions.length > 0 && (
        <div className={styles.autocomplete}>
          {suggestions.map((cmd, i) => (
            <button
              key={cmd.name}
              className={`${styles.suggestion} ${i === autocompleteIndex ? styles.activeSuggestion : ''}`}
              onMouseDown={(e) => { e.preventDefault(); applySuggestion(cmd.name) }}
            >
              <span className={styles.suggestionName}>/{cmd.name}</span>
              <span className={styles.suggestionDesc}>{cmd.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.inputRow}>
        <span className={styles.prompt}>›</span>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={value}
          onChange={(e) => { setValue(e.target.value); setHistoryIndex(null) }}
          onKeyDown={onKeyDown}
          placeholder="Ask the agent, or type / for commands…"
          rows={1}
          spellCheck={false}
          autoFocus
        />
      </div>
    </div>
  )
}
