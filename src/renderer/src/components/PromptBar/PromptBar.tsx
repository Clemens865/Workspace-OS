import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AtSign, FileText, Layers, Send, SlashSquare, X } from 'lucide-react'
import {
  filterCases, filterCommands, filterFiles, fileName, replaceToken, tokenAt,
  type CaseRef, type Command, type TokenQuery,
} from './promptBarModel'
import styles from './PromptBar.module.css'

/**
 * The unified agent composer — one grammar for every "ask an agent" surface:
 * `@` mentions a workspace file (it becomes a context chip, not a path pasted
 * into prose), `/` at the start offers commands, Enter sends.
 *
 * Adapted from Beautiful UI's Prompt Bar grammar (beautifului.dev, MIT;
 * reference in docs/design/reference) — re-implemented on the wos token
 * system. The token rules live in promptBarModel and are unit-tested.
 */

interface Props {
  placeholder?: string
  disabled?: boolean
  /** Commands offered on a leading `/` — omit to disable the slash menu. */
  commands?: Command[]
  /** Which way the completion popover opens (dock sits at the bottom → 'up'). */
  popover?: 'up' | 'down'
  /** Compact = single-line header variant (the Ask boxes). */
  compact?: boolean
  /** `#` mentions a case. Optional third arg carries the tagged case ids. */
  onSubmit: (text: string, mentions: string[], caseIds?: string[]) => void
}

interface PopoverState {
  tok: TokenQuery
  files?: string[]
  commands?: Command[]
  cases?: CaseRef[]
  sel: number
}

