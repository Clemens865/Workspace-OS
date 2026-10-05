import { useSyncExternalStore } from 'react'

/**
 * Which conversation sits beside the stage, if any. One chat, two places: the
 * Chat view is its home; pulled out, it sits next to whatever the person is
 * working on (the browser it is driving, the document it is about) and goes
 * back to Chat when they are done.
 */
export interface ChatSideState {
  open: boolean
  /** The conversation beside the stage; null: a new one starts on the first message. */
  sessionId: string | null
}

let state: ChatSideState = { open: false, sessionId: null }
const listeners = new Set<() => void>()
const set = (next: ChatSideState): void => {
  state = next
  listeners.forEach((l) => l())
}

export const chatSide = {
  get: (): ChatSideState => state,
  subscribe(l: () => void): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
  /** Put a conversation beside the stage (null: a new one). */
  show(sessionId: string | null): void {
    set({ open: true, sessionId })
  },
  /** The new conversation got its id with its first message. */
  adopt(sessionId: string): void {
    set({ ...state, sessionId })
  },
  toggle(): void {
    set({ ...state, open: !state.open })
  },
  close(): void {
    set({ ...state, open: false })
  },
}

export function useChatSide(): ChatSideState {
  return useSyncExternalStore(chatSide.subscribe, chatSide.get, chatSide.get)
}
