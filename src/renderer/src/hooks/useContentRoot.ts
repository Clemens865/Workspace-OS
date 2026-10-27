import { useEffect, useState } from 'react'
import { useWorkspaceRoot } from './useWorkspaceRoot'

/**
 * The workspace-relative folder that holds Cases/, Work/, Wiki/ and Apps/
 * ('' = the workspace root, the default). Configured per folder in the main
 * process (host-profile.ts); follows Open/Close Folder.
 */
export function useContentRel(): string {
  const root = useWorkspaceRoot()
  const [rel, setRel] = useState('')
  useEffect(() => {
    let live = true
    if (!root) { setRel(''); return }
    window.workspace.fs.getContentRoot?.().then((c) => { if (live) setRel(c?.rel ?? '') }).catch(() => {})
    return () => { live = false }
  }, [root])
  return rel
}

/** `<rel>/<folder>/`, or `<folder>/` when the content folders sit at the root. */
export const contentPrefix = (rel: string, folder: string): string => (rel ? `${rel}/${folder}/` : `${folder}/`)
