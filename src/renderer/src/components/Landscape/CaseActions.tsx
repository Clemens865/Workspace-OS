import { Sparkles } from 'lucide-react'
import type { WorkCase } from '../../types/workspace-api'
import { useCaseActions } from '../CalmCockpit/useCaseActions'
import { CaseAgentActivity } from '../CalmCockpit/CaseAgentActivity'
import { PromptBar } from '../PromptBar/PromptBar'
import { ApprovalCard } from '../ApprovalCard/ApprovalCard'
import styles from './CaseActions.module.css'

const openFile = (path: string): void => {
  window.dispatchEvent(new CustomEvent('wos:open-file', { detail: { path } }))
}

/**
 * What a case can do, in the landscape (ADOPTION.md B3): hand it to an agent
 * (with @ files and # other cases), watch and continue that agent's run, take
 * the offers its notes imply (research, prepare, put in the calendar), and
 * choose where it lives. One implementation with the Cockpit: useCaseActions.
 */
export function CaseActions({ c, onChanged }: { c: WorkCase; onChanged: () => void }): JSX.Element {
  const a = useCaseActions(c, onChanged, true)
  const scope = c.scope ?? 'workspace'
  return (
    <section className={styles.actions} data-testid="case-actions">
      <h3 className={styles.h}>Hand to an agent</h3>
      <div className={styles.prompt}>
        <PromptBar compact popover="down" placeholder="What should an agent do with this case? @ file · # case" disabled={a.busy || a.agentBusy} onSubmit={(t, m, ids) => void a.runAsk(t, m, ids)} />
      </div>
      <CaseAgentActivity key={a.run?.runId} run={a.run} onOpenFile={openFile} onContinue={a.continueRun} />

      {a.signals.length > 0 && (
        <>
          <h3 className={styles.h}>Offers from your notes</h3>
          <div className={styles.chips}>
            {a.signals.map((s, i) => (
              <button key={i} type="button" className={styles.offer} disabled={a.busy || (s.kind !== 'schedule' && a.agentBusy)} onClick={() => void a.runOffer(s)} data-offer={s.kind}>
                <Sparkles size={13} /> {s.label}
              </button>
            ))}
          </div>
        </>
      )}

      <h3 className={styles.h}>Lives in</h3>
      <div className={styles.seg} role="group" aria-label="Where the case lives">
        <button type="button" className={scope === 'workspace' ? styles.segOn : ''} disabled={a.busy || a.agentBusy || scope === 'workspace'} onClick={() => void a.setScope('workspace')} data-scope="workspace">
          This workspace
        </button>
        <button type="button" className={scope === 'global' ? styles.segOn : ''} disabled={a.busy || a.agentBusy || scope === 'global'} onClick={() => void a.setScope('global')} data-scope="global">
          Everywhere
        </button>
      </div>

      {a.error && <p className={styles.error}>{a.error}</p>}

      {a.pickCalendar && (
        <ApprovalCard
          question="Which calendar should this go in?"
          options={a.pickCalendar.options.map((t) => ({ id: t.id, label: t.label, hint: t.canInvite ? 'can invite people' : 'on this Mac only, no invitations' }))}
          busy={a.busy}
          onAnswer={({ optionId }) => {
            if (optionId) void a.schedule(a.pickCalendar!.signal, optionId)
          }}
          onDismiss={() => a.setPickCalendar(null)}
        />
      )}
    </section>
  )
}
