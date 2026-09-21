import { useCallback } from 'react'
import type { RunArtifactGroup } from './useAgentSession'
import type { ArtifactType } from '../../types/workspace-api'
import styles from './ArtifactCards.module.css'

interface ArtifactCardsProps {
  /** Recent runs' classified outputs, newest run first. */
  groups: RunArtifactGroup[]
  /** Opens a file in the Canvas (the existing tab-open path). */
  onOpen: (path: string) => void
}

/** Emoji glyph per artifact type — mirrors the terminal's existing emoji cues. */
const ICON: Record<ArtifactType, string> = {
  office: '📄',
  page: '🌐',
  image: '🖼',
  code: '</>',
  data: '📊',
  diff: '🔀',
  other: '📎',
}

const LABEL: Record<ArtifactType, string> = {
  office: 'Document',
  page: 'Web page',
  image: 'Image',
  code: 'Code',
  data: 'Data',
  diff: 'Diff',
  other: 'File',
}

/**
 * The strip of artifact cards docked in an agent session: the files a run
 * produced, one card each, with Open (→ Canvas) and Reveal (→ Finder). Grouped
 * by run so a later run's outputs don't visually merge with an earlier one's.
 * Keeps generated files clickable instead of buried in the console stream.
 */
export function ArtifactCards({ groups, onOpen }: ArtifactCardsProps): JSX.Element | null {
  const reveal = useCallback((path: string) => {
    void window.workspace.fs.reveal(path)
  }, [])

  if (groups.length === 0) return null

  return (
    <div className={styles.strip} role="list" aria-label="Agent output artifacts">
      {groups.map((group) => (
        <div key={group.runId} className={styles.group}>
          {group.items.map((a) => (
            <div key={a.path} className={styles.card} role="listitem" title={a.path}>
              <span className={styles.icon} aria-hidden>{ICON[a.type]}</span>
              <div className={styles.meta}>
                <span className={styles.name}>{a.name}</span>
                <span className={styles.type}>{LABEL[a.type]}</span>
              </div>
              <div className={styles.cardActions}>
                <button className={styles.openBtn} onClick={() => onOpen(a.path)} title="Open in canvas">
                  Open
                </button>
                <button className={styles.revealBtn} onClick={() => reveal(a.path)} title="Reveal in Finder">
                  Reveal
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
