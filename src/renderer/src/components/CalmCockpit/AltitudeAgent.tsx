import { AGENT_VIEW } from './mock'
import styles from './Altitude.module.css'

const KIND_GLYPH: Record<string, string> = {
  deck: '◧',
  xlsx: '▦',
  docx: '▤',
  email: '✉',
  note: '•'
}

/**
 * Agent altitude (flying DOWN, deepest zoom) — ONE agent, single-focus and
 * detailed: its live activity trail, a confidence read, turns + cost, and the
 * artifact taking shape in a thumbnail slot. This is the most magnified view.
 */
export function AltitudeAgent(): JSX.Element {
  const a = AGENT_VIEW
  const pct = Math.round(a.confidence * 100)
  return (
    <>
      <p className={styles.altStatus}>
        Zoomed into <strong>{a.name}</strong> · {a.role}. {a.live}.
      </p>

      <section className={styles.agentGrid}>
        {/* Left — the live activity trail. */}
        <div className={styles.agentCol}>
          <h2 className={styles.sectionTitle}>Activity trail</h2>
          <ol className={styles.trail}>
            {a.trail.map((t) => (
              <li key={t.id} className={`${styles.step} ${t.done ? styles.stepDone : styles.stepLive}`}>
                <span className={styles.stepMark} aria-hidden>
                  {t.done ? '✓' : '◦'}
                </span>
                <span className={styles.stepLine}>{t.line}</span>
              </li>
            ))}
          </ol>

          <div className={styles.reads}>
            <div className={styles.read}>
              <span className={styles.readLabel}>Confidence</span>
              <span className={styles.confBar} aria-hidden>
                <span className={styles.confFill} style={{ width: `${pct}%` }} />
              </span>
              <span className={styles.readVal}>{a.confidence.toFixed(2)} · watching</span>
            </div>
            <div className={styles.readRow}>
              <span className={styles.read}>
                <span className={styles.readLabel}>Turns</span>
                <span className={styles.readBig}>{a.turns}</span>
              </span>
              <span className={styles.read}>
                <span className={styles.readLabel}>Cost so far</span>
                <span className={styles.readBig}>{a.cost}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Right — the artifact taking shape (thumbnail slot). */}
        <div className={styles.agentCol}>
          <h2 className={styles.sectionTitle}>Taking shape</h2>
          <div className={styles.artifact}>
            <div className={styles.thumb} aria-hidden>
              <span className={styles.thumbGlyph}>{KIND_GLYPH[a.artifact.kind] ?? '•'}</span>
              <span className={styles.thumbProgress}>{a.artifact.progress}</span>
            </div>
            <div className={styles.artifactMeta}>
              <span className={styles.artifactLabel}>{a.artifact.label}</span>
              <button className={styles.artifactOpen}>→ open in progress</button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
