import { useEffect, useRef } from 'react'
import type { TreeNode } from '../../types/fs'
import styles from './ContextMenu.module.css'
import { toast } from '../Landscape/toastStore'
import { FILE_MANAGER } from '../../lib/platform'

/** The app reads the file (or the folder's documents) and writes its pages in Wiki/; Library → Notes shows the progress. */
async function addToWiki(target: string): Promise<void> {
  try {
    const r = await window.workspace.wiki.add([target])
    toast(r.queued ? `Adding ${r.queued === 1 ? 'it' : `${r.queued} files`} to the wiki. Library → Notes shows the pages.` : 'Already in the wiki, and unchanged.')
  } catch (e) {
    toast(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not add that to the wiki.')
  }
}

interface ContextMenuProps {
  node: TreeNode
  x: number
  y: number
  isStarred: boolean
  onClose: () => void
  onRename: (node: TreeNode) => void
  onDelete: (node: TreeNode) => void
  onNewFile: (node: TreeNode) => void
  onNewFolder: (node: TreeNode) => void
  onReveal: (node: TreeNode) => void
  onToggleStar: () => void
  /** Start a case with this file as its first artifact (files only). */
  onStartCase: (node: TreeNode) => void
}

export function ContextMenu({ node, x, y, isStarred, onClose, onRename, onDelete, onNewFile, onNewFolder, onReveal, onToggleStar, onStartCase }: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  const item = (label: string, action: () => void, danger = false) => (
    <button
      className={`${styles.item} ${danger ? styles.danger : ''}`}
      onClick={() => { action(); onClose() }}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      role="menu"
    >
      {node.isDirectory && item('New File', () => onNewFile(node))}
      {node.isDirectory && item('New Folder', () => onNewFolder(node))}
      {node.isDirectory && <div className={styles.separator} />}
      {!node.isDirectory && item(isStarred ? 'Unstar' : 'Star', onToggleStar)}
      {!node.isDirectory && item('Start a case from this file', () => onStartCase(node))}
      {item('Add to the wiki', () => void addToWiki(node.path))}
      {item('Rename', () => onRename(node))}
      {item(`Reveal in ${FILE_MANAGER}`, () => onReveal(node))}
      <div className={styles.separator} />
      {item('Delete', () => onDelete(node), true)}
    </div>
  )
}
