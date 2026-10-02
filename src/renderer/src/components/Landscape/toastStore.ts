/**
 * Toasts (ADOPTION.md B6): a short line that confirms what just happened
 * ("Accepted.", "Reverted to before the run.") wherever you are, landscape or
 * stage, and fades on its own. One small store, read with useSyncExternalStore.
 */
export interface Toast {
  id: number
  text: string
  tone: 'ok' | 'error'
}

const LIFE_MS = 3600
const MAX = 3

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = (): void => listeners.forEach((l) => l())

export const toastStore = {
  getSnapshot: (): Toast[] => toasts,
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  push(text: string, tone: Toast['tone'] = 'ok', life = LIFE_MS): number {
    const t: Toast = { id: ++seq, text, tone }
    toasts = [...toasts, t].slice(-MAX)
    emit()
    if (life > 0 && typeof window !== 'undefined') window.setTimeout(() => toastStore.dismiss(t.id), life)
    return t.id
  },
  dismiss(id: number): void {
    const next = toasts.filter((t) => t.id !== id)
    if (next.length === toasts.length) return
    toasts = next
    emit()
  },
  /** Tests only. */
  reset(): void {
    toasts = []
    emit()
  },
}

/** Confirm an action. */
export const toast = (text: string): number => toastStore.push(text, 'ok')
/** Report a failure (stays a little longer). */
export const toastError = (text: string): number => toastStore.push(text, 'error', 6000)
