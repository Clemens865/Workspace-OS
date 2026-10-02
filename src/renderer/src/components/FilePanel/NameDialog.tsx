import { useEffect, useRef, useState } from 'react'
import styles from './NameDialog.module.css'

/** Ask for a name (new file / new folder). */
interface PromptProps {
  kind: 'prompt'
  heading: string
  label: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

/** Ask a yes/no question (delete). */
interface ConfirmProps {
  kind: 'confirm'
  heading: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export type NameDialogProps = PromptProps | ConfirmProps

/**
 * In-app replacement for window.prompt / window.confirm in the file tree.
 * Enter confirms, Escape or a click on the backdrop cancels. The backdrop has
 * no blur on purpose: it can sit over a live office canvas or webview.
 */
export function NameDialog(props: NameDialogProps): JSX.Element {
  const { heading, onCancel } = props
  const [value, setValue] = useState(props.kind === 'prompt' ? props.initialValue ?? '' : '')
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (props.kind === 'prompt') inputRef.current?.select()
    else confirmRef.current?.focus()
  }, [props.kind])

  const canSubmit = props.kind === 'confirm' || value.trim().length > 0

  const submit = (): void => {
    if (props.kind === 'prompt') {
      const trimmed = value.trim()
      if (trimmed) props.onSubmit(trimmed)
    } else {
      props.onConfirm()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (canSubmit) submit()
    }
  }

  const danger = props.kind === 'confirm' && props.danger

  return (
    <div className={styles.backdrop} onMouseDown={onCancel} data-testid="name-dialog-backdrop">
      <div
        className={styles.dialog}
        role={props.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-label={heading}
        data-testid="name-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <h2 className={styles.heading}>{heading}</h2>
        {props.kind === 'prompt' ? (
          <label className={styles.field}>
            <span className={styles.label}>{props.label}</span>
            <input
              ref={inputRef}
              className={styles.input}
              value={value}
              placeholder={props.placeholder}
              spellCheck={false}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              data-testid="name-dialog-input"
            />
          </label>
        ) : (
          <p className={styles.message}>{props.message}</p>
        )}
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onCancel} data-testid="name-dialog-cancel">
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={danger ? styles.danger : styles.primary}
            onClick={submit}
            disabled={!canSubmit}
            data-testid="name-dialog-ok"
          >
            {props.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}
