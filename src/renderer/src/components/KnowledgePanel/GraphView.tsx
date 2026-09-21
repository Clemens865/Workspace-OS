import { useEffect, useRef, useState, useCallback } from 'react'
import type { KnowledgeGraph } from '../../types/workspace-api'
import { initLayout, step, type LayoutNode } from '../../lib/forceLayout'
import styles from './GraphView.module.css'

interface GraphViewProps {
  /** The current active note path — highlighted, if present in the graph. */
  activeFile: string | null
  /** Open a note by path (stub nodes are non-navigable). */
  onFileOpen: (path: string) => void
}

/** Just the basename, for hover labels. */
function baseName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p
}

/**
 * Obsidian-style force-directed graph of the workspace [[wikilink]] index.
 * Canvas-rendered (crisp + cheap for many nodes), laid out by the dependency-free
 * force simulation in lib/forceLayout. Note nodes are clickable → open the file;
 * stub nodes are styled distinctly and inert. Node radius ∝ degree; hover shows
 * the name. Lazy-loaded so the sim/canvas code is code-split out of first paint.
 */
export function GraphView({ activeFile, onFileOpen }: GraphViewProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [hover, setHover] = useState<string | null>(null)

  // Mutable sim + view state kept in refs (the RAF loop reads/writes these
  // without re-rendering React on every frame).
  const nodesRef = useRef<LayoutNode[]>([])
  const graphRef = useRef<KnowledgeGraph | null>(null)
  const optionsRef = useRef<ReturnType<typeof initLayout>['options'] | null>(null)
  const rafRef = useRef<number>(0)
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 })
  const dragRef = useRef<{ active: boolean; lastX: number; lastY: number }>({
    active: false,
    lastX: 0,
    lastY: 0,
  })
  const hoverIdRef = useRef<string | null>(null)

  // Load the graph once on mount.
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const g = await window.workspace.links.graph()
        if (!live) return
        setGraph(g)
      } catch {
        if (live) setGraph({ nodes: [], edges: [], truncated: false })
      }
      if (live) setLoading(false)
    })()
    return () => {
      live = false
    }
  }, [])

  // (Re)initialise the simulation whenever the graph data changes.
  useEffect(() => {
    if (!graph) return
    graphRef.current = graph
    const sim = initLayout(
      graph.nodes.map((n) => ({ id: n.id, degree: n.degree })),
      graph.edges,
      { seed: 1 },
    )
    nodesRef.current = sim.nodes
    optionsRef.current = sim.options
    viewRef.current = { scale: 1, ox: 0, oy: 0 }
  }, [graph])

  const nodeRadius = useCallback((degree: number): number => {
    return 3 + Math.min(9, Math.sqrt(degree) * 2)
  }, [])

  // The draw + step loop.
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const g = graphRef.current
    const opts = optionsRef.current
    if (!canvas || !g || !opts) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Advance the simulation until it settles (energy → 0), then coast (redraw
    // only, so hover/drag stay responsive without burning CPU forever).
    const energy = step(nodesRef.current, g.edges, opts)

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr
      canvas.height = h * dpr
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const view = viewRef.current
    const cx = w / 2 + view.ox
    const cy = h / 2 + view.oy
    const s = view.scale
    const toX = (x: number): number => cx + x * s
    const toY = (y: number): number => cy + y * s

    const pos = new Map<string, LayoutNode>()
    for (const nd of nodesRef.current) pos.set(nd.id, nd)

    // Edges first (behind nodes).
    const css = getComputedStyle(canvas)
    const edgeColor = css.getPropertyValue('--color-border').trim() || '#8884'
    ctx.lineWidth = 1
    ctx.strokeStyle = edgeColor
    for (const e of g.edges) {
      const a = pos.get(e.source)
      const b = pos.get(e.target)
      if (!a || !b) continue
      ctx.beginPath()
      ctx.moveTo(toX(a.x), toY(a.y))
      ctx.lineTo(toX(b.x), toY(b.y))
      ctx.stroke()
    }

    const accent = css.getPropertyValue('--color-accent').trim() || '#5b8def'
    const text = css.getPropertyValue('--color-text').trim() || '#ddd'
    const subtle = css.getPropertyValue('--color-text-subtle').trim() || '#888'
    for (const node of g.nodes) {
      const p = pos.get(node.id)
      if (!p) continue
      const r = nodeRadius(node.degree)
      const isHover = node.id === hoverIdRef.current
      const isActive = node.id === activeFile
      ctx.beginPath()
      ctx.arc(toX(p.x), toY(p.y), r, 0, Math.PI * 2)
      if (node.kind === 'stub') {
        ctx.fillStyle = 'transparent'
        ctx.strokeStyle = subtle
        ctx.lineWidth = 1.5
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.fillStyle = isActive ? accent : text
        ctx.fill()
      }
      if (isHover) {
        ctx.strokeStyle = accent
        ctx.lineWidth = 2
        ctx.stroke()
        // Label.
        ctx.fillStyle = text
        ctx.font = '11px system-ui, sans-serif'
        ctx.fillText(node.name, toX(p.x) + r + 4, toY(p.y) + 4)
      }
    }

    // Keep animating while it's still moving, or while the user hovers/drags.
    rafRef.current =
      energy > 0.05 || hoverIdRef.current || dragRef.current.active
        ? requestAnimationFrame(draw)
        : requestAnimationFrame(() => {
            rafRef.current = requestAnimationFrame(draw)
          })
  }, [activeFile, nodeRadius])

  useEffect(() => {
    if (!graph) return
    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [graph, draw])

  // Hit-test the pointer against node positions (screen space).
  const nodeAt = useCallback(
    (clientX: number, clientY: number): { id: string; kind: 'note' | 'stub' } | null => {
      const canvas = canvasRef.current
      const g = graphRef.current
      if (!canvas || !g) return null
      const rect = canvas.getBoundingClientRect()
      const px = clientX - rect.left
      const py = clientY - rect.top
      const view = viewRef.current
      const cx = canvas.clientWidth / 2 + view.ox
      const cy = canvas.clientHeight / 2 + view.oy
      const s = view.scale
      const pos = new Map(nodesRef.current.map((n) => [n.id, n]))
      // Reverse order so top-drawn nodes win.
      for (let i = g.nodes.length - 1; i >= 0; i--) {
        const node = g.nodes[i]
        const p = pos.get(node.id)
        if (!p) continue
        const sx = cx + p.x * s
        const sy = cy + p.y * s
        const r = nodeRadius(node.degree) + 4
        if ((px - sx) ** 2 + (py - sy) ** 2 <= r * r) return { id: node.id, kind: node.kind }
      }
      return null
    },
    [nodeRadius],
  )

  const onPointerDown = (e: React.PointerEvent): void => {
    const hit = nodeAt(e.clientX, e.clientY)
    if (hit && hit.kind === 'note') {
      onFileOpen(hit.id)
      return
    }
    dragRef.current = { active: true, lastX: e.clientX, lastY: e.clientY }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    if (dragRef.current.active) {
      const view = viewRef.current
      view.ox += e.clientX - dragRef.current.lastX
      view.oy += e.clientY - dragRef.current.lastY
      dragRef.current.lastX = e.clientX
      dragRef.current.lastY = e.clientY
      return
    }
    const hit = nodeAt(e.clientX, e.clientY)
    const id = hit?.id ?? null
    if (id !== hoverIdRef.current) {
      hoverIdRef.current = id
      setHover(id)
    }
  }

  const onPointerUp = (): void => {
    dragRef.current.active = false
  }

  const onWheel = (e: React.WheelEvent): void => {
    const view = viewRef.current
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    view.scale = Math.max(0.2, Math.min(4, view.scale * factor))
  }

  return (
    <div className={styles.wrap}>
      {loading ? (
        <div className={styles.status}>Building graph…</div>
      ) : graph && graph.nodes.length === 0 ? (
        <div className={styles.status}>
          No linked notes yet. Use [[Note]] links to build the graph.
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onWheel={onWheel}
          />
          <div className={styles.overlay}>
            <span>
              {graph?.nodes.length ?? 0} nodes · {graph?.edges.length ?? 0} links
              {graph?.truncated ? ' · truncated' : ''}
            </span>
            {hover && <span className={styles.hoverLabel}>{baseName(hover.replace(/^stub:/, ''))}</span>}
          </div>
        </>
      )}
    </div>
  )
}

export default GraphView
