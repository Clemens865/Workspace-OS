import { useState } from 'react'
import { ChevronRight, Check, Star, Copy, Printer, MoreHorizontal, Save } from 'lucide-react'
import { FileIcon } from '../FilePanel/fileIcons'
import { ActionMenu } from './ActionMenu'
import { actionsFor } from '../../lib/fileActions'
import { categoryOf, PRINTABLE } from '../../lib/fileCategory'
import styles from './CanvasToolbar.module.css'

interface CanvasToolbarProps {
  filePath: string
  isDirty: boolean
  isStarred: boolean
  onToggleStar: () => void
  onRefresh: () => void
  onCloseFile: (path: string) => void
  /** Save the active text editor's content; absent for non-editable files. */
  onSave?: (() => void) | null
}

/**
 * Breadcrumb + document actions bar (Claude Design reference). The actions are
 * driven by the per-file action registry, so they're contextual to the type.
 */
export function CanvasToolbar({ filePath, isDirty, isStarred, onToggleStar, onRefresh, onCloseFile, onSave }: CanvasToolbarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const segments = filePath.split('/').filter(Boolean)
  const fileName = segments[segments.length - 1] ?? ''
  const trailStart = Math.max(0, segments.length - 3)
  const trail = segments.slice(trailStart, segments.length - 1)
  // Full path of the folder crumb at display index i (for click-to-reveal).
  const crumbPath = (i: number): string => '/' + segments.slice(0, trailStart + i + 1).join('/')
  const revealFolder = (i: number): void => {
    window.dispatchEvent(new CustomEvent('wos:reveal-path', { detail: crumbPath(i) }))
  }
  const canPrint = PRINTABLE.has(categoryOf(filePath))

  const items = actionsFor(filePath, {
    filePath,
    isDirty,
    isStarred,
    refresh: onRefresh,
    closeFile: onCloseFile,
    toggleStar: onToggleStar,
  })

  return (
    <div className={styles.bar}>
      <div className={styles.crumbs}>
        {trail.map((seg, i) => (
          <span key={i} className={styles.crumbGroup}>
            <button
              type="button"
              className={styles.crumb}
              onClick={() => revealFolder(i)}
              title={`Show “${seg}” in Files`}
            >
              {seg}
            </button>
            <ChevronRight size={13} className={styles.sep} />
          </span>
        ))}
        <span className={styles.current}>
          <FileIcon name={fileName} isDirectory={false} size={14} />
          {fileName}
        </span>
        <span className={`${styles.status} ${isDirty ? styles.dirty : ''}`}>
          {isDirty ? (
            <><span className={styles.dot} />Edited</>
          ) : (
            <><Check size={12} className={styles.check} />Saved</>
          )}
        </span>
      </div>

      <div className={styles.actions}>
        {onSave && (
          <button
            className={styles.saveBtn}
            title="Save (⌘S)"
            disabled={!isDirty}
            onClick={onSave}
          >
            <Save size={14} strokeWidth={2} /> {isDirty ? 'Save' : 'Saved'}
          </button>
        )}
        <button
          className={`${styles.iconBtn} ${isStarred ? styles.starred : ''}`}
          title={isStarred ? 'Unstar' : 'Star'}
          onClick={onToggleStar}
        >
          <Star size={16} strokeWidth={1.9} fill={isStarred ? 'var(--type-media)' : 'none'} />
        </button>
        <button className={styles.iconBtn} title="Copy path" onClick={() => navigator.clipboard.writeText(filePath)}>
          <Copy size={16} strokeWidth={1.9} />
        </button>
        {canPrint && (
          <button className={styles.iconBtn} title="Print" onClick={() => {
            const item = items.find(({ action }) => action.id === 'print')
            if (item) void item.action.run(item.ctx)
          }}>
            <Printer size={16} strokeWidth={1.9} />
          </button>
        )}
        <div className={styles.divider} />
        <div className={styles.moreWrap}>
          <button className={styles.iconBtn} title="More actions" onClick={() => setMenuOpen((v) => !v)}>
            <MoreHorizontal size={17} strokeWidth={1.9} />
          </button>
          {menuOpen && <ActionMenu items={items} onClose={() => setMenuOpen(false)} />}
        </div>
      </div>
    </div>
  )
}
