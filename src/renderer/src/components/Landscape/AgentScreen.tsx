import { useRef, type ReactNode } from 'react'
import { FileText, AlertTriangle } from 'lucide-react'
import { PROVIDER_LABEL, STATUS_LABEL, type AgentPresence } from './presenceTypes'
import { ago } from './agentPresence'
import { useGlass } from './backdrop/useBackdrop'
import { clock, useResultPreview, useWorkingPreview } from './usePreview'
import { lastLines } from './previewStore'
import { sessionStore } from '../../lib/sessions/sessionStore'
import { useSessions } from './session/SessionPane'
import styles from './LandscapeWorld.module.css'

interface Props {
  agent: AgentPresence
  focused: boolean
  side: boolean
  /** 0 clear, 1 back row, 2 side flank. */
  depth: 0 | 1 | 2
  onOpen: () => void
  /** The focused screen's full content. */
  children?: ReactNode
}

/** The small face of a screen: what the agent is doing, at a glance, honestly. */
/**
 * A work card's face: what the case is, at a glance (workCardModel). Status in
 * the case's own words with how far along it is, the title, what it is about,
 * what happened last or what is next, its files and who worked on it.
 */
function WorkFace({ a }: { a: AgentPresence }): JSX.Element {
  const k = a.card!
  return (
    <div className={styles.wFace} data-testid="work-face" data-tone={k.tone}>
      <div className={styles.wHead}>
        <span className={styles.wStatus} data-tone={k.tone}>
          <span className={styles.dot} data-tone={k.tone} /> {k.status}
        </span>
        {k.stage && (
          <span className={styles.wStage} title={`Stage ${k.stage.index} of ${k.stage.count}`} aria-label={`Stage ${k.stage.index} of ${k.stage.count}`}>
            {Array.from({ length: k.stage.count }, (_, i) => (
              <i key={i} data-on={i < k.stage!.index ? 'true' : 'false'} />
            ))}
          </span>
        )}
        <span className={styles.wWhen}>{a.since ? ago(a.since) : ''}</span>
      </div>
      <div className={styles.wTitle}>{a.name}</div>
      {(k.host || k.about) && (
        <div className={styles.wAbout}>
          {k.host && <b>{k.host}</b>}
          {k.host && k.about ? ' · ' : ''}
          {k.about}
        </div>
      )}
      <div className={styles.wLine} data-kind={k.next ? 'next' : 'last'}>
        {k.next ? (
          <>
            <span className={styles.wKey}>Next</span> {k.next}
          </>
        ) : k.last ? (
          <>
            <span className={styles.wKey}>{k.last.who}</span> {k.last.text}
          </>
        ) : (
          <span className={styles.wKey}>{k.tone === 'grey' || k.tone === 'done' ? 'Closed' : 'Nothing noted yet'}</span>
        )}
      </div>
      <div className={styles.wFoot}>
        {k.fileCount > 0 && (
          <span className={styles.wFiles}>
            <FileText size={12} /> {k.fileCount} file{k.fileCount === 1 ? '' : 's'}
          </span>
        )}
        <span className={styles.flexGap} />
        {k.agents.slice(0, 3).map((n) => (
          <span key={n} className={styles.wAgent} title={n}>
            {n.slice(0, 1).toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  )
}

/** An agent with nothing running: who it is, the last thing it did, how much work it carries. */
function ReadyFace({ a }: { a: AgentPresence }): JSX.Element {
  useSessions()
  const mine = sessionStore.list().filter((s) => s.agentName === a.id && s.turns > 0)
  const last = mine.sort((x, y) => y.lastAt - x.lastAt)[0]
  const cases = new Set(mine.map((s) => s.caseId).filter(Boolean)).size
  return (
    <div className={styles.mCenter}>
      <div className={styles.mono}>{a.name.slice(0, 1).toUpperCase()}</div>
      <div className={styles.mState}>{STATUS_LABEL[a.status]}</div>
      <div className={styles.mSub}>{a.role || 'Ready when you are'}</div>
      {last ? (
        <div className={styles.mLast} data-testid="agent-last">
          Last: {last.title} · {ago(last.lastAt)}
          {cases > 0 ? ` · ${cases} case${cases === 1 ? '' : 's'}` : ''}
        </div>
      ) : null}
    </div>
  )
}

function Mini({ a }: { a: AgentPresence }): JSX.Element {
  const when = a.since ? ago(a.since) : null
  // A work card shows its case, not an agent's state, unless something is happening now.
  if (a.kind === 'work' && a.card && a.status !== 'working' && a.status !== 'question') return <WorkFace a={a} />
  switch (a.status) {
    case 'working':
      return <WorkingMini a={a} when={when} />
    case 'question':
      return (
        <>
          <div className={styles.mCenter}>
            <div className={styles.qIco}>?</div>
            <div className={styles.mQuestion}>{a.question ?? 'Waiting for your answer'}</div>
            <div className={styles.mInput}>Your answer…</div>
          </div>
          <div className={styles.mFoot}>
            <span className={styles.dot} data-tone="amber" /> {STATUS_LABEL.question}
          </div>
        </>
      )
    case 'review':
      return <ReviewMini a={a} />
    case 'paused':
      return (
        <>
          <div className={styles.mCenter}>
            <div className={styles.pIco}>II</div>
            <div className={styles.mState}>Paused</div>
            <div className={styles.mSub}>{a.task ?? 'Task on hold'}</div>
          </div>
          <div className={styles.mFoot}>
            <span className={styles.dot} data-tone="grey" /> Paused{when ? ` · ${when}` : ''}
          </div>
        </>
      )
    case 'error':
    case 'interrupted':
      return (
        <>
          <div className={styles.mCenter}>
            <AlertTriangle size={22} className={styles.warnIco} />
            <div className={styles.mQuestion}>{a.activity ?? a.task ?? STATUS_LABEL[a.status]}</div>
          </div>
          <div className={styles.mFoot}>
            <span className={styles.dot} data-tone="grey" /> {STATUS_LABEL[a.status]}
            {when ? ` · ${when}` : ''}
          </div>
        </>
      )
    default:
      return <ReadyFace a={a} />
  }
}

const PROVIDER_HEX = { claude: '#D97757', codex: '#2D9D8F' } as const

/** How present a screen's glass is: its slot's opacity; none while focused (it is solid paper then). */
function presence(el: HTMLElement): number {
  const sheet = el.closest<HTMLElement>('[data-depth]')
  if (!sheet || sheet.dataset.focused === 'true') return 0
  return Number(el.closest<HTMLElement>('[data-agent]')?.style.opacity || 1)
}

/** A working agent: the page its run is driving, or the lines it is writing, each with its time. */
function WorkingMini({ a, when }: { a: AgentPresence; when: string | null }): JSX.Element {
  const { shot, tail } = useWorkingPreview(a)
  const lines = tail ? lastLines(tail.text, 4) : []
  return (
    <>
      {shot ? (
        <div className={styles.mShot} data-testid="screen-shot">
          <img src={shot.src} alt="" />
          <div className={styles.mShotUrl}>{shot.url.replace(/^https?:\/\//, '')}</div>
        </div>
      ) : (
        <div className={styles.mTask}>{a.task ?? 'Working'}</div>
      )}
      {!shot && lines.length > 0 ? (
        <div className={styles.mTail} data-testid="screen-tail">
          {lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      ) : (
        !shot && a.activity && <div className={styles.mActivity}>{a.activity}</div>
      )}
      <div className={styles.mFoot}>
        <span className={styles.pulse} /> Working
        {shot ? ` · captured ${clock(shot.at)}` : tail ? ` · ${ago(tail.at)}` : when ? ` · ${when}` : ''}
      </div>
    </>
  )
}

/** A finished run: its first result, small (an image, or the opening lines of a text). */
function ReviewMini({ a }: { a: AgentPresence }): JSX.Element {
  const preview = useResultPreview(a.outputs[0] ?? null)
  return (
    <>
      <div className={styles.mDoc}>
        <FileText size={15} /> {a.outputs[0]?.split('/').pop() ?? a.task ?? 'Result'}
      </div>
      {preview?.kind === 'image' ? (
        <img className={styles.mImg} src={preview.src} alt="" data-testid="screen-result-image" />
      ) : preview?.kind === 'text' ? (
        <div className={styles.mText} data-testid="screen-result-text">
          {preview.text}
        </div>
      ) : (
        a.task && <div className={styles.mActivity}>{a.task}</div>
      )}
      <div className={styles.mFoot}>
        <span className={styles.dot} /> {STATUS_LABEL.review}
        {a.outputs.length > 1 ? ` · ${a.outputs.length} files` : ''}
      </div>
    </>
  )
}

/** One agent's screen in the landscape: face, name grip, and its case tab, each on Liquid Glass. */
export function AgentScreen({ agent: a, focused, side, depth, onOpen, children }: Props): JSX.Element {
  const label = `${a.name}, ${PROVIDER_LABEL[a.provider]}, ${STATUS_LABEL[a.status]}`
  const face = useRef<HTMLDivElement>(null)
  const grip = useRef<HTMLButtonElement>(null)
  const tab = useRef<HTMLDivElement>(null)
  useGlass(face, {
    radius: 22,
    bezel: 22,
    thickness: 56,
    color: PROVIDER_HEX[a.provider],
    alpha: presence,
    frost: (el) => {
      const d = el.closest<HTMLElement>('[data-depth]')?.dataset.depth
      return d === '2' ? 0.34 : d === '1' ? 0.22 : 0.12
    },
  })
  useGlass(grip, { radius: 12, bezel: 7, thickness: 14, frost: 0.35, alpha: presence })
  useGlass(tab, a.caseTitle ? { radius: 10, bezel: 6, thickness: 12, frost: 0.22, alpha: (el) => (el.closest('[data-side="true"]') ? 0 : presence(el)) } : null)
  return (
    <div
      className={`${styles.sheet} ${focused ? styles.focused : ''} ${side ? styles.side : ''}`}
      data-provider={a.provider}
      data-status={a.status}
      data-depth={depth}
      data-focused={focused}
      data-side={side}
    >
      <div
        ref={face}
        className={styles.face}
        role={focused ? undefined : 'button'}
        tabIndex={focused ? -1 : 0}
        aria-label={focused ? undefined : label}
        onClick={focused ? undefined : onOpen}
        onKeyDown={(e) => {
          if (!focused && e.key === 'Enter') onOpen()
        }}
        data-testid="agent-face"
      >
        <div className={styles.mini}>
          <Mini a={a} />
        </div>
        <div className={styles.full}>{children}</div>
      </div>
      {!(a.kind === 'work' && !a.card?.agents.length) && (
        <button ref={grip} type="button" className={`${styles.grip} ${a.kind === 'work' ? styles.gripWork : ''}`} tabIndex={-1} onClick={onOpen} title={a.name}>
          <span className={styles.dot} />
          {a.kind === 'work' ? (
            <span className={styles.gripTitle}>{a.card?.agents.join(', ') ?? a.name}</span>
          ) : (
            <span>
              {a.name}
              <span className={styles.pv}> / {PROVIDER_LABEL[a.provider]}</span>
            </span>
          )}
        </button>
      )}
      {a.caseTitle && a.kind !== 'work' && (
        <div ref={tab} className={styles.casetab}>
          {a.caseTitle}
        </div>
      )}
    </div>
  )
}
