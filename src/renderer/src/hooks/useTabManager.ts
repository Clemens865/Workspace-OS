import { useState, useCallback, useRef } from 'react'
import path from 'path-browserify'
import type { Tab } from '../types/tab'

const HISTORY_MAX = 50

let nextId = 1

function makeTab(filePath: string): Tab {
  return {
    id: String(nextId++),
    filePath,
    label: path.basename(filePath),
    isPinned: false,
    isDirty: false,
  }
}

export interface TabManager {
  tabs: Tab[]
  activeId: string | null
  openFile: (filePath: string) => void
  closeTab: (id: string) => void
  activateTab: (id: string) => void
  pinTab: (id: string) => void
  markDirty: (id: string, dirty: boolean) => void
  moveTab: (fromIndex: number, toIndex: number) => void
  /** Navigate the tab-activation history (Go ▸ Back / Forward). */
  goBack: () => void
  goForward: () => void
  /** Replaces all tabs wholesale (session restore / snapshot restore). */
  restoreTabs: (files: string[], activeFile: string | null) => void
  activeFilePath: string | null
}

export function useTabManager(): TabManager {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const tabsRef = useRef<Tab[]>(tabs)
  tabsRef.current = tabs

  // Activation history for Go ▸ Back/Forward. A ref (not state): navigation
  // re-renders via setActiveId; the stack itself never needs to.
  const history = useRef<{ stack: string[]; index: number }>({ stack: [], index: -1 })

  const record = useCallback((id: string) => {
    const h = history.current
    if (h.stack[h.index] === id) return
    h.stack = h.stack.slice(0, h.index + 1)
    h.stack.push(id)
    if (h.stack.length > HISTORY_MAX) h.stack.shift()
    h.index = h.stack.length - 1
  }, [])

  const openFile = useCallback((filePath: string) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.filePath === filePath)
      if (existing) {
        record(existing.id)
        setActiveId(existing.id)
        return prev
      }
      const tab = makeTab(filePath)
      record(tab.id)
      setActiveId(tab.id)
      return [...prev, tab]
    })
  }, [record])

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id)
      const next = prev.filter((t) => t.id !== id)
      setActiveId((currentId) => {
        if (currentId !== id) return currentId
        // Activate the tab to the right, or left if last
        const sibling = next[index] ?? next[index - 1] ?? null
        return sibling?.id ?? null
      })
      return next
    })
  }, [])

  const activateTab = useCallback((id: string) => {
    record(id)
    setActiveId(id)
  }, [record])

  // Walk the history to the nearest entry whose tab still exists; activate it
  // without re-recording (so Back → Forward round-trips). Reads tabs via a ref
  // — mutating history inside a state updater would double-step in StrictMode.
  const navigate = useCallback((dir: -1 | 1) => {
    const h = history.current
    const alive = new Set(tabsRef.current.map((t) => t.id))
    let i = h.index + dir
    while (i >= 0 && i < h.stack.length && !alive.has(h.stack[i])) i += dir
    if (i >= 0 && i < h.stack.length) {
      h.index = i
      setActiveId(h.stack[i])
    }
  }, [])

  const goBack = useCallback(() => navigate(-1), [navigate])
  const goForward = useCallback(() => navigate(1), [navigate])

  const pinTab = useCallback((id: string) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isPinned: !t.isPinned } : t))
    )
  }, [])

  const markDirty = useCallback((id: string, dirty: boolean) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t))
    )
  }, [])

  const moveTab = useCallback((fromIndex: number, toIndex: number) => {
    setTabs((prev) => {
      const next = [...prev]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      return next
    })
  }, [])

  // Wholesale replacement for session/snapshot restore: fresh tabs for every
  // path (deduped, order kept), history reset to just the active tab.
  const restoreTabs = useCallback((files: string[], activeFile: string | null) => {
    const next = [...new Set(files)].map(makeTab)
    const active = next.find((t) => t.filePath === activeFile) ?? next[next.length - 1] ?? null
    history.current = { stack: active ? [active.id] : [], index: active ? 0 : -1 }
    setTabs(next)
    setActiveId(active?.id ?? null)
  }, [])

  const activeFilePath = tabs.find((t) => t.id === activeId)?.filePath ?? null

  return { tabs, activeId, openFile, closeTab, activateTab, pinTab, markDirty, moveTab, goBack, goForward, restoreTabs, activeFilePath }
}
