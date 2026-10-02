import { useState, useCallback } from 'react'
import type { TreeNode } from '../../types/fs'
import { ChevronRight } from 'lucide-react'
import { FileIcon } from './fileIcons'
import { ContextMenu } from './ContextMenu'
import { NewCaseDialog } from '../CalmCockpit/NewCaseDialog'
import { NameDialog } from './NameDialog'
import styles from './FileTree.module.css'

interface FileTreeProps {
  nodes: TreeNode[]
  expandedPaths: Set<string>
  onToggle: (node: TreeNode) => void
  onFileOpen: (filePath: string) => void
  onRefresh: (dirPath?: string) => void
  isStarred: (path: string) => boolean
  onToggleStar: (path: string) => void
  depth?: number
}

/** The in-app dialog standing in for window.prompt / window.confirm. */
interface DialogState {
  kind: 'newFile' | 'newFolder' | 'delete'
  node: TreeNode
}

interface ContextState {
  node: TreeNode
  x: number
  y: number
}

export function FileTree({ nodes, expandedPaths, onToggle, onFileOpen, onRefresh, isStarred, onToggleStar, depth = 0 }: FileTreeProps): JSX.Element {
  const [context, setContext] = useState<ContextState | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // "Start a case from this file" — the file becomes the case's first artifact.
  const [startCaseFile, setStartCaseFile] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault()
    e.stopPropagation()
    setContext({ node, x: e.clientX, y: e.clientY })
  }, [])

  const handleRename = useCallback((node: TreeNode) => {
    setRenamingPath(node.path)
    setRenameValue(node.name)
  }, [])

  const commitRename = useCallback(async (node: TreeNode) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.name) {
      await window.workspace.fs.rename(node.path, trimmed)
      const parent = node.path.substring(0, node.path.lastIndexOf('/'))
      onRefresh(parent)
    }
    setRenamingPath(null)
  }, [renameValue, onRefresh])

  const handleDelete = useCallback((node: TreeNode) => {
    setDialog({ kind: 'delete', node })
  }, [])

  const confirmDelete = useCallback(async (node: TreeNode) => {
    setDialog(null)
    await window.workspace.fs.delete(node.path)
    const parent = node.path.substring(0, node.path.lastIndexOf('/'))
    onRefresh(parent)
  }, [onRefresh])

  const handleNewFile = useCallback((node: TreeNode) => {
    setDialog({ kind: 'newFile', node })
  }, [])

  const handleNewFolder = useCallback((node: TreeNode) => {
    setDialog({ kind: 'newFolder', node })
  }, [])

  const createEntry = useCallback(async (node: TreeNode, name: string, isDirectory: boolean) => {
    setDialog(null)
    if (!name.trim()) return
    await window.workspace.fs.create(node.path, name.trim(), isDirectory)
    onRefresh(node.path)
  }, [onRefresh])

  const handleReveal = useCallback((node: TreeNode) => {
    // Opens in system Finder/Explorer via shell.openPath in main
    window.workspace.fs.reveal?.(node.path)
  }, [])

  return (
    <>
      <div className={styles.tree}>
        {nodes.map((node) => {
          const isExpanded = expandedPaths.has(node.path)
          const isRenaming = renamingPath === node.path

          return (
            <div key={node.path}>
              <div
                className={styles.row}
                style={{ paddingLeft: 8 + depth * 16 }}
                onClick={() => node.isDirectory ? onToggle(node) : onFileOpen(node.path)}
                onContextMenu={(e) => handleContextMenu(e, node)}
                role={node.isDirectory ? 'treeitem' : 'button'}
                aria-expanded={node.isDirectory ? isExpanded : undefined}
                draggable={!node.isDirectory}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', node.path)
                  e.dataTransfer.setData('application/x-wos-path', node.path)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    node.isDirectory ? onToggle(node) : onFileOpen(node.path)
                  }
                }}
              >
                <span className={`${styles.chevron} ${isExpanded ? styles.chevronOpen : ''}`}>
                  {node.isDirectory && <ChevronRight size={14} strokeWidth={2} />}
                </span>
                <span className={styles.icon}>
                  <FileIcon name={node.name} isDirectory={node.isDirectory} isExpanded={isExpanded} />
                </span>

                {isRenaming ? (
                  <input
                    className={styles.renameInput}
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(node)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(node)
                      if (e.key === 'Escape') setRenamingPath(null)
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className={styles.label}>{node.name}</span>
                )}
              </div>

              {node.isDirectory && isExpanded && node.children && (
                <FileTree
                  nodes={node.children}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  onFileOpen={onFileOpen}
                  onRefresh={onRefresh}
                  isStarred={isStarred}
                  onToggleStar={onToggleStar}
                  depth={depth + 1}
                />
              )}
            </div>
          )
        })}
      </div>

      {context && (
        <ContextMenu
          node={context.node}
          x={context.x}
          y={context.y}
          isStarred={isStarred(context.node.path)}
          onClose={() => setContext(null)}
          onRename={handleRename}
          onDelete={handleDelete}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onReveal={handleReveal}
          onToggleStar={() => onToggleStar(context.node.path)}
          onStartCase={(node) => setStartCaseFile(node.path)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <NameDialog
          kind="confirm"
          heading="Move to trash?"
          message={`Move "${dialog.node.name}" to trash? You can restore it later.`}
          confirmLabel="Move to trash"
          danger
          onConfirm={() => confirmDelete(dialog.node)}
          onCancel={() => setDialog(null)}
        />
      )}

      {(dialog?.kind === 'newFile' || dialog?.kind === 'newFolder') && (
        <NameDialog
          kind="prompt"
          heading={dialog.kind === 'newFile' ? 'New file' : 'New folder'}
          label={dialog.kind === 'newFile' ? 'New file name' : 'New folder name'}
          placeholder={dialog.kind === 'newFile' ? 'notes.md' : 'Untitled folder'}
          confirmLabel="Create"
          onSubmit={(name) => createEntry(dialog.node, name, dialog.kind === 'newFolder')}
          onCancel={() => setDialog(null)}
        />
      )}

      {startCaseFile && (
        <NewCaseDialog
          initialTitle={(startCaseFile.split('/').pop() ?? '').replace(/\.[^.]+$/, '')}
          attachFile={startCaseFile}
          onClose={() => setStartCaseFile(null)}
          onCreated={() => setStartCaseFile(null)}
        />
      )}
    </>
  )
}
