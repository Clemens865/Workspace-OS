// Illustrator Light: the drawing's data. A drawing is { w, h, shapes } and a
// shape is plain data; everything here is pure except measure(), which asks
// the browser for the size of a text or an imported piece.
window.Model = (function () {
  const SVGNS = 'http://www.w3.org/2000/svg'
  let seq = 0
  const id = () => 's' + Date.now().toString(36) + (seq++).toString(36)
  const round = (n) => Math.round(n * 100) / 100
  const NAMES = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', path: 'Path', text: 'Text', svg: 'Imported' }
  // The type a drawing's text is set in, written into the file (a drawing travels without the app's fonts).
  const TYPE = ['Inter', 'system-ui', 'sans-serif'].join(', ')

  function make(type, props) {
    return { id: id(), type, name: NAMES[type], fill: 'none', stroke: 'none', strokeWidth: 2, opacity: 1, ...props }
  }

  // ── bounds ──
  function bbox(s) {
    if (s.type === 'line') return { x: Math.min(s.x1, s.x2), y: Math.min(s.y1, s.y2), w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1) }
    if (s.type === 'path') {
      const xs = s.points.map((p) => p[0]), ys = s.points.map((p) => p[1])
      const x = Math.min(...xs), y = Math.min(...ys)
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
    }
    if (s.type === 'text') return { x: s.x, y: s.y - s.fontSize * 0.8, w: s.tw || s.text.length * s.fontSize * 0.55, h: s.fontSize }
    return { x: s.x, y: s.y, w: s.w, h: s.h }
  }
  function union(list) {
    if (!list.length) return null
    const b = list.map(bbox)
    const x = Math.min(...b.map((r) => r.x)), y = Math.min(...b.map((r) => r.y))
    return { x, y, w: Math.max(...b.map((r) => r.x + r.w)) - x, h: Math.max(...b.map((r) => r.y + r.h)) - y }
  }

  // ── changes: a copy, never in place ──
  function moved(s, dx, dy) {
    const c = structuredClone(s)
    if (c.type === 'line') { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy }
    else if (c.type === 'path') c.points = c.points.map((p) => [p[0] + dx, p[1] + dy])
    else { c.x += dx; c.y += dy }
    return c
  }
  /** Maps a shape from box `from` to box `to` (a resize of the selection). */
  function scaled(s, from, to) {
    const sx = from.w ? to.w / from.w : 1, sy = from.h ? to.h / from.h : 1
    const X = (x) => to.x + (x - from.x) * sx, Y = (y) => to.y + (y - from.y) * sy
    const c = structuredClone(s)
    if (c.type === 'line') { c.x1 = X(s.x1); c.x2 = X(s.x2); c.y1 = Y(s.y1); c.y2 = Y(s.y2) }
    else if (c.type === 'path') c.points = s.points.map((p) => [X(p[0]), Y(p[1])])
    else if (c.type === 'text') { c.x = X(s.x); c.y = Y(s.y); c.fontSize = Math.max(4, s.fontSize * Math.abs(sy)); c.tw = s.tw ? s.tw * Math.abs(sx) : s.tw }
    else {
      const x2 = X(s.x + s.w), y2 = Y(s.y + s.h)
      c.x = Math.min(X(s.x), x2); c.y = Math.min(Y(s.y), y2)
      c.w = Math.abs(x2 - X(s.x)); c.h = Math.abs(y2 - Y(s.y))
    }
    return c
  }

  // ── drawing it ──
  /** A path through points; a pencil stroke is smoothed through the midpoints. */
  function pathD(s) {
    const p = s.points
    if (!p.length) return ''
    if (!s.smooth || p.length < 3) return 'M' + p.map((q) => round(q[0]) + ' ' + round(q[1])).join(' L') + (s.closed ? ' Z' : '')
    let d = `M${round(p[0][0])} ${round(p[0][1])}`
    for (let i = 1; i < p.length - 1; i++) {
      const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2
      d += ` Q${round(p[i][0])} ${round(p[i][1])} ${round(mx)} ${round(my)}`
    }
    const l = p[p.length - 1]
    return d + ` L${round(l[0])} ${round(l[1])}` + (s.closed ? ' Z' : '')
  }

  /** The element and attributes for a shape: the same in the editor and in an export. */
  function element(s) {
    const paint = { fill: s.fill || 'none', stroke: s.stroke || 'none', 'stroke-width': s.strokeWidth ?? 0, opacity: s.opacity ?? 1 }
    if (s.type === 'rect') return ['rect', { x: round(s.x), y: round(s.y), width: round(s.w), height: round(s.h), rx: s.radius || 0, ...paint }]
    if (s.type === 'ellipse') return ['ellipse', { cx: round(s.x + s.w / 2), cy: round(s.y + s.h / 2), rx: round(s.w / 2), ry: round(s.h / 2), ...paint }]
    if (s.type === 'line') return ['line', { x1: round(s.x1), y1: round(s.y1), x2: round(s.x2), y2: round(s.y2), ...paint, fill: 'none', 'stroke-linecap': 'round' }]
    if (s.type === 'path') return ['path', { d: pathD(s), ...paint, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }]
    if (s.type === 'text') return ['text', { x: round(s.x), y: round(s.y), 'font-size': round(s.fontSize), 'font-family': TYPE, ...paint }]
    // An imported piece: its own markup, fitted from its own box into the shape's box.
    const sx = s.ow ? s.w / s.ow : 1, sy = s.oh ? s.h / s.oh : 1
    return ['g', { transform: `translate(${round(s.x)} ${round(s.y)}) scale(${round(sx * 1000) / 1000} ${round(sy * 1000) / 1000}) translate(${round(-s.ox)} ${round(-s.oy)})`, opacity: s.opacity ?? 1 }]
  }

  const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const escText = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')

  /** The drawing as a standalone SVG file. */
  function toSVG(doc) {
    const body = doc.shapes
      .filter((s) => !s.hidden)
      .map((s) => {
        const [tag, attrs] = element(s)
        const a = Object.entries(attrs).map(([k, v]) => `${k}="${escAttr(v)}"`).join(' ')
        if (s.type === 'text') return `  <text ${a}>${escText(s.text)}</text>`
        if (s.type === 'svg') return `  <g ${a}>${s.markup}</g>`
        return `  <${tag} ${a}/>`
      })
      .join('\n')
    const bg = doc.background ? `  <rect width="${doc.w}" height="${doc.h}" fill="${escAttr(doc.background)}"/>\n` : ''
    return `<svg xmlns="${SVGNS}" width="${doc.w}" height="${doc.h}" viewBox="0 0 ${doc.w} ${doc.h}">\n${bg}${body}\n</svg>\n`
  }

  // ── reading an SVG (an import, or what the AI drew) ──
  const ALLOWED = new Set(['g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath'])
  const SAFE_ATTR = /^(d|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|width|height|points|fill|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|opacity|fill-opacity|stroke-opacity|transform|font-size|font-family|font-weight|text-anchor|offset|stop-color|stop-opacity|id|gradientUnits|gradientTransform|clip-path|fill-rule|clip-rule|x1|y1|fx|fy|viewBox)$/
  /** An element and its children, keeping only drawing tags and attributes (no scripts, no links, no events). */
  function clean(el) {
    if (!ALLOWED.has(el.tagName)) return ''
    const attrs = [...el.attributes]
      .filter((a) => SAFE_ATTR.test(a.name) && !/url\(\s*['"]?(?!#)/i.test(a.value) && !/javascript:/i.test(a.value))
      .map((a) => `${a.name}="${escAttr(a.value)}"`)
      .join(' ')
    const kids = [...el.childNodes].map((n) => (n.nodeType === 3 ? escText(n.textContent) : n.nodeType === 1 ? clean(n) : '')).join('')
    return `<${el.tagName}${attrs ? ' ' + attrs : ''}>${kids}</${el.tagName}>`
  }
  const num = (el, a, d = 0) => (el.hasAttribute(a) ? parseFloat(el.getAttribute(a)) || 0 : d)
  function paintOf(el) {
    const style = Object.fromEntries((el.getAttribute('style') || '').split(';').map((x) => x.split(':').map((y) => y.trim())).filter((x) => x[0]))
    const get = (k) => style[k] ?? el.getAttribute(k)
    return { fill: get('fill') ?? 'black', stroke: get('stroke') ?? 'none', strokeWidth: parseFloat(get('stroke-width') ?? '1') || 0, opacity: parseFloat(get('opacity') ?? '1') }
  }

  /**
   * The shapes of an SVG: plain rectangles, ellipses, circles, lines and
   * polygons become shapes you can edit point by point; anything else (paths,
   * groups, transforms, gradients) comes in as one imported piece you can move
   * and size.
   */
  function fromSVG(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
    const root = doc.documentElement
    if (!root || root.tagName !== 'svg') throw new Error('That is not an SVG.')
    const defs = [...root.querySelectorAll('defs')].map(clean).join('')
    const out = []
    for (const el of [...root.children]) {
      if (el.tagName === 'defs' || !ALLOWED.has(el.tagName)) continue
      const p = paintOf(el)
      const plain = !el.hasAttribute('transform') && !/url\(/.test(p.fill + p.stroke)
      if (plain && el.tagName === 'rect') out.push(make('rect', { x: num(el, 'x'), y: num(el, 'y'), w: num(el, 'width'), h: num(el, 'height'), radius: num(el, 'rx'), ...p }))
      else if (plain && el.tagName === 'circle') { const r = num(el, 'r'); out.push(make('ellipse', { x: num(el, 'cx') - r, y: num(el, 'cy') - r, w: 2 * r, h: 2 * r, ...p })) }
      else if (plain && el.tagName === 'ellipse') out.push(make('ellipse', { x: num(el, 'cx') - num(el, 'rx'), y: num(el, 'cy') - num(el, 'ry'), w: 2 * num(el, 'rx'), h: 2 * num(el, 'ry'), ...p }))
      else if (plain && el.tagName === 'line') out.push(make('line', { x1: num(el, 'x1'), y1: num(el, 'y1'), x2: num(el, 'x2'), y2: num(el, 'y2'), ...p, fill: 'none' }))
      else if (plain && (el.tagName === 'polygon' || el.tagName === 'polyline')) {
        const n = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number)
        const points = []
        for (let i = 0; i + 1 < n.length; i += 2) points.push([n[i], n[i + 1]])
        if (points.length > 1) out.push(make('path', { points, closed: el.tagName === 'polygon', ...p }))
      } else {
        const markup = (defs ? `<defs>${defs}</defs>` : '') + clean(el)
        const b = measure(markup)
        if (b && b.w > 0 && b.h > 0) out.push(make('svg', { markup, ox: b.x, oy: b.y, ow: b.w, oh: b.h, x: b.x, y: b.y, w: b.w, h: b.h, fill: 'none', stroke: 'none', name: el.tagName === 'g' ? 'Group' : NAMES.svg }))
      }
    }
    return out
  }

  /** The browser's own measure of a piece of SVG (or of a text shape's width). */
  function measure(markup) {
    const host = document.getElementById('measure')
    host.innerHTML = `<g>${markup}</g>`
    try {
      const b = host.firstChild.getBBox()
      return { x: b.x, y: b.y, w: b.width, h: b.height }
    } catch {
      return null
    } finally {
      host.innerHTML = ''
    }
  }
  function textWidth(s) {
    const [, a] = element({ ...s, x: 0, y: 0 })
    const b = measure(`<text ${Object.entries(a).map(([k, v]) => `${k}="${escAttr(v)}"`).join(' ')}>${escText(s.text)}</text>`)
    return b ? b.w : s.text.length * s.fontSize * 0.55
  }

  /** Fewer points for a pencil stroke (Ramer–Douglas–Peucker). */
  function simplify(points, eps) {
    if (points.length < 3) return points
    const [a, b] = [points[0], points[points.length - 1]]
    let far = 0, at = 0
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i]
      const d = Math.abs((b[1] - a[1]) * p[0] - (b[0] - a[0]) * p[1] + b[0] * a[1] - b[1] * a[0]) / (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1)
      if (d > far) { far = d; at = i }
    }
    if (far <= eps) return [a, b]
    return simplify(points.slice(0, at + 1), eps).slice(0, -1).concat(simplify(points.slice(at), eps))
  }

  return { SVGNS, make, bbox, union, moved, scaled, element, pathD, toSVG, fromSVG, textWidth, simplify, id }
})()
