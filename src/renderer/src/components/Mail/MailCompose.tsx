import { useState, useCallback, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, Send, Loader2, Check, AlertCircle, Paperclip, Trash2, Type, Wand2, Save, Maximize2, Minimize2 } from 'lucide-react'
import { applySignature } from './signatureClient'
import type {
  MailAccount,
  MailDraft,
  MailComposeContext,
  MailDraftAttachment,
  MailOutAddress,
  EmailThemeId,
  EmailBlock,
  EmailUnresolvedToken,
} from '../../types/workspace-api'
import { MailComposeRich, RichPreview } from './MailComposeRich'
import {
  initialRichState,
  assembleBlocks,
  addExtra,
  removeExtra,
  moveExtra,
  updateExtra,
  inlineImageAttachments,
  substituteImageData,
  type RichComposeState,
} from './richComposeModel'
import styles from './MailCompose.module.css'

/**
 * A recipient field with suggestions drawn from people you have actually
 * corresponded with (the mail index already holds them — no contact store).
 *
 * Suggests on the LAST address in the field, so "ana@x.com, sch" completes the
 * second recipient rather than trying to replace the whole line.
 */
function RecipientField({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  const [hits, setHits] = useState<{ address: string; name: string }[]>([])
  const [open, setOpen] = useState(false)

  const lastFragment = (v: string): string => {
    const parts = v.split(',')
    return (parts[parts.length - 1] ?? '').trim()
  }

  useEffect(() => {
    const frag = lastFragment(value)
    // Two characters before suggesting: one letter matches most of an address
    // book and the list is noise rather than help.
    if (frag.length < 2) {
      setHits([])
      return
    }
    let live = true
    const t = setTimeout(() => {
      void window.workspace.mail.contacts(frag, 6).then((res) => {
        if (!live) return
        setHits(res.ok ? res.value : [])
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [value])

  const accept = (address: string): void => {
    const parts = value.split(',')
    parts[parts.length - 1] = ` ${address}`
    onChange(parts.join(',').replace(/^\s+/, '') + ', ')
    setHits([])
    setOpen(false)
  }

  return (
    <div className={styles.recipientWrap}>
      <input
        className={styles.input}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        // Blur is delayed so a click on a suggestion lands before the list is
        // torn down — otherwise the option disappears from under the cursor.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && hits.length > 0 && (
        <div className={styles.suggestions}>
          {hits.map((h) => (
            <button key={h.address} type="button" className={styles.suggestion} onMouseDown={() => accept(h.address)}>
              <span className={styles.suggestName}>{h.name || h.address}</span>
              {h.name ? <span className={styles.suggestAddr}>{h.address}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface MailComposeProps {
  account: MailAccount
  /** Draft prefill (recipients, subject prefix, quoted body) + threading context. */
  initial: { draft: Partial<MailDraft>; context: MailComposeContext }
  onClose: () => void
  /** Told when a send enters the undo window, so the panel can offer Undo. */
  onQueued?: (id: string, holdMs: number) => void
  onSent: () => void
}

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'error'; message: string }

/** Parses a comma/semicolon-separated recipient string into addresses. */
function parseAddrs(raw: string): MailOutAddress[] {
  return raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.includes('@'))
    .map((address) => ({ address }))
}

/**
 * Compose / reply / forward dialog. Two modes:
 *  - PLAIN (the fast default): a plain-text body, sent as-is.
 *  - RICH: the everyday email made richer than a plain box — a clean design
 *    theme, agent-assisted writing, live-data insertion and structured blocks,
 *    compiled to responsive HTML with a plain-text fallback. This is a 1:1 email
 *    that happens to be advanced, NOT a broadcast.
 *
 * The password is never touched here — send() decrypts the SMTP secret in the
 * main process at send-time. Attachments are base64-encoded for the IPC boundary.
 */
export function MailCompose({ account, initial, onClose, onSent, onQueued }: MailComposeProps): JSX.Element {
  const [to, setTo] = useState(fmtList(initial.draft.to))
  const [cc, setCc] = useState(fmtList(initial.draft.cc))
  const [bcc, setBcc] = useState(fmtList(initial.draft.bcc))
  const [showCc, setShowCc] = useState(Boolean(initial.draft.cc?.length || initial.draft.bcc?.length))
  const [subject, setSubject] = useState(initial.draft.subject ?? '')
  const [body, setBody] = useState(initial.draft.text ?? '')

  /**
   * Drop the account's signature into a fresh draft.
   *
   * Runs once per compose window. applySignature is idempotent and places
   * itself above any quoted original, so a reply is signed where the reader
   * expects rather than stranded under the quote.
   */
  useEffect(() => {
    let live = true
    void window.workspace.mail.getSignature(account.id).then((res) => {
      if (!live || !res.ok || !res.value.trim()) return
      setBody((current) => applySignature(current, res.value))
    })
    return () => { live = false }
    // Intentionally account-only: re-running on body changes would fight the
    // user's typing, and applySignature's idempotence is a safety net, not a
    // licence to re-apply on every keystroke.
  }, [account.id])
  const [attachments, setAttachments] = useState<MailDraftAttachment[]>([])

  // The uid of the copy already sitting in Drafts, so a re-save supersedes it
  // instead of littering the folder with near-identical drafts.
  const [draftUid, setDraftUid] = useState<number | undefined>(undefined)
  const [draftNote, setDraftNote] = useState<string | null>(null)
  const [savingDraft, setSavingDraft] = useState(false)

  const saveDraft = useCallback(async () => {
    setSavingDraft(true)
    setDraftNote(null)
    const res = await window.workspace.mail.saveDraft(
      account.id,
      { to: parseAddrs(to), cc: parseAddrs(cc), bcc: parseAddrs(bcc), subject, text: body, attachments },
      initial.context,
      draftUid,
    )
    setSavingDraft(false)
    if (!res.ok) { setDraftNote(res.error.message); return false }
    // Only track a uid the server actually reported (UIDPLUS). Without one we
    // simply append again next time rather than risk trashing a wrong message.
    if (typeof res.value.uid === 'number') setDraftUid(res.value.uid)
    setDraftNote(`Saved to ${res.value.folder}`)
    return true
  }, [account.id, to, cc, bcc, subject, body, attachments, initial.context, draftUid])

  const [state, setState] = useState<SendState>({ kind: 'idle' })

  /**
   * Full-screen compose. A 560px card is right for a two-line reply and wrong
   * for anything designed: with blocks and a preview in play the card scrolls
   * forever and the message is judged through a keyhole. Expanded, the window
   * takes the screen — and in rich mode the preview moves BESIDE the editor,
   * so arranging blocks and seeing the result stop being two separate trips.
   */
  const [expanded, setExpanded] = useState(false)

  // ── Rich mode ─────────────────────────────────────────────────────────────
  const [rich, setRich] = useState(false)
  const [richState, setRichState] = useState<RichComposeState>(() => initialRichState(initial.draft.text ?? ''))
  const [preview, setPreview] = useState<{ html: string; text: string; unresolved: EmailUnresolvedToken[] }>({
    html: '',
    text: '',
    unresolved: [],
  })

  // Keep the shared body in sync when switching modes, so typing in one carries
  // into the other (rich body IS the typed text block).
  const enterRich = useCallback(() => {
    setRichState((s) => ({ ...s, body }))
    setRich(true)
  }, [body])
  const exitRich = useCallback(() => {
    setBody(richState.body)
    setRich(false)
  }, [richState.body])

  // The build's html references images as `cid:` (right for the wire); the
  // preview swaps in the data: bytes the renderer holds, so what you see is
  // what the recipient gets.
  const previewHtml = useMemo(
    () => substituteImageData(preview.html, richState.extras),
    [preview.html, richState.extras],
  )

  // Debounced live build of the rich preview (theme + body + inserted blocks →
  // responsive HTML + text fallback, with live tokens resolved). Never sends.
  useEffect(() => {
    if (!rich) return
    let cancelled = false
    const blocks: EmailBlock[] = assembleBlocks(richState)
    const timer = setTimeout(() => {
      void window.workspace.mail.richBuild({ themeId: richState.themeId, blocks }).then((res) => {
        if (cancelled || !res.ok) return
        setPreview({ html: res.value.html, text: res.value.text, unresolved: res.value.unresolvedTokens })
      })
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [rich, richState])

  const pickFiles = useCallback(async (files: FileList | null) => {
    if (!files) return
    const next: MailDraftAttachment[] = []
    for (const file of Array.from(files)) {
      const buf = await file.arrayBuffer()
      next.push({
        filename: file.name,
        contentType: file.type || undefined,
        content: bytesToBase64(new Uint8Array(buf)),
      })
    }
    setAttachments((prev) => [...prev, ...next])
  }, [])

  const canSend = to.trim().includes('@') && state.kind !== 'sending'

  const handleSend = useCallback(async () => {
    if (!canSend) return
    setState({ kind: 'sending' })

    // Rich mode: do ONE final build so the html + live-data are resolved fresh at
    // send (the debounced preview may lag the last keystroke). Plain mode sends
    // the text box as-is. Either way the proven MAIL_SEND path does the sending.
    let html: string | undefined
    let text = body
    if (rich) {
      const built = await window.workspace.mail.richBuild({
        themeId: richState.themeId,
        blocks: assembleBlocks(richState),
      })
      if (!built.ok) {
        setState({ kind: 'error', message: built.error.message })
        return
      }
      html = built.value.html
      text = built.value.text || richState.body // plain-text fallback part
    }

    const draft: MailDraft = {
      to: parseAddrs(to),
      cc: parseAddrs(cc),
      bcc: parseAddrs(bcc),
      subject,
      text,
      html,
      // Inline images ride as CID attachments the html's `cid:` refs resolve
      // to — the one image mechanism mainstream clients reliably render.
      attachments: rich ? [...attachments, ...inlineImageAttachments(richState.extras)] : attachments,
    }
    try {
      // Queue behind the undo window rather than sending immediately. The window
      // closes at once — the message is genuinely still on this machine, and the
      // Undo bar in the mail panel is the only thing standing between it and
      // SMTP. That is what makes the undo honest: nothing to recall, because
      // nothing has left.
      const res = await window.workspace.mail.sendQueued(account.id, draft, initial.context)
      if (res.ok) {
        setState({ kind: 'sent' })
        onQueued?.(res.value.id, res.value.holdMs)
        setTimeout(onSent, 400)
      } else {
        setState({ kind: 'error', message: res.error.message })
      }
    } catch {
      setState({ kind: 'error', message: 'Sending failed unexpectedly.' })
    }
  }, [canSend, to, cc, bcc, subject, body, attachments, account.id, initial.context, onSent, onQueued, rich, richState])

  /*
   * Portalled to <body>, not rendered in place. Every shell surface is its own
   * stacking context (`isolation: isolate` in WorkspaceShell.module.css), so a
   * `position: fixed` modal rendered inside the Mail surface can NEVER paint
   * over the terminal dock — the dock is a later sibling of the surfaces and
   * wins regardless of z-index. The 560px card dodged the dock by geometry;
   * the full-screen compose overlapped it and surfaced the truth.
   */
  return createPortal(
    <div className={`${styles.backdrop} ${expanded ? styles.backdropTall : ''}`} onClick={onClose}>
      <div className={`${styles.panel} ${expanded ? styles.panelExpanded : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.heading}>{title(initial.context)}</span>
          <span className={styles.headerTools}>
            <button
              className={styles.close}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? 'Back to the small window' : 'Write full screen'}
            >
              {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <button className={styles.close} onClick={onClose} title="Close"><X size={16} /></button>
          </span>
        </div>

        <div className={`${styles.body} ${expanded && rich ? styles.bodySplit : ''}`}>
          <div className={expanded && rich ? styles.editorCol : styles.editorPlain}>
          <div className={styles.fromRow}>
            <span className={styles.rowKey}>From</span>
            <span className={styles.fromValue}>{account.displayName} &lt;{account.user}&gt;</span>
          </div>

          <label className={styles.addrRow}>
            <span className={styles.rowKey}>To</span>
            <RecipientField value={to} onChange={setTo} placeholder="recipient@example.com" />
            {!showCc && <button className={styles.ccToggle} onClick={() => setShowCc(true)} type="button">Cc/Bcc</button>}
          </label>

          {showCc && (
            <>
              <label className={styles.addrRow}>
                <span className={styles.rowKey}>Cc</span>
                <RecipientField value={cc} onChange={setCc} />
              </label>
              <label className={styles.addrRow}>
                <span className={styles.rowKey}>Bcc</span>
                <RecipientField value={bcc} onChange={setBcc} />
              </label>
            </>
          )}

          <label className={styles.addrRow}>
            <span className={styles.rowKey}>Subject</span>
            <input className={styles.input} value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>

          <div className={styles.modeRow}>
            <button
              type="button"
              className={`${styles.modeToggle} ${!rich ? styles.modeToggleActive : ''}`}
              onClick={exitRich}
            >
              <Type size={12} /> Plain
            </button>
            <button
              type="button"
              className={`${styles.modeToggle} ${rich ? styles.modeToggleActive : ''}`}
              onClick={enterRich}
              title="Design, live data, and writing assist — a richer 1:1 email"
            >
              <Wand2 size={12} /> Rich
            </button>
          </div>

          {rich ? (
            <>
              <textarea
                className={styles.textarea}
                value={richState.body}
                onChange={(e) => setRichState((s) => ({ ...s, body: e.target.value }))}
                placeholder="Write your message… use “Assist” to draft or refine, “Insert” to drop in live numbers."
              />
              <MailComposeRich
                state={richState}
                onThemeChange={(id: EmailThemeId) => setRichState((s) => ({ ...s, themeId: id }))}
                onBodyChange={(b) => setRichState((s) => ({ ...s, body: b }))}
                onAddExtra={(block) => setRichState((s) => addExtra(s, block))}
                onRemoveExtra={(i) => setRichState((s) => removeExtra(s, i))}
                onMoveExtra={(from, to) => setRichState((s) => moveExtra(s, from, to))}
                onUpdateExtra={(i, block) => setRichState((s) => updateExtra(s, i, block))}
                previewHtml={previewHtml}
                unresolved={preview.unresolved}
                showPreview={!expanded}
              />
            </>
          ) : (
            <textarea className={styles.textarea} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" />
          )}

          {attachments.length > 0 && (
            <div className={styles.attachments}>
              {attachments.map((a, i) => (
                <span key={i} className={styles.attachment}>
                  <Paperclip size={12} /> {a.filename}
                  <button className={styles.attRemove} onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} title="Remove">
                    <Trash2 size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {state.kind === 'error' && (
            <div className={styles.errorMsg}><AlertCircle size={14} /> {state.message}</div>
          )}
          {state.kind === 'sent' && (
            <div className={styles.sentMsg}><Check size={14} /> Message sent</div>
          )}
          </div>

          {/* Expanded rich compose: the message as the recipient will see it,
              beside the editor and always in view — arrange on the left, judge
              on the right, no scrolling between the two. */}
          {expanded && rich && (
            <div className={styles.previewCol}>
              <RichPreview html={previewHtml} tall />
            </div>
          )}
        </div>

        {draftNote && <div className={styles.draftNote}>{draftNote}</div>}
        <div className={styles.footer}>
          <label className={styles.attachBtn} title="Attach files">
            <Paperclip size={14} />
            <input type="file" multiple hidden onChange={(e) => void pickFiles(e.target.files)} />
          </label>
          <div className={styles.footerRight}>
            <button
              className={styles.ghost}
              onClick={() => void saveDraft()}
              disabled={savingDraft || (!subject.trim() && !body.trim())}
              title="Save this draft to the server, so it is there from any device"
            >
              {savingDraft ? <Loader2 size={13} className={styles.spin} /> : <Save size={13} />} Save draft
            </button>
            <button className={styles.ghost} onClick={onClose}>Cancel</button>
            <button className={styles.primary} onClick={() => void handleSend()} disabled={!canSend}>
              {state.kind === 'sending' ? <><Loader2 size={13} className={styles.spin} /> Sending…</> : <><Send size={13} /> Send</>}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function fmtList(list?: MailOutAddress[]): string {
  return (list ?? []).map((a) => a.address).join(', ')
}

function title(ctx: MailComposeContext): string {
  if (ctx.kind === 'reply') return ctx.replyAll ? 'Reply all' : 'Reply'
  if (ctx.kind === 'forward') return 'Forward'
  return 'New message'
}

/** Encodes bytes to base64 for the IPC boundary (renderer has no Buffer). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}
