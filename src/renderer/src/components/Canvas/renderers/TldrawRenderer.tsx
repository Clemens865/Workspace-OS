import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, type Editor, type TLShapeId } from 'tldraw'
import { getAssetUrlsByMetaUrl } from '@tldraw/assets/urls'
import 'tldraw/tldraw.css'
import { serializeDoc, parseDoc, isDirty, type CanvasSnapshot } from './tldrawDoc'
import { frameToSlideSpec, encodeSlidePayload, type FrameSource } from './frameToShapes'
import styles from './TldrawRenderer.module.css'

/**
 * Resolve tldraw's fonts/icons/translations to LOCAL bundled assets (via
 * `import.meta.url`, which vite fingerprints into our own build) instead of
 * tldraw's default `cdn.tldraw.com`. This keeps the app offline-first and
 * avoids widening the CSP (`default-src 'self'`) to allow an external CDN.
 * Computed once at module load — this module is already lazy/code-split.
 */
const assetUrls = getAssetUrlsByMetaUrl()

interface TldrawRendererProps {
  filePath: string
  onDirty: (dirty: boolean) => void
  /** Registers a save callback with the parent (for ⌘S / toolbar Save). */
  onSaveRegister?: (save: (() => void) | null) => void
}

/** How long to wait after the last edit before flipping the dirty flag. */
const DIRTY_DEBOUNCE_MS = 400

/**
 * Infinite/open canvas backed by the MIT tldraw SDK, persisted as a `.wcanvas`
 * file. Mirrors the MonacoRenderer contract: reads the file on mount, loads the
 * snapshot (empty doc if new/empty/broken), debounces a dirty flag on edits,
 * and registers a save fn that writes the serialised snapshot back to disk.
 *
 * tldraw is a large dependency; this whole module is `lazy()`-imported from
 * Canvas.tsx so it (and tldraw) code-splits into its own chunk out of the main
 * bundle.
 */
