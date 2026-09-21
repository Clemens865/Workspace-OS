/**
 * Turns the deck's one-SVG vector export (window.workspace.lok.slidesSvg) into
 * per-slide, resolution-independent images. The Impress SVG export stacks every
 * slide at the same viewBox (a slideshow player toggles which is visible); we do
 * the same — clone with only slide `i` shown — and hand back a data URL that an
 * <img> renders crisply at any size (thumbnails, zoom), no bitmap re-render.
 */
export interface DeckSvg {
  slideCount: number
  /** data: URL of slide `i` alone (cached). */
  slideUrl: (i: number) => string
}

export function parseDeckSvg(svgText: string): DeckSvg | null {
  if (!svgText) return null
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  } catch {
    return null
  }
  const root = doc.documentElement
  if (!root || doc.querySelector('parsererror') || root.tagName.toLowerCase() !== 'svg') return null

  // Real slides are <g class="Slide"> with a stable id; skip the export's
  // "dummy-slide" placeholder (kept hidden so it never paints over slide 0).
  const groups = Array.from(doc.querySelectorAll('g.Slide')) as SVGGElement[]
  const dummy = groups.filter((g) => g.getAttribute('id') === 'dummy-slide')
  const slides = groups.filter((g) => g.getAttribute('id') !== 'dummy-slide')
  if (slides.length === 0) return null
  dummy.forEach((g) => g.setAttribute('style', 'display:none'))

  // The export wraps every slide in an anonymous <g visibility="hidden"> that
  // the (stripped) slideshow player script would toggle. Our display toggling
  // happens on the inner g.Slide, so unhide those wrapper ancestors — otherwise
  // every slide stays invisible and the thumbnails render blank.
  for (const g of slides) {
    for (let el: Element | null = g.parentElement; el && el !== root; el = el.parentElement) {
      if (el.getAttribute('visibility') === 'hidden') el.removeAttribute('visibility')
    }
  }

  // Backgrounds also live in player-only territory: a slide's own background is
  // <defs class="SlideBackground"><g class="Background"> inside its Page (defs
  // never paint), and master backgrounds are <g id="bg-<master>"> inside the
  // top-level <defs> of Master_Slide groups — the stripped player script would
  // instantiate them at runtime. Clone the right one to the front of each slide
  // group so it paints beneath the content and follows the slide's display
  // toggle. Only class="Background" is inlined — BackgroundObjects (DateTime/
  // Footer/PageNumber player chrome) stay hidden.
  const metaBySlideId = new Map<string, Element>()
  for (const m of Array.from(doc.querySelectorAll('g[id^="ooo:meta_slide_"]'))) {
    const sid = m.getAttribute('ooo:slide')
    if (sid) metaBySlideId.set(sid, m)
  }
  for (const g of slides) {
    const meta = metaBySlideId.get(g.getAttribute('id') ?? '')
    if (meta?.getAttribute('ooo:background-visibility') === 'hidden') continue
    let bg: Element | null = g.querySelector('defs.SlideBackground > g.Background')
    if (!bg) {
      const masterId = meta?.getAttribute('ooo:master')
      if (masterId) bg = doc.querySelector(`g.Background[id="bg-${masterId}"]`)
    }
    if (!bg) continue
    const clone = bg.cloneNode(true) as Element
    clone.removeAttribute('visibility')
    clone.removeAttribute('id')
    clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
    g.insertBefore(clone, g.firstChild)
  }

  const serializer = new XMLSerializer()
  const cache = new Map<number, string>()
  const slideUrl = (i: number): string => {
    const hit = cache.get(i)
    if (hit) return hit
    slides.forEach((g, idx) => g.setAttribute('style', idx === i ? 'display:inline' : 'display:none'))
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serializer.serializeToString(root))
    cache.set(i, url)
    return url
  }

  return { slideCount: slides.length, slideUrl }
}
