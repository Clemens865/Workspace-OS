import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, Plus, Search, Square, X } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { useSessions } from '../session/SessionPane'
import { PromptBar } from '../../PromptBar/PromptBar'
import { useWorkspaceRoot } from '../../../hooks/useWorkspaceRoot'
import { useGlass } from '../backdrop/useBackdrop'
import { toast } from '../toastStore'
import { ChatThread } from './ChatThread'
import { ArtifactPanel } from './ArtifactPanel'
import { artifactKind, baseName, historyGroups, linkTarget } from './chatModel'
import styles from './ChatView.module.css'

/** Files a reply can show beside the chat (the rest open on the stage). */
const previewable = (p: string): boolean => !['office', 'pdf', 'other'].includes(artifactKind(p))

/**
 * Chat (the dock's second item): conversations like Claude Desktop's, on the
 * same engine as every session. History on the left (every conversation in
 * the workspace, searchable by what was said), the conversation in the middle,
 * and what it made on the right. Files come in by the clip, by dropping them
 * from Finder or by pasting; the run reads them where they land.
 */
export function ChatView({ onOpenUrl }: { onOpenUrl: (url: string) => void }): JSX.Element {
  useSessions()
  const root = useWorkspaceRoot()
  const panel = useRef<HTMLDivElement>(null)
  useGlass(panel, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  const [activeId, setActiveId] = useState<string | null>(() => sessionStore.list().find((s) => s.kind === 'chat')?.id ?? null)
  const [query, setQuery] = useState('')
  const [artifact, setArtifact] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<string[]>([])
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  const session = sessionStore.get(activeId)
  const live = sessionStore.live(activeId)
  const groups = historyGroups(sessionStore.list(), Date.now(), query)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])

  // What a reply makes opens beside it as it arrives (like an artifact in Claude).
  const made = useMemo(() => session?.messages.flatMap((m) => m.files ?? []).filter(previewable) ?? [], [session])
  const newest = made[made.length - 1] ?? null
  const seen = useRef<string | null>(null)
  useEffect(() => {
    if (newest && newest !== seen.current && live.running) setArtifact(newest)
    seen.current = newest
  }, [newest, live.running])
  // A different conversation: its own artifact, if it made one.
  useEffect(() => {
    setArtifact(null)
    setAttachments([])
  }, [activeId])

  const upload = async (files: File[]): Promise<void> => {
    if (!files.length) return
    setUploading((n) => n + files.length)
    for (const f of files) {
      try {
        const name = f.name || `Pasted ${new Date().toLocaleTimeString().replace(/:/g, '.')}.${(f.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`
        const r = await window.workspace.chat.upload(name, new Uint8Array(await f.arrayBuffer()))
        setAttachments((a) => [...a, r.path])
      } catch (e) {
        toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not attach that file.')
      } finally {
        setUploading((n) => n - 1)
      }
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    setDragging(false)
    // A file from the workspace's own tree is attached where it is; one from Finder is uploaded.
    const inside = e.dataTransfer.getData('application/x-wos-path')
    if (inside) {
      e.preventDefault()
      setAttachments((a) => (a.includes(inside) ? a : [...a, inside]))
      return
    }
    if (e.dataTransfer.files.length) {
      e.preventDefault()
      void upload([...e.dataTransfer.files])
    }
  }
  const onPaste = (e: React.ClipboardEvent): void => {
    const files = [...e.clipboardData.files]
    if (files.length) {
      e.preventDefault()
      void upload(files)
    }
  }

  const onLink = (href: string): void => {
    const t = linkTarget(href, root)
    if ('web' in t) onOpenUrl(t.web)
    else if (previewable(t.file)) setArtifact(t.file)
    else window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: t.file } }))
  }

  const send = (text: string, mentions: string[]): void => {
    let prompt = text
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
    if (slash && skills.some((k) => k.name === slash[1])) prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
    let id = session?.id
    if (!id) {
      id = sessionStore.create({ kind: 'chat' }).id
      setActiveId(id)
    }
    const files = attachments
    setAttachments([])
    void sessionStore.send(id, prompt, mentions, { attachments: files })
  }

  const newChat = (): void => {
    setActiveId(null)
    setQuery('')
  }

  return (
    <div className={styles.chat} data-testid="chat-view">
      <div ref={panel} className={`${styles.panel} ${artifact ? styles.withArtifact : ''}`}>
        <nav className={styles.history} aria-label="Conversations" data-testid="chat-history">
          <button type="button" className={styles.newBtn} onClick={newChat} data-testid="chat-new">
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

        <section
          className={`${styles.main} ${dragging ? styles.dropping : ''}`}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-wos-path')) {
              e.preventDefault()
              setDragging(true)
            }
          }}
          onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
          onDrop={onDrop}
          onPaste={onPaste}
        >
          <ChatThread session={session} live={live} openArtifact={artifact} onArtifact={(p) => (previewable(p) ? setArtifact(p) : window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path: p } })))} onLink={onLink} />

          <div className={styles.composer}>
            {(attachments.length > 0 || uploading > 0) && (
              <div className={styles.attachments} data-testid="chat-attachments">
                {attachments.map((f) => (
                  <span key={f} className={styles.fileChip} title={f} data-attachment={baseName(f)}>
                    <Paperclip size={11} /> {baseName(f)}
                    <button type="button" className={styles.chipX} onClick={() => setAttachments((a) => a.filter((x) => x !== f))} aria-label={`Remove ${baseName(f)}`}>
                      <X size={11} />
                    </button>
                  </span>
                ))}
                {uploading > 0 && <span className={styles.quietSmall}>Attaching…</span>}
              </div>
            )}
            <div className={styles.inputRow}>
              <button type="button" className={styles.iconBtn} onClick={() => picker.current?.click()} title="Attach files" aria-label="Attach files" data-testid="chat-attach">
                <Paperclip size={16} />
              </button>
              <input
                ref={picker}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void upload([...(e.target.files ?? [])])
                  e.target.value = ''
                }}
                data-testid="chat-file-input"
              />
              <div className={styles.prompt}>
                <PromptBar
                  placeholder={live.running ? 'Working…' : 'Message… (@ a file, / a skill)'}
                  disabled={live.running || uploading > 0}
                  commands={skills.map((k) => ({ name: k.name, hint: k.description }))}
                  onSubmit={send}
                />
              </div>
              {live.running && (
                <button type="button" className={styles.stop} onClick={() => session && void sessionStore.stop(session.id)} title="Stop" aria-label="Stop" data-testid="chat-stop">
                  <Square size={12} />
                </button>
              )}
            </div>
          </div>
        </section>

        {artifact && <ArtifactPanel path={artifact} stamp={session?.lastAt ?? 0} onClose={() => setArtifact(null)} />}
      </div>
    </div>
  )
}
