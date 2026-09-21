import { useCallback, useEffect, useRef, useState } from 'react'
import { Lock, Star, Clock, Search, Globe } from 'lucide-react'
import styles from './Omnibox.module.css'

/**
 * The single input.
 *
 * This browser lives inside a workspace that already has chrome of its own, so
 * stacking a second full browser UI would letterbox the page. The answer is one
 * row and one input: address, search, history and bookmarks are the same box,
 * and there is never a second search field to find.
 *
 * Suggestions match url and title only — NOT page body text. Typing three
 * letters must not surface every page that mentions the word somewhere; content
 * search is a deliberate act (⌘⇧H), not something that fires on a keystroke.
 * The index supports both; this is a UI decision about which one a partial
 * input means.
 */

export interface Suggestion {
  url: string
  title: string
  favicon: string
  starred: boolean
  score: number
  kind: 'bookmark' | 'history'
}

/** True when the text is a URL rather than something to search for. */
export function looksLikeUrl(input: string): boolean {
  const s = input.trim()
  if (!s || /\s/.test(s)) return false
  if (/^https?:\/\//i.test(s)) return true
  if (/^localhost(:\d+)?(\/|$)/i.test(s)) return true
  // A dotted host with a plausible TLD: example.com, sub.example.co.uk/path
  return /^[^/\s.]+(\.[^/\s.]+)+(:\d+)?(\/|$|\?)/.test(s)
}

/** Turns whatever was typed into something navigable. */
export function toNavUrl(input: string, searchTemplate: string): string {
  const s = input.trim()
  if (/^https?:\/\//i.test(s)) return s
  if (looksLikeUrl(s)) return `https://${s}`
  return searchTemplate.replace('%s', encodeURIComponent(s))
}

export function Omnibox({
  value,
  onChange,
  onNavigate,
  starred,
  onToggleStar,
  searchTemplate = 'https://duckduckgo.com/?q=%s',
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  onNavigate: (url: string) => void
  starred: boolean
  onToggleStar: () => void
  searchTemplate?: string
  inputRef?: React.RefObject<HTMLInputElement | null>
}): JSX.Element {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(-1)
  const localRef = useRef<HTMLInputElement | null>(null)
  const ref = inputRef ?? localRef
  // Guards a stale async response from overwriting a newer one — the classic
  // way a suggestion list ends up showing results for a prefix the user has
  // already typed past.
  const seq = useRef(0)

  const fetchSuggestions = useCallback(async (prefix: string) => {
    const mine = ++seq.current
    try {
      const rows = (await window.workspace.history.suggest(prefix, 8)) as Suggestion[]
      if (mine === seq.current) setSuggestions(rows ?? [])
    } catch {
      if (mine === seq.current) setSuggestions([])
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void fetchSuggestions(value)
    setCursor(-1)
  }, [value, open, fetchSuggestions])

  const commit = useCallback(
    (raw: string) => {
      const url = toNavUrl(raw, searchTemplate)
      if (!url) return
      setOpen(false)
      setSuggestions([])
      ref.current?.blur()
      onNavigate(url)
    },
    [onNavigate, searchTemplate, ref],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, -1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      // A highlighted suggestion wins over the raw text; otherwise what was
      // typed is what the user meant.
      commit(cursor >= 0 && suggestions[cursor] ? suggestions[cursor].url : value)
    } else if (e.key === 'Escape') {
      setOpen(false)
      ref.current?.blur()
    }
  }

  const isSearch = value.trim() !== '' && !looksLikeUrl(value)

  return (
    <div className={styles.wrap}>
      <label className={styles.url}>
        {isSearch ? <Search className={styles.lead} size={14} /> : <Lock className={styles.lead} size={14} />}
        <input
          ref={ref as React.Ref<HTMLInputElement>}
          className={styles.input}
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            void fetchSuggestions(value)
          }}
          // A click on a suggestion would otherwise be lost to the blur that
          // precedes it, so the list survives one tick.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search or enter a website"
          spellCheck={false}
          autoComplete="off"
          aria-label="Address bar"
          aria-expanded={open}
          role="combobox"
          aria-controls="omnibox-suggestions"
        />
        <button
          type="button"
          className={starred ? styles.starOn : styles.star}
          onClick={onToggleStar}
          title={starred ? 'Remove bookmark' : 'Bookmark this page'}
          aria-label={starred ? 'Remove bookmark' : 'Bookmark this page'}
        >
          <Star size={15} fill={starred ? 'currentColor' : 'none'} />
        </button>
      </label>

      {open && (suggestions.length > 0 || isSearch) && (
        <ul className={styles.list} id="omnibox-suggestions" role="listbox">
          {isSearch && (
            <li
              className={cursor === -1 ? styles.rowOn : styles.row}
              role="option"
              aria-selected={cursor === -1}
              onMouseDown={() => commit(value)}
            >
              <Search size={14} className={styles.icon} />
              <span className={styles.title}>Search for “{value.trim()}”</span>
            </li>
          )}
          {suggestions.map((s, i) => (
            <li
              key={s.url}
              className={i === cursor ? styles.rowOn : styles.row}
              role="option"
              aria-selected={i === cursor}
              onMouseDown={() => commit(s.url)}
            >
              {s.kind === 'bookmark' ? (
                <Star size={14} className={styles.icon} fill="currentColor" />
              ) : s.favicon ? (
                <img src={s.favicon} alt="" className={styles.fav} />
              ) : (
                <Clock size={14} className={styles.icon} />
              )}
              <span className={styles.title}>{s.title || s.url}</span>
              <span className={styles.host}>{hostOf(s.url)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export { Globe }
