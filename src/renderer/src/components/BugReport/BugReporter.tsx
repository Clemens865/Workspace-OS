import { useCallback, useEffect, useState } from 'react'
import type { BugAnalysis, BugContext } from '../../types/workspace-api'
import styles from './BugReporter.module.css'

/**
 * Report a bug without leaving what you were doing.
 *
 * The design constraint is that a bug is noticed at the *worst* moment — mid-task,
 * mildly annoyed, with no appetite for a form. So the user owes exactly one thing:
 * a sentence. Everything else — which surface, which build, which errors were in
 * the log — the app already knows and attaches silently.
 *
 * Claude then structures it, reading the source READ-ONLY to guess at the
 * responsible code. That proposal is shown for correction before anything is
 * written, the same contract the Foundry and the memory panel use: the machine
 * drafts, the human confirms, and the human's original words are kept verbatim
 * either way.
 *
 * Reports go to `docs/BUGS.md` in the development repo. Nothing is fixed here —
 * this surface exists to make sure a bug survives to the next session.
 */

type Phase = 'writing' | 'analyzing' | 'review' | 'filed'

export function BugReporter({ onClose, surface, openFile }: {
  onClose: () => void
  surface: string | null
  openFile: string | null
}): JSX.Element {
  const [phase, setPhase] = useState<Phase>('writing')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'bug' | 'idea'>('bug')
  const [analysis, setAnalysis] = useState<BugAnalysis | null>(null)
  const [context, setContext] = useState<BugContext | null>(null)
  const [status, setStatus] = useState<{ repoRoot: string | null; count: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filed, setFiled] = useState<{ id: string; duplicate: boolean } | null>(null)

  useEffect(() => {
    void window.workspace.bugs.status().then((s) => setStatus({ repoRoot: s.repoRoot, count: s.count }))
    void window.workspace.bugs.context(surface, openFile).then(setContext)
  }, [surface, openFile])

  // Escape closes, but never mid-write without warning — a lost report is the
  // one failure this surface cannot have.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (phase === 'writing' && text.trim()) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, phase, text])

  const pickRepo = useCallback(async () => {
    const dir = await window.workspace.fs.openFolderDialog()
    if (!dir) return
    try {
      const r = await window.workspace.bugs.setRepo(dir)
      setStatus((s) => ({ repoRoot: r.repoRoot, count: s?.count ?? 0 }))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const analyze = useCallback(async () => {
    if (!text.trim()) return
    setPhase('analyzing'); setError(null)
    try {
      const res = await window.workspace.bugs.analyze(text, surface, openFile, kind)
      setContext(res.context)
      if (res.ok && res.analysis) {
        setAnalysis(res.analysis)
        setPhase('review')
      } else {
        // Analysis is a bonus, not a gate. Fall through to filing raw.
        setError(res.error ?? 'Could not analyze that — you can still file it as written.')
        setPhase('review')
      }
    } catch (e) {
      setError((e as Error).message)
      setPhase('review')
    }
  }, [text, surface, openFile])

  const file = useCallback(async (withAnalysis: boolean) => {
    if (!context) return
    setError(null)
    try {
      const r = await window.workspace.bugs.file(text, withAnalysis ? analysis : null, context, kind)
      setFiled({ id: r.id, duplicate: r.duplicate })
      setPhase('filed')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [text, analysis, context])

  const edit = <K extends keyof BugAnalysis>(k: K, v: BugAnalysis[K]): void =>
    setAnalysis((a) => (a ? { ...a, [k]: v } : a))

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget && !text.trim()) onClose() }}>
      <div className={styles.panel} role="dialog" aria-label="Report a bug">
        <header className={styles.head}>
          <h2 className={styles.title}>{kind === 'idea' ? 'Suggest a feature' : 'Report a bug'}</h2>
          {/* One shortcut, two destinations. Making ideas a separate shortcut
              means the ones you have mid-task are simply lost; making them the
              same FILE means forty ideas bury three real bugs. */}
          <div className={styles.kindToggle}>
            <button
              className={kind === 'bug' ? styles.kindOn : styles.kindOff}
              onClick={() => setKind('bug')}
            >
              Bug
            </button>
            <button
              className={kind === 'idea' ? styles.kindOn : styles.kindOff}
              onClick={() => setKind('idea')}
            >
              Idea
            </button>
          </div>
          <span className={styles.spacer} />
          <button className={styles.close} onClick={onClose} title="Close">×</button>
        </header>

        {!status?.repoRoot && (
          <div className={styles.setup}>
            <p>
              Bugs are written to <code>docs/BUGS.md</code> in the Workspace&nbsp;OS
              repository, so the next development session picks them up. Point the
              reporter at that folder once.
            </p>
            <button className={styles.primary} onClick={() => void pickRepo()}>Choose the repository folder…</button>
          </div>
        )}

        {phase === 'writing' && (
          <>
            <textarea
              className={styles.input}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={kind === 'idea'
                ? 'What should it do?\n\nPlain language is fine — "when I click a link in a mail it should open in our browser, not Safari" is a perfect idea.'
                : 'What went wrong?\n\nPlain language is fine — "I made a new Word document and can\'t type in it, there\'s no cursor" is a perfect report.'}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void analyze() }}
            />
            {context && (
              <p className={styles.ctx}>
                Attached automatically: {context.surface ?? 'unknown surface'} · v{context.appVersion}
                {context.commit ? ` · ${context.commit}` : ''}
                {context.recentErrors.length > 0 ? ` · ${context.recentErrors.length} recent error${context.recentErrors.length > 1 ? 's' : ''}` : ''}
              </p>
            )}
            <footer className={styles.foot}>
              <span className={styles.hint}>Claude reads the source read-only to guess the cause. It never edits anything.</span>
              <button className={styles.ghost} onClick={() => void file(false)} disabled={!text.trim() || !status?.repoRoot}>File as written</button>
              <button className={styles.primary} onClick={() => void analyze()} disabled={!text.trim() || !status?.repoRoot}>Analyze &amp; file</button>
            </footer>
          </>
        )}

        {phase === 'analyzing' && (
          <div className={styles.busy}>
            <p>Reading the source and structuring your report…</p>
            <p className={styles.hint}>Read-only. Nothing is being changed.</p>
          </div>
        )}

        {phase === 'review' && (
          <div className={styles.review}>
            <p className={styles.lede}>
              Correct anything that is wrong — your original words are kept either way.
            </p>

            {analysis ? (
              <>
                <label className={styles.field}>
                  <span>Title</span>
                  <input value={analysis.title} onChange={(e) => edit('title', e.target.value)} />
                </label>
                <div className={styles.row}>
                  {/* WOS-010: a proposal has no severity. Offering one invites
                      an idea to be triaged as though something were broken. */}
                  {kind !== 'idea' && (
                    <label className={styles.field}>
                      <span>Severity</span>
                      <select value={analysis.severity} onChange={(e) => edit('severity', e.target.value as BugAnalysis['severity'])}>
                        {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </label>
                  )}
                  <label className={styles.field}>
                    <span>{kind === 'idea' ? 'What it touches' : 'Surface'}</span>
                    <input value={analysis.surface} onChange={(e) => edit('surface', e.target.value)} />
                  </label>
                </div>
                <label className={styles.field}>
                  <span>{kind === 'idea' ? 'What already exists' : 'What happens'}</span>
                  <textarea rows={2} value={analysis.whatHappened} onChange={(e) => edit('whatHappened', e.target.value)} />
                </label>
                <label className={styles.field}>
                  <span>{kind === 'idea' ? 'What this would add' : 'Expected'}</span>
                  <textarea rows={2} value={analysis.expected} onChange={(e) => edit('expected', e.target.value)} />
                </label>

                {kind === 'idea' && analysis.verdict !== undefined && (
                  <label className={styles.field}>
                    <span>Worth building? — the roadmap rule, and the honest objection</span>
                    <textarea rows={3} value={analysis.verdict} onChange={(e) => edit('verdict', e.target.value)} />
                  </label>
                )}

                {analysis.steps.length > 0 && (
                  <div className={styles.field}>
                    <span>Steps</span>
                    <ol className={styles.steps}>{analysis.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                  </div>
                )}

                <div className={styles.field}>
                  <span>Suspected code — a guess, not a diagnosis</span>
                  {analysis.suspects.length > 0 ? (
                    <ul className={styles.suspects}>
                      {analysis.suspects.map((s, i) => <li key={i}><code>{s.path}</code> — {s.why}</li>)}
                    </ul>
                  ) : (
                    <p className={styles.hint}>
                      {analysis.localized ? 'Not localized.' : 'Source not available, so no files were guessed at.'}
                    </p>
                  )}
                </div>

                {analysis.duplicateOf && (
                  <p className={styles.dupe}>
                    Looks like the same defect as <strong>{analysis.duplicateOf}</strong>. Filing will
                    bump its counter instead of adding a second entry.
                  </p>
                )}
              </>
            ) : (
              <p className={styles.hint}>No analysis available — it will be filed exactly as you wrote it.</p>
            )}

            {error && <p className={styles.error}>{error}</p>}

            <footer className={styles.foot}>
              <button className={styles.ghost} onClick={() => setPhase('writing')}>Back</button>
              <span className={styles.spacer} />
              {analysis && <button className={styles.ghost} onClick={() => void file(false)}>File raw instead</button>}
              <button className={styles.primary} onClick={() => void file(true)}>File it</button>
            </footer>
          </div>
        )}

        {phase === 'filed' && filed && (
          <div className={styles.done}>
            <p className={styles.big}>{filed.duplicate ? `Added to ${filed.id}` : `Filed as ${filed.id}`}</p>
            <p className={styles.hint}>
              {filed.duplicate
                ? 'You had already reported this — its counter went up rather than filing a duplicate.'
                : 'It is in docs/BUGS.md and will be picked up in the next development session.'}
            </p>
            <footer className={styles.foot}>
              <span className={styles.spacer} />
              <button className={styles.primary} onClick={onClose}>Done</button>
            </footer>
          </div>
        )}

        {error && phase === 'writing' && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
