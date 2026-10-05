import { useEffect, useMemo, useRef, useState } from 'react'
import { PanelRight, Plus, Search } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { useSessions } from '../session/SessionPane'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { useGlass } from '../backdrop/useBackdrop'
import { ChatThread } from './ChatThread'
import { ArtifactPanel } from './ArtifactPanel'
import { ChatComposer, useAttachments } from './ChatComposer'
import { artifactKind, historyGroups, linkTarget } from './chatModel'
import styles from './ChatView.module.css'

/** Files a reply can show beside the chat (the rest open on the stage). */
export const previewable = (p: string): boolean => !['office', 'pdf', 'other'].includes(artifactKind(p))

interface Props {
  /** A web link: open it in the in-app browser, with this conversation beside it. */
  onOpenUrl: (url: string, sessionId: string | null) => void
  /** Take this conversation to the side of the stage. */
  onBeside: (sessionId: string | null) => void
  /** Open with this conversation (back from beside the stage). */
  initialSession?: string | null
}

/**
 * Chat (the dock's second item): conversations like Claude Desktop's, on the
 * same engine as every session. History on the left (every conversation in
 * the workspace, searchable by what was said), the conversation in the middle,
 * and what it made on the right. Files come in by the clip, by dropping them
 * from Finder or by pasting; the run reads them where they land.
 */
export function ChatView({ onOpenUrl, onBeside, initialSession = null }: Props): JSX.Element {
  useSessions()
  const root = useWorkspaceRoot()
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  const [activeId, setActiveId] = useState<string | null>(() => initialSession ?? sessionStore.list().find((s) => s.kind === 'chat')?.id ?? null)
  const [query, setQuery] = useState('')
  const [artifact, setArtifact] = useState<string | null>(null)
  const att = useAttachments()

  const session = sessionStore.get(activeId)
  const live = sessionStore.live(activeId)
  const groups = historyGroups(sessionStore.list(), Date.now(), query)

  // What a reply makes opens beside it as it arrives (like an artifact in Claude).
  const made = useMemo(() => session?.messages.flatMap((m) => m.files ?? []).filter(previewable) ?? [], [session])
  const newest = made[made.length - 1] ?? null
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (newest && newest !== seen.current && live.running) setArtifact(newest)
    seen.current = newest
  }, [newest, live.running])
  useEffect(() => {
    setArtifact(null)
    att.setAttachments([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const onLink = (href: string): void => {
    const t = linkTarget(href, root)
    if ('web' in t) onOpenUrl(t.web, activeId)
    else if (previewable(t.file)) setArtifact(t.file)
    else window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: t.file } }))
  }

  return (
    <div className={styles.chat} data-testid="chat-view">
      <div ref={panel} className={`${styles.panel} ${artifact ? styles.withArtifact : ''}`}>
        <nav className={styles.history} aria-label="Conversations" data-testid="chat-history">
          <button
            type="button"
            className={styles.newBtn}
            onClick={() => {
              setActiveId(null)
              setQuery('')
            }}
            data-testid="chat-new"
          >
            <Plus size={15} /> New chat
          </button>
          <label className={styles.find}>
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" data-testid="chat-search" />
          </label>
          <div className={styles.historyList}>
            {groups.map((g) => (
              <section key={g.label}>
                <h3 className={styles.groupLabel}>{g.label}</h3>
                {g.items.map((s) => (
                  <button key={s.id} type="button" className={`${styles.historyItem} ${s.id === activeId ? styles.historyOn : ''}`} onClick={() => setActiveId(s.id)} data-chat-item={s.id} title={s.title}>
                    <span className={styles.historyTitle}>{s.title}</span>
                    {s.kind !== 'chat' && <span className={styles.historyAgent}>{s.agentName ? s.agentName.split(' — ')[0] : 'Session'}</span>}
                    {sessionStore.live(s.id).running && <span className={styles.dot} aria-label="working" />}
                  </button>
                ))}
              </section>
            ))}
            {!groups.length && <p className={styles.quiet}>{query ? 'No chat says that.' : 'Your conversations will be here.'}</p>}
          </div>
        </nav>

        <section className={`${styles.main} ${att.dragging ? styles.dropping : ''}`} {...att.dropProps}>
          <button type="button" className={styles.besideBtn} onClick={() => onBeside(activeId)} title="Keep this chat beside your work (the browser, a document…)" data-testid="chat-beside">
            <PanelRight size={14} /> Beside your work
          </button>
          <ChatThread session={session} live={live} openArtifact={artifact} onArtifact={(p) => (previewable(p) ? setArtifact(p) : window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: p } })))} onLink={onLink} />
          <ChatComposer session={session} att={att} onCreated={setActiveId} />
        </section>

        {artifact && <ArtifactPanel path={artifact} stamp={session?.lastAt ?? 0} onClose={() => setArtifact(null)} />}
      </div>
    </div>
  )
}