export function PromptBar({ placeholder, disabled, commands, popover = 'up', compact, onSubmit }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [caseMentions, setCaseMentions] = useState<CaseRef[]>([])
  const [pop, setPop] = useState<PopoverState | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  // The list is longer than the popover — keep the keyboard selection visible.
  useEffect(() => {
    popRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [pop?.sel])
  // The workspace file list, re-fetched when stale — an agent's fresh
  // deliverable is precisely the file the person wants to @ next, so a
  // once-per-mount cache would hide the most likely mention. The walk is
  // bounded and yielding, so a 15s TTL costs nothing perceptible.
  const filesRef = useRef<{ files: string[]; at: number } | null>(null)
  const casesRef = useRef<{ cases: CaseRef[]; at: number } | null>(null)

  const refreshPopover = useCallback(async (value: string, caret: number) => {
    const tok = tokenAt(value, caret)
    if (!tok) { setPop(null); return }
    if (tok.kind === '@') {
      if (!filesRef.current || Date.now() - filesRef.current.at > 15_000) {
        try {
          filesRef.current = { files: await window.workspace.fs.listFiles(), at: Date.now() }
        } catch {
          filesRef.current = { files: filesRef.current?.files ?? [], at: Date.now() }
        }
      }
      const files = filterFiles(filesRef.current.files, tok.query)
      setPop(files.length ? { tok, files, sel: 0 } : null)
    } else if (tok.kind === '#') {
      if (!casesRef.current || Date.now() - casesRef.current.at > 15_000) {
        try {
          const list = await window.workspace.cases.list()
          casesRef.current = { cases: list.map((c) => ({ id: c.id, title: c.title, status: c.status })), at: Date.now() }
        } catch {
          casesRef.current = { cases: casesRef.current?.cases ?? [], at: Date.now() }
        }
      }
      const cases = filterCases(casesRef.current.cases, tok.query)
      setPop(cases.length ? { tok, cases, sel: 0 } : null)
    } else if (commands?.length) {
      const list = filterCommands(commands, tok.query)
      setPop(list.length ? { tok, commands: list, sel: 0 } : null)
    } else {
      setPop(null)
    }
  }, [commands])

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setText(e.target.value)
    void refreshPopover(e.target.value, e.target.selectionStart ?? e.target.value.length)
  }

  const applyText = (next: { text: string; caret: number }): void => {
    setText(next.text)
    setPop(null)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  const pickFile = (path: string): void => {
    if (!pop) return
    // The mention becomes a chip, not prose — the path stays out of the text.
    setMentions((m) => (m.includes(path) ? m : [...m, path]))
    applyText(replaceToken(text, pop.tok, ''))
  }

  const pickCommand = (c: Command): void => {
    if (!pop) return
    applyText(replaceToken(text, pop.tok, `/${c.name} `))
  }

  const pickCase = (c: CaseRef): void => {
    if (!pop) return
    setCaseMentions((m) => (m.some((x) => x.id === c.id) ? m : [...m, c]))
    applyText(replaceToken(text, pop.tok, ''))
  }

  const submit = (): void => {
    const t = text.trim()
    if ((!t && mentions.length === 0 && caseMentions.length === 0) || disabled) return
    onSubmit(t, mentions, caseMentions.map((c) => c.id))
    setText('')
    setMentions([])
    setCaseMentions([])
    setPop(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (pop) {
      const items = pop.files ?? pop.commands ?? pop.cases ?? []
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setPop({ ...pop, sel: (pop.sel + d + items.length) % items.length })
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        if (pop.files) pickFile(pop.files[pop.sel])
        else if (pop.commands) pickCommand(pop.commands[pop.sel])
        else if (pop.cases) pickCase(pop.cases[pop.sel])
        return
      }
      if (e.key === 'Escape') { e.preventDefault(); setPop(null); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // Keep the popover honest when the caret moves without a change event.
  const onSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const el = e.currentTarget
    if (pop) void refreshPopover(el.value, el.selectionStart ?? 0)
  }

  // A workspace file dropped anywhere on the bar becomes a mention chip.
  const onDrop = (e: React.DragEvent): void => {
    const raw = e.dataTransfer.getData('application/x-wos-path') || e.dataTransfer.getData('text/plain')
    const paths = raw.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith('/'))
    if (!paths.length) return
    e.preventDefault()
    setMentions((m) => [...m, ...paths.filter((p) => !m.includes(p))])
    inputRef.current?.focus()
  }
  const onDragOver = (e: React.DragEvent): void => {
    if (e.dataTransfer.types.includes('application/x-wos-path') || e.dataTransfer.types.includes('text/plain')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  useEffect(() => () => setPop(null), [])

  // Auto-grow with the draft: measure, clamp to the CSS max-height (~6 lines),
  // scroll beyond it. Layout effect so the height never flashes a frame behind.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`
  }, [text])

  return (
    <div className={`${styles.root} ${compact ? styles.compact : ''}`} onDrop={onDrop} onDragOver={onDragOver}>
      {(mentions.length > 0 || caseMentions.length > 0) && (
        <div className={styles.chips}>
          {caseMentions.map((c) => (
            <span key={c.id} className={`${styles.chip} ${styles.chipCase}`} title={`Case: ${c.title}`}>
              <Layers size={11} />
              <span className={styles.chipName}>{c.title}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove case ${c.title}`}
                onClick={() => setCaseMentions((cur) => cur.filter((x) => x.id !== c.id))}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {mentions.map((m) => (
            <span key={m} className={styles.chip} title={m}>
              <FileText size={11} />
              <span className={styles.chipName}>{fileName(m)}</span>
              <button
                type="button"
                className={styles.chipRemove}
                aria-label={`Remove ${fileName(m)}`}
                onClick={() => setMentions((cur) => cur.filter((x) => x !== m))}
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className={styles.bar}>
        <textarea
          ref={inputRef}
          className={styles.input}
          rows={1}
          placeholder={placeholder ?? 'Ask the agent — @ mentions a file'}
          value={text}
          disabled={disabled}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          data-testid="prompt-bar-input"
        />
        <button
          type="button"
          className={styles.send}
          onClick={submit}
          disabled={disabled || (!text.trim() && mentions.length === 0 && caseMentions.length === 0)}
          aria-label="Send"
        >
          <Send size={13} />
        </button>

        {pop && (
          <div ref={popRef} className={`${styles.popover} ${popover === 'down' ? styles.popoverDown : ''}`} role="listbox">
            {(pop.files ?? []).map((f, i) => (
              <button
                key={f}
                type="button"
                role="option"
                aria-selected={i === pop.sel}
                className={`${styles.option} ${i === pop.sel ? styles.optionSel : ''}`}
                onMouseEnter={() => setPop({ ...pop, sel: i })}
                onMouseDown={(e) => { e.preventDefault(); pickFile(f) }}
              >
                <AtSign size={11} className={styles.optionIcon} />
                <span className={styles.optionName}>{fileName(f)}</span>
                <span className={styles.optionHint}>{f}</span>
              </button>
            ))}
            {(pop.commands ?? []).map((c, i) => (
              <button
                key={c.name}
                type="button"
                role="option"
                aria-selected={i === pop.sel}
                className={`${styles.option} ${i === pop.sel ? styles.optionSel : ''}`}
                onMouseEnter={() => setPop({ ...pop, sel: i })}
                onMouseDown={(e) => { e.preventDefault(); pickCommand(c) }}
              >
                <SlashSquare size={11} className={styles.optionIcon} />
                <span className={styles.optionName}>/{c.name}</span>
                {c.hint && <span className={styles.optionHint}>{c.hint}</span>}
              </button>
            ))}
            {(pop.cases ?? []).map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === pop.sel}
                className={`${styles.option} ${i === pop.sel ? styles.optionSel : ''}`}
                onMouseEnter={() => setPop({ ...pop, sel: i })}
                onMouseDown={(e) => { e.preventDefault(); pickCase(c) }}
              >
                <Layers size={11} className={styles.optionIcon} />
                <span className={styles.optionName}>{c.title}</span>
                {c.status && <span className={styles.optionHint}>{c.status}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
