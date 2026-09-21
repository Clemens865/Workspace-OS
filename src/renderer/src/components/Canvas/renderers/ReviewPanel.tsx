import { memo, useState } from 'react'
import { Check, MessageSquarePlus, Reply, Trash2, X } from 'lucide-react'
import { shortDate, threadsOf, type Redline, type ReviewComment } from './reviewModel'
import styles from './ReviewPanel.module.css'

interface Props {
  app: 'w' | 'c' | 'p'
  comments: ReviewComment[]
  redlines: Redline[]
  /** Which comment is highlighted (from a margin anchor click). */
  focusId: string | null
  recording: boolean
  onInsertComment: (text: string) => void
  onReply: (id: string, text: string) => void
  onResolve: (id: string) => void
  onDeleteComment: (id: string) => void
  onAccept: (index: number) => void
  onReject: (index: number) => void
  onAcceptAll: () => void
  onRejectAll: () => void
  onToggleRecord: () => void
  onFocusComment: (c: ReviewComment) => void
  onClose: () => void
}

/**
 * The review panel: comment threads (reply, resolve, delete, add) and the
 * tracked-change list (accept / reject one or all, record on/off). Both lists
 * are the engine's own, re-read on its COMMENT / REDLINE callbacks, so an
 * agent's edits show up here the moment they land.
 */
export const ReviewPanel = memo(function ReviewPanel(p: Props): JSX.Element {
  const [draft, setDraft] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyText, setReplyText] = useState('')
  const threads = threadsOf(p.comments)
  const open = threads.filter((t) => !t.root.resolved)
  const resolved = threads.filter((t) => t.root.resolved)

  const submitDraft = (): void => {
    const t = draft.trim()
    if (!t) return
    p.onInsertComment(t)
    setDraft('')
  }
  const submitReply = (id: string): void => {
    const t = replyText.trim()
    if (!t) return
    p.onReply(id, t)
    setReplyText('')
    setReplyTo(null)
  }

  const thread = (t: { root: ReviewComment; replies: ReviewComment[] }): JSX.Element => (
    <div key={t.root.id} className={`${styles.thread} ${p.focusId === t.root.id ? styles.threadOn : ''} ${t.root.resolved ? styles.threadDone : ''}`} data-testid="review-thread" data-comment-id={t.root.id}
      onClick={() => p.onFocusComment(t.root)}>
      {[t.root, ...t.replies].map((c, i) => (
        <div key={c.id} className={i === 0 ? styles.comment : styles.replyRow}>
          <div className={styles.meta}><span className={styles.author}>{c.author || 'Unknown'}</span><span className={styles.date}>{shortDate(c.dateTime)}</span></div>
          <div className={styles.text}>{c.text}</div>
        </div>
      ))}
      <div className={styles.actions} onClick={(e) => e.stopPropagation()}>
        {p.app === 'w' && !t.root.resolved && <button className={styles.act} title="Reply" onClick={() => { setReplyTo(t.root.id); setReplyText('') }}><Reply size={13} /> Reply</button>}
        {p.app === 'w' && !t.root.resolved && <button className={styles.act} title="Resolve" onClick={() => p.onResolve(t.root.id)}><Check size={13} /> Resolve</button>}
        <button className={styles.act} title="Delete" onClick={() => p.onDeleteComment(t.root.id)}><Trash2 size={13} /> Delete</button>
      </div>
      {replyTo === t.root.id && (
        <div className={styles.replyBox} onClick={(e) => e.stopPropagation()}>
          <textarea className={styles.input} autoFocus rows={2} value={replyText} placeholder="Reply…" onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitReply(t.root.id); if (e.key === 'Escape') setReplyTo(null) }} />
          <div className={styles.row}><button className={styles.primary} onClick={() => submitReply(t.root.id)}>Reply</button><button className={styles.act} onClick={() => setReplyTo(null)}>Cancel</button></div>
        </div>
      )}
    </div>
  )

  return (
    <div className={styles.panel} data-testid="review-panel" onMouseDown={(e) => e.stopPropagation()}>
      <div className={styles.head}>
        <span>Review</span>
        <button className={styles.x} onClick={p.onClose} title="Close"><X size={14} /></button>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>Comments <span className={styles.count}>{open.length}</span></div>
        <div className={styles.add}>
          <textarea className={styles.input} rows={2} value={draft} placeholder={p.app === 'c' ? 'Note on the active cell…' : 'Comment at the cursor…'} onChange={(e) => setDraft(e.target.value)}
            data-testid="review-draft"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitDraft() }} />
          <button className={styles.primary} data-testid="review-add" onClick={submitDraft} disabled={!draft.trim()}><MessageSquarePlus size={13} /> Add</button>
        </div>
        {open.length === 0 && resolved.length === 0 && <div className={styles.empty}>No comments yet.</div>}
        {open.map(thread)}
        {resolved.length > 0 && <div className={styles.sub}>Resolved</div>}
        {resolved.map(thread)}
      </div>

      {p.app === 'w' && (
        <div className={styles.section}>
          <div className={styles.sectionHead}>
            Changes <span className={styles.count}>{p.redlines.length}</span>
            <label className={styles.record} title="Record changes as you edit"><input type="checkbox" checked={p.recording} onChange={p.onToggleRecord} /> Record</label>
          </div>
          {p.redlines.length > 0 && (
            <div className={styles.row}>
              <button className={styles.act} data-testid="review-accept-all" onClick={p.onAcceptAll}>Accept all</button>
              <button className={styles.act} data-testid="review-reject-all" onClick={p.onRejectAll}>Reject all</button>
            </div>
          )}
          {p.redlines.length === 0 && <div className={styles.empty}>{p.recording ? 'No changes recorded yet.' : 'Turn on Record to track edits.'}</div>}
          {p.redlines.map((r) => (
            <div key={r.index} className={styles.change} data-testid="review-change" data-index={r.index}>
              <div className={styles.meta}><span className={`${styles.type} ${styles['type_' + r.type.toLowerCase()] ?? ''}`}>{r.type}</span><span className={styles.author}>{r.author}</span><span className={styles.date}>{shortDate(r.dateTime)}</span></div>
              <div className={styles.text}>{r.description || r.comment}</div>
              <div className={styles.actions}>
                <button className={styles.act} data-testid="review-accept" onClick={() => p.onAccept(r.index)}><Check size={13} /> Accept</button>
                <button className={styles.act} data-testid="review-reject" onClick={() => p.onReject(r.index)}><X size={13} /> Reject</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
})
