import { useSyncExternalStore } from 'react'
import { mailReviewStore, type MailReviewSnapshot } from './mailReviewStore'

/** Subscribes a component to the shared mail-review store (mail cards). */
export function useMailReviewStore(): MailReviewSnapshot {
  return useSyncExternalStore(
    mailReviewStore.subscribe,
    mailReviewStore.getSnapshot,
    mailReviewStore.getSnapshot,
  )
}
