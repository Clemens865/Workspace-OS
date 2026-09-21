import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PrintSurfaceContext } from '../../hooks/useFilePrint'
import { Files as FilesIcon } from 'lucide-react'
import { CanvasToolbar } from './CanvasToolbar'
import { MarkdownToolbar, type MdViewMode } from './MarkdownToolbar'
import type { CodeEditor } from './renderers/MonacoRenderer'
import { routeFile } from './renderers/routeFile'
import { categoryOf } from '../../lib/fileCategory'
import type { ActionContext } from '../../lib/fileActions'
import { useNativeMenuActions } from '../../hooks/useNativeMenuActions'
import { useEditorContent } from '../../hooks/useEditorContent'
import type { WorkspaceLibrary } from '../../hooks/useWorkspaceLibrary'
import type { TabManager } from '../../hooks/useTabManager'
import styles from './Canvas.module.css'

// The live-transclusion preview renders through marked + the sanitizer; lazy so
// marked code-splits into its own chunk, never the main bundle.
const MarkdownPreview = lazy(() => import('./MarkdownPreview').then((m) => ({ default: m.MarkdownPreview })))

const MonacoRenderer = lazy(() => import('./renderers/MonacoRenderer').then((m) => ({ default: m.MonacoRenderer })))
const PdfRenderer = lazy(() => import('./renderers/PdfRenderer').then((m) => ({ default: m.PdfRenderer })))
const ImageRenderer = lazy(() => import('./renderers/ImageRenderer').then((m) => ({ default: m.ImageRenderer })))
const MediaRenderer = lazy(() => import('./renderers/MediaRenderer').then((m) => ({ default: m.MediaRenderer })))
const CsvRenderer = lazy(() => import('./renderers/CsvRenderer').then((m) => ({ default: m.CsvRenderer })))
const HexRenderer = lazy(() => import('./renderers/HexRenderer').then((m) => ({ default: m.HexRenderer })))
const OfficeRenderer = lazy(() => import('./renderers/OfficeRenderer').then((m) => ({ default: m.OfficeRenderer })))
const HtmlRenderer = lazy(() => import('./renderers/HtmlRenderer').then((m) => ({ default: m.HtmlRenderer })))
// tldraw is a large dep — lazy so it code-splits into its own chunk, never the main bundle.
const TldrawRenderer = lazy(() => import('./renderers/TldrawRenderer').then((m) => ({ default: m.TldrawRenderer })))

interface CanvasProps {
  tabManager: TabManager
  library: WorkspaceLibrary
  onRefresh: () => void
}

