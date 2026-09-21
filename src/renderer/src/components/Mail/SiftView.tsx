/**
 * The sift — the inbox read as a STREAM, not a morning pile. New mail flows
 * in and gets judged as it arrives; handled mail leaves; the steady state is
 * a quiet "nothing is waiting on you", never a finish line, because there is
 * no finish line.
 *
 * B2 design: every row carries its VERBS (draft, done, add-to-case,
 * add-to-calendar) so the person acts in place and the row goes; a wrong
 * zone is corrected in place, and "always for this sender" writes a rule so
 * tomorrow's sift is measurably better. Zones carry zone-level verbs (mark
 * all read, file all). Noise reads per sender.
 */

import { JSX, useState } from 'react'
import { X, ChevronDown, ChevronRight, CalendarPlus, PenSquare, Check, FolderInput } from 'lucide-react'
import styles from './SiftView.module.css'
import {
  briefingLine, countByZone, zoneRows, groupNoise,
  ZONE_TITLES, type SiftRow, type Zone,
} from './siftViewModel'

/** Zones a correction can move a mail to. 'case' needs a target, so not here. */
const FIX_ZONES: Zone[] = ['answer', 'glance', 'noise']

interface SiftViewProps {
  rows: SiftRow[]
  /** The assistant's spoken-style overview of the batch, or null. */
  briefing: string | null
  /** True when the model reply was unusable and zones fell back to headers. */
  degraded: boolean
  /** True while an incremental refresh (new mail only) is in flight. */
  busy: boolean
  /** Uids acted on this session — struck through until a refresh retires them. */
  handled: ReadonlySet<number>
  onOpen: (row: SiftRow) => void
  /** Draft a reply to this mail (opens Compose prefilled — never sends). */
  onDraft: (row: SiftRow) => void
  /** Mark this mail read — it leaves the sift. */
  onDone: (row: SiftRow) => void
  /** Attach this mail to its matched case as a note. */
  onAddToCase: (row: SiftRow) => void
  /** Create a calendar event from the mail's named date/time. */
  onAddToCalendar: (row: SiftRow) => void
  /** Mark every mail in a zone read (bounded by what's shown). */
  onMarkZoneRead: (rows: SiftRow[]) => void
  /** Kick the existing Newsletters filing flow (propose → approve). */
  onFileNoise: () => void
  /** Move a mail to another zone; `always` writes a sender rule. */
  onReassign: (row: SiftRow, zone: Zone, always: boolean) => void
  onClose: () => void
}

