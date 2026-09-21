import { useState, useCallback, useEffect, useRef } from 'react'

interface PanelSizes {
  filePanel: number
  terminal: number
}

const STORAGE_KEY = 'workspace-os:panel-sizes'
const DEFAULTS: PanelSizes = { filePanel: 260, terminal: 220 }

function load(): PanelSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    // Corrupt storage — use defaults
  }
  return DEFAULTS
}

function save(sizes: PanelSizes): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes))
}

export function usePanelSizes(): {
  sizes: PanelSizes
  onFilePanelResize: (e: React.MouseEvent) => void
  onTerminalResize: (e: React.MouseEvent) => void
  /** Applies sizes wholesale (snapshot restore) and persists them. */
  applySizes: (next: PanelSizes) => void
} {
  const [sizes, setSizes] = useState<PanelSizes>(load)
  const dragging = useRef<'filePanel' | 'terminal' | null>(null)
  const startPos = useRef(0)
  const startSize = useRef(0)

  const commit = useCallback((next: PanelSizes) => {
    setSizes(next)
    save(next)
  }, [])

  // Same clamps as the drag handlers, so a restored snapshot can't wedge a
  // panel off-screen.
  const applySizes = useCallback((next: PanelSizes) => {
    commit({
      filePanel: Math.max(160, Math.min(600, next.filePanel)),
      terminal: Math.max(120, Math.min(window.innerHeight * 0.7, next.terminal)),
    })
  }, [commit])

  const onFilePanelResize = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = 'filePanel'
      startPos.current = e.clientX
      startSize.current = sizes.filePanel
      e.preventDefault()
    },
    [sizes.filePanel]
  )

  const onTerminalResize = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = 'terminal'
      startPos.current = e.clientY
      startSize.current = sizes.terminal
      e.preventDefault()
    },
    [sizes.terminal]
  )

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      if (dragging.current === 'filePanel') {
        const delta = e.clientX - startPos.current
        const next = Math.max(160, Math.min(600, startSize.current + delta))
        setSizes((s) => ({ ...s, filePanel: next }))
      } else {
        const delta = startPos.current - e.clientY
        const next = Math.max(120, Math.min(window.innerHeight * 0.7, startSize.current + delta))
        setSizes((s) => ({ ...s, terminal: next }))
      }
    }
    const onUp = () => {
      if (dragging.current) {
        setSizes((s) => {
          save(s)
          return s
        })
        dragging.current = null
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [commit])

  return { sizes, onFilePanelResize, onTerminalResize, applySizes }
}
