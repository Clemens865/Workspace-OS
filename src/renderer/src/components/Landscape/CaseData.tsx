import { useEffect, useState } from 'react'
import type { ArtifactInsight, CaseViewResult } from '../../types/workspace-api'
import { Chart, Kpis, Preview } from '../CalmCockpit/FullCaseView'
import styles from './CaseActions.module.css'

/**
 * A case's own numbers (ADOPTION.md B3, from the Cockpit's full case view):
 * the view the case declares for itself (its `## View`), then one card per
 * data file with KPIs, a small chart and a table preview.
 */
export function CaseData({ caseId }: { caseId: string }): JSX.Element {
  const [data, setData] = useState<ArtifactInsight[] | null>(null)
  const [view, setView] = useState<CaseViewResult | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    setView(null)
    void window.workspace.cases.insights(caseId).then((d) => live && setData(d)).catch(() => live && setData([]))
    void window.workspace.cases.view(caseId).then((v) => live && setView(v)).catch(() => live && setView(null))
    return () => {
      live = false
    }
  }, [caseId])

  if (data === null) return <p className={styles.muted}>Reading the case’s data…</p>
  if (!view && !data.length) return <p className={styles.muted}>No numbers yet. Spreadsheets and CSV files on the case show up here.</p>

  return (
    <div className={styles.data} data-testid="case-data">
      {view && (
        <div className={styles.dcard}>
          <div className={styles.dhead}>{view.title ?? 'Overview'}</div>
          {view.kpis.length > 0 && <Kpis kpis={view.kpis} />}
          {view.chart && <Chart chart={view.chart} />}
          {view.table && <Preview preview={view.table.preview} />}
        </div>
      )}
      {data.map((d) => (
        <div key={d.file} className={styles.dcard} data-file={d.file}>
          <div className={styles.dhead}>{d.file.split('/').pop()}</div>
          <Kpis kpis={d.kpis} />
          {d.chart && <Chart chart={d.chart} />}
          {d.preview.length > 1 && <Preview preview={d.preview} />}
        </div>
      ))}
    </div>
  )
}
