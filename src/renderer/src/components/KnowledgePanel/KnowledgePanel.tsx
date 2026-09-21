import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { Link2, ArrowUpRight, FileQuestion, RefreshCw, CornerDownRight, CircleDashed, List, Share2, Sparkles } from 'lucide-react'
import type { Backlink, OutgoingLink, Stub, RelatedNote } from '../../types/workspace-api'
import styles from './KnowledgePanel.module.css'

// Lazy — the graph pulls in the canvas + force-layout code, code-split out of
// the panel's (and first-paint's) bundle until the user opens the Graph tab.
const GraphView = lazy(() => import('./GraphView'))

type KnowledgeMode = 'list' | 'graph'

interface KnowledgePanelProps {
  /** True while this view is the visible sidebar tab — triggers a refresh. */
  active: boolean
  /** The file whose backlinks / outgoing links are shown (null = none open). */
  activeFile: string | null
  /** Open a file in the canvas (backlink / resolved-link navigation). */
  onFileOpen: (path: string) => void
}

/** Just the basename of a path, for display. */
function baseName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

/** A terse chip label for why a note is related (strongest signal wins). */
function relatedReason(r: RelatedNote['reasons']): string {
  if (r.direct) return 'linked'
  if (r.coupling && r.coupling >= (r.cocitation ?? 0)) return `${r.coupling} shared`
  if (r.cocitation) return `${r.cocitation} cite both`
  return 'related'
}

/**
 * Sidebar Knowledge view — the [[wikilink]] backlinks graph for the workspace.
 * For the ACTIVE file it surfaces its Backlinks (who links here) and Outgoing
 * links (resolved → clickable, stub → "unresolved"), plus a global Stubs list
 * ("notes people reference that don't exist yet"). Read-only navigation; note
 * creation is deferred (see the DEFER list). Mirrors the Memory/Search panels.
 */
