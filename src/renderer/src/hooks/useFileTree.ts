import { useState, useCallback, useEffect } from 'react'
import type { TreeNode } from '../types/fs'

// The main process owns the workspace root (it's the security boundary). The
// renderer reads it on mount and only *requests* changes via the folder dialog.

async function loadChildren(dirPath: string): Promise<TreeNode[]> {
  const entries = await window.workspace.fs.readDir(dirPath)
  return entries
    // Hide dotfiles — including `.workspace-os` (trash + config). Matches the
    // Finder default; the office persona never needs to see them.
    .filter((e) => !e.name.startsWith('.'))
    .sort((a, b) => {
      // Directories first, then alphabetical
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((e) => ({ ...e, isLoaded: false }))
}

export interface FileTreeHook {
  root: string
  nodes: TreeNode[]
  expandedPaths: Set<string>
  setRoot: (path: string) => void
  toggle: (node: TreeNode) => Promise<void>
  refresh: (dirPath?: string) => Promise<void>
  /** Expand the tree down to a folder path (breadcrumb "reveal this folder"). */
  revealPath: (target: string) => Promise<void>
}

export function useFileTree(): FileTreeHook {
  const [root, setRootState] = useState<string>('')
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  // Restore the persisted root that the main process owns.
  useEffect(() => {
    window.workspace.fs.getWorkspaceRoot().then((persisted) => {
      if (persisted) setRootState(persisted)
    })
  }, [])

  // React to Open/Close Folder from the application menu.
  useEffect(() => {
    return window.workspace.fs.onRootChanged((newRoot) => {
      setRootState(newRoot ?? '')
      setNodes([])
      setExpandedPaths(new Set())
    })
  }, [])

  const setRoot = useCallback((path: string) => {
    setRootState(path)
    setNodes([])
    setExpandedPaths(new Set())
  }, [])

  const refresh = useCallback(async (dirPath?: string) => {
    const target = dirPath ?? root
    if (!target) return
    const children = await loadChildren(target)
    if (!dirPath || dirPath === root) {
      setNodes(children)
      return
    }
    // Recursively update the subtree for dirPath
    setNodes((prev) => updateSubtree(prev, dirPath, children))
  }, [root])

  const toggle = useCallback(async (node: TreeNode) => {
    if (!node.isDirectory) return
    if (expandedPaths.has(node.path)) {
      setExpandedPaths((s) => { const n = new Set(s); n.delete(node.path); return n })
      return
    }
    if (!node.isLoaded) {
      const children = await loadChildren(node.path)
      setNodes((prev) => updateSubtree(prev, node.path, children))
    }
    setExpandedPaths((s) => new Set(s).add(node.path))
  }, [expandedPaths])

  // Expand the tree down to (and including) a folder path, loading each ancestor
  // level as needed. Used by breadcrumb navigation ("reveal this folder").
  const revealPath = useCallback(async (target: string) => {
    if (!root || !target.startsWith(root) || target === root) return
    const rel = target.slice(root.length).split('/').filter(Boolean)
    let cur = root
    for (const seg of rel) {
      cur = `${cur}/${seg}`
      const children = await loadChildren(cur).catch(() => null) // null if it's a file, not a dir
      if (children) setNodes((prev) => updateSubtree(prev, cur, children))
      // eslint-disable-next-line no-loop-func
      setExpandedPaths((s) => new Set(s).add(cur))
    }
  }, [root])

  useEffect(() => {
    if (!root) return
    refresh()
    // Watch the root so external/agent changes reflect live in the tree.
    window.workspace.fs.watchStart()
    // Kick off background content indexing for full-text search.
    window.workspace.search.start()
    return () => { window.workspace.fs.watchStop() }
  }, [root, refresh])

  // Wire file watcher events from main process
  useEffect(() => {
    const removeListener = window.workspace.fs.onWatchEvent?.((event) => {
      // Refresh the parent directory of the changed file
      const parentDir = event.path.substring(0, event.path.lastIndexOf('/'))
      if (parentDir && expandedPaths.has(parentDir)) refresh(parentDir)
    })
    return () => removeListener?.()
  }, [expandedPaths, refresh])

  return { root, nodes, expandedPaths, setRoot, toggle, refresh, revealPath }
}

function updateSubtree(nodes: TreeNode[], targetPath: string, children: TreeNode[]): TreeNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return { ...n, children, isLoaded: true }
    if (n.children) return { ...n, children: updateSubtree(n.children, targetPath, children) }
    return n
  })
}
