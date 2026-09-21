/**
 * Observable singleton for MAIL cards in the Living Feed. Mirrors reviewStore's
 * shape (subscribe / getSnapshot / bounded localStorage persistence) so the mail
 * cards render alongside agent runs without touching ReviewStore's semantics.
 *
 * State transitions (draft/send) live here; the pure state-machine predicates
 * are in mailReviewModel.ts and unit-tested there. This store is the thin,
 * side-effecting adapter React subscribes to.
 */

import {
  cardFromTriage,
  mailCardId,
  type MailCard,
  type MailCardStatus,
} from './mailReviewModel'

type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const STORE_KEY = 'workspace-os:mail-review:v1'
const CARDS_MAX = 40
const SAVE_DELAY_MS = 300

function memoryStorage(): StringStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** A triage hit as passed in from the IPC layer (mirror of MailNeedsReply). */
export interface TriageHit {
  folder: string
  uid: number
  subject: string
  from: { name: string; address: string } | null
  reason: string
  score: number
}

export interface MailReviewSnapshot {
  version: number
  cards: MailCard[]
}

export class MailReviewStore {
  private cards: MailCard[] = []
  private listeners = new Set<() => void>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private version = 0
  private cachedSnapshot: MailReviewSnapshot | null = null

  constructor(
    private storage: StringStorage,
    private now: () => number = () => Date.now(),
  ) {
    this.load()
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(STORE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        this.cards = parsed.filter((c): c is MailCard => typeof (c as MailCard)?.id === 'string')
      }
    } catch {
      this.cards = []
    }
  }

  private emit(): void {
    this.version++
    this.cachedSnapshot = null
    for (const l of this.listeners) l()
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        this.storage.setItem(STORE_KEY, JSON.stringify(this.cards))
      } catch {
        // best-effort
      }
    }, SAVE_DELAY_MS)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): MailReviewSnapshot => {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = { version: this.version, cards: this.cards }
    }
    return this.cachedSnapshot
  }

  private find(id: string): MailCard | undefined {
    return this.cards.find((c) => c.id === id)
  }

  private patch(id: string, patch: Partial<MailCard>): void {
    let changed = false
    this.cards = this.cards.map((c) => {
      if (c.id !== id) return c
      changed = true
      return { ...c, ...patch }
    })
    if (changed) this.emit()
  }

  /**
   * Merges a triage result into the feed. New hits become `needs-draft` cards;
   * hits already present are left untouched (so an in-progress draft or a
   * resolved card is never clobbered by a re-scan).
   */
  ingestTriage(accountId: string, folder: string, hits: TriageHit[]): void {
    let changed = false
    /*
     * A fresh scan is the AUTHORITY for what still needs a draft in the folder
     * it scanned. Cards used to only accumulate — nothing ever removed a
     * `needs-draft` card once the mail was read elsewhere or once better rules
     * stopped classifying it as needing a reply, so fossils from the weaker
     * classifier filled the cockpit with "newsletters that need you". The
     * scanned folder is passed EXPLICITLY (not derived from the hits) so that
     * an empty result — the clean-inbox case — still retires its fossils.
     * Cards mid-flight (drafting / drafted / sent / error) survive: they
     * carry work the person may be looking at.
     */
    const fresh = new Set(hits.map((h) => mailCardId(accountId, h.folder, h.uid)))
    const before = this.cards.length
    this.cards = this.cards.filter(
      (c) =>
        c.status !== 'needs-draft' ||
        c.source.accountId !== accountId ||
        c.source.folder !== folder ||
        fresh.has(c.id),
    )
    if (this.cards.length !== before) changed = true

    for (const hit of hits) {
      const id = mailCardId(accountId, hit.folder, hit.uid)
      if (this.find(id)) continue
      this.cards = [cardFromTriage(accountId, hit, this.now()), ...this.cards].slice(0, CARDS_MAX)
      changed = true
    }
    if (changed) this.emit()
  }

  /** Marks a card as drafting (the agent request is in flight). */
  markDrafting(id: string): void {
    this.patch(id, { status: 'drafting', error: null })
  }

  /** Records a returned draft; opens the card into the drafted (reviewable) state. */
  setDraft(id: string, body: string, replyAll: boolean): void {
    this.patch(id, { status: 'drafted', draftBody: body, replyAll, error: null })
  }

  /** Records a drafting failure (retryable). */
  setDraftError(id: string, message: string): void {
    this.patch(id, { status: 'draft-error', error: message })
  }

  /** User edited the draft body inline. */
  editDraft(id: string, body: string): void {
    this.patch(id, { draftBody: body })
  }

  /** Marks the draft tier opened — the send gate (see canArmSend). */
  openDraft(id: string): void {
    const card = this.find(id)
    if (card && !card.draftOpened) this.patch(id, { draftOpened: true })
  }

  /** Toggle reply-all vs direct reply (only before a draft exists). */
  setReplyAll(id: string, replyAll: boolean): void {
    this.patch(id, { replyAll })
  }

  markSending(id: string): void {
    this.patch(id, { status: 'sending', error: null })
  }

  /** Resolves a card as sent (terminal). */
  markSent(id: string): void {
    this.patch(id, { status: 'sent', resolvedAt: this.now() })
  }

  setSendError(id: string, message: string): void {
    this.patch(id, { status: 'send-error', error: message })
  }

  /** Resolves a card as dismissed (terminal, equal-weight to sent). */
  dismiss(id: string): void {
    this.patch(id, { status: 'dismissed', resolvedAt: this.now() })
  }

  /** Sets status directly (used by the state machine / tests). */
  setStatus(id: string, status: MailCardStatus): void {
    this.patch(id, { status })
  }

  /** Empties the store. For tests/e2e isolation. */
  reset(): void {
    this.cards = []
    this.emit()
  }

  clearResolved(): void {
    const before = this.cards.length
    this.cards = this.cards.filter((c) => c.status !== 'sent' && c.status !== 'dismissed')
    if (this.cards.length !== before) this.emit()
  }
}

export const mailReviewStore = new MailReviewStore(
  typeof localStorage === 'undefined' ? memoryStorage() : localStorage,
)

// Expose the singleton for e2e/dev harnesses to seed a card without a real inbox.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __mailReviewStore?: MailReviewStore }).__mailReviewStore = mailReviewStore
}