export function KnowledgePanel({ active, activeFile, onFileOpen }: KnowledgePanelProps): JSX.Element {
  const [mode, setMode] = useState<KnowledgeMode>('list')
  const [backlinks, setBacklinks] = useState<Backlink[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingLink[]>([])
  const [stubs, setStubs] = useState<Stub[]>([])
  const [related, setRelated] = useState<RelatedNote[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [st, back, out, rel] = await Promise.all([
        window.workspace.links.stubs(),
        activeFile ? window.workspace.links.backlinks(activeFile) : Promise.resolve([]),
        activeFile ? window.workspace.links.outgoing(activeFile) : Promise.resolve([]),
        activeFile ? window.workspace.links.related(activeFile) : Promise.resolve([]),
      ])
      setStubs(st)
      setBacklinks(back)
      setOutgoing(out)
      setRelated(rel)
    } catch {
      setStubs([])
      setBacklinks([])
      setOutgoing([])
      setRelated([])
    }
    setLoading(false)
  }, [activeFile])

  // Refresh when the panel becomes visible or the active file changes — the
  // graph accrues as files are indexed in the background.
  useEffect(() => {
    if (active && mode === 'list') void load()
  }, [active, mode, load])

  const openResolved = (link: OutgoingLink): void => {
    if (link.resolvedPath) onFileOpen(link.resolvedPath)
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>
          <Link2 size={14} strokeWidth={1.75} className={styles.headerIcon} />
          <span>Knowledge</span>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.modeToggle} role="tablist" aria-label="Knowledge view">
            <button
              className={`${styles.modeBtn} ${mode === 'list' ? styles.modeActive : ''}`}
              onClick={() => setMode('list')}
              title="List view"
              role="tab"
              aria-selected={mode === 'list'}
            >
              <List size={12} strokeWidth={2} />
            </button>
            <button
              className={`${styles.modeBtn} ${mode === 'graph' ? styles.modeActive : ''}`}
              onClick={() => setMode('graph')}
              title="Graph view"
              role="tab"
              aria-selected={mode === 'graph'}
            >
              <Share2 size={12} strokeWidth={2} />
            </button>
          </div>
          {mode === 'list' && (
            <button className={styles.refresh} onClick={() => void load()} title="Refresh" disabled={loading}>
              <RefreshCw size={13} strokeWidth={2} className={loading ? styles.spin : ''} />
            </button>
          )}
        </div>
      </div>

      {mode === 'graph' ? (
        <Suspense fallback={<div className={styles.body} />}>
          {/* Keyed so switching the active file / re-entering rebuilds the graph. */}
          <GraphView key={activeFile ?? 'none'} activeFile={activeFile} onFileOpen={onFileOpen} />
        </Suspense>
      ) : (
      <div className={styles.body}>
        {!activeFile ? (
          <div className={styles.empty}>
            <Link2 size={28} strokeWidth={1.25} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>No file open</p>
            <p className={styles.emptyHint}>
              Open a note to see what links to it and where it links. Use [[Note]] to link notes.
            </p>
          </div>
        ) : (
          <>
            <div className={styles.activeFile} title={activeFile}>
              {baseName(activeFile)}
            </div>

            {/* Backlinks — who links to this note. */}
            <div className={styles.sectionLabel}>
              <Link2 size={11} strokeWidth={2} /> Backlinks
              <span className={styles.sectionCount}>{backlinks.length}</span>
            </div>
            {backlinks.length === 0 ? (
              <div className={styles.sectionEmpty}>Nothing links here yet.</div>
            ) : (
              backlinks.map((b, i) => (
                <button
                  key={`${b.path}:${i}`}
                  className={styles.card}
                  onClick={() => onFileOpen(b.path)}
                  title={b.path}
                >
                  <div className={styles.cardName}>{b.name}</div>
                  <div className={styles.cardSnippet}>{b.snippet}</div>
                </button>
              ))
            )}

            {/* Outgoing links — resolved (clickable) + stubs (unresolved). */}
            <div className={styles.sectionLabel}>
              <ArrowUpRight size={11} strokeWidth={2} /> Outgoing links
              <span className={styles.sectionCount}>{outgoing.length}</span>
            </div>
            {outgoing.length === 0 ? (
              <div className={styles.sectionEmpty}>This note links nowhere yet.</div>
            ) : (
              outgoing.map((o, i) =>
                o.resolvedPath ? (
                  <button
                    key={`${o.targetName}:${i}`}
                    className={styles.card}
                    onClick={() => openResolved(o)}
                    title={o.resolvedPath}
                  >
                    <div className={styles.cardName}>
                      <CornerDownRight size={11} strokeWidth={2} className={styles.linkIcon} />
                      {o.targetName}
                      {o.heading && <span className={styles.heading}>#{o.heading}</span>}
                      {o.ambiguous && <span className={styles.badgeAmbiguous}>ambiguous</span>}
                    </div>
                    <div className={styles.cardSnippet}>{o.snippet}</div>
                  </button>
                ) : (
                  <div key={`${o.targetName}:${i}`} className={`${styles.card} ${styles.stub}`}>
                    <div className={styles.cardName}>
                      <CircleDashed size={11} strokeWidth={2} className={styles.linkIcon} />
                      {o.targetName}
                      {o.heading && <span className={styles.heading}>#{o.heading}</span>}
                      <span className={styles.badgeUnresolved}>unresolved</span>
                    </div>
                    <div className={styles.cardSnippet}>{o.snippet}</div>
                  </div>
                )
              )
            )}

            {/* Related notes — link-graph proximity (direct + shared neighbours). */}
            <div className={styles.sectionLabel}>
              <Sparkles size={11} strokeWidth={2} /> Related notes
              <span className={styles.sectionCount}>{related.length}</span>
            </div>
            {related.length === 0 ? (
              <div className={styles.sectionEmpty}>No related notes yet.</div>
            ) : (
              related.map((r) => (
                <button
                  key={r.path}
                  className={styles.card}
                  onClick={() => onFileOpen(r.path)}
                  title={r.path}
                >
                  <div className={styles.cardName}>
                    <Sparkles size={11} strokeWidth={2} className={styles.linkIcon} />
                    {r.name}
                    <span className={styles.badgeRelated}>{relatedReason(r.reasons)}</span>
                  </div>
                </button>
              ))
            )}
          </>
        )}

        {/* Global stubs — referenced notes that don't exist yet. */}
        <div className={styles.sectionLabel}>
          <FileQuestion size={11} strokeWidth={2} /> Stubs
          <span className={styles.sectionCount}>{stubs.length}</span>
        </div>
        {stubs.length === 0 ? (
          <div className={styles.sectionEmpty}>No dangling references.</div>
        ) : (
          stubs.map((s) => (
            <div key={s.targetName} className={styles.stubRow}>
              <span className={styles.stubName}>{s.targetName}</span>
              <span className={styles.stubCount} title={`${s.refCount} note(s) reference this`}>
                {s.refCount}
              </span>
            </div>
          ))
        )}
      </div>
      )}
    </div>
  )
}
