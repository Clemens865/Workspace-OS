import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CalendarDays, FileText, Globe, Mail, Send, Sparkles } from 'lucide-react'
import { useGlass } from '../backdrop/useBackdrop'
import { FileThumb } from '../../FilePanel/FileThumb'
import { agoLabel } from '../../Shell/home/homeModel'
import { eventWhen, type TodayGo } from './todayModel'
import { useToday } from './useToday'
import { useDeskAssistant } from './useDeskAssistant'
import styles from './TodayView.module.css'

interface Props {
  /** Follow a Today action (a case, the team, a stage surface). */
  onGo: (go: TodayGo) => void
  /** Open a url in the stage browser. */
  onOpenUrl: (url: string) => void
}

/** A glass card; the landscape's paper look when glass is off. */
function Card({ className, children, testid }: { className?: string; children: React.ReactNode; testid?: string }): JSX.Element {
  const ref = useRef<HTMLElement>(null)
  useGlass(ref, { radius: 20, bezel: 16, thickness: 32, frost: 0.4 })
  return (
    <section ref={ref} className={`${styles.card} ${className ?? ''}`} data-today={testid}>
      {children}
    </section>
  )
}

const openFile = (path: string): void => {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

/**
 * Today: the old Home dashboard in the landscape (ADOPTION.md B1). One loud
 * thing (the hero, with "Not now"), then what is next, mail that waits, what
 * happened while you were away, the files and pages you work with, and the
 * desk assistant on the right.
 */
export function TodayView({ onGo, onOpenUrl }: Props): JSX.Element {
  const { model, loading, desk, snooze, refresh } = useToday()
  const assistant = useDeskAssistant(model, desk, refresh)
  const [draft, setDraft] = useState('')
  const hero = useRef<HTMLDivElement>(null)
  const side = useRef<HTMLDivElement>(null)
  const log = useRef<HTMLDivElement>(null)
  useGlass(hero, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  useGlass(side, { radius: 26, bezel: 24, thickness: 46, frost: 0.82 })
  const now = Date.now()
  const h = model.hero

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight })
  }, [assistant.msgs])

  const send = (): void => {
    if (assistant.busy) return
    assistant.ask(draft)
    setDraft('')
  }

  return (
    <div className={styles.today} data-testid="today-view" data-loading={loading ? 'true' : 'false'}>
      <div className={styles.main}>
        <div ref={hero} className={styles.hero} data-testid="today-hero" data-kind={h.kind}>
          <div className={styles.kicker}>
            {h.kicker}
            {h.of > 1 && <span className={styles.of}> · 1 of {h.of}</span>}
          </div>
          <div className={styles.headline}>{h.headline}</div>
          <div className={styles.heroSub}>{h.sub}</div>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={() => onGo(h.go)} data-testid="today-hero-go">
              {h.primary.label}
            </button>
            {h.secondary && h.goSecondary && (
              <button type="button" className={styles.btn} onClick={() => onGo(h.goSecondary!)}>
                {h.secondary.label}
              </button>
            )}
            {h.caseId && (
              <button type="button" className={styles.quiet} onClick={() => snooze(h.caseId!)} data-testid="today-snooze">
                Not now
              </button>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          <Card testid="next">
            <div className={styles.label}>
              <CalendarDays size={13} /> Next
            </div>
            {model.next.length ? (
              <ul className={styles.list}>
                {model.next.map((e) => (
                  <li key={e.uid + e.start}>
                    <button type="button" className={styles.row} onClick={() => onGo({ to: 'surface', rail: 'calendar' })}>
                      <span className={styles.when}>{eventWhen(e, now)}</span>
                      <span className={styles.rowText}>{e.summary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.quietText}>Nothing in the next two days.</p>
            )}
            <button type="button" className={styles.link} onClick={() => onGo({ to: 'surface', rail: 'calendar' })}>
              Calendar <ArrowUpRight size={12} />
            </button>
          </Card>

          <Card testid="mail">
            <div className={styles.label}>
              <Mail size={13} /> Mail
            </div>
            {model.mail.waiting.length ? (
              <ul className={styles.list}>
                {model.mail.waiting.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={styles.row} onClick={() => onGo({ to: 'surface', rail: 'mail' })}>
                      <span className={styles.rowText}>{m.subject}</span>
                      <span className={styles.meta}>{m.from}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.quietText}>
                {model.mail.accounts
                  ? `${model.mail.accounts} account${model.mail.accounts === 1 ? '' : 's'} connected. Nothing waits for a reply.`
                  : 'No mail account yet.'}
              </p>
            )}
            <button type="button" className={styles.link} onClick={() => onGo({ to: 'surface', rail: 'mail' })}>
              Mail <ArrowUpRight size={12} />
            </button>
          </Card>

          <Card className={styles.wide} testid="away">
            <div className={styles.label}>While you were away</div>
            {model.away.length ? (
              <ul className={styles.feed}>
                {model.away.map((a, i) => (
                  <li key={`${a.at}-${i}`} data-kind={a.kind}>
                    <span className={styles.dot} data-kind={a.kind} />
                    <span className={styles.rowText}>{a.text}</span>
                    <span className={styles.meta}>{a.kind === 'calendar' ? '' : agoLabel(a.at, now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.quietText}>Nothing new since you last looked.</p>
            )}
          </Card>

          <Card className={styles.full} testid="files">
            <div className={styles.label}>
              <FileText size={13} /> Files · new and opened
            </div>
            {model.files.length ? (
              <div className={styles.strip}>
                {model.files.map((f) => (
                  <button key={f.path} type="button" className={styles.tile} onClick={() => openFile(f.path)} title={f.path} data-file={f.name}>
                    <span className={styles.thumb}>
                      <FileThumb entry={{ name: f.name, path: f.path, isDirectory: false }} size={56} />
                    </span>
                    <span className={styles.tileName}>{f.name}</span>
                    <span className={styles.meta}>{f.tag === 'new' ? 'new' : agoLabel(f.at, now)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.quietText}>Files you open, and files your agents create, appear here.</p>
            )}
          </Card>

          <Card className={styles.full} testid="pages">
            <div className={styles.label}>
              <Globe size={13} /> Pages · open and visited
            </div>
            {model.pages.length ? (
              <div className={styles.strip}>
                {model.pages.map((p) => (
                  <button key={p.url} type="button" className={styles.page} onClick={() => onOpenUrl(p.url)} title={p.url}>
                    <span className={styles.rowText}>{p.title}</span>
                    {p.open && <span className={styles.tag}>open</span>}
                  </button>
                ))}
              </div>
            ) : (
              <p className={styles.quietText}>Pages you visit appear here.</p>
            )}
          </Card>
        </div>
      </div>

      <aside ref={side} className={styles.side} data-testid="today-assistant">
        <div className={styles.label}>
          <Sparkles size={13} /> Ask your workspace
        </div>
        <div ref={log} className={styles.log}>
          {assistant.msgs.length === 0 && (
            <p className={styles.quietText}>Sees everything on this page and can open any case for the full thread. Try “brief me” or “what should I do first?”.</p>
          )}
          {assistant.msgs.map((m, i) => (
            <div key={i} className={m.role === 'user' ? styles.you : styles.agent}>
              {m.text}
            </div>
          ))}
          {assistant.busy && <div className={styles.step}>{assistant.step ?? 'Thinking…'}</div>}
        </div>
        <form
          className={styles.composer}
          onSubmit={(e) => {
            e.preventDefault()
            send()
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask about your workspace…"
            aria-label="Ask your workspace"
            data-testid="today-ask"
          />
          <button type="submit" className={styles.send} disabled={assistant.busy} aria-label="Send">
            <Send size={14} />
          </button>
        </form>
      </aside>
    </div>
  )
}
