import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, Send, BookOpen, Mail, Phone, Globe, ShieldCheck } from 'lucide-react'
import { useSettings } from '../../hooks/useSettings'
import styles from './PageAssistant.module.css'
import { PageActions } from './PageActions'
import type { ActionId, PageSignals } from './page-actions'

/**
 * The Browser surface's page-aware assistant panel.
 *
 * Two reads, both against the ALREADY-loaded webview via the existing
 * `window.workspace.browser.*` bridge — no new IPC:
 *   - "Deep-read this site" → browser.deepRead({url}) → a rendered profile
 *     (homepage/title, pages it read, and contact chips).
 *   - "Ask about this page"  → browser.extract({mode:'text'}) for the page
 *     text, then streams an answer through window.workspace.agent.run
 *     (mirroring TerminalAgentPane's run + onOutput/onDone bubble streaming).
 *
 * Reading is safe & local; nothing here changes anything, so nothing needs
 * approval. The agent's own actions (elsewhere) still ask first.
 */

interface Props {
  currentUrl: string
  /** What the page contains — drives which actions are offered. */
  signals: PageSignals
  /** Actions the BROWSER owns (find, zoom, bookmark, pdf, history). */
  onBrowserAction: (id: ActionId) => void
}

type Profile = NonNullable<
  Awaited<ReturnType<Window['workspace']['browser']['deepRead']>>['profile']
>

type QA = { question: string; answer: string }

const MAX_PAGE_CHARS = 6000
const newRunId = (): string => `pa-run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`

/** Read the extracted page text out of the extract() payload, whatever shape. */
function pageTextFrom(data: unknown): string {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object' && 'text' in data) {
    const t = (data as { text?: unknown }).text
    if (typeof t === 'string') return t
  }
  return ''
}

