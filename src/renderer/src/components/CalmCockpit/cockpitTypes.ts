/**
 * Type re-exports for the cockpit model — it maps over the REAL review-store
 * shapes, so it imports them from the single source of truth (reviewModel) and
 * the live-activity adjunct. Kept separate so cockpitModel.ts stays a pure,
 * dependency-light module the unit tests can import without React.
 */

export type { ReviewRun, HitlItem } from '../Review/reviewModel'

/** The latest-activity shape the cockpit reads (mirrors activityStore.RunActivity). */
export interface RunActivityLite {
  tool: string
  label: string
  at: number
}
