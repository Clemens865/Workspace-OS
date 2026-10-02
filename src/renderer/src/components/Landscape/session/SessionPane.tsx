import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BookmarkPlus, FolderOpen, Square } from 'lucide-react'
import { sessionStore } from '../../../lib/sessions/sessionStore'
import { RunTrace } from '../../AgentTerminal/RunTrace'
import { PromptBar } from '../../PromptBar/PromptBar'
import { FileThumb } from '../../FilePanel/FileThumb'
import { toast } from '../toastStore'
import styles from './SessionPane.module.css'

const openFile = (path: string): void => {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

/** Re-renders with the session store. */
export function useSessions(): number {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.getVersion, sessionStore.getVersion)
}

interface Props {
  /** The session shown; null = a fresh one, created on the first ask. */
  sessionId: string | null
  /** For a fresh session: who it runs as, and the case it continues. */
  agentName?: string | null
  caseId?: string | null
  /** A fresh session was created (the first ask). */
  onCreated?: (id: string) => void
  /** Open the session's case in Cases. */
  onOpenCase?: (caseId: string) => void
  placeholder?: string
}

/**
 * One working session, in the landscape: the conversation with Claude or
 * Codex, the steps it is taking, the files it made, and the input. Keeping it
 * as a case (the workspace's memory) is offered here when the setting says so,
 * or always available by hand.
 */
export function SessionPane({ sessionId, agentName = null, caseId = null, onCreated, onOpenCase, placeholder }: Props): JSX.Element | null {
  useSessions()
  const found = sessionStore.get(sessionId)
  // Before the first ask there is nothing to keep: show an empty session, create it on send.
  const s = found ?? { id: '', title: caseId ? 'Continue the case' : 'New session', agentName, caseId, createdAt: 0, lastAt: 0, turns: 0, files: [], lastRunId: null, messages: [] }
  const live = sessionStore.live(sessionId)
  const log = useRef<HTMLDivElement>(null)
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([])
  useEffect(() => {
    window.workspace.skills.list().then(setSkills).catch(() => {})
  }, [])
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [s?.messages.length, s?.messages[s.messages.length - 1]?.text.length])

  const suggest = !!found && sessionStore.suggests(found.id)

  const keep = async (): Promise<void> => {
    if (!found) return
    const id = await sessionStore.keepAsCase(found.id)
    if (id) toast(`Kept as a case: ${s.title}`)
  }

  return (
    <div className={styles.pane} data-testid="session-pane" data-session={s.id || 'new'} data-running={live.running ? 'true' : 'false'}>
      <div className={styles.head}>
        <span className={styles.title} title={s.title}>
          {s.title}
        </span>
        {s.caseId ? (
          <button type="button" className={styles.caseChip} onClick={() => onOpenCase?.(s.caseId!)} data-testid="session-case" title="Open the case">
            <FolderOpen size={12} /> Case
          </button>
        ) : (
          s.turns > 0 && (
            <button type="button" className={styles.keepBtn} onClick={() => void keep()} data-testid="session-keep" title="Keep this session as a case: its asks, outcomes and files are remembered">
              <BookmarkPlus size={13} /> Keep as a case
            </button>
          )
        )}
      </div>

      <div ref={log} className={styles.log} data-testid="session-log">
        {s.messages.length === 0 && <p className={styles.empty}>{placeholder ?? 'What should get done? Ask in your own words; @ adds a file, / a skill.'}</p>}
        {s.messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? styles.you : m.role === 'agent' ? styles.agent : styles.system} data-role={m.role}>
            {m.text || (m.role === 'agent' && live.running && i === s.messages.length - 1 ? '…' : m.text)}
          </div>
        ))}
      </div>

      {(live.running || live.steps.length > 0) && (
        <div className={styles.trace}>
          <RunTrace steps={live.steps} busy={live.running} onOpenFile={openFile} />
        </div>
      )}

      {s.files.length > 0 && (
        <div className={styles.files} data-testid="session-files">
          {s.files.slice(-6).map((f) => (
            <button key={f} type="button" className={styles.file} onClick={() => openFile(f)} title={f} data-file={f.split('/').pop()}>
              <FileThumb entry={{ name: f.split('/').pop() ?? f, path: f, isDirectory: false }} size={20} />
              <span>{f.split('/').pop()}</span>
            </button>
          ))}
        </div>
      )}

      {suggest && (
        <div className={styles.suggest} data-testid="session-suggest">
          <span>This turned into real work. Keep it as a case, so it is remembered?</span>
          <button type="button" className={styles.primary} onClick={() => void keep()} data-testid="session-suggest-keep">
            Keep it
          </button>
          <button type="button" className={styles.quiet} onClick={() => found && sessionStore.dismissSuggestion(found.id)}>
            Not now
          </button>
        </div>
      )}

      <div className={styles.composer}>
        <PromptBar
          placeholder={live.running ? 'Working…' : 'Ask, or continue the work… @ file, / skill'}
          disabled={live.running}
          commands={skills.map((k) => ({ name: k.name, hint: k.description }))}
          onSubmit={(text, mentions) => {
            let prompt = text
            const slash = /^\/(\S+)\s*([\s\S]*)$/.exec(text.trim())
            if (slash && skills.some((k) => k.name === slash[1])) prompt = `Use the "${slash[1]}" skill.${slash[2] ? ' ' + slash[2] : ''}`
            let id = found?.id
            if (!id) {
              id = sessionStore.create({ agentName, caseId }).id
              onCreated?.(id)
            }
            void sessionStore.send(id, prompt, mentions)
          }}
        />
        {live.running && (
          <button type="button" className={styles.stop} onClick={() => found && void sessionStore.stop(found.id)} title="Stop" aria-label="Stop" data-testid="session-stop">
            <Square size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