const fmtTime = (ms: number | null): string => {
  if (!ms) return ''
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

const fmtDue = (due: string): string => {
  const [date, time] = due.split('T')
  const d = new Date(`${date}T${time ?? '12:00'}:00`)
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return time ? `${day} · ${time}` : day
}

export function SiftView(p: SiftViewProps): JSX.Element {
  const { rows, briefing, degraded, busy, handled } = p
  const [noiseOpen, setNoiseOpen] = useState(false)
  /** The row whose "not right?" popover is open, if any. */
  const [fixFor, setFixFor] = useState<number | null>(null)
  const counts = countByZone(rows)
  const total = rows.length || 1
  const live = (zr: SiftRow[]): SiftRow[] => zr.filter((r) => !handled.has(r.uid))

  const fixPopover = (r: SiftRow): JSX.Element => (
    <span className={styles.fix} onClick={(e) => e.stopPropagation()}>
      <span className={styles.fixQ}>Where should this go?</span>
      <span className={styles.fixOpts}>
        {FIX_ZONES.filter((z) => z !== r.zone).map((z) => (
          <button key={z} className={styles.fixOpt} onClick={() => { setFixFor(null); p.onReassign(r, z, false) }}>
            {ZONE_TITLES[z]}
          </button>
        ))}
      </span>
      <span className={styles.fixOpts}>
        {FIX_ZONES.filter((z) => z !== r.zone).map((z) => (
          <button
            key={z}
            className={`${styles.fixOpt} ${styles.fixAlways}`}
            title={`Writes a rule: mail from ${r.fromAddress || r.fromName} is always ${ZONE_TITLES[z].toLowerCase()}`}
            onClick={() => { setFixFor(null); p.onReassign(r, z, true) }}
          >
            always {ZONE_TITLES[z].toLowerCase()}
          </button>
        ))}
      </span>
    </span>
  )

  const rowEl = (r: SiftRow, zone: Zone): JSX.Element => {
    const done = handled.has(r.uid)
    return (
      <div key={`${r.folder}:${r.uid}`} className={`${styles.row} ${done ? styles.rowDone : ''}`}>
        <span className={`${styles.dot} ${r.priority >= 3 ? styles.dotHot : r.priority === 2 ? styles.dotWarm : ''}`} />
        <span className={styles.rowBody}>
          <button className={styles.rowTop} onClick={() => p.onOpen(r)}>
            <span className={styles.from}>{r.fromName || r.fromAddress}</span>
            <span className={styles.summary}>{r.summary}</span>
            {r.caseTitle && <span className={styles.casePill}>{r.caseTitle}</span>}
            {r.due && <span className={styles.due}>{fmtDue(r.due)}</span>}
            {done ? <span className={styles.doneStamp}><Check size={11} /> done</span> : <span className={styles.time}>{fmtTime(r.date)}</span>}
          </button>
          {!done && (
            <span className={styles.todoLine}>
              {r.todo && <span className={styles.todo}>→ {r.todo}</span>}
              <span className={styles.acts}>
                {(zone === 'answer' || zone === 'case') && (
                  <button className={`${styles.act} ${styles.actPrimary}`} onClick={() => p.onDraft(r)} title="Draft a reply — opens Compose prefilled, never sends">
                    <PenSquare size={11} /> Draft reply
                  </button>
                )}
                {zone === 'case' && r.caseTitle && (
                  <button className={styles.act} onClick={() => p.onAddToCase(r)} title={`Write this mail into “${r.caseTitle}” as a case note`}>
                    <FolderInput size={11} /> Add to case
                  </button>
                )}
                {r.due && (
                  <button className={styles.act} onClick={() => p.onAddToCalendar(r)} title={`Create a calendar event on ${fmtDue(r.due)}`}>
                    <CalendarPlus size={11} /> Calendar
                  </button>
                )}
                <button className={styles.act} onClick={() => p.onDone(r)} title="Mark read — it leaves the sift">
                  <Check size={11} /> Done
                </button>
                <button
                  className={styles.fixBtn}
                  onClick={() => setFixFor(fixFor === r.uid ? null : r.uid)}
                  title="Wrong zone? Correcting it can also teach a rule for this sender"
                >
                  not right?
                </button>
              </span>
            </span>
          )}
          {fixFor === r.uid && !done && fixPopover(r)}
        </span>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <strong className={styles.brief}>
          {busy && rows.length === 0 ? 'Reading your unread mail…' : briefingLine(rows)}
          {busy && rows.length > 0 && <span className={styles.busy}> · reading new mail…</span>}
        </strong>
        <button className={styles.close} onClick={p.onClose} title="Switch to the plain list" aria-label="Switch to list view">
          <X size={13} />
        </button>
      </div>
      {briefing && rows.length > 0 && <p className={styles.briefing}>{briefing}</p>}
      {degraded && (
        <div className={styles.degraded}>
          The assistant couldn’t read this batch — zones below come from headers only.
        </div>
      )}

      {rows.length > 0 && (
        <div className={styles.strip} aria-hidden>
          {(['answer', 'case', 'glance', 'noise'] as Zone[]).map((z) =>
            counts[z] === 0 ? null : (
              <span
                key={z}
                className={`${styles.seg} ${styles[`seg_${z}`]}`}
                style={{ flexGrow: counts[z] / total }}
                title={`${ZONE_TITLES[z]}: ${counts[z]}`}
              />
            ),
          )}
        </div>
      )}

      {(['answer', 'case', 'glance'] as Zone[]).map((zone) => {
        const zr = zoneRows(rows, zone)
        if (zr.length === 0) return null
        const remaining = live(zr)
        return (
          <section key={zone} className={styles.zone}>
            <h4 className={`${styles.zoneTitle} ${styles[`zt_${zone}`]}`}>
              {ZONE_TITLES[zone]} <span className={styles.zoneCount}>{remaining.length}</span>
              {zone === 'glance' && remaining.length > 1 && (
                <button className={styles.zoneAct} onClick={() => p.onMarkZoneRead(remaining)} title="Mark every glance mail read — they leave the sift">
                  Mark all read
                </button>
              )}
            </h4>
            {zr.map((r) => rowEl(r, zone))}
          </section>
        )
      })}

      {counts.noise > 0 && (
        <section className={styles.zone}>
          <div className={styles.noiseHeadRow}>
            <button className={styles.noiseHead} onClick={() => setNoiseOpen((v) => !v)}>
              {noiseOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <h4 className={`${styles.zoneTitle} ${styles.zt_noise}`}>
                {ZONE_TITLES.noise} <span className={styles.zoneCount}>{counts.noise}</span>
              </h4>
              <span className={styles.noiseHint}>{groupNoise(rows).length} sender{groupNoise(rows).length === 1 ? '' : 's'}</span>
            </button>
            <button className={styles.zoneAct} onClick={p.onFileNoise} title="Propose filing the newsletters — nothing moves until you approve">
              File them →
            </button>
          </div>
          {noiseOpen &&
            groupNoise(rows).map((g) => (
              <button key={g.address} className={styles.noiseRow} onClick={() => p.onOpen(g.top)}>
                <span className={styles.dot} />
                <span className={styles.from}>{g.label}</span>
                <span className={styles.summary}>{g.top.summary}</span>
                <span className={styles.time}>{g.count > 1 ? `×${g.count}` : fmtTime(g.top.date)}</span>
              </button>
            ))}
        </section>
      )}
    </div>
  )
}
