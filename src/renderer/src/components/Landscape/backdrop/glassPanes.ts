/**
 * Liquid Glass panes behind DOM elements. Each pane is a small grid bent to
 * its element's four projected corners (read from zero-size corner markers,
 * so CSS 3D transforms are matched exactly), shaded by GLASS_FRAG from the
 * landscape texture. The DOM element keeps its content; the glass is drawn
 * behind it on the backdrop canvas.
 */
import * as THREE from 'three'
import { GLASS_FRAG, GLASS_VERT } from './shaders'

export interface GlassOpts {
  /** Corner radius, bezel depth and lens thickness, CSS px. */
  radius?: number
  bezel?: number
  thickness?: number
  /** 0..1 lift toward white for legibility; or a function of the element. */
  frost?: number | ((el: HTMLElement) => number)
  /** Provider light caught in the rim (hex). */
  color?: string
  /** 0..1: how present the pane is (its screen's opacity); below ~0.03 it hides. */
  alpha?: (el: HTMLElement) => number
}

/** Uniforms every pane shares by reference: the landscape, light, pointer, pixel ratio. */
export interface SharedGlass {
  tLand: { value: THREE.Texture }
  uOut: { value: THREE.Vector2 }
  uPR: { value: number }
  uTime: { value: number }
  uLight: { value: THREE.Vector2 }
  uPointer: { value: THREE.Vector2 }
  /** 0 = day, 1 = night (the dark theme). */
  uNight: { value: number }
}

interface Pane {
  el: HTMLElement
  opts: GlassOpts
  marks: HTMLElement[]
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>
  w: number
  h: number
  /** The scroll box that clips the element (null = the window). */
  clip: HTMLElement | null
}

const PAD = 3
const GRID = 10

/** The nearest ancestor that clips its content (a scroll box), if any. */
export function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p)
    if (/(auto|scroll|hidden)/.test(s.overflowY + s.overflowX)) return p
  }
  return null
}

/** Bilinear interpolation of the four corners (TL, TR, BR, BL). */
export function bilerp(c: [number, number][], u: number, v: number, k: 0 | 1): number {
  return c[0][k] * (1 - u) * (1 - v) + c[1][k] * u * (1 - v) + c[2][k] * u * v + c[3][k] * (1 - u) * v
}

function paneGeo(w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1, 1, GRID, GRID)
  const uv = g.attributes.uv.array as Float32Array
  const loc: number[] = []
  const W = w + PAD * 2
  const H = h + PAD * 2
  for (let i = 0; i < uv.length; i += 2) loc.push((uv[i] - 0.5) * W, (0.5 - uv[i + 1]) * H)
  g.setAttribute('aLocal', new THREE.Float32BufferAttribute(loc, 2))
  return g
}

export class GlassPanes {
  private panes = new Map<HTMLElement, Pane>()

  constructor(
    private scene: THREE.Scene,
    private shared: SharedGlass,
  ) {}

  get size(): number {
    return this.panes.size
  }

  has(el: HTMLElement): boolean {
    return this.panes.has(el)
  }

