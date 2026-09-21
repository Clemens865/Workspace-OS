import { useEffect, useState } from 'react'
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
export function useCreatedAssets(): CreatedAsset[] {
  const [assets, setAssets] = useState<CreatedAsset[]>([])

  useEffect(() => {
    const off = window.workspace.fs.onWatchEvent?.((e) => {
      // applyEvent returns the SAME array when nothing relevant happened, so an
      // irrelevant event (and the watcher is chatty) costs no re-render.
      setAssets((prev) => applyEvent(prev, e.event, e.path, Date.now()))
    })
    return () => off?.()
  }, [])

  return assets
}
