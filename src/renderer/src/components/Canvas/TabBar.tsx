import { useRef } from 'react'
import { X, Pin } from 'lucide-react'
import { FileIcon } from '../FilePanel/fileIcons'
import type { Tab } from '../../types/tab'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: Tab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onPin: (id: string) => void
  onMove: (fromIndex: number, toIndex: number) => void
  /** Compact pill style for sitting inline in the title strip. */
  compact?: boolean
}

export function TabBar({ tabs, activeId, onActivate, onClose, onPin, onMove, compact }: TabBarProps): JSX.Element {
  const dragIndex = useRef<number | null>(null)

  const handleDragStart = (index: number) => {
    dragIndex.current = index
  }

  const handleDrop = (toIndex: number) => {
    if (dragIndex.current !== null && dragIndex.current !== toIndex) {
      onMove(dragIndex.current, toIndex)
    }
    dragIndex.current = null
  }

  return (
    <div className={`${styles.bar} ${compact ? styles.compact : ''}`} role="tablist">
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          role="tab"
          data-doc-tab
          aria-selected={tab.id === activeId}
          className={`${styles.tab} ${tab.id === activeId ? styles.active : ''} ${tab.isPinned ? styles.pinned : ''}`}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleDrop(index)}
          onClick={() => onActivate(tab.id)}
          onAuxClick={(e) => {
            // Middle-click closes
            if (e.button === 1 && !tab.isPinned) onClose(tab.id)
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            onPin(tab.id)
          }}
          title={tab.filePath}
        >
          <span className={styles.tabIcon}>
            <FileIcon name={tab.label} isDirectory={false} size={14} />
          </span>
          <span className={styles.label}>{tab.label}</span>
          {tab.isPinned && <Pin size={11} className={styles.pinIcon} />}
          {!tab.isPinned && (
            <button
              className={styles.close}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              aria-label={`Close ${tab.label}`}
            >
              {tab.isDirty ? <span className={styles.dirty}>●</span> : <X size={13} strokeWidth={2} />}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
