import { useState } from 'react'
import { BookOpen, FolderOpen, Home, Inbox, MoreHorizontal } from 'lucide-react'
import '@fontsource/newsreader/400.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '../../styles/landscape-tokens.css'
import { SettingsPanel } from '../Settings/SettingsPanel'
import { useSettings } from '../../hooks/useSettings'
import styles from './LandscapeShell.module.css'

/**
 * The Screen Landscape shell (feat/landscape-shell), phase 0 scaffold.
 *
 * Only the frame exists yet: the `.wl` token scope, the fonts, the dock and a
 * way into Settings and back to the current shell. Overview screens, Inbox,
 * Cases and Library are built in phases 1–2; the WebGL backdrop and Liquid
 * Glass in phase 3. Plan and progress: docs/landscape/.
 */
export function LandscapeShell(): JSX.Element {
  const settings = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className={`wl ${styles.root}`} data-shell="landscape">
      <div className={styles.horizon} aria-hidden />

      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Workspace OS</div>
          <h1 className={styles.heading}>Your team</h1>
          <div className={styles.sub}>Screen Landscape · in progress</div>
        </div>
        <button className={styles.back} onClick={() => settings.set('landscapeShell', false)} data-testid="landscape-exit">
          Back to the current shell
        </button>
      </header>

      <p className={styles.note}>
        This is the frame of the new shell. Agent screens, Inbox, Cases and Library arrive in the
        next phases; until then every surface stays in the current shell.
      </p>

      <nav className={styles.dock} aria-label="Landscape">
        <button className={`${styles.dockItem} ${styles.on}`} aria-current="page">
          <Home size={17} /> Overview
        </button>
        <button className={styles.dockItem} disabled title="Phase 2">
          <Inbox size={17} /> Inbox
        </button>
        <button className={styles.dockItem} disabled title="Phase 5">
          <FolderOpen size={17} /> Cases
        </button>
        <button className={styles.dockItem} disabled title="Phase 1">
          <BookOpen size={17} /> Library
        </button>
        <button className={styles.dockItem} onClick={() => setSettingsOpen(true)} data-testid="landscape-menu">
          <MoreHorizontal size={17} /> Menu
        </button>
      </nav>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
