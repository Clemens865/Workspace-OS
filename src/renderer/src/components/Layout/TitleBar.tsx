import { PanelLeft, Search, Sun, Moon, Settings } from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { TabBar } from '../Canvas/TabBar'
import type { TabManager } from '../../hooks/useTabManager'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  onToggleSidebar: () => void
  onOpenCommand: () => void
  onOpenSettings: () => void
  tabManager: TabManager
}

/**
 * Top app strip: macOS traffic-light inset, sidebar toggle, the open-file tabs
 * (inline — reclaims a row), then a compact search trigger + appearance/settings.
 */
export function TitleBar({ onToggleSidebar, onOpenCommand, onOpenSettings, tabManager }: TitleBarProps): JSX.Element {
  const { theme, toggle } = useTheme()

  return (
    <div className={styles.bar}>
      <div className={styles.trafficSpace} />
      <button className={styles.iconBtn} onClick={onToggleSidebar} title="Toggle sidebar">
        <PanelLeft size={17} strokeWidth={1.9} />
      </button>

      <div className={styles.tabs}>
        <TabBar
          compact
          tabs={tabManager.tabs}
          activeId={tabManager.activeId}
          onActivate={tabManager.activateTab}
          onClose={tabManager.closeTab}
          onPin={tabManager.pinTab}
          onMove={tabManager.moveTab}
        />
      </div>

      <button className={styles.iconBtn} onClick={onOpenCommand} title="Search files and contents (⌘K)">
        <Search size={16} strokeWidth={1.9} />
      </button>
      <button className={styles.iconBtn} onClick={toggle} title="Toggle theme">
        {theme === 'light' ? <Moon size={16} strokeWidth={1.9} /> : <Sun size={16} strokeWidth={1.9} />}
      </button>
      <button className={styles.iconBtn} title="Settings" onClick={onOpenSettings}>
        <Settings size={16} strokeWidth={1.9} />
      </button>
    </div>
  )
}
