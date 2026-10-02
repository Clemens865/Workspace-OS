import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Check, FileText, Play, RotateCcw, Send, X } from 'lucide-react'
import { reviewStore } from '../Review/reviewStore'
import { AgentAvatar } from '../Agents/AgentAvatar'
import { useGlass } from './backdrop/useBackdrop'
import { ago } from './agentPresence'
import { KIND_LABEL, revisionPrompt, type InboxItem } from './inboxModel'
import * as act from './agentActions'
import { resumeRun } from './pauseResume'
import styles from './InboxView.module.css'

const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|html?|xml|log|ts|tsx|js|py)$/i

/** A text result, read straight from disk (the first part of it). */
function useTextPreview(path: string | null): string | null {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    setText(null)
    if (!path || !TEXT_EXT.test(path)) return
    let alive = true
    void window.workspace.fs
      .readFile(path)
      .then((t) => alive && setText(t.length > 8000 ? `${t.slice(0, 8000)}\n…` : t))
      .catch(() => alive && setText(null))
    return () => {
      alive = false
    }
  }, [path])
  return text
}

function Card({ item, selected, onPick, i }: { item: InboxItem; selected: boolean; onPick: () => void; i: number }): JSX.Element {
  const ref = useRef<HTMLButtonElement>(null)
  useGlass(ref, { radius: 20, bezel: 16, thickness: 34, frost: selected ? 0.3 : 0.18 })
  return (
    <button
      ref={ref}
      type="button"
      className={`${styles.card} ${selected ? styles.sel : ''}`}
      style={{ transform: `rotateY(${16 - Math.min(i, 4) * 4}deg)`, transitionDelay: `${i * 40}ms` }}
      onClick={onPick}
      data-kind={item.kind}
      data-inbox={item.key}
    >
      <span className={styles.cardTag}>
        <span className={styles.dot} data-kind={item.kind} /> {KIND_LABEL[item.kind]}
      </span>
      <span className={styles.cardWho}>{item.who}</span>
      <span className={styles.cardTitle}>{item.title}</span>
      <span className={styles.cardWhen}>{ago(item.at)}</span>
    </button>
  )
}

/**
 * Inbox: everything waiting on you, across agents (the design's "Inbox ·
 * 3 waiting"). Cards fan in from the left; the chosen one opens on the right
 * with the action it needs. Every action goes through an existing path.
 */
