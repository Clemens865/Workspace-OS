import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from '../../lib/useEscape'
import { X, ArrowUp, ArrowDown, Pencil, Trash2 } from 'lucide-react'
import type { MailCategory, MailRule } from '../../types/workspace-api'
import { CATEGORIES, changeRules, describeRule, formOf, rulePatch, type RuleForm } from './mailRulesModel'
import dialog from './MailAccountDialog.module.css'
import styles from './MailRulesDialog.module.css'

/**
 * The person's own sorting rules: see them, reorder, edit, switch off, delete.
 * They are added from a message ("not a newsletter") or from the sift.
 * Order matters: the first rule that matches decides.
 */
export function MailRulesDialog({ onClose }: { onClose: () => void }): JSX.Element {
  useEscape(onClose)
  const [rules, setRules] = useState<MailRule[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; form: RuleForm } | null>(null)

  const run = useCallback(async (change?: () => Promise<unknown>) => {
    const out = await changeRules(window.workspace.mail.rules, change)
    setRules(out.rules)
    setError(out.error)
  }, [])

  useEffect(() => { void run() }, [run])

  const save = (): void => {
    if (!editing) return
    const out = rulePatch(editing.form)
    if (!out.ok) { setError(out.error); return }
    const { id } = editing
    setEditing(null)
    void run(() => window.workspace.mail.rules.update(id, out.patch))
  }

  const field = (key: 'from' | 'domain' | 'subject', label: string): JSX.Element => (
    <label className={dialog.field}>
      <span className={dialog.label}>{label}</span>
      <input
        className={dialog.input}
        value={editing?.form[key] ?? ''}
        onChange={(e) => setEditing((cur) => cur && { ...cur, form: { ...cur.form, [key]: e.target.value } })}
      />
    </label>
  )

  // Portalled to <body>: a modal inside the Mail surface cannot paint over the dock.
  return createPortal(
    <div className={dialog.backdrop} onClick={onClose}>
      <div className={dialog.panel} onClick={(e) => e.stopPropagation()}>
        <div className={dialog.header}>
          <span className={dialog.heading}>Sorting rules</span>
          <button className={dialog.close} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={dialog.body}>
          <p className={dialog.hint}>The first rule that matches decides how a message is sorted.</p>
          {error && <p className={styles.error}>{error}</p>}
          {rules?.length === 0 && (
            <p className={dialog.hint}>No rules yet. Correct how a message was sorted to make one.</p>
          )}
          {rules?.map((r, i) =>
            editing?.id === r.id ? (
              <div key={r.id} className={styles.edit}>
                {field('from', 'Sender contains')}
                {field('domain', 'Domain')}
                {field('subject', 'Subject contains')}
                <label className={dialog.field}>
                  <span className={dialog.label}>Treat as</span>
                  <select
                    className={dialog.input}
                    value={editing.form.category}
                    onChange={(e) => setEditing({ id: r.id, form: { ...editing.form, category: e.target.value as MailCategory } })}
                  >
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <div className={styles.editActions}>
                  <button className={dialog.ghost} onClick={() => { setEditing(null); setError(null) }}>Cancel</button>
                  <button className={dialog.primary} onClick={save}>Save rule</button>
                </div>
              </div>
            ) : (
              <div key={r.id} className={styles.rule}>
                <input
                  type="checkbox"
                  checked={r.enabled !== false}
                  title={r.enabled === false ? 'Switch this rule on' : 'Switch this rule off'}
                  onChange={(e) => void run(() => window.workspace.mail.rules.update(r.id, { enabled: e.target.checked }))}
                />
                <span className={`${styles.text} ${r.enabled === false ? styles.off : ''}`}>
                  {describeRule(r)}
                  <span className={styles.category}>treated as {r.category}</span>
                </span>
                <button className={styles.tool} title="Move up" disabled={i === 0} onClick={() => void run(() => window.workspace.mail.rules.reorder(r.id, -1))}>
                  <ArrowUp size={13} />
                </button>
                <button className={styles.tool} title="Move down" disabled={i === rules.length - 1} onClick={() => void run(() => window.workspace.mail.rules.reorder(r.id, 1))}>
                  <ArrowDown size={13} />
                </button>
                <button className={styles.tool} title="Edit" onClick={() => { setEditing({ id: r.id, form: formOf(r) }); setError(null) }}>
                  <Pencil size={13} />
                </button>
                <button className={`${styles.tool} ${styles.danger}`} title="Delete this rule" onClick={() => void run(() => window.workspace.mail.rules.remove(r.id))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ),
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
