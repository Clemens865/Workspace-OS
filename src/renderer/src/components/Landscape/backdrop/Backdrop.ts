/**
 * The landscape backdrop: the mist landscape (drawn into a texture), drifting
 * motes, and Liquid Glass panes behind DOM elements, on one canvas behind the
 * landscape layer. Ported from the approved prototype (docs/landscape/
 * prototype/bg.js) with two changes from PLAN.md §3a: no bloom, and frames are
 * drawn only when the scheduler says something changed.
 */
import * as THREE from 'three'
import { FULLSCREEN_VERT, LANDSCAPE_FRAG, MOTE_FRAG, MOTE_VERT, SCREEN_FRAG, SCREEN_VERT } from './shaders'
import { GlassPanes, type GlassOpts } from './glassPanes'
import { plan, type Quality } from './scheduler'
import { GpuTimer } from './gpuTimer'

export interface SheetFootprint {
  left: number
  right: number
  bottom: number
  alpha: number
  color: [number, number, number]
}

/**
 * Landscape texture resolution in device px per CSS px. The mist is soft; at
 * 0.75 it costs about a third of the 1.24 the prototype used, with no visible
 * difference (measured: PLAN.md §3a budget).
 */
const LAND_RES = { full: 0.75, light: 0.6, off: 0.6 } as const

function makeUniforms() {
  return {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2() },
    uMouse: { value: new THREE.Vector2() },
    uFocus: { value: 0 },
    uTint: { value: new THREE.Color('#2D9D8F') },
    uTintAmt: { value: 0 },
    uLight: { value: 0.56 },
    uBreath: { value: 0 },
    uDebug: { value: 0 },
    uNight: { value: 0 },
    uRip: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) },
    uSh: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uShC: { value: Array.from({ length: 8 }, () => new THREE.Vector3(1, 1, 1)) },
  }
}

