/**
 * Raster → vector: trace a bitmap (a slide image or a picked PNG/JPG) into an
 * editable, resolution-independent SVG. Wraps imagetracerjs.
 *
 * Split so the actual trace stays pure and DOM-free (`imageDataToSvg`) — that
 * half is unit-testable and could move off the main thread — while the browser
 * bits (decode a URL, downscale on a canvas) live in the async helpers used by
 * the renderer. Compounds with the vector-rendering direction and the component
 * system: the SVG can be saved as a workspace asset and/or placed on a slide.
 */
import ImageTracer from 'imagetracerjs'

/**
 * Structural shape of a browser `ImageData`. Accepting the loose form (rather
 * than the DOM class) lets the pure tracer run under Node/vitest where any
 * `{ width, height, data }` will do.
 */
export type RasterData = Pick<ImageData, 'width' | 'height' | 'data'>

export interface VectorizeOptions {
  /** Palette size after color quantization. 2 ≈ mono icon/logo, 8–16 ≈ illustration/photo. Default 8. */
  colors?: number
  /**
   * Longest source edge, in px, the image is downscaled to before tracing.
   * Tracing is roughly O(pixels), so this bounds cost on large photos. Only used
   * by the canvas-decoding helpers; the pure tracer traces whatever it is given.
   * Default 512.
   */
  maxSize?: number
  /** Drop traced paths shorter than this many points (speckle removal). Default 8. */
  pathomit?: number
  /**
   * Straight-line & curve error thresholds (imagetracerjs ltres/qtres). Lower =
   * tighter fit but larger SVG; higher = smoother, smaller. Default 1.
   */
  smoothing?: number
}

const DEFAULTS: Required<VectorizeOptions> = { colors: 8, maxSize: 512, pathomit: 8, smoothing: 1 }

/** Maps our friendly options onto the imagetracerjs native option bag. */
function toTracerOptions(o: VectorizeOptions): Record<string, number | boolean> {
  const { colors, pathomit, smoothing } = { ...DEFAULTS, ...o }
  const palette = Math.max(2, Math.round(colors))
  return {
    numberofcolors: palette,
    // Deterministic quantization for a tiny palette (icons/logos); statistical
    // sampling for richer images where an exact palette is less important.
    colorsampling: palette <= 2 ? 0 : 2,
    pathomit,
    ltres: smoothing,
    qtres: smoothing,
    roundcoords: 2,
    // Emit a viewBox (no fixed width/height) so the SVG scales crisply anywhere.
    viewbox: true,
  }
}

/**
 * Traces raster pixels to an SVG document string. Pure and synchronous — no DOM.
 * Returns the full `<svg>…</svg>` markup, with one `<path>` fill per quantized
 * color. Throws on empty input.
 */
export function imageDataToSvg(image: RasterData, options: VectorizeOptions = {}): string {
  if (!image || image.width <= 0 || image.height <= 0 || image.data.length === 0) {
    throw new Error('vectorize: empty image data')
  }
  return ImageTracer.imagedataToSVG(image as ImageData, toTracerOptions(options))
}

/** Decodes an image URL (data:/blob:/object URL) to an `HTMLImageElement`. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('vectorize: could not decode image'))
    img.src = src
  })
}

/**
 * Decodes an image URL to `ImageData` via an offscreen canvas, downscaling so
 * the longest edge is at most `maxSize` px. Renderer-only (needs a DOM canvas).
 */
export async function rasterizeToImageData(src: string, maxSize = DEFAULTS.maxSize): Promise<RasterData> {
  const img = await loadImage(src)
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1
  const scale = Math.min(1, maxSize / longest)
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('vectorize: 2D canvas context unavailable')
  ctx.drawImage(img, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

/** End-to-end convenience: an image URL → traced SVG string. Renderer-only. */
export async function vectorizeImageUrl(src: string, options: VectorizeOptions = {}): Promise<string> {
  const { maxSize } = { ...DEFAULTS, ...options }
  const data = await rasterizeToImageData(src, maxSize)
  return imageDataToSvg(data, options)
}
