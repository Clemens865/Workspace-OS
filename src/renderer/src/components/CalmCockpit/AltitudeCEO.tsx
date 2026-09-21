import { CEO_VIEW } from './mock'
import { DecisionItem } from './DecisionItem'
import styles from './Altitude.module.css'

/**
 * CEO altitude (flying UP) — company WEATHER. ~6 teams as soft regions, each
 * with a health tone; most read calm and recede, ONE runs warm. Plain-language
 * momentum notes, NOT KPI cards. Only the CEO's own decision is warm/forward.
 * Hide-the-healthy at company scale.
 */
export function AltitudeCEO({ onDrill }: { onDrill?: () => void }): JSX.Element {
  const v = CEO_VIEW
  return (
    <>
      <p className={styles.altStatus}>{v.status}</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Company weather</h2>
        <div className={styles.weather}>
          {v.regions.map((r) => (
            <button
              key={r.id}
              className={`${styles.region} ${r.tone === 'warm' ? styles.regionWarm : ''}`}
              onClick={onDrill}
              title={r.tone === 'warm' ? `${r.team} needs a look` : `${r.team} · calm`}
            >
              <span className={styles.regionTeam}>{r.team}</span>
              <span className={styles.regionNote}>{r.note}</span>
              <span
                className={`${styles.regionTone} ${r.tone === 'warm' ? styles.toneWarm : styles.toneCalm}`}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={`${styles.sectionTitle} ${styles.warmHeading}`}>
          <span className={styles.warmDot} /> Needs you
        </h2>
        <div className={styles.decisions}>
          {v.decisions.map((d) => (
            <DecisionItem key={d.id} d={d} onResolve={() => undefined} />
          ))}
        </div>
      </section>
    </>
  )
}
