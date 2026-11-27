import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { MailAccount } from '../../types/workspace-api'
import { MAX_SIGNATURE, loadSignature, storeSignature } from './signatureModel'
import dialog from './MailAccountDialog.module.css'
import { useEscape } from '../../lib/useEscape'

/** One account's signature: added to new drafts in compose, above any quoted original. */
export function SignatureDialog({ account, onClose }: { account: MailAccount; onClose: () => void }): JSX.Element {
  // null until read: saving before that would replace a signature never shown.
  const [text, setText] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEscape(onClose)

  useEffect(() => {
    let live = true
    void loadSignature(window.workspace.mail.getSignature, account.id).then((out) => {
      if (!live) return
      if ('error' in out) setError(out.error)
      else setText(out.text)
    })
    return () => { live = false }
  }, [account.id])

  const save = async (): Promise<void> => {
    if (text === null) return
    setSaving(true)
    const problem = await storeSignature(window.workspace.mail.setSignature, account.id, text)
    setSaving(false)
    if (problem) setError(problem)
    else onClose()
  }

  // Portalled to <body>: a modal inside the Mail surface cannot paint over the dock.
  return createPortal(
    <div className={dialog.backdrop} onClick={onClose}>
      <div className={dialog.panel} onClick={(e) => e.stopPropagation()}>
        <div className={dialog.header}>
          <span className={dialog.heading}>Signature</span>
          <button className={dialog.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={dialog.body}>
          <label className={dialog.field}>
            <span className={dialog.label}>{account.displayName}</span>
            <textarea
              className={dialog.signature}
              value={text ?? ''}
              disabled={text === null}
              maxLength={MAX_SIGNATURE}
              onChange={(e) => setText(e.target.value)}
              placeholder={text === null ? 'Loading…' : 'Your name, role, how to reach you'}
              rows={6}
              autoFocus
            />
          </label>
          <p className={dialog.hint}>Added to new messages and replies from this account. Leave it empty for none.</p>
          {error && <div className={`${dialog.testResult} ${dialog.testError}`}>{error}</div>}
        </div>

        <div className={dialog.footer}>
          <span />
          <div className={dialog.footerRight}>
            <button className={dialog.ghost} onClick={onClose}>Cancel</button>
            <button className={dialog.primary} onClick={() => void save()} disabled={text === null || saving}>Save</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
