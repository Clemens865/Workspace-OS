import { useState } from 'react'
import { describePrompt } from '../AgentTerminal/hitlGate'
import { reviewStore } from './reviewStore'
import { relTime, type HitlItem } from './reviewModel'
import { CautionIcon } from './FeedCard'
import styles from './FeedCard.module.css'

interface HitlCardProps {
  item: HitlItem
}

const KIND_LABEL: Record<HitlItem['kind'], string> = {
  edit: 'file edit',
  command: 'shell command',
  fetch: 'web fetch',
  connection: 'network connection',
  generic: 'privileged action',
}

/**
 * A live outbound permission request (from a PTY agent session) as an Action
 * card. This is the genuinely irreversible family: the request is DRAFT-GATED —
 * Approve arms only after the details are opened — while Deny is always one tap
 * (equal, so approving is never the lazy default). Routes back to the owning
 * PTY session via the review store.
 */
export function HitlCard({ item }: HitlCardProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)

  const approve = (): void => {
    if (!open) { setOpen(true); return }
    if (!armed) { setArmed(true); return }
    reviewStore.respondHitl(item.sessionId, 'allow-once')
  }
  const allowSession = (): void => reviewStore.respondHitl(item.sessionId, 'allow-session')
  const deny = (): void => reviewStore.respondHitl(item.sessionId, 'deny')

  return (
    <article className={`${styles.card} ${styles.live}`} data-testid="review-hitl" data-family="action">
      <div className={styles.topAccent} />
      <div className={styles.body}>
        <div className={styles.kickerRow}>
          <span className={styles.family}>Waiting on you</span>
          <span className={styles.session}>{item.sessionName}</span>
          <span className={styles.time}>{relTime(item.createdAt)}</span>
        </div>

        <h3 className={styles.headline}>{describePrompt(item)}</h3>
        <div className={styles.stakes}>
          <span className={styles.chip}>{KIND_LABEL[item.kind]}</span>
          <span className={styles.chip}>waiting for your go-ahead</span>
        </div>

        <p className={`${styles.gateNote} ${styles.willsend}`}>
          <CautionIcon />
          This can&apos;t be undone — open the request before you approve
        </p>

        <div className={styles.actions}>
          <button className={`${styles.act} ${armed ? styles.actArmed : ''}`} onClick={approve}>
            {!open ? 'Open the request' : armed ? 'Confirm — approve' : 'Approve once'}
          </button>
          <button className={styles.act} onClick={deny}>Deny</button>
        </div>

        <div className={styles.disclosure}>
          <button className={styles.discBtn} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide request' : 'Show request'}
          </button>
          {open && (
            <button className={styles.discBtn} onClick={allowSession}>Allow for this session</button>
          )}
        </div>

        {open && (
          <div className={styles.tier}>
            <div className={styles.tierKicker}>WHAT THE ASSISTANT IS ASKING FOR</div>
            <pre className={styles.prompt}>{item.question}</pre>
          </div>
        )}
      </div>
    </article>
  )
}
