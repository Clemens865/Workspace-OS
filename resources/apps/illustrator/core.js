// Illustrator Light: the editor's state, history and drawing on screen.
window.Ed = (function () {
  const M = window.Model
  const $ = (id) => document.getElementById(id)
  const NS = M.SVGNS
  const css = getComputedStyle(document.documentElement)
  // The palette for a drawing: the kit's colours, read once and kept as plain values (a drawing does not change with the theme).
  const PALETTE = ['--ink', '--swatch-1', '--swatch-2', '--swatch-3', '--swatch-4', '--swatch-5', '--swatch-6', '--paper'].map((t) => css.getPropertyValue(t).trim())

  let saveTimer = null
  const ed = {
    doc: { w: 800, h: 600, shapes: [] },
    sel: new Set(),
    tool: 'select',
    view: { x: 0, y: 0, z: 1 },
    grid: false,
    style: { fill: PALETTE[1], stroke: PALETTE[0], strokeWidth: 2 },
    past: [],
    future: [],
    PALETTE,
  }

  // ── history: a snapshot before each change ──
  const snap = () => JSON.stringify({ doc: ed.doc, sel: [...ed.sel] })
  // Saved at once after every finished change: an app that is closed gets no time to save later.
  ed.save = () => {
    clearTimeout(saveTimer)
    return wos.storage.set('drawing', ed.doc).catch((e) => ed.error('Could not save: ' + e.message))
  }
  ed.commit = (change) => {
    ed.past.push(snap())
    if (ed.past.length > 150) ed.past.shift()
    ed.future = []
    change()
    ed.changed()
    ed.save()
  }
  const restore = (s) => {
    const o = JSON.parse(s)
    ed.doc = o.doc
    ed.sel = new Set(o.sel)
  }
  ed.undo = () => {
    if (!ed.past.length) return
    ed.future.push(snap())
    restore(ed.past.pop())
    ed.changed()
    ed.save()
  }
  ed.redo = () => {
    if (!ed.future.length) return
    ed.past.push(snap())
    restore(ed.future.pop())
    ed.changed()
    ed.save()
  }

  // ── lookups ──
  ed.get = (id) => ed.doc.shapes.find((s) => s.id === id)
  ed.selected = () => ed.doc.shapes.filter((s) => ed.sel.has(s.id))
  ed.replace = (list) => {
    const by = new Map(list.map((s) => [s.id, s]))
    ed.doc.shapes = ed.doc.shapes.map((s) => by.get(s.id) || s)
  }

  // ── the view: zoom and pan ──
  ed.toDoc = (clientX, clientY) => {
    const r = $('canvas').getBoundingClientRect()
    return [(clientX - r.left - ed.view.x) / ed.view.z, (clientY - r.top - ed.view.y) / ed.view.z]
  }
  ed.applyView = () => {
    $('view').setAttribute('transform', `translate(${ed.view.x} ${ed.view.y}) scale(${ed.view.z})`)
    $('zoom').textContent = Math.round(ed.view.z * 100) + '%'
    drawOverlay()
  }
  ed.fit = () => {
    const r = $('canvas').getBoundingClientRect()
    const z = Math.min((r.width - 60) / ed.doc.w, (r.height - 60) / ed.doc.h, 4)
    ed.view = { z, x: (r.width - ed.doc.w * z) / 2, y: (r.height - ed.doc.h * z) / 2 }
    ed.applyView()
  }
  ed.zoomAt = (factor, cx, cy) => {
    const r = $('canvas').getBoundingClientRect()
    const px = cx ?? r.left + r.width / 2, py = cy ?? r.top + r.height / 2
    const [dx, dy] = ed.toDoc(px, py)
    const z = Math.min(16, Math.max(0.1, ed.view.z * factor))
    ed.view = { z, x: px - r.left - dx * z, y: py - r.top - dy * z }
    ed.applyView()
  }

  // ── drawing the shapes ──
  function node(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    if (parent) parent.appendChild(el)
    return el
  }
  ed.node = node
  function drawShapes() {
    const g = $('shapes')
    g.replaceChildren()
    for (const s of ed.doc.shapes) {
      if (s.hidden) continue
      const [tag, attrs] = M.element(s)
      const el = node(tag, attrs, g)
      el.dataset.id = s.id
      if (s.locked) el.classList.add('locked')
      if (s.type === 'text') el.textContent = s.text
      if (s.type === 'svg') el.innerHTML = s.markup
      // Thin and open lines get a wider, invisible edge to be clicked by.
      if (!s.locked && (s.type === 'line' || (s.type === 'path' && (!s.closed || s.fill === 'none')))) {
        const hit = node(tag, { ...attrs, class: 'hit', 'stroke-width': Math.max(10 / ed.view.z, s.strokeWidth || 0) }, g)
        hit.dataset.id = s.id
      }
    }
  }

  // ── the editor's marks: the selection, its handles, previews ──
  const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  ed.handlePoints = (b) => ({
    nw: [b.x, b.y], n: [b.x + b.w / 2, b.y], ne: [b.x + b.w, b.y], e: [b.x + b.w, b.y + b.h / 2],
    se: [b.x + b.w, b.y + b.h], s: [b.x + b.w / 2, b.y + b.h], sw: [b.x, b.y + b.h], w: [b.x, b.y + b.h / 2],
  })
  ed.preview = null // { d } or { rect } while a tool is drawing
  function drawOverlay() {
    const o = $('overlay')
    o.replaceChildren()
    const sel = ed.selected().filter((s) => !s.hidden)
    const b = M.union(sel)
    if (b) {
      node('rect', { class: 'sel-box', x: b.x, y: b.y, width: b.w, height: b.h }, o)
      if (ed.tool === 'select' && !sel.some((s) => s.locked)) {
        const r = 4 / ed.view.z, pts = ed.handlePoints(b)
        for (const h of HANDLES) {
          const el = node('rect', { class: 'handle', x: pts[h][0] - r, y: pts[h][1] - r, width: 2 * r, height: 2 * r }, o)
          el.dataset.handle = h
          el.style.cursor = h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize'
        }
      }
    }
    const p = ed.preview
    if (p?.rect) node('rect', { class: p.marquee ? 'marquee' : 'preview', x: p.rect.x, y: p.rect.y, width: p.rect.w, height: p.rect.h }, o)
    if (p?.d) node('path', { class: 'preview', d: p.d }, o)
    if (p?.dots) for (const [x, y] of p.dots) node('circle', { class: 'pen-dot', cx: x, cy: y, r: 3.5 / ed.view.z }, o)
  }
  ed.drawOverlay = drawOverlay

  // ── everything after a change ──
  const listeners = []
  ed.onChange = (fn) => listeners.push(fn)
  ed.changed = () => {
    $('board').setAttribute('width', ed.doc.w)
    $('board').setAttribute('height', ed.doc.h)
    $('board-grid').setAttribute('width', ed.doc.w)
    $('board-grid').setAttribute('height', ed.doc.h)
    $('board-grid').style.display = ed.grid ? '' : 'none'
    drawShapes()
    drawOverlay()
    listeners.forEach((fn) => fn())
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => wos.storage.set('drawing', ed.doc), 400)
  }
  ed.error = (msg) => {
    $('error').textContent = msg || ''
    $('error').hidden = !msg
  }

  ed.load = async () => {
    const saved = await wos.storage.get('drawing')
    if (saved && Array.isArray(saved.shapes)) ed.doc = saved
    ed.changed()
    ed.fit()
  }
  return ed
})()
