/**
 * A tiny, dependency-free force-directed graph layout (Fruchterman-Reingold with
 * velocity damping). Pure + deterministic given a seed — no DOM, no globals — so
 * it can be unit-tested and driven from a requestAnimationFrame loop alike.
 *
 * Model: nodes repel each other (inverse-square), edges pull their endpoints
 * together (spring), and a mild gravity keeps the graph centred. One `step()`
 * advances the simulation; call it repeatedly (or to convergence) to lay out.
 */

export interface LayoutNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Relative mass (∝ 1 + degree) — heavier nodes move less, anchoring hubs. */
  mass: number
}

export interface LayoutEdge {
  source: string
  target: string
}

export interface LayoutOptions {
  /** Ideal edge length / repulsion scale. */
  k?: number
  /** Spring stiffness for edges (0..1). */
  spring?: number
  /** Pull toward the origin (keeps disconnected bits from drifting away). */
  gravity?: number
  /** Velocity retained each step (0..1) — lower = faster settle. */
  damping?: number
  /** Max displacement per node per step (stability clamp). */
  maxStep?: number
  /** Deterministic seed for the initial ring placement. */
  seed?: number
}

const DEFAULTS: Required<LayoutOptions> = {
  k: 60,
  spring: 0.08,
  gravity: 0.02,
  damping: 0.82,
  maxStep: 40,
  seed: 1,
}

/** A small deterministic PRNG (mulberry32) — same seed ⇒ same layout. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Builds initial node state: a deterministic ring (avoids degenerate overlap). */
export function initLayout(
  nodes: { id: string; degree: number }[],
  edges: LayoutEdge[],
  opts: LayoutOptions = {},
): { nodes: LayoutNode[]; edges: LayoutEdge[]; options: Required<LayoutOptions> } {
  const options = { ...DEFAULTS, ...opts }
  const rand = rng(options.seed)
  const n = nodes.length
  const radius = options.k * Math.sqrt(Math.max(n, 1))
  const laidOut: LayoutNode[] = nodes.map((node, i) => {
    // Deterministic ring + a seeded jitter so no two nodes start coincident.
    const angle = (i / Math.max(n, 1)) * Math.PI * 2
    const jitter = (rand() - 0.5) * options.k
    return {
      id: node.id,
      x: Math.cos(angle) * radius + jitter,
      y: Math.sin(angle) * radius + jitter,
      vx: 0,
      vy: 0,
      mass: 1 + node.degree,
    }
  })
  // Keep only edges whose endpoints exist (defensive; the model already prunes).
  const ids = new Set(laidOut.map((x) => x.id))
  const kept = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  return { nodes: laidOut, edges: kept, options }
}

/**
 * Advance the simulation one step, mutating node positions in place. Returns the
 * total kinetic energy — a caller can stop the RAF loop once it drops below a
 * threshold (the layout has converged).
 */
export function step(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: Required<LayoutOptions>,
): number {
  const byId = new Map<string, LayoutNode>()
  for (const nd of nodes) byId.set(nd.id, nd)

  const fx = new Map<string, number>()
  const fy = new Map<string, number>()
  for (const nd of nodes) {
    fx.set(nd.id, 0)
    fy.set(nd.id, 0)
  }

  // Repulsion — every pair pushes apart (inverse-square, softened at 0).
  const k2 = options.k * options.k
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      let dx = a.x - b.x
      let dy = a.y - b.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) {
        // Coincident — nudge deterministically so they separate.
        dx = (i - j) * 0.01 + 0.01
        dy = 0.01
        d2 = dx * dx + dy * dy
      }
      const force = k2 / d2
      const d = Math.sqrt(d2)
      const ux = dx / d
      const uy = dy / d
      fx.set(a.id, (fx.get(a.id) as number) + ux * force)
      fy.set(a.id, (fy.get(a.id) as number) + uy * force)
      fx.set(b.id, (fx.get(b.id) as number) - ux * force)
      fy.set(b.id, (fy.get(b.id) as number) - uy * force)
    }
  }

  // Attraction — edges act as springs toward the ideal length k.
  for (const e of edges) {
    const a = byId.get(e.source)
    const b = byId.get(e.target)
    if (!a || !b) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01
    const force = options.spring * (d - options.k)
    const ux = dx / d
    const uy = dy / d
    fx.set(a.id, (fx.get(a.id) as number) + ux * force)
    fy.set(a.id, (fy.get(a.id) as number) + uy * force)
    fx.set(b.id, (fx.get(b.id) as number) - ux * force)
    fy.set(b.id, (fy.get(b.id) as number) - uy * force)
  }

  // Gravity toward origin + integrate, clamped for stability. Energy = Σ v².
  let energy = 0
  for (const nd of nodes) {
    const gx = -nd.x * options.gravity
    const gy = -nd.y * options.gravity
    const ax = ((fx.get(nd.id) as number) + gx) / nd.mass
    const ay = ((fy.get(nd.id) as number) + gy) / nd.mass
    nd.vx = (nd.vx + ax) * options.damping
    nd.vy = (nd.vy + ay) * options.damping
    // Clamp displacement so a huge force can't fling a node off-screen.
    const dx = Math.max(-options.maxStep, Math.min(options.maxStep, nd.vx))
    const dy = Math.max(-options.maxStep, Math.min(options.maxStep, nd.vy))
    nd.x += dx
    nd.y += dy
    energy += dx * dx + dy * dy
  }
  return energy
}

/**
 * Run the layout to (approximate) convergence — a convenience for tests and
 * one-shot layouts. Steps until the kinetic energy falls below `epsilon` or
 * `maxIters` is hit. Deterministic given the seed.
 */
export function layout(
  nodes: { id: string; degree: number }[],
  edges: LayoutEdge[],
  opts: LayoutOptions = {},
  maxIters = 300,
  epsilon = 0.01,
): LayoutNode[] {
  const sim = initLayout(nodes, edges, opts)
  for (let i = 0; i < maxIters; i++) {
    if (step(sim.nodes, sim.edges, sim.options) < epsilon) break
  }
  return sim.nodes
}