export function PageAssistant({ currentUrl, signals, onBrowserAction }: Props): JSX.Element {
  const settings = useSettings()
  const hasPage = !!currentUrl

  // Deep-read state.
  const [reading, setReading] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [notes, setNotes] = useState<string[]>([])
  const [readError, setReadError] = useState<string | null>(null)

  // Ask-composer state.
  const [draft, setDraft] = useState('')
  const [asking, setAsking] = useState(false)
  const [scrollback, setScrollback] = useState<QA[]>([])
  const runRef = useRef<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  // Stream agent chunks into the trailing answer — mirrors TerminalAgentPane.
  useEffect(() => {
    const offOutput = window.workspace.agent.onOutput((runId, chunk) => {
      if (runId !== runRef.current) return
      setScrollback((prev) => {
        if (!prev.length) return prev
        const next = prev.slice()
        next[next.length - 1] = { ...next[next.length - 1], answer: next[next.length - 1].answer + chunk }
        return next
      })
    })
    const offDone = window.workspace.agent.onDone((runId, code) => {
      if (runId !== runRef.current) return
      if (code !== 0) {
        setScrollback((prev) => {
          if (!prev.length) return prev
          const next = prev.slice()
          const last = next[next.length - 1]
          if (!last.answer) next[next.length - 1] = { ...last, answer: `[agent exited with code ${code}]` }
          return next
        })
      }
      runRef.current = null
      setAsking(false)
    })
    return () => {
      offOutput()
      offDone()
    }
  }, [])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [scrollback])

  const deepRead = useCallback(async () => {
    if (!currentUrl || reading) return
    setReading(true)
    setReadError(null)
    try {
      const res = await window.workspace.browser.deepRead({ url: currentUrl })
      if (res.ok && res.profile) {
        setProfile(res.profile)
        setNotes(res.notes ?? [])
      } else {
        setReadError(res.error ?? 'Could not read this site.')
      }
    } catch (err) {
      setReadError((err as Error).message)
    } finally {
      setReading(false)
    }
  }, [currentUrl, reading])

  /**
   * Runs an agent task about the current page.
   *
   * Factored out of ask() so a one-click action and a typed question take the
   * same path: same scrollback, same streaming, same failure handling. A second
   * implementation would drift, and the panel would behave differently
   * depending on how the work was started.
   */
  const runAgentTask = useCallback(
    async (shown: string, buildPrompt: (pageText: string) => string) => {
      if (asking || !currentUrl) return
      setAsking(true)
      setScrollback((prev) => [...prev, { question: shown, answer: '' }])
      const runId = newRunId()
      runRef.current = runId
      try {
        const ex = await window.workspace.browser.extract('text')
        const pageText = (ex.ok ? pageTextFrom(ex.data) : '').slice(0, MAX_PAGE_CHARS)
        await window.workspace.agent.run(runId, buildPrompt(pageText), [], null, settings.agentMode, null, runId)
      } catch (err) {
        setScrollback((prev) => {
          const next = prev.slice()
          if (next.length) next[next.length - 1] = { ...next[next.length - 1], answer: `[error] ${(err as Error).message}` }
          return next
        })
        runRef.current = null
        setAsking(false)
      }
    },
    [asking, currentUrl, settings.agentMode],
  )

  const composerRef = useRef<HTMLTextAreaElement>(null)

  /**
   * One entry point for every offered action.
   *
   * Agent work is handled here (the plumbing lives here); anything the BROWSER
   * owns — find, zoom, bookmark, pdf, history — is delegated upward rather than
   * reaching across into the webview from the panel.
   */
  const runAction = useCallback(
    (id: ActionId) => {
      switch (id) {
        case 'deep-read':
          void deepRead()
          break
        case 'summarise':
          void runAgentTask('Summarise this page', (t) =>
            `Summarise this web page for someone who has not read it.\n\nURL: ${currentUrl}\n\n${t}\n\n` +
            `Lead with what it is and why it matters, then the specifics. Use only what is on the page.`)
          break
        case 'table-to-sheet':
          void runAgentTask('Turn the table into a spreadsheet', (t) =>
            `The page below contains one or more data tables.\n\nURL: ${currentUrl}\n\n${t}\n\n` +
            `Extract every data table and write them to a .xlsx file in the workspace, one sheet per table, ` +
            `with the original header row preserved. Tell me where you saved it.`)
          break
        case 'ask':
          composerRef.current?.focus()
          break
        default:
          onBrowserAction(id)
      }
    },
    [currentUrl, deepRead, runAgentTask, onBrowserAction],
  )

  const ask = useCallback(async () => {
    const question = draft.trim()
    if (!question || asking || !currentUrl) return
    setDraft('')
    setAsking(true)
    setScrollback((prev) => [...prev, { question, answer: '' }])
    const runId = newRunId()
    runRef.current = runId
    try {
      const ex = await window.workspace.browser.extract('text')
      const pageText = (ex.ok ? pageTextFrom(ex.data) : '').slice(0, MAX_PAGE_CHARS)
      const prompt =
        `You are looking at the web page: ${currentUrl}\n\n` +
        `Page content:\n${pageText}\n\n` +
        `Question: ${question}\n\n` +
        `Answer using only what's on this page; say so if it's not there.`
      await window.workspace.agent.run(runId, prompt, [], null, settings.agentMode, null, runId)
    } catch (err) {
      setScrollback((prev) => {
        const next = prev.slice()
        if (next.length) next[next.length - 1] = { ...next[next.length - 1], answer: `[error] ${(err as Error).message}` }
        return next
      })
      runRef.current = null
      setAsking(false)
    }
  }, [draft, asking, currentUrl, settings.agentMode])

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void ask()
    }
  }

  const hasContacts =
    !!profile && (profile.emails.length > 0 || profile.phones.length > 0 || profile.socials.length > 0)

  return (
    <aside className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.title}>
          <Sparkles className={styles.titleIc} size={18} /> Assistant
        </div>
        <p className={styles.subtitle}>Reads the page you're on — ask anything, or pull a full profile.</p>
      </div>

      <div className={styles.body}>
        <PageActions signals={signals} onRun={runAction} busy={asking ? 'summarise' : null} />

        {!hasPage && (
          <div className={styles.empty}>Open a page in the address bar first, then I can read it for you.</div>
        )}

        {/* Deep-read */}
        <button className={styles.primary} onClick={() => void deepRead()} disabled={!hasPage || reading}>
          {reading ? (
            <>
              <span className={styles.spinner} /> Reading…
            </>
          ) : (
            <>
              <BookOpen size={15} /> Deep-read this site
            </>
          )}
        </button>
        {reading && <div className={styles.hint}>This can take up to a minute — reading the listed pages.</div>}
        {readError && <div className={styles.readError}>{readError}</div>}

        {profile && (
          <div className={styles.profile}>
            <div className={styles.pName}>{profile.title || profile.name || profile.homepage}</div>
            {profile.homepage && (
              <a className={styles.pHome} href={profile.homepage} target="_blank" rel="noreferrer">
                {profile.homepage}
              </a>
            )}

            {profile.pages.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sHead}>Pages read</div>
                <ul className={styles.pages}>
                  {profile.pages.map((p, i) => (
                    <li key={i} className={styles.pageRow}>
                      <span className={styles.cat}>{p.category}</span>
                      <span className={styles.pageTitle}>{p.title || p.url}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className={styles.section}>
              <div className={styles.sHead}>Contact</div>
              {hasContacts ? (
                <div className={styles.chips}>
                  {profile.emails.map((e) => (
                    <span key={e} className={styles.chip}>
                      <Mail size={12} /> {e}
                    </span>
                  ))}
                  {profile.phones.map((p) => (
                    <span key={p} className={styles.chip}>
                      <Phone size={12} /> {p}
                    </span>
                  ))}
                  {profile.socials.map((s) => (
                    <span key={s} className={styles.chip}>
                      <Globe size={12} /> {s}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={styles.muted}>No contact details found on the listed pages.</div>
              )}
            </div>

            {notes.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sHead}>Notes</div>
                {notes.map((n, i) => (
                  <div key={i} className={styles.note}>
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Ask composer + scrollback */}
        {scrollback.length > 0 && (
          <div className={styles.log} ref={logRef}>
            {scrollback.map((qa, i) => (
              <div key={i} className={styles.qa}>
                <div className={styles.q}>› {qa.question}</div>
                <div className={styles.a}>
                  {qa.answer || <span className={styles.typing}>thinking…</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.composer}>
        <textarea
          ref={composerRef}
          className={styles.input}
          rows={2}
          placeholder="Ask about this page…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!hasPage}
        />
        <button className={styles.send} onClick={() => void ask()} disabled={!hasPage || asking || !draft.trim()}>
          <Send size={13} />
        </button>
      </div>

      <div className={styles.safety}>
        <ShieldCheck size={13} /> Reading is safe &amp; local. Actions that change things always ask first.
      </div>
    </aside>
  )
}
