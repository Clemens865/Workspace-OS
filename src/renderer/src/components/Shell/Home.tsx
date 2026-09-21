import { ArrowUpRight } from 'lucide-react'
import type { WorkspaceLibrary } from '../../hooks/useWorkspaceLibrary'
import { Canvas } from '../Canvas/Canvas'
import type { TabManager } from '../../hooks/useTabManager'
import { docLabel, type RailId } from './shellModel'
import { HomeDashboard } from './home/HomeDashboard'
import styles from './WorkspaceShell.module.css'

interface HomeProps {
  library: WorkspaceLibrary
  /** Canvas is composed in-pane to show the doc opened INTO Home. */
  peekTabManager: TabManager
  /** Non-null when a document is open in the Home pane. */
  peekFilePath: string | null
  onOpenInPane: (path: string) => void
  /** Promote the peeked doc to a full Stage tab. */
  onPopOut: (path: string) => void
  /** A widget card was clicked — go to its surface. */
  onNavigate: (rail: RailId) => void
  onRefresh: () => void
}

/**
 * Home — the widget board: every surface as one card of high-level truth
 * (cases, calendar, agents, files, browser, mail, knowledge), customizable
 * and accent-colored. It used to open on the agent triage feed, which made
 * Home a duplicate of the Agents surface; the feed lives there, and Home now
 * answers the first question of a session: what happened, what needs me,
 * where was I?
 *
 * Opening a file from a card keeps the in-pane editor behaviour (peek), with
 * the way back and the pop-out unchanged.
 */
export function Home({
  library,
  peekTabManager,
  peekFilePath,
  onOpenInPane,
  onPopOut,
  onNavigate,
  onRefresh,
}: HomeProps): JSX.Element {
  if (peekFilePath) {
    return (
      <div className={styles.homeSolo}>
        <div className={styles.peekHead}>
          <div>
            <div className={styles.peekTitle}>{docLabel(peekFilePath)}</div>
            <div className={styles.peekSub}>opened from Home</div>
          </div>
          <button className={styles.peekAct} onClick={() => onPopOut(peekFilePath)}>
            <ArrowUpRight size={14} /> Open full
          </button>
        </div>
        <div className={styles.peekHost}>
          <Canvas tabManager={peekTabManager} library={library} onRefresh={onRefresh} />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.homeSolo}>
      <HomeDashboard recent={library.recent} onNavigate={onNavigate} onOpenFile={onOpenInPane} />
    </div>
  )
}