export function TldrawRenderer({ filePath, onDirty, onSaveRegister }: TldrawRendererProps): JSX.Element {
  const editorRef = useRef<Editor | null>(null)
  // The snapshot as last written to disk — the baseline for dirty detection.
  const savedRef = useRef<CanvasSnapshot>({})
  const [status, setStatus] = useState('')

  // Load the file into the editor once tldraw has mounted it.
  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      window.workspace.fs
        .readFile(filePath)
        .then((text: string) => {
          const snapshot = parseDoc(text)
          savedRef.current = snapshot
          if (Object.keys(snapshot).length > 0) {
            editor.loadSnapshot(snapshot as Parameters<Editor['loadSnapshot']>[0])
          }
          onDirty(false)
        })
        .catch(() => {
          // New/unreadable file — start from a blank canvas.
          savedRef.current = {}
          onDirty(false)
        })
    },
    [filePath, onDirty],
  )

  // Release the editor when this renderer unmounts / the file changes.
  useEffect(() => () => { editorRef.current = null }, [filePath])

  // Debounced dirty detection driven by the store's change stream.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    const editor = editorRef.current
    // The editor may not be mounted on the first effect run; poll briefly.
    const attach = (): void => {
      const ed = editorRef.current
      if (!ed) {
        if (!disposed) timer = setTimeout(attach, 100)
        return
      }
      cleanup = ed.store.listen(
        () => {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => {
            const current = ed.getSnapshot() as unknown as CanvasSnapshot
            onDirty(isDirty(savedRef.current, current))
          }, DIRTY_DEBOUNCE_MS)
        },
        { source: 'user', scope: 'document' },
      )
    }
    let cleanup: (() => void) | undefined
    if (editor) attach()
    else timer = setTimeout(attach, 100)
    return () => {
      disposed = true
      if (timer) clearTimeout(timer)
      cleanup?.()
    }
  }, [filePath, onDirty])

  // Save: serialise the live snapshot and write it back to the file.
  const handleSave = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const snapshot = editor.getSnapshot() as unknown as CanvasSnapshot
    await window.workspace.fs.writeFile(filePath, serializeDoc(snapshot))
    savedRef.current = snapshot
    onDirty(false)
  }, [filePath, onDirty])

  // Register a stable save wrapper that always calls the latest handleSave.
  const saveRef = useRef(handleSave)
  saveRef.current = handleSave
  useEffect(() => {
    onSaveRegister?.(() => void saveRef.current())
    return () => onSaveRegister?.(null)
  }, [onSaveRegister])

  // ⌘S — save (in addition to the toolbar Save button wired via onSaveRegister).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const flash = useCallback((msg: string) => {
    setStatus(msg)
    setTimeout(() => setStatus(''), 2500)
  }, [])

  // Export the whole current page to an SVG saved next to the file.
  const exportSvg = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const ids = [...editor.getCurrentPageShapeIds()]
    if (ids.length === 0) { flash('Nothing to export'); return }
    const out = await editor.getSvgString(ids)
    if (!out) { flash('Export failed'); return }
    const svgPath = filePath.replace(/\.wcanvas$/i, '') + '.svg'
    await window.workspace.fs.writeFile(svgPath, out.svg)
    flash(`Exported → ${svgPath.split('/').pop()}`)
  }, [filePath, flash])

  // Frame → slide (v1): export the selected frame to an SVG asset next to the
  // file, ready to drop into a deck. The deep live-slide bridge (a frame that
  // IS a live LOK slide) is deferred — this ships only the export step.
  const frameToSlide = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const selected = editor.getSelectedShapes()
    const frames = selected.filter((s) => s.type === 'frame')
    if (frames.length === 0) { flash('Select a frame first'); return }
    const frameIds = frames.map((f) => f.id as TLShapeId)
    const out = await editor.getSvgString(frameIds)
    if (!out) { flash('Export failed'); return }
    const base = filePath.replace(/\.wcanvas$/i, '')
    const slidePath = `${base}.slide.svg`
    await window.workspace.fs.writeFile(slidePath, out.svg)
    flash(`Frame → ${slidePath.split('/').pop()} (drop into a deck)`)
  }, [filePath, flash])

  // Frame → slide (NATIVE) v1: translate the selected frame's basic shapes into
  // real, EDITABLE PPTX shapes on a new slide of the OPEN Impress deck (the
  // "canvas becomes real office, not a picture" seam). Rect/ellipse/text/line map
  // natively; unsupported shapes (draw/arrow/image/complex geo) are rasterised and
  // dropped as pictures so nothing is lost. ONE-WAY v1 — live re-sync is v2.
  const frameToSlideNative = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    const frames = editor.getSelectedShapes().filter((s) => s.type === 'frame')
    if (frames.length === 0) { flash('Select a frame first'); return }
    const frameId = frames[0].id
    const spec = frameToSlideSpec(editor as unknown as FrameSource, frameId)
    if (spec.shapes.length === 0 && spec.imageFallback.length === 0) { flash('Frame is empty'); return }
    const payload = encodeSlidePayload(spec)

    // Rasterise each fallback shape to a PNG so the handler can drop it as a picture.
    const fallbackImages: { png: Uint8Array }[] = []
    for (const fb of spec.imageFallback) {
      try {
        const out = await editor.toImage([fb.id as TLShapeId], { format: 'png', background: false })
        fallbackImages.push({ png: new Uint8Array(await out.blob.arrayBuffer()) })
      } catch { /* skip a shape that won't rasterise */ }
    }

    flash('Building native slide…')
    try {
      const res = await window.workspace.canvas.frameToSlide({ payload, fallbackImages })
      if (!res.ok) { flash('Native slide failed (open a .pptx deck first)'); return }
      flash(`Native slide #${res.slide + 1}: ${res.native} shapes, ${res.images} image${res.images === 1 ? '' : 's'}`)
    } catch (e) {
      flash(`Failed: ${(e as Error).message}`)
    }
  }, [flash])

  // Export deck (.pptx) v1: enumerate frames in reading order (top→bottom,
  // left→right) — or fall back to pages if there are no frames — render each to
  // a PNG, and hand the ordered buffers to main to write a real .pptx beside the
  // .wcanvas. Image-based + one-way; native-shape translation + live-sync are
  // deferred.
  const exportDeck = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return

    // Collect ordered (ids, title) tuples: one entry per slide.
    const slides: { ids: TLShapeId[]; title?: string }[] = []
    const startPage = editor.getCurrentPageId()
    const frames = editor
      .getCurrentPageShapes()
      .filter((s) => s.type === 'frame')
      .sort((a, b) => (a.y - b.y) || (a.x - b.x)) // reading order: top→bottom, then left→right
    if (frames.length > 0) {
      for (const f of frames) {
        const name = (f.props as { name?: string }).name
        slides.push({ ids: [f.id as TLShapeId], title: name })
      }
    } else {
      // No frames — one slide per page (each page's whole shape set).
      for (const page of editor.getPages()) {
        editor.setCurrentPage(page.id)
        const ids = [...editor.getCurrentPageShapeIds()]
        if (ids.length > 0) slides.push({ ids, title: page.name })
      }
    }

    if (slides.length === 0) { flash('Nothing to export'); return }

    flash(`Exporting ${slides.length} slide${slides.length === 1 ? '' : 's'}…`)
    const images: { png: Uint8Array; title?: string }[] = []
    try {
      for (const s of slides) {
        // toImage renders exactly the given shapes to a PNG blob (full-bleed
        // per slide) at the shapes' own bounds.
        const out = await editor.toImage(s.ids, { format: 'png', background: true })
        const bytes = new Uint8Array(await out.blob.arrayBuffer())
        images.push({ png: bytes, title: s.title })
      }
    } finally {
      if (editor.getCurrentPageId() !== startPage) editor.setCurrentPage(startPage)
    }

    const targetPath = filePath.replace(/\.wcanvas$/i, '') + '.pptx'
    try {
      const res = await window.workspace.canvas.exportPptx({ targetPath, images })
      flash(`Deck → ${res.path.split('/').pop()} (${res.slides} slides)`)
    } catch (e) {
      flash(`Export failed: ${(e as Error).message}`)
    }
  }, [filePath, flash])

  return (
    <div className={styles.root}>
      <div className={styles.actions}>
        <button className={styles.actionBtn} onClick={() => void exportSvg()} title="Export the current page to an SVG next to this file">
          Export SVG
        </button>
        <button className={styles.actionBtn} onClick={() => void frameToSlide()} title="Export the selected frame as a slide asset (SVG) next to this file">
          Frame → Slide
        </button>
        <button className={styles.actionBtn} onClick={() => void frameToSlideNative()} title="Translate the selected frame's shapes into NATIVE, editable shapes on a new slide of the open deck (unsupported shapes fall back to images)">
          Frame → slide (native)
        </button>
        <button className={styles.actionBtn} onClick={() => void exportDeck()} title="Export every frame (or page) as a slide in a real .pptx deck next to this file">
          Export deck (.pptx)
        </button>
        {status && <span className={styles.status}>{status}</span>}
      </div>
      <div className={styles.canvas}>
        <Tldraw onMount={handleMount} assetUrls={assetUrls} />
      </div>
    </div>
  )
}
