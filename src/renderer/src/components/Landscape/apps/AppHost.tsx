import { useEffect, useRef, useState } from 'react'
import { Minimize2 } from 'lucide-react'
import type { WosAppManifest } from '../../../types/workspace-api'
import styles from './AppsView.module.css'

/** What an app may ask for (resources/apps-kit/bridge.js), and the permission each needs. */
const METHODS: Record<string, ((m: WosAppManifest, args: Record<string, unknown>) => boolean) | true> = {
  'ai.complete': (m, a) => (a.web === true ? m.permissions.includes('ai.web') : m.permissions.includes('ai') || m.permissions.includes('ai.web')),
  'storage.get': true,
  'storage.set': true,
  'storage.remove': true,
  'storage.keys': true,
  'files.save': true,
  'files.open': true,
}

const themeNow = (): 'light' | 'dark' => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light')
const reason = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The request failed')

/**
 * Runs one app, served from wos-app:// (its own policy: scripts, no network;
 * see handlers/apps.ts): its page in a frame with scripts but no origin (it cannot reach
 * the app, its storage or the network), and the only way out is a message the
 * host checks: from this frame, a known request, granted by app.json. Main
 * checks again. `version` reloads it (the builder changed a file).
 *
 * `full` puts it over the whole screen (the host's button turns it on;
 * Escape, the Exit button or leaving the screen's full screen turn it off).
 */
export function AppHost({ slug, version = 0, full = false, onFull }: { slug: string; version?: number | string; full?: boolean; onFull?: (on: boolean) => void }): JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  // Read by the message listener (an Escape the app did not use), which outlives renders.
  const fullRef = useRef(full)
  const onFullRef = useRef(onFull)
  fullRef.current = full
  onFullRef.current = onFull
  const [doc, setDoc] = useState<{ manifest: WosAppManifest; src: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    setError(null)
    window.workspace.apps
      .manifest(slug)
      .then((manifest) => live && setDoc({ manifest, src: `wos-app://app/${slug}/?theme=${themeNow()}&v=${encodeURIComponent(String(version))}` }))
      .catch((e) => live && setError(reason(e)))
    return () => {
      live = false
    }
  }, [slug, version])

  // Requests from the app.
  useEffect(() => {
    if (!doc) return
    const onMessage = (e: MessageEvent): void => {
      const win = frame.current?.contentWindow
      if (!win || e.source !== win) return
      const m = e.data as { __wos?: number; type?: string; id?: number; method?: string; args?: Record<string, unknown> }
      if (m && m.__wos === 1 && m.type === 'escape') return void (fullRef.current && onFullRef.current?.(false))
      if (!m || m.__wos !== 1 || m.type !== 'call' || typeof m.id !== 'number' || typeof m.method !== 'string') return
      const reply = (ok: boolean, value?: unknown, err?: string): void => win.postMessage({ __wos: 1, type: 'reply', id: m.id, ok, value, error: err }, '*')
      const rule = METHODS[m.method]
      const args = m.args && typeof m.args === 'object' ? m.args : {}
      if (!rule) return reply(false, undefined, `Apps cannot do “${m.method}”`)
      if (rule !== true && !rule(doc.manifest, args)) return reply(false, undefined, `${doc.manifest.name} is not allowed to use ${m.method === 'ai.complete' && args.web ? 'web lookup' : 'AI'} (see its app.json)`)
      window.workspace.apps.call(slug, m.method, args).then(
        (v) => reply(true, v),
        (err) => reply(false, undefined, reason(err)),
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [doc, slug])

  // The app follows the workspace's light and dark.
  useEffect(() => {
    const obs = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ __wos: 1, type: 'theme', theme: themeNow() }, '*'))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  // Full screen: the app over everything. A window already in macOS full screen is simply covered;
  // a smaller window goes full screen with it (the page's own full screen) and comes back after.
  // Measured 2026-10-06: the page's full screen over a full-screen window let Escape take the
  // WINDOW out of full screen too, and it stayed out.
  useEffect(() => {
    if (!full) return
    const el = wrap.current
    let entered = false
    let live = true
    void window.workspace.apps
      .windowFull()
      .catch(() => true)
      .then((windowFull) => {
        if (!live || windowFull || !el || document.fullscreenElement) return
        return el.requestFullscreen().then(() => void (entered = true))
      })
      .catch(() => {})
    frame.current?.focus()
    const onChange = (): void => {
      if (entered && !document.fullscreenElement) onFull?.(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFull?.(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    window.addEventListener('keydown', onKey)
    return () => {
      live = false
      document.removeEventListener('fullscreenchange', onChange)
      window.removeEventListener('keydown', onKey)
      if (el && document.fullscreenElement === el) void document.exitFullscreen().catch(() => {})
    }
  }, [full, onFull])

  if (error) return <div className={styles.appError}>This app could not start: {error}</div>
  if (!doc) return <div className={styles.appLoading} />
  return (
    <div ref={wrap} className={`${styles.appWrap} ${full ? styles.appFull : ''}`} data-testid="app-host" data-full={full ? '' : undefined}>
      <iframe ref={frame} className={styles.appFrame} sandbox="allow-scripts allow-modals" src={doc.src} title={doc.manifest.name} data-testid="app-frame" data-app={slug} />
      {full && (
        <button type="button" className={styles.appExit} onClick={() => onFull?.(false)} title="Leave full screen (Esc)" data-testid="app-exit-full">
          <Minimize2 size={13} /> Exit full screen
        </button>
      )}
    </div>
  )
}
