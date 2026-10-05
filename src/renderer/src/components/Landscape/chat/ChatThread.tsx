import { memo, useEffect, useMemo, useRef } from 'react'
import { Paperclip } from 'lucide-react'
import type { Session } from '../../../lib/sessions/sessionModel'
import { sessionStore, type SessionLive } from '../../../lib/sessions/sessionStore'
import { chatMarkdown } from '../../../lib/chatMarkdown'
import { RunTrace } from '../../AgentTerminal/RunTrace'
import { FileThumb } from '../../FilePanel/FileThumb'
import { baseName } from './chatModel'
import styles from './ChatView.module.css'

/** One reply, rendered once per change of its text. */
const Reply = memo(function Reply({ text }: { text: string }): JSX.Element {
  const html = useMemo(() => chatMarkdown(text), [text])
  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: html }} />
})

interface Props {
  session: Session | undefined
  live: SessionLive
  /** The artifact open beside the thread. */
  openArtifact: string | null
  onArtifact: (path: string) => void
  /** A link in a reply: data-chat-link's value. */
  onLink: (href: string) => void
  /** What an empty conversation says (the app builder has its own). */
  welcome?: { title: string; text: string }
}

/**
 * The conversation: the person's messages (with what they attached), the
 * replies as formatted text, and under each reply the things it made.
 */
export function ChatThread({ session, live, openArtifact, onArtifact, onLink, welcome }: Props): JSX.Element {
  const log = useRef<HTMLDivElement>(null)
  const last = session?.messages[session.messages.length - 1]
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [session?.id, session?.messages.length, last?.text.length])

  // Copy buttons and links inside rendered replies.
  const onClick = (e: React.MouseEvent): void => {
    const t = e.target as HTMLElement
    const copy = t.closest('[data-chat-copy]')
    if (copy) {
      const code = copy.closest(`.chat-code`)?.querySelector('code')?.textContent ?? ''
      void navigator.clipboard.writeText(code).then(() => {
        copy.textContent = 'Copied'
        window.setTimeout(() => (copy.textContent = 'Copy'), 1400)
      })
      return
    }
    const link = t.closest('[data-chat-link]')
    if (link) {
      e.preventDefault()
      onLink(link.getAttribute('data-chat-link') ?? '')
    }
  }

  if (!session || session.messages.length === 0) {
    return (
      <div ref={log} className={styles.thread} data-testid="chat-thread">
        <div className={styles.welcome}>
          <h2 className={styles.welcomeTitle}>{welcome?.title ?? 'What’s on your mind?'}</h2>
          <p className={styles.quiet}>{welcome?.text ?? 'Ask anything. Attach files or drop them here, ask it to look something up in the browser, or to make a page, a diagram or a document. What it makes opens beside the chat.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div ref={log} className={styles.thread} onClick={onClick} data-testid="chat-thread">
      {session.messages.map((m, i) =>
        m.role === 'user' ? (
          <div key={i} className={styles.you} data-role="user">
            {!!m.files?.length && (
              <div className={styles.attached}>
                {m.files.map((f) => (
                  <span key={f} className={styles.fileChip} title={f}>
                    <Paperclip size={11} /> {baseName(f)}
                  </span>
                ))}
              </div>
            )}
            <div className={styles.youText}>{m.text}</div>
          </div>
        ) : m.role === 'agent' ? (
          <div key={i} className={styles.reply} data-role="agent">
            {m.text ? <Reply text={m.text} /> : live.running && i === session.messages.length - 1 ? <span className={styles.typing}>…</span> : null}
            {!!m.files?.length && (
              <div className={styles.made}>
                {m.files.map((f) => (
                  <button key={f} type="button" className={`${styles.madeCard} ${openArtifact === f ? styles.madeOn : ''}`} onClick={() => onArtifact(f)} data-chat-artifact={baseName(f)}>
                    <FileThumb entry={{ name: baseName(f), path: f, isDirectory: false }} size={28} />
                    <span className={styles.madeName}>{baseName(f)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div key={i} className={styles.system} data-role="system">
            {m.text}
            {m.suggest && m.suggest.length > 0 && (
              // Next steps from the app harness's review: one click asks for it.
              <div className={styles.suggest} data-testid="chat-suggest">
                {m.suggest.map((s) => (
                  <button key={s} type="button" className={styles.suggestBtn} disabled={live.running} onClick={() => void sessionStore.send(session.id, s)} data-suggest={s}>
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}
      {live.running && last?.role === 'user' && <span className={styles.typing}>…</span>}
      {(live.running || live.steps.length > 0) && live.steps.length > 0 && (
        <div className={styles.trace}>
          <RunTrace steps={live.steps} busy={live.running} onOpenFile={onArtifact} />
        </div>
      )}
    </div>
  )
}
