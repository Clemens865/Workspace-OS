import { useCallback, useEffect, useRef, useState } from 'react'
import splashLogo from '../../assets/splash-logo.png'
import styles from './Splash.module.css'

/**
 * The startup splash — the Workspace logo seen through rippling water, then
 * "Loading…" resolving into an Enter button.
 *
 * The water is a real ping-pong wave simulation (WebGL2, RG16F): each frame the
 * height field is relaxed against its previous state, drops are injected on
 * pointer movement/clicks and on a slow automatic cadence, and the render pass
 * refracts the LOGO TEXTURE through the surface gradient with crest shading and
 * a specular glint. Adapted from the ThreeUI "Elements — Water" study, ported
 * NATIVELY into this bundle: the original ships as an iframe with inline
 * scripts, which our CSP (script-src 'self', enforced via response headers)
 * would refuse — so the shaders live here as module code instead.
 *
 * Fail-safe: no WebGL2 / no float buffers / prefers-reduced-motion → a static
 * logo with the same Loading→Enter overlay. The splash must never be the thing
 * that keeps someone out of their workspace.
 */

const SIM_RES = 384
const MIN_SHOW_MS = 1500

const VERT = `#version 300 es
out vec2 vUv;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

/* Wave-equation step over a ping-pong height field (r = h, g = h_prev). */
const FRAG_SIM = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec3 uDrop; // sim-uv.xy, strength
in vec2 vUv;
out vec4 frag;
void main(){
  vec2 s = texture(uState, vUv).rg;
  float l = texture(uState, vUv - vec2(uTexel.x, 0.0)).r;
  float r = texture(uState, vUv + vec2(uTexel.x, 0.0)).r;
  float u = texture(uState, vUv + vec2(0.0, uTexel.y)).r;
  float d = texture(uState, vUv - vec2(0.0, uTexel.y)).r;
  float next = (l + r + u + d) * 0.5 - s.g;
  next *= 0.984;
  if (uDrop.z != 0.0){
    float dd = distance(vUv, uDrop.xy);
    next += uDrop.z * exp(-dd * dd * 3800.0);
  }
  frag = vec4(next, s.r, 0.0, 1.0);
}`

/* The logo, refracted through the simulated surface. */
const FRAG_WATER = `#version 300 es
precision highp float;
uniform sampler2D uState;
uniform sampler2D uLogo;
uniform vec2  uSimTexel;
uniform float uAspect;
uniform float uTime;
in vec2 vUv;
out vec4 frag;

float hash21(vec2 p){
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1,0));
  float c = hash21(i + vec2(0,1)), d = hash21(i + vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 5; i++){ v += a * vnoise(p); p = r * p * 2.03; a *= 0.5; }
  return v;
}
/* cover-map panel uv into the square sim so rings stay circular on screen */
vec2 simUV(vec2 uv){
  return 0.5 + (uv - 0.5) * vec2(uAspect, 1.0) / max(uAspect, 1.0);
}
void main(){
  vec2 suv = simUV(vUv);
  float h  = texture(uState, suv).r;
  float hx = texture(uState, suv + vec2(uSimTexel.x, 0.0)).r - texture(uState, suv - vec2(uSimTexel.x, 0.0)).r;
  float hy = texture(uState, suv + vec2(0.0, uSimTexel.y)).r - texture(uState, suv - vec2(0.0, uSimTexel.y)).r;
  vec2 grad = vec2(hx, hy);
  vec3 nrm = normalize(vec3(-grad * 30.0, 1.0));

  vec2 ruv = vUv + grad * 0.22; // refracted lookup

  // deep-water base, tuned to the logo's own navy so the mark melts into it
  vec3 col = mix(vec3(0.030, 0.034, 0.085), vec3(0.055, 0.065, 0.145), vUv.y * 0.8 + h * 0.25);
  col += vec3(0.02, 0.05, 0.12) * fbm(vUv * vec2(uAspect, 1.0) * 3.0 + uTime * 0.05) * 0.35;

  // the logo, seen through the surface — centered box, feathered into the water
  float boxH = 0.52; // logo height as a fraction of the viewport height
  vec2 lp = ((ruv - 0.5) * vec2(uAspect, 1.0)) / boxH + 0.5;
  float edge = max(abs(lp.x - 0.5), abs(lp.y - 0.5)) * 2.0;
  float inBox = 1.0 - smoothstep(0.80, 1.0, edge);
  vec3 logo = texture(uLogo, vec2(lp.x, 1.0 - lp.y)).rgb;
  col = mix(col, logo, inBox);

  // ripple shading: crests bright, troughs barely darker
  col += vec3(0.07, 0.20, 0.30) * clamp(h * 1.8, -0.06, 1.0);
  col += vec3(0.20, 0.42, 0.55) * pow(clamp(h * 2.6, 0.0, 1.0), 2.0) * 0.5;

  // specular glint
  vec3 L = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(nrm, H), 0.0), 150.0);
  col += spec * vec3(0.65, 0.85, 1.0) * 0.8;

  // gentle vignette + dither
  float fade = smoothstep(0.0, 0.10, vUv.x) * smoothstep(1.0, 0.90, vUv.x)
             * smoothstep(0.0, 0.10, vUv.y) * smoothstep(1.0, 0.90, vUv.y);
  col *= 0.45 + 0.55 * fade;
  col += (hash21(vUv * 617.0 + uTime) - 0.5) / 128.0;
  frag = vec4(col, 1.0);
}`

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return null
  return sh
}
function program(gl: WebGL2RenderingContext, v: string, f: string): WebGLProgram | null {
  const p = gl.createProgram()
  if (!p) return null
  const vs = compile(gl, gl.VERTEX_SHADER, v)
  const fs = compile(gl, gl.FRAGMENT_SHADER, f)
  if (!vs || !fs) return null
  gl.attachShader(p, vs)
  gl.attachShader(p, fs)
  gl.linkProgram(p)
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null
  return p
}

