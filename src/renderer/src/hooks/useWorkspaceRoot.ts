import { useState, useEffect } from 'react'

/**
 * Tracks the active workspace root owned by the main process. Reads it on mount
 * and follows Open/Close Folder changes. Lets layout-level concerns (the shared
 * library) scope to the same workspace as the file tree.
 */
export function useWorkspaceRoot(): string {
  const [root, setRoot] = useState('')

  useEffect(() => {
    window.workspace.fs.getWorkspaceRoot().then((r) => { if (r) setRoot(r) })
    return window.workspace.fs.onRootChanged((r) => setRoot(r ?? ''))
  }, [])

  return root
}