export function InboxView({ items, onDismiss }: { items: InboxItem[]; onDismiss: (key: string) => void }): JSX.Element {
  const [pick, setPick] = useState<string | null>(null)
  const item = useMemo(() => items.find((i) => i.key === pick) ?? items[0] ?? null, [items, pick])
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const main = useRef<HTMLDivElement>(null)
  useGlass(main, item ? { radius: 26, bezel: 24, thickness: 46, frost: 0.82 } : null)
  const preview = useTextPreview(item?.kind === 'review' ? (item.files.find((f) => TEXT_EXT.test(f)) ?? null) : null)

  useEffect(() => {
    setFeedback('')
    setNote(null)
  }, [item?.key])

  // ↑ ↓ move through the cards.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && /INPUT|TEXTAREA/.test(t.tagName)) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const i = items.findIndex((x) => x.key === item?.key)
      const next = items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
      if (next) {
        e.preventDefault()
        setPick(next.key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, item?.key])

  const run = async (fn: () => unknown, done: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      setNote(done)
    } catch (e) {
      setNote((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revise = async (it: InboxItem): Promise<void> => {
    await window.workspace.runs.enqueue({ prompt: revisionPrompt(it.prompt, it.files, feedback), label: `Revise: ${it.title}`, agentName: it.agentName, origin: 'background', contextFiles: it.files })
    if (it.runId) reviewStore.resolveRun(it.runId, 'kept')
  }

  const again = async (it: InboxItem): Promise<void> => {
    await window.workspace.runs.enqueue({ prompt: it.prompt ?? '', label: `Again: ${it.title}`, agentName: it.agentName, origin: 'background' })
    onDismiss(it.key)
  }

  if (!items.length) {
    return (
      <div className={styles.empty} data-testid="inbox-view" data-count={0}>
        <div className={styles.emptyMark}>✓</div>
        <div className={styles.emptyTitle}>Nothing is waiting on you</div>
        <p className={styles.emptyText}>Questions, results to review and anything that went wrong will appear here.</p>
      </div>
    )
  }

  return (
    <div className={styles.inbox} data-testid="inbox-view" data-count={items.length}>
      <div className={styles.fan}>
        {items.map((it, i) => (
          <Card key={it.key} item={it} i={i} selected={it.key === item?.key} onPick={() => setPick(it.key)} />
        ))}
      </div>

      {item && (
        <div ref={main} className={styles.main} data-kind={item.kind} data-testid="inbox-main">
          <header className={styles.head}>
            <AgentAvatar seed={item.agentName ?? item.who} size={44} />
            <div className={styles.headText}>
              <div className={styles.headWho}>{item.who}</div>
              <div className={styles.headMeta}>
                {KIND_LABEL[item.kind]} · {ago(item.at)}
              </div>
            </div>
          </header>

          <h2 className={styles.title}>{item.title}</h2>
          {item.text && <p className={styles.sub}>{item.text}</p>}

          {item.kind === 'review' && (
            <div className={styles.body}>
              {preview ? <pre className={styles.preview}>{preview}</pre> : null}
              {item.files.length > 0 && (
                <div className={styles.files}>
                  {item.files.map((f) => (
                    <button key={f} className={styles.file} onClick={() => act.openFile(f)}>
                      <FileText size={14} /> {f.split('/').pop()} <ArrowUpRight size={13} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className={styles.spacer} />
          {note && (
            <p className={styles.note} role="status">
              {note}
            </p>
          )}

          <footer className={styles.actions}>
            {item.kind === 'question' && item.sessionId && !item.requestId && (
              <>
                <button className={styles.primary} disabled={busy} onClick={() => run(() => reviewStore.respondHitl(item.sessionId!, 'allow-once'), 'Approved once.')}>
                  <Check size={14} /> Allow once
                </button>
                <button className={styles.btn} disabled={busy} onClick={() => run(() => reviewStore.respondHitl(item.sessionId!, 'allow-session'), 'Allowed for this session.')}>
                  Allow for this session
                </button>
                <button className={styles.btn} disabled={busy} onClick={() => run(() => reviewStore.respondHitl(item.sessionId!, 'deny'), 'Denied.')}>
                  <X size={14} /> Deny
                </button>
              </>
            )}
            {item.kind === 'question' && item.requestId && <p className={styles.hint}>Answer in the Codex request at the bottom right of the window.</p>}

            {item.kind === 'review' && (
              <>
                <button className={styles.primary} disabled={busy} onClick={() => run(() => act.keep(item.runId), 'Accepted.')} data-testid="inbox-accept">
                  <Check size={14} /> Mark accepted
                </button>
                {item.revertible && (
                  <button className={styles.btn} disabled={busy} onClick={() => run(() => act.revert(item.runId), 'Reverted to before the run.')}>
                    <RotateCcw size={14} /> Revert
                  </button>
                )}
                <label className={styles.revise}>
                  <input value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="What should change?" data-testid="inbox-feedback" />
                  <button
                    className={styles.send}
                    disabled={busy || !feedback.trim()}
                    onClick={() => run(() => revise(item), `Revision sent — ${item.who} continues on the same files.`)}
                    aria-label="Send revision"
                    data-testid="inbox-revise"
                  >
                    <Send size={14} />
                  </button>
                </label>
              </>
            )}

            {item.kind === 'paused' && (
              <>
                <button className={styles.primary} disabled={busy} onClick={() => run(() => resumeRun(item.runId), `Resumed — ${item.who} continues where it stopped.`)} data-testid="inbox-resume">
                  <Play size={14} /> Resume
                </button>
                <button className={styles.btn} disabled={busy} onClick={() => run(() => act.stopPaused(item.runId), 'Stopped.')} data-testid="inbox-stop">
                  Stop
                </button>
              </>
            )}

            {(item.kind === 'error' || item.kind === 'interrupted') && (
              <>
                {item.prompt && (
                  <button className={styles.primary} disabled={busy} onClick={() => run(() => again(item), 'Started again.')}>
                    <Play size={14} /> Start again
                  </button>
                )}
                <button className={styles.btn} disabled={busy} onClick={() => onDismiss(item.key)} data-testid="inbox-dismiss">
                  Dismiss
                </button>
              </>
            )}
            <span className={styles.flex} />
            {item.runId && (
              <button className={styles.btn} onClick={() => act.openRail('agents')}>
                Open in the feed <ArrowUpRight size={13} />
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
