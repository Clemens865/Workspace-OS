import { useEffect, type MutableRefObject } from 'react'

/** Zoom bounds shared with the ribbon's − / + and the View presets. */
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3

/**
 * The next zoom for a wheel/pinch delta. Trackpad pinch arrives as a wheel
 * event with ctrlKey and small fractional deltas; a mouse wheel with ⌘ held
 * arrives with ±100-ish deltas. Scale multiplicatively so both feel even, and
 * clamp so a big fling cannot jump past the bounds.
 */
export function zoomForDelta(zoom: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * 0.0025)
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * factor))
  return +next.toFixed(3)
}

/**
 * Scroll offsets that keep the document point under the pointer fixed across
 * a zoom change. `px`/`py` are the pointer's offsets inside the scroll host's
 * client box; content scales about the origin, so the point's content
 * coordinate scales by the zoom ratio and the scroll must absorb the rest.
 */
export function anchoredScroll(
  oldZoom: number,
  newZoom: number,
  scrollLeft: number,
  scrollTop: number,
  px: number,
  py: number,
): { left: number; top: number } {
  const r = newZoom / oldZoom
  return {
    left: Math.max(0, (scrollLeft + px) * r - px),
    top: Math.max(0, (scrollTop + py) * r - py),
  }
}

/**
 * ⌘-wheel / ctrl-wheel / trackpad pinch → zoom, anchored on the pointer.
 *
 * Bound natively (not through React's onWheel) because a wheel listener must
 * be non-passive to call preventDefault, and the browser's own page zoom must
 * not fire. The scroll correction is applied after React has laid out the new
 * size: `commitAnchor` runs from the zoom effect in the renderer.
 */
export function useWheelZoom(
  hostRef: MutableRefObject<HTMLElement | null>,
  zoomRef: MutableRefObject<number>,
  setZoom: (z: number) => void,
  anchorRef: MutableRefObject<{ oldZoom: number; newZoom: number; px: number; py: number; scrollLeft: number; scrollTop: number } | null>,
): void {
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const oldZoom = zoomRef.current
      const newZoom = zoomForDelta(oldZoom, e.deltaY)
      if (newZoom === oldZoom) return
      const rect = host.getBoundingClientRect()
      anchorRef.current = {
        oldZoom, newZoom,
        px: e.clientX - rect.left, py: e.clientY - rect.top,
        scrollLeft: host.scrollLeft, scrollTop: host.scrollTop,
      }
      setZoom(newZoom)
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => host.removeEventListener('wheel', onWheel)
    // The host element is swapped when the document type resolves; re-bind then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostRef.current])
}