export function Splash({ onDone }: { onDone: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [fallback, setFallback] = useState(false)

  // Ready = the bridge answers AND a floor so the splash never just blinks.
  useEffect(() => {
    let live = true
    const floor = new Promise((r) => setTimeout(r, MIN_SHOW_MS))
    const bridge = Promise.resolve()
      .then(() => window.workspace?.fs?.getWorkspaceRoot?.())
      .catch(() => null)
    void Promise.all([floor, bridge]).then(() => live && setReady(true))
    return () => {
      live = false
    }
  }, [])

  const enter = useCallback(() => {
    setLeaving(true)
    window.setTimeout(onDone, 550) // matches the CSS fade
  }, [onDone])

  // Enter key works as soon as the button is up.
  useEffect(() => {
    if (!ready) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') enter()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ready, enter])

  useEffect(() => {
    const canvas = canvasRef.current
    const host = hostRef.current
    if (!canvas || !host) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFallback(true)
      return
    }
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })
    if (!gl || !gl.getExtension('EXT_color_buffer_float')) {
      setFallback(true)
      return
    }
    const simProg = program(gl, VERT, FRAG_SIM)
    const drawProg = program(gl, VERT, FRAG_WATER)
    if (!simProg || !drawProg) {
      setFallback(true)
      return
    }
    const simUni = {
      uState: gl.getUniformLocation(simProg, 'uState'),
      uTexel: gl.getUniformLocation(simProg, 'uTexel'),
      uDrop: gl.getUniformLocation(simProg, 'uDrop'),
    }
    const drawUni = {
      uState: gl.getUniformLocation(drawProg, 'uState'),
      uLogo: gl.getUniformLocation(drawProg, 'uLogo'),
      uSimTexel: gl.getUniformLocation(drawProg, 'uSimTexel'),
      uAspect: gl.getUniformLocation(drawProg, 'uAspect'),
      uTime: gl.getUniformLocation(drawProg, 'uTime'),
    }

    // ping-pong height field
    const simTex: WebGLTexture[] = []
    const simFbo: WebGLFramebuffer[] = []
    for (let i = 0; i < 2; i++) {
      const t = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, t)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, SIM_RES, SIM_RES, 0, gl.RG, gl.HALF_FLOAT, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const f = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, f)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
      simTex.push(t)
      simFbo.push(f)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    let simSrc = 0

    // logo texture
    const logoTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, logoTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 11, 30, 255]))
    const img = new Image()
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, logoTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    img.src = splashLogo

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75)
    let aspect = 1
    const resize = (): void => {
      const r = host.getBoundingClientRect()
      const w = Math.max(2, Math.round(r.width * dpr))
      const h = Math.max(2, Math.round(r.height * dpr))
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w
        canvas.height = h
      }
      aspect = w / h
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(host)

    // drops: pointer + slow automatic cadence
    const dropQueue: { x: number; y: number; s: number }[] = []
    let nextAutoDrop = 0.5
    let last: { x: number; y: number } | null = null
    let lastT = 0
    const uv = (e: PointerEvent): { x: number; y: number } => {
      const r = host.getBoundingClientRect()
      return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height }
    }
    const onMove = (e: PointerEvent): void => {
      const p = uv(e)
      const now = performance.now()
      if (last) {
        const dt = Math.max(8, now - lastT)
        const speed = Math.hypot(p.x - last.x, p.y - last.y) / (dt / 1000)
        if (speed > 0.05 && dropQueue.length < 6) dropQueue.push({ x: p.x, y: p.y, s: Math.min(speed * 0.14, 0.5) })
      }
      last = p
      lastT = now
    }
    const onDown = (e: PointerEvent): void => {
      const p = uv(e)
      dropQueue.push({ x: p.x, y: p.y, s: 0.9 })
    }
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerdown', onDown)

    /* panel uv -> square sim uv (must match simUV() in the shader) */
    const toSimUV = (x: number, y: number): { x: number; y: number } => {
      const m = Math.max(aspect, 1)
      return { x: 0.5 + (x - 0.5) * aspect / m, y: 0.5 + (y - 0.5) / m }
    }

    let raf = 0
    const t0 = performance.now()
    const loop = (): void => {
      const t = (performance.now() - t0) / 1000
      if (t > nextAutoDrop) {
        dropQueue.push({ x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7, s: 0.1 + Math.random() * 0.28 })
        nextAutoDrop = t + 0.5 + Math.random() * 1.4
      }
      // sim: two relaxation steps a frame
      gl.useProgram(simProg)
      gl.viewport(0, 0, SIM_RES, SIM_RES)
      gl.uniform2f(simUni.uTexel, 1 / SIM_RES, 1 / SIM_RES)
      for (let i = 0; i < 2; i++) {
        const drop = dropQueue.shift()
        if (drop) {
          const s = toSimUV(drop.x, drop.y)
          gl.uniform3f(simUni.uDrop, s.x, s.y, drop.s)
        } else gl.uniform3f(simUni.uDrop, 0, 0, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, simFbo[1 - simSrc])
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, simTex[simSrc])
        gl.uniform1i(simUni.uState, 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        simSrc = 1 - simSrc
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)

      // render
      gl.useProgram(drawProg)
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform1f(drawUni.uTime, t)
      gl.uniform1f(drawUni.uAspect, aspect)
      gl.uniform2f(drawUni.uSimTexel, 1 / SIM_RES, 1 / SIM_RES)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, simTex[simSrc])
      gl.uniform1i(drawUni.uState, 0)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, logoTex)
      gl.uniform1i(drawUni.uLogo, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerdown', onDown)
    }
  }, [])

  return (
    <div ref={hostRef} className={`${styles.splash} ${leaving ? styles.leaving : ''}`}>
      {!fallback && <canvas ref={canvasRef} className={styles.canvas} />}
      {fallback && <img src={splashLogo} alt="" className={styles.staticLogo} />}
      <div className={styles.overlay}>
        <div className={styles.word}>WORKSPACE&nbsp;OS</div>
        {!ready && (
          <div className={styles.loading} role="status">
            Loading<span className={styles.dots}><i>.</i><i>.</i><i>.</i></span>
          </div>
        )}
        {ready && (
          <button type="button" className={styles.enter} onClick={enter} autoFocus>
            Enter
          </button>
        )}
      </div>
    </div>
  )
}
