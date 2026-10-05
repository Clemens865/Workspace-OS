import { MessageCircle, Plus, X } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { useSessions } from '../session/SessionPane'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { ChatThread } from './ChatThread'
import { ChatComposer, useAttachments } from './ChatComposer'
import { chatSide, useChatSide } from './chatSideStore'
import { linkTarget } from './chatModel'
import styles from './ChatView.module.css'

/**
 * The chat beside the stage: the same conversation as in Chat, next to the
 * browser it is driving or the document it is about. What it makes opens on
 * the stage itself; "Chat" takes it home with its history and artifacts.
 */
export function ChatSide({ onHome }: { onHome: (sessionId: string | null) => void }): JSX.Element | null {
  useSessions()
  const { open, sessionId } = useChatSide()
  const root = useWorkspaceRoot()
  const att = useAttachments()
  if (!open) return null
  const session = sessionStore.get(sessionId)
  const live = sessionStore.live(sessionId)

  const openFile = (path: string): void => {
    window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
  }
  const onLink = (href: string): void => {
    const t = linkTarget(href, root)
    if ('web' in t) {
      window.dispatchEvent(new CustomEvent('wos:browser-open', { detail: { url: t.web } }))
      window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail: 'browser' } }))
    } else openFile(t.file)
  }

  return (
    <aside className={`${styles.side} ${att.dragging ? styles.dropping : ''}`} data-testid="chat-side" data-session={sessionId ?? 'new'} {...att.dropProps}>
      <div className={styles.sideHead}>
        <button type="button" className={styles.ghostBtn} onClick={() => onHome(sessionId)} title="Back to Chat, with the history and what it made" data-testid="chat-side-home">
          <MessageCircle size={13} /> Chat
        </button>
        <span className={styles.sideTitle} title={session?.title}>
          {session?.title ?? 'New chat'}
        </span>
        <button type="button" className={styles.iconBtn} onClick={() => chatSide.show(null)} title="New chat" aria-label="New chat" data-testid="chat-side-new">
          <Plus size={15} />
        </button>
        <button type="button" className={styles.iconBtn} onClick={() => chatSide.close()} aria-label="Close" data-testid="chat-side-close">
          <X size={15} />
        </button>
      </div>
      <ChatThread session={session} live={live} openArtifact={null} onArtifact={openFile} onLink={onLink} />
      <ChatComposer session={session} att={att} onCreated={(id) => chatSide.adopt(id)} />
    </aside>
  )
}
