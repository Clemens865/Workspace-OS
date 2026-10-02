import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { browserDriver } from '../../lib/browserDriver'
import { outputStore, type OutputTail } from './previewStore'
import type { AgentPresence } from './presenceTypes'

/** True while the landscape is on screen; previews only refresh then. */
export const PreviewLive = createContext(false)

export interface BrowserShot {
  src: string
  url: string
  title: string
  at: number
}

const SHOT_EVERY_MS = 2000
/** A drive older than this no longer claims the browser for that run. */
const DRIVE_FRESH_MS = 5 * 60_000

/**
 * What a working agent's screen shows: the page its run is driving (a real
 * capture, refreshed every 2 s while visible, stamped with when it was taken)
 * or the last lines it wrote. Never a stale frame presented as live: every
 * preview carries its own time.
 */
export function useWorkingPreview(a: AgentPresence): { shot: BrowserShot | null; tail: OutputTail | null } {
  const live = useContext(PreviewLive)
  useEffect(() => outputStore.attach(), [])
  useSyncExternalStore(outputStore.subscribe, outputStore.getVersion, outputStore.getVersion)
  const driver = useSyncExternalStore(browserDriver.subscribe, browserDriver.get, browserDriver.get)
  const drives = a.status === 'working' && !!a.runId && driver?.runId === a.runId && Date.now() - driver.at < DRIVE_FRESH_MS
  const [shot, setShot] = useState<BrowserShot | null>(null)

  useEffect(() => {
    if (!drives || !live) return
    let alive = true
    const take = (): void => {
      void window.workspace.browser
        ?.thumbnail?.(420)
        .then((r) => alive && r?.ok && setShot({ src: r.src, url: r.url, title: r.title, at: r.at }))
        .catch(() => {})
    }
    take()
    const id = window.setInterval(take, SHOT_EVERY_MS)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [drives, live])

  return { shot: drives ? shot : null, tail: a.status === 'working' ? (outputStore.get(a.runId) ?? null) : null }
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const TEXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|log)$/i

export type ResultPreview = { kind: 'image'; src: string } | { kind: 'text'; text: string } | null

/** A finished run's first result, small: an image as itself, text as its opening lines. */
export function useResultPreview(path: string | null): ResultPreview {
  const [p, setP] = useState<ResultPreview>(null)
  useEffect(() => {
    setP(null)
    if (!path) return
    let alive = true
    let url: string | null = null
    if (IMAGE.test(path)) {
      void window.workspace.fs
        .readFileBytes(path)
        .then((bytes) => {
          if (!alive) return
          url = URL.createObjectURL(new Blob([bytes as BlobPart]))
          setP({ kind: 'image', src: url })
        })
        .catch(() => {})
    } else if (TEXT.test(path)) {
      void window.workspace.fs
        .readFile(path)
        .then((t) => alive && setP({ kind: 'text', text: t.slice(0, 600) }))
        .catch(() => {})
    }
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [path])
  return p
}

/** "10:24:31" */
export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
