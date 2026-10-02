import type { ReactNode } from 'react'
import { FileText, AlertTriangle } from 'lucide-react'
import { PROVIDER_LABEL, STATUS_LABEL, type AgentPresence } from './presenceTypes'
import { ago } from './agentPresence'
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
function Mini({ a }: { a: AgentPresence }): JSX.Element {
  const when = a.since ? ago(a.since) : null
  switch (a.status) {
    case 'working':
      return (
        <>
          <div className={styles.mTask}>{a.task ?? 'Working'}</div>
          {a.activity && <div className={styles.mActivity}>{a.activity}</div>}
          <div className={styles.mFoot}>
            <span className={styles.pulse} /> Working{when ? ` · ${when}` : ''}
          </div>
        </>
      )
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
      return (
        <>
          <div className={styles.mDoc}>
            <FileText size={15} /> {a.outputs[0]?.split('/').pop() ?? a.task ?? 'Result'}
          </div>
          {a.task && <div className={styles.mActivity}>{a.task}</div>}
          <div className={styles.mFoot}>
            <span className={styles.dot} /> {STATUS_LABEL.review}
            {a.outputs.length > 1 ? ` · ${a.outputs.length} files` : ''}
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
      return (
        <div className={styles.mCenter}>
          <div className={styles.mono}>{a.name.slice(0, 1).toUpperCase()}</div>
          <div className={styles.mState}>{STATUS_LABEL[a.status]}</div>
          <div className={styles.mSub}>{a.role || 'Ready when you are'}</div>
        </div>
      )
  }
}

/** One agent's screen in the landscape: face, name grip, and its case tab. */
export function AgentScreen({ agent: a, focused, side, depth, onOpen, children }: Props): JSX.Element {
  const label = `${a.name}, ${PROVIDER_LABEL[a.provider]}, ${STATUS_LABEL[a.status]}`
  return (
    <div
      className={`${styles.sheet} ${focused ? styles.focused : ''} ${side ? styles.side : ''}`}
      data-provider={a.provider}
      data-status={a.status}
      data-depth={depth}
    >
      <div
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
      <button type="button" className={styles.grip} tabIndex={-1} onClick={onOpen}>
        <span className={styles.dot} />
        <span>
          {a.name}
          <span className={styles.pv}> / {PROVIDER_LABEL[a.provider]}</span>
        </span>
      </button>
      {a.caseTitle && <div className={styles.casetab}>{a.caseTitle}</div>}
    </div>
  )
}
