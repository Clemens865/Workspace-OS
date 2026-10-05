import { useEffect, useRef, useState } from 'react'
import { Paperclip, Square, X } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import type { Session } from '../../../lib/sessions/sessionModel'
import { PromptBar } from '../../PromptBar/PromptBar'
import { toast } from '../toastStore'
import { baseName } from './chatModel'
import styles from './ChatView.module.css'

/**
 * Files on their way into a chat: uploaded as bytes (the clip, a drop from
 * Finder, a paste), or a workspace file dragged from the tree, attached where
 * it is. Shared by the Chat view and the chat beside the stage.
 */
export function useAttachments(): {
  attachments: string[]
  uploading: number
  setAttachments: React.Dispatch<React.SetStateAction<string[]>>
  upload: (files: File[]) => Promise<void>
  dropProps: { onDragOver: (e: React.DragEvent) => void; onDragLeave: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void; onPaste: (e: React.ClipboardEvent) => void }
  dragging: boolean
} {
  const [attachments, setAttachments] = useState<string[]>([])
  const [uploading, setUploading] = useState(0)
  const [dragging, setDragging] = useState(false)

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

  const dropProps = {
    onDragOver: (e: React.DragEvent): void => {
      if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-wos-path')) {
        e.preventDefault()
        setDragging(true)
      }
    },
    onDragLeave: (e: React.DragEvent): void => {
      if (e.currentTarget === e.target) setDragging(false)
    },
    onDrop: (e: React.DragEvent): void => {
      setDragging(false)
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
    },
    onPaste: (e: React.ClipboardEvent): void => {
      const files = [...e.clipboardData.files]
      if (files.length) {
        e.preventDefault()
        void upload(files)
      }
    },
  }
  return { attachments, uploading, setAttachments, upload, dropProps, dragging }
}

interface Props {
  session: Session | undefined
  att: ReturnType<typeof useAttachments>
  /** A first message started a new conversation. */
  onCreated: (id: string) => void
  /** Said before the person's words on every message (e.g. what page they are on). */
  preamble?: () => string | undefined
}

/** The input of a chat: what is attached, the clip, the message, and Stop. */
export function ChatComposer({ session, att, onCreated, preamble }: Props): JSX.Element {
  const live = sessionStore.live(session?.id)
  const picker = useRef<HTMLInputElement>(null)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])
  const { attachments, uploading, setAttachments, upload } = att

  const send = (text: string, mentions: string[]): void => {
    let prompt = text
    const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
    if (slash && skills.some((k) => k.name === slash[1])) prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
    let id = session?.id
    if (!id) {
      id = sessionStore.create({ kind: 'chat' }).id
      onCreated(id)
    }
    const files = attachments
    setAttachments([])
    void sessionStore.send(id, prompt, mentions, { attachments: files, preamble: preamble?.() })
  }

  return (
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
  )
}