export class Backdrop {
  readonly renderer: THREE.WebGLRenderer
  readonly glass: GlassPanes
  readonly gpu: GpuTimer
  frames = 0
  private quality: Quality
  private visible = true
  private pr = 1
  private raf = 0
  private lastTick = 0
  private lastInput = performance.now()
  private lastLand = 0
  private landDirty = true
  private pointerDirty = false
  private movingUntil = 0
  private panesUntil = 0
  private sheetSource: (() => SheetFootprint[]) | null = null
  private ripples: { x: number; y: number; age: number; amp: number }[] = []
  private breath = 0
  private readonly target = { focus: 0, tint: 0, mx: 0, my: 0, light: 0.56, night: 0 }
  private readonly cur = { focus: 0, tint: 0, mx: 0, my: 0, light: 0.56, night: 0 }
  private readonly u = makeUniforms()
  private readonly reduced: boolean
  private readonly landRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  private readonly bgScene = new THREE.Scene()
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly glassScene = new THREE.Scene()
  private readonly glassCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10)
  private readonly moteScene = new THREE.Scene()
  private readonly persp = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
  private readonly uOut = { value: new THREE.Vector2(1, 1) }
  private readonly uPR = { value: 1 }
  private readonly uLight = { value: new THREE.Vector2(-0.6, -0.8) }
  private readonly uPointer = { value: new THREE.Vector2(-1e4, -1e4) }
  private readonly moteMat: THREE.ShaderMaterial

  constructor(canvas: HTMLCanvasElement, opts: { quality: Quality; grid?: boolean; reduced?: boolean }) {
    this.quality = opts.quality
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.autoClear = false
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace // the landscape is authored in display space
    this.gpu = new GpuTimer(this.renderer.getContext() as WebGL2RenderingContext)
    this.reduced = !!opts.reduced

    this.u.uDebug.value = opts.grid ? 1 : 0
    this.bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: FULLSCREEN_VERT, fragmentShader: LANDSCAPE_FRAG, depthWrite: false })))

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { tLand: { value: this.landRT.texture }, uOut: this.uOut }, vertexShader: SCREEN_VERT, fragmentShader: SCREEN_FRAG, depthWrite: false, depthTest: false }))
    quad.frustumCulled = false
    quad.renderOrder = -1
    this.glassScene.add(quad)
    this.glass = new GlassPanes(this.glassScene, { tLand: { value: this.landRT.texture }, uOut: this.uOut, uPR: this.uPR, uTime: this.u.uTime, uLight: this.uLight, uPointer: this.uPointer, uNight: this.u.uNight })

    // Motes: a sparse drift of light specks in front of the far mist.
    const N = 260
    const pos = new Float32Array(N * 3)
    const seed = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 26
      pos[i * 3 + 1] = (Math.random() - 0.35) * 12
      pos[i * 3 + 2] = -Math.random() * 18 + 2
      seed[i] = Math.random()
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1))
    this.moteMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { uTime: this.u.uTime, uPx: { value: 1 }, uFocus: this.u.uFocus }, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG })
    this.moteScene.add(new THREE.Points(geo, this.moteMat))
    this.persp.position.set(0, 0, 8)

    this.resize()
  }

  // ── state the shell sets ──
  setVisible(v: boolean): void {
    this.visible = v
    if (v) {
      this.landDirty = true
      this.wake()
    }
  }

  setQuality(q: Quality): void {
    if (q === this.quality) return
    this.quality = q
    this.resize()
  }

  setFocus(v: number): void {
    this.target.focus = v
    this.wake()
  }

  /** Day or night (the dark theme); eases over, like a change of focus. `instant` skips the ease (first frame). */
  setNight(on: boolean, instant = false): void {
    this.target.night = on ? 1 : 0
    if (instant) this.cur.night = this.target.night
    this.u.uNight.value = this.cur.night
    this.landDirty = true
    this.wake()
  }

  setTint(hex: string | null, amt = 1): void {
    if (hex) this.u.uTint.value.set(hex)
    this.target.tint = hex ? amt : 0
    this.wake()
  }

  setLight(x: number): void {
    this.target.light = x
    this.wake()
  }

  /** A ripple on the lake, at window coordinates. */
  ripple(cx: number, cy: number, amp = 1): void {
    if (this.reduced) return
    this.ripples.unshift({ x: cx / window.innerWidth, y: 1 - cy / window.innerHeight, age: 0, amp })
    this.ripples.length = Math.min(this.ripples.length, 4)
    this.wake()
  }

  /** The mist breathes once (a view change). */
  breathe(): void {
    if (this.reduced) return
    this.breath = 1
    this.wake()
  }

  /** Screens are moving for `ms`: follow their glass and lake reflections. */
  trackSheets(source: (() => SheetFootprint[]) | null, ms = 1300): void {
    if (source) this.sheetSource = source
    this.movingUntil = Math.max(this.movingUntil, performance.now() + ms)
    this.wake()
  }

  /** Only the glass needs to follow for `ms` (a hover lift). */
  followGlass(ms = 650): void {
    this.panesUntil = Math.max(this.panesUntil, performance.now() + ms)
    this.wake()
  }

  addGlass(el: HTMLElement, opts: GlassOpts): void {
    this.glass.add(el, opts)
    this.followGlass(400)
  }

  removeGlass(el: HTMLElement): void {
    this.glass.remove(el)
    this.followGlass(50)
  }

  pointer(x: number, y: number): void {
    this.uPointer.value.set(x, y)
    this.target.mx = (x / window.innerWidth) * 2 - 1
    this.target.my = (y / window.innerHeight) * 2 - 1
    this.lastInput = performance.now()
    this.pointerDirty = true
    this.wake()
  }

  pointerLeft(): void {
    this.uPointer.value.set(-1e4, -1e4)
    this.pointerDirty = true
    this.wake()
  }

  /** Keyboard / wheel input: someone is here (keeps the mist drifting). */
  input(): void {
    this.lastInput = performance.now()
    this.wake()
  }

  resize(): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.pr = Math.min(window.devicePixelRatio || 1, 2) * (this.quality === 'light' ? 0.75 : 0.9)
    this.renderer.setPixelRatio(this.pr)
    this.renderer.setSize(w, h, false)
    const ow = Math.round(w * this.pr)
    const oh = Math.round(h * this.pr)
    const lw = Math.round(w * LAND_RES[this.quality])
    const lh = Math.round(h * LAND_RES[this.quality])
    this.u.uRes.value.set(lw, lh)
    this.uOut.value.set(ow, oh)
    this.uPR.value = this.pr
    ;(this.moteMat.uniforms.uPx as { value: number }).value = this.pr
    this.persp.aspect = w / h
    this.persp.updateProjectionMatrix()
    this.glassCam.left = -w / 2
    this.glassCam.right = w / 2
    this.glassCam.top = h / 2
    this.glassCam.bottom = -h / 2
    this.glassCam.position.set(w / 2, -h / 2, 5)
    this.glassCam.updateProjectionMatrix()
    this.landRT.setSize(lw, lh)
    this.landDirty = true
    this.panesUntil = Math.max(this.panesUntil, performance.now() + 300)
    this.wake()
  }

  dispose(): void {
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.glass.dispose()
    this.landRT.dispose()
    this.gpu.dispose()
    this.renderer.dispose()
  }

  /** Why the loop is (or is not) running: for the perf test and debugging. */
  debugState(): Record<string, number | boolean> {
    const now = performance.now()
    return { easing: this.easing(), movingMs: Math.round(this.movingUntil - now), panesMs: Math.round(this.panesUntil - now), pointerDirty: this.pointerDirty, landDirty: this.landDirty, inputAgoMs: Math.round(now - this.lastInput), ripples: this.ripples.length, breath: this.breath, visible: this.visible }
  }

  // ── the loop ──
  private wake(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private easing(): boolean {
    const t = this.target
    const c = this.cur
    return Math.abs(t.focus - c.focus) + Math.abs(t.tint - c.tint) + Math.abs(t.mx - c.mx) + Math.abs(t.my - c.my) + Math.abs(t.light - c.light) + Math.abs(t.night - c.night) > 0.002 || this.ripples.length > 0 || this.breath > 0
  }

  private tick = (now: number): void => {
    this.raf = 0
    const dt = this.lastTick ? Math.min((now - this.lastTick) / 1000, 0.05) : 1 / 60
    this.lastTick = now
    const visible = this.visible && !document.hidden
    const p = plan({ now: performance.now(), visible, quality: this.quality, lastInput: this.lastInput, easing: this.easing(), movingUntil: this.movingUntil, panesUntil: this.panesUntil, landDirty: this.landDirty, pointerDirty: this.pointerDirty, lastLand: this.lastLand })
    if (p.screen) {
      this.advance(dt)
      this.gpu.begin()
      if (p.panes) {
        this.glass.prune()
        this.glass.updateAll()
      }
      const r = this.renderer
      if (p.land) {
        if (this.sheetSource && performance.now() < this.movingUntil) this.writeSheets(this.sheetSource())
        r.setRenderTarget(this.landRT)
        r.clear()
        r.render(this.bgScene, this.ortho)
        this.lastLand = performance.now()
        this.landDirty = false
      }
      r.setRenderTarget(null)
      r.clear()
      r.render(this.glassScene, this.glassCam)
      if (this.quality === 'full') r.render(this.moteScene, this.persp)
      this.gpu.end()
      this.pointerDirty = false
      this.frames++
    } else {
      this.lastTick = 0
    }
    if (p.again) this.wake()
  }

  /** Ease the shared state one step (frame-rate independent). */
  private advance(dt: number): void {
    if (this.quality === 'full' && !this.reduced) this.u.uTime.value += dt
    const k = 1 - Math.pow(0.0016, dt)
    const c = this.cur as Record<string, number>
    const t = this.target as Record<string, number>
    for (const key in c) c[key] += (t[key] - c[key]) * (key === 'focus' || key === 'tint' ? k * 0.55 : k * 0.35)
    this.u.uFocus.value = c.focus
    this.u.uTintAmt.value = c.tint
    this.u.uLight.value = c.light
    this.u.uNight.value = c.night
    this.u.uMouse.value.set(c.mx, c.my)
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      this.ripples[i].age += dt
      if (this.ripples[i].age > 2.6) this.ripples.splice(i, 1)
    }
    this.u.uRip.value.forEach((v, i) => {
      const rp = this.ripples[i]
      if (rp) v.set(rp.x, rp.y, rp.age, rp.amp)
      else v.set(0, 0, 0, 0)
    })
    this.breath = Math.max(0, this.breath - dt * 1.4)
    this.u.uBreath.value = Math.sin(Math.min(1, this.breath) * Math.PI) * 0.9
    this.persp.position.set(c.mx * 0.5, -c.my * 0.3, 8 - c.focus * 1.6)
    this.persp.lookAt(0, 0, -6)
  }

  private writeSheets(list: SheetFootprint[]): void {
    const w = window.innerWidth
    const h = window.innerHeight
    this.u.uSh.value.forEach((v, i) => {
      const s = list[i]
      if (!s) {
        v.set(0, 0, 0, 0)
        return
      }
      v.set(s.left / w, s.right / w, 1 - s.bottom / h, s.alpha)
      this.u.uShC.value[i].set(s.color[0], s.color[1], s.color[2])
    })
  }
}
