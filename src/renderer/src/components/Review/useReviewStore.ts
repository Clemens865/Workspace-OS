import { useSyncExternalStore } from 'react'
import { reviewStore, type ReviewSnapshot } from './reviewStore'

/** Subscribes a component to the shared review store (runs, filter, HITL). */
export function useReviewStore(): ReviewSnapshot {
  return useSyncExternalStore(reviewStore.subscribe, reviewStore.getSnapshot, reviewStore.getSnapshot)
}
