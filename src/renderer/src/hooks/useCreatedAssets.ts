import { useSyncExternalStore } from 'react'
import { applyEvent, type CreatedAsset } from '../lib/createdAssets'

/**
 * Assets that appeared in the workspace during this session.
 *
 * Fed by the workspace file watcher, so it does not care WHO made the file —
 * the in-app agent, a plain `claude` in the terminal, a script, a download.
 * Every producer ends the same way, with a file on disk.
 *
 * Session-scoped on purpose: this answers "what just happened", not "what do I
 * have". The Files surface and Recent already answer the second question, and a
 * "just created" list that survives restarts is simply a worse file browser.
 */
// One app-wide list, listening from the moment the app loads: a view that
// mounts later (the landscape's Today) still sees what appeared before it.
let assets: CreatedAsset[] = []
const listeners = new Set<() => void>()
let started = false

function start(): void {
  if (started || typeof window === 'undefined' || !window.workspace?.fs) return
  started = true
  window.workspace.fs.onWatchEvent?.((e) => {
    // applyEvent returns the SAME array when nothing relevant happened, so an
    // irrelevant event (and the watcher is chatty) costs no re-render.
    const next = applyEvent(assets, e.event, e.path, Date.now())
    if (next === assets) return
    assets = next
    listeners.forEach((l) => l())
  })
  // A different workspace has its own news.
  window.workspace.fs.onRootChanged?.(() => {
    assets = []
    listeners.forEach((l) => l())
  })
}
start()

const subscribe = (l: () => void): (() => void) => {
  start()
  listeners.add(l)
  return () => listeners.delete(l)
}
const getSnapshot = (): CreatedAsset[] => assets

export function useCreatedAssets(): CreatedAsset[] {
  return useSyncExternalStore(subscribe, getSnapshot)
}
