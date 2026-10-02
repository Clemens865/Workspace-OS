import { createContext, useContext, useEffect, useRef, useState, type RefObject } from 'react'
import { Backdrop } from './Backdrop'
import type { GlassOpts } from './glassPanes'
import type { Quality } from './scheduler'
import { currentTheme, onThemeChange } from '../../../hooks/useTheme'

export const BackdropContext = createContext<Backdrop | null>(null)

/** The quality actually used: the setting, with 'auto' resolved from power and motion preferences. */
export function resolveQuality(setting: 'auto' | Quality, onBattery: boolean, reduced: boolean): Quality {
  if (setting !== 'auto') return setting
  if (reduced || onBattery) return 'light'
  return 'full'
}

interface BatteryLike {
  charging: boolean
  addEventListener: (t: string, f: () => void) => void
  removeEventListener: (t: string, f: () => void) => void
}

/** True while running on battery (Chromium's Battery Status API; false when unknown). */
function useOnBattery(): boolean {
  const [onBattery, setOnBattery] = useState(false)
  useEffect(() => {
    let bat: BatteryLike | null = null
    const read = (): void => setOnBattery(!!bat && !bat.charging)
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }
    void nav.getBattery?.().then((b) => {
      bat = b
      read()
      b.addEventListener('chargingchange', read)
    }).catch(() => {})
    return () => bat?.removeEventListener('chargingchange', read)
  }, [])
  return onBattery
}

export interface BackdropPerf {
  supported: boolean
  frames: () => number
  gpuAvgMs: () => number | null
  gpuMaxMs: () => number | null
  reset: () => void
  quality: () => Quality
  state: () => Record<string, number | boolean>
}

/**
 * Owns the Backdrop for a canvas: creates it (or falls back to Off when WebGL
 * is unavailable), feeds it window input, and stops it while it is covered.
 */
export function useBackdrop(canvas: RefObject<HTMLCanvasElement>, opts: { setting: 'auto' | Quality; visible: boolean; reduced: boolean }): { backdrop: Backdrop | null; quality: Quality } {
  const onBattery = useOnBattery()
  const quality = resolveQuality(opts.setting, onBattery, opts.reduced)
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null)
  const [failed, setFailed] = useState(false)
  const off = quality === 'off' || failed

  useEffect(() => {
    if (off || !canvas.current) return
    let b: Backdrop
    try {
      b = new Backdrop(canvas.current, { quality, grid: localStorage.getItem('wos:landscape-grid') === '1', reduced: opts.reduced })
    } catch {
      setFailed(true)
      return
    }
    setBackdrop(b)
    const perf: BackdropPerf = {
      supported: b.gpu.supported,
      frames: () => b.frames,
      gpuAvgMs: () => b.gpu.avgMs(),
      gpuMaxMs: () => b.gpu.maxMs(),
      reset: () => {
        b.frames = 0
        b.gpu.reset()
      },
      quality: () => quality,
      state: () => b.debugState(),
    }
    ;(window as unknown as { __landscapePerf?: BackdropPerf }).__landscapePerf = perf
    const onMove = (e: PointerEvent): void => b.pointer(e.clientX, e.clientY)
    const onLeave = (): void => b.pointerLeft()
    const onInput = (): void => b.input()
    const onResize = (): void => b.resize()
    const onVis = (): void => b.setVisible(!document.hidden)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    window.addEventListener('keydown', onInput)
    window.addEventListener('wheel', onInput, { passive: true })
    window.addEventListener('resize', onResize)
    document.addEventListener('visibilitychange', onVis)
    const canvasEl = canvas.current
    const onLost = (e: Event): void => {
      e.preventDefault()
      setFailed(true)
    }
    canvasEl.addEventListener('webglcontextlost', onLost)
    return () => {
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('keydown', onInput)
      window.removeEventListener('wheel', onInput)
      window.removeEventListener('resize', onResize)
      document.removeEventListener('visibilitychange', onVis)
      canvasEl.removeEventListener('webglcontextlost', onLost)
      b.dispose()
      setBackdrop(null)
    }
    // Recreated only when it must be (on/off); quality changes are applied live below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [off, canvas])

  useEffect(() => backdrop?.setQuality(quality), [backdrop, quality])
  // The dark theme is night in the landscape: set at once on creation, eased on a switch.
  useEffect(() => {
    if (!backdrop) return
    backdrop.setNight(currentTheme() === 'dark', true)
    return onThemeChange((t) => backdrop.setNight(t === 'dark'))
  }, [backdrop])
  useEffect(() => backdrop?.setVisible(opts.visible), [backdrop, opts.visible])

  return { backdrop, quality: off ? 'off' : quality }
}

/** Put Liquid Glass behind an element while it is mounted. */
export function useGlass(ref: RefObject<HTMLElement>, opts: GlassOpts | null): void {
  const backdrop = useContext(BackdropContext)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const enabled = !!opts
  useEffect(() => {
    const el = ref.current
    if (!backdrop || !el || !enabled || !optsRef.current) return
    backdrop.addGlass(el, optsRef.current)
    return () => backdrop.removeGlass(el)
  }, [backdrop, ref, enabled])
}