export function Canvas({ tabManager, library, onRefresh }: CanvasProps): JSX.Element {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const { tabs, activeId, activeFilePath, closeTab, markDirty } = tabManager

  // The file you open jumps the search-index queue so its content is searchable
  // almost immediately, even while a huge workspace is still indexing.
  useEffect(() => {
    if (activeFilePath) void window.workspace.search.prioritize(activeFilePath)
  }, [activeFilePath])
  const activeTab = tabs.find((t) => t.id === activeId)
  const [mdEditor, setMdEditor] = useState<CodeEditor | null>(null)
  // Markdown Edit | Split | Preview view mode (resets to Edit per opened file).
  const [mdViewMode, setMdViewMode] = useState<MdViewMode>('edit')
  // Save callback registered by the active text editor (Monaco), for the toolbar.
  const [saveFn, setSaveFn] = useState<(() => void) | null>(null)
  const isMarkdown = !!activeFilePath && /\.md$/i.test(activeFilePath)
  const showPreview = isMarkdown && mdViewMode !== 'edit'
  // Live editor text feeds the preview (debounced); only subscribed when shown.
  const mdSource = useEditorContent(mdEditor, showPreview)

  // Start each newly-opened markdown file in Edit mode.
  useEffect(() => { setMdViewMode('edit') }, [activeFilePath])

  const handleDirty = useCallback((dirty: boolean) => {
    if (activeId) markDirty(activeId, dirty)
  }, [activeId, markDirty])

  // A save callback is a function; store it behind an updater so React doesn't
  // mistake it for a state-updater and invoke it.
  const registerSave = useCallback((fn: (() => void) | null) => setSaveFn(() => fn), [])

  // Close the tab whose file matches a path (used by the Move-to-Trash action).
  const closeFile = useCallback((path: string) => {
    const tab = tabManager.tabs.find((t) => t.filePath === path)
    if (tab) closeTab(tab.id)
  }, [tabManager.tabs, closeTab])

  // Shared action context — feeds both the in-canvas action menu and the native
  // menu bar from the one registry.
  const actionContext = useMemo<ActionContext | null>(() => {
    if (!activeFilePath) return null
    return {
      filePath: activeFilePath,
      category: categoryOf(activeFilePath),
      isDirty: activeTab?.isDirty ?? false,
      isStarred: library.isStarred(activeFilePath),
      refresh: onRefresh,
      closeFile,
      toggleStar: () => library.toggleStar(activeFilePath),
    }
  }, [activeFilePath, activeTab?.isDirty, library, onRefresh, closeFile])

  useNativeMenuActions(activeFilePath, actionContext, surfaceRef)

  return (
    <PrintSurfaceContext.Provider value={surfaceRef}>
    <div ref={surfaceRef} className={styles.root}>
      {activeFilePath && routeFile(activeFilePath) !== 'office' && (
        <CanvasToolbar
          filePath={activeFilePath}
          isDirty={activeTab?.isDirty ?? false}
          isStarred={library.isStarred(activeFilePath)}
          onToggleStar={() => library.toggleStar(activeFilePath)}
          onRefresh={onRefresh}
          onCloseFile={closeFile}
          onSave={saveFn}
        />
      )}
      {isMarkdown && <MarkdownToolbar editor={mdEditor} mode={mdViewMode} onModeChange={setMdViewMode} />}
      <div className={styles.content}>
        {activeFilePath ? (
          isMarkdown ? (
            // Monaco stays mounted in every mode (so the save path + live source
            // survive a switch to Preview); CSS hides whichever pane is inactive.
            <div className={mdViewMode === 'split' ? styles.mdSplit : styles.mdSingle}>
              <div className={mdViewMode === 'preview' ? styles.hidden : styles.mdEditorPane}>
                <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
                  <FileRenderer key={activeFilePath} filePath={activeFilePath} onDirty={handleDirty} onEditorMount={setMdEditor} onSaveRegister={registerSave} />
                </Suspense>
              </div>
              {showPreview && (
                <div className={styles.mdPreviewPane}>
                  <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
                    <MarkdownPreview source={mdSource} />
                  </Suspense>
                </div>
              )}
            </div>
          ) : (
            <Suspense fallback={<div className={styles.loading}>Loading…</div>}>
              <FileRenderer key={activeFilePath} filePath={activeFilePath} onDirty={handleDirty} onSaveRegister={registerSave} />
            </Suspense>
          )
        ) : (
          <div className={styles.empty}>
            <FilesIcon size={40} strokeWidth={1.1} className={styles.emptyIcon} />
            <p className={styles.emptyTitle}>Open a file to get started</p>
            <p className={styles.hint}>⌘P to open a file · ⌘K to search contents</p>
          </div>
        )}
      </div>
    </div>
    </PrintSurfaceContext.Provider>
  )
}

function FileRenderer({ filePath, onDirty, onEditorMount, onSaveRegister }: { filePath: string; onDirty: (dirty: boolean) => void; onEditorMount?: (e: CodeEditor | null) => void; onSaveRegister?: (save: (() => void) | null) => void }): JSX.Element {
  const renderer = routeFile(filePath)
  switch (renderer) {
    case 'monaco': return <MonacoRenderer filePath={filePath} onDirty={onDirty} onEditorMount={onEditorMount} onSaveRegister={onSaveRegister} />
    case 'html': return <HtmlRenderer filePath={filePath} onDirty={onDirty} />
    case 'pdf': return <PdfRenderer filePath={filePath} />
    case 'image': return <ImageRenderer filePath={filePath} />
    case 'video': return <MediaRenderer filePath={filePath} type="video" />
    case 'audio': return <MediaRenderer filePath={filePath} type="audio" />
    case 'csv': return <CsvRenderer filePath={filePath} onDirty={onDirty} onSaveRegister={onSaveRegister} />
    case 'office': return <OfficeRenderer filePath={filePath} />
    case 'whiteboard': return <TldrawRenderer filePath={filePath} onDirty={onDirty} onSaveRegister={onSaveRegister} />
    default: return <HexRenderer filePath={filePath} />
  }
}