  add(el: HTMLElement, opts: GlassOpts = {}): void {
    if (this.panes.has(el)) {
      this.panes.get(el)!.opts = opts
      return
    }
    const cs = getComputedStyle(el)
    const bw = parseFloat(cs.borderLeftWidth) || 0
    if (cs.position === 'static') el.style.position = 'relative'
    const marks = ([[0, 0], [1, 0], [1, 1], [0, 1]] as const).map(([x, y]) => {
      const m = document.createElement('i')
      m.setAttribute('aria-hidden', 'true')
      m.dataset.glassMark = ''
      m.style.cssText = `position:absolute;width:0;height:0;pointer-events:none;left:calc(${x * 100}% + ${(x ? 1 : -1) * bw}px);top:calc(${y * 100}% + ${(y ? 1 : -1) * bw}px)`
      el.appendChild(m)
      return m
    })
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: {
        ...this.shared,
        uHalf: { value: new THREE.Vector2() },
        uRadius: { value: opts.radius ?? 8 },
        uBezel: { value: opts.bezel ?? 14 },
        uThick: { value: opts.thickness ?? 18 },
        uScale: { value: 1 },
        uAlpha: { value: 1 },
        uFrost: { value: typeof opts.frost === 'number' ? opts.frost : 0.1 },
        uColor: { value: new THREE.Color(opts.color ?? '#ffffff') },
        uTinted: { value: opts.color ? 1 : 0 },
        uClip: { value: new THREE.Vector4(-1e6, -1e6, 1e6, 1e6) },
      },
    })
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat)
    mesh.frustumCulled = false
    mesh.renderOrder = this.panes.size
    this.scene.add(mesh)
    const p: Pane = { el, opts, marks, mesh, w: 0, h: 0, clip: scrollBox(el) }
    this.panes.set(el, p)
    this.update(p)
  }

  remove(el: HTMLElement): void {
    const p = this.panes.get(el)
    if (!p) return
    this.scene.remove(p.mesh)
    p.mesh.geometry.dispose()
    p.mesh.material.dispose()
    p.marks.forEach((m) => m.remove())
    this.panes.delete(el)
  }

  /** Drop panes whose elements left the DOM. */
  prune(): void {
    for (const el of [...this.panes.keys()]) if (!el.isConnected) this.remove(el)
  }

  updateAll(): void {
    this.panes.forEach((p) => this.update(p))
  }

  dispose(): void {
    for (const el of [...this.panes.keys()]) this.remove(el)
  }

  private update(p: Pane): void {
    const el = p.el
    if (!el.isConnected) {
      this.remove(el)
      return
    }
    const alpha = p.opts.alpha ? p.opts.alpha(el) : 1
    const w = el.offsetWidth
    const h = el.offsetHeight
    if (alpha < 0.03 || w < 4 || h < 4) {
      p.mesh.visible = false
      return
    }
    const c = p.marks.map((m) => {
      const r = m.getBoundingClientRect()
      return [r.left, r.top] as [number, number]
    })
    // Clip to the scroll box the element lives in; hide it once it has left the box.
    const U0 = p.mesh.material.uniforms
    if (p.clip?.isConnected) {
      const b = p.clip.getBoundingClientRect()
      const xs = c.map((q) => q[0])
      const ys = c.map((q) => q[1])
      if (Math.max(...xs) <= b.left || Math.min(...xs) >= b.right || Math.max(...ys) <= b.top || Math.min(...ys) >= b.bottom) {
        p.mesh.visible = false
        return
      }
      U0.uClip.value.set(b.left, b.top, b.right, b.bottom)
    }
    if (Math.abs(c[1][0] - c[0][0]) < 2) {
      p.mesh.visible = false
      return
    }
    if (!p.w || Math.abs(p.w - w) > 0.5 || Math.abs(p.h - h) > 0.5) {
      p.mesh.geometry.dispose()
      p.mesh.geometry = paneGeo(w, h)
      p.w = w
      p.h = h
    }
    const pos = p.mesh.geometry.attributes.position
    const arr = pos.array as Float32Array
    const loc = p.mesh.geometry.attributes.aLocal.array as Float32Array
    for (let i = 0, j = 0; i < arr.length; i += 3, j += 2) {
      const u = loc[j] / w + 0.5
      const v = loc[j + 1] / h + 0.5
      arr[i] = bilerp(c, u, v, 0)
      arr[i + 1] = -bilerp(c, u, v, 1)
      arr[i + 2] = 0
    }
    pos.needsUpdate = true
    const U = p.mesh.material.uniforms
    U.uHalf.value.set(w / 2, h / 2)
    U.uScale.value = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]) / w
    U.uAlpha.value = alpha
    if (typeof p.opts.frost === 'function') U.uFrost.value = p.opts.frost(el)
    p.mesh.visible = true
  }
}
