import { useReviewStore } from './useReviewStore'
import { reviewStore } from './reviewStore'
import { feedCounts, type FeedFilter } from './reviewModel'
import styles from './ReviewRail.module.css'

/**
 * The Living-Feed left rail, in the sidebar slot: filter the feed by family and
 * surface the counts. Selecting a filter drives the wide center feed
 * (ReviewFeed) via the shared review store.
 */
export function ReviewRail(): JSX.Element {
  const { filter, runs, hitl } = useReviewStore()
  const counts = feedCounts(runs, hitl)

  const items: { key: FeedFilter; label: string; n: number }[] = [
    { key: 'all', label: 'All activity', n: counts.total },
    { key: 'edit', label: 'Edits', n: counts.edits },
    { key: 'action', label: 'Actions', n: counts.actions },
    { key: 'resolved', label: 'Resolved', n: counts.resolved },
  ]

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Review</span>
        {counts.total > 0 && <span className={styles.badge}>{counts.total}</span>}
      </div>

      <div className={styles.filters}>
        {items.map((it) => (
          <button
            key={it.key}
            className={`${styles.filter} ${filter === it.key ? styles.filterActive : ''}`}
            onClick={() => reviewStore.setFilter(it.key)}
            data-testid={`review-filter-${it.key}`}
          >
            <span className={styles.filterLabel}>{it.label}</span>
            <span className={styles.filterCount}>{it.n}</span>
          </button>
        ))}
      </div>

      {counts.resolved > 0 && (
        <button className={styles.clear} onClick={() => reviewStore.clearResolved()}>
          Clear resolved
        </button>
      )}

      <p className={styles.hint}>
        Each agent run is one card. Keep or revert — both clear the queue equally. The reward is an empty feed.
      </p>
    </div>
  )
}
