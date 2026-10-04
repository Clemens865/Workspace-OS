import { useEffect, useState } from 'react'
import type { MemoryLite } from './inboxModel'

/**
 * The memories agents noted that the person has not kept yet, for the Inbox.
 * Re-read when memory changes (an agent's memory.remember, a keep/correct/forget
 * here), when the workspace changes, and now and then.
 */
export function useMemoryInbox(): MemoryLite[] {
  const [items, setItems] = useState<MemoryLite[]>([])
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.workspace.memory
        .listMemories({ unconfirmed: true, limit: 50 })
        .then((list) => {
          if (!alive) return
          const next = list.map((m) => ({ id: m.id, text: m.text, kind: m.kind, source: m.source, scope: m.scope, at: m.createdAt }))
          // Same list, same state: the Inbox (and its glass) stays still.
          setItems((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
        })
        .catch(() => {})
    }
    load()
    window.addEventListener('wos:memory-changed', load)
    const off = window.workspace.fs.onRootChanged(load)
    const t = window.setInterval(load, 30_000)
    return () => {
      alive = false
      window.removeEventListener('wos:memory-changed', load)
      off()
      window.clearInterval(t)
    }
  }, [])
  return items
}
