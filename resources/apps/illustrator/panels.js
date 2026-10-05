// Illustrator Light: the properties and layers panels, files, and drawing with AI.
;(function () {
  const ed = window.Ed, M = window.Model
  const $ = (id) => document.getElementById(id)
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const r1 = (n) => Math.round(n * 10) / 10

  // ── properties: of the selection, or of the drawing when nothing is selected ──
  function swatches(key, current) {
    const items = ['none', ...ed.PALETTE]
      .map((c) => `<button class="swatch${c === 'none' ? ' none' : ''}${c === current ? ' on' : ''}" data-${key}="${esc(c)}" title="${c === 'none' ? 'None' : esc(c)}"${c === 'none' ? '' : ` style="background:${esc(c)}"`}></button>`)
      .join('')
    const custom = current && current !== 'none' && current.startsWith('#') && current.length === 7 ? current : ed.PALETTE[0]
    return `<div class="swatches">${items}<input type="color" class="picker" data-${key}-pick value="${esc(custom)}" title="Any colour"></div>`
  }
  const field = (label, key, value, step = 1) => `<div><label>${label}</label><input class="wos-input" type="number" step="${step}" data-field="${key}" value="${value}"></div>`

  function renderProps() {
    const sel = ed.selected()
    const one = sel.length === 1 ? sel[0] : null
    const box = M.union(sel)
    const fill = one ? one.fill : sel.length ? null : ed.style.fill
    const stroke = one ? one.stroke : sel.length ? null : ed.style.stroke
    const width = one ? one.strokeWidth : ed.style.strokeWidth
    let html = ''
    if (!sel.length) {
      html += `<span class="wos-label">Drawing</span><div class="prop-row">${field('Width', 'doc-w', ed.doc.w)}${field('Height', 'doc-h', ed.doc.h)}</div>`
      html += `<span class="wos-label">New shapes</span>`
    } else {
      html += `<span class="wos-label">${one ? esc(one.name) : sel.length + ' shapes'}</span>`
      html += `<div class="prop-row">${field('X', 'x', r1(box.x))}${field('Y', 'y', r1(box.y))}${field('W', 'w', r1(box.w))}${field('H', 'h', r1(box.h))}</div>`
    }
    html += `<div class="prop"><label>Fill</label>${swatches('fill', fill)}</div>`
    html += `<div class="prop"><label>Stroke</label>${swatches('stroke', stroke)}</div>`
    html += `<div class="prop-row">${field('Stroke width', 'strokeWidth', width ?? 2, 0.5)}${one ? field('Opacity %', 'opacity', Math.round((one.opacity ?? 1) * 100), 5) : '<div></div>'}</div>`
    if (one?.type === 'rect') html += `<div class="prop-row">${field('Corner radius', 'radius', one.radius || 0)}<div></div></div>`
    if (one?.type === 'text') html += `<div class="prop"><label>Text</label><input class="wos-input" data-text value="${esc(one.text)}"></div><div class="prop-row">${field('Size', 'fontSize', r1(one.fontSize))}<div></div></div>`
    if (sel.length) html += `<div class="wos-row"><button class="wos-btn small" id="dup">Duplicate</button><button class="wos-btn small ghost" id="del">Delete</button></div>`
    $('props').innerHTML = html
  }

  // Paint: on the selection, and remembered for the next shape.
  function setPaint(key, value) {
    if (!ed.sel.size) {
      ed.style[key] = value
      return renderProps()
    }
    ed.commit(() => ed.replace(ed.selected().map((s) => ({ ...s, [key]: s.type === 'line' && key === 'fill' ? 'none' : value }))))
    ed.style[key] = value
  }
  $('props').addEventListener('click', (e) => {
    const t = e.target
    if (t.dataset.fill) setPaint('fill', t.dataset.fill)
    if (t.dataset.stroke) setPaint('stroke', t.dataset.stroke)
    if (t.id === 'dup') ed.duplicate()
    if (t.id === 'del') ed.remove()
  })
  $('props').addEventListener('change', (e) => {
    const t = e.target
    if (t.dataset.fillPick !== undefined) return setPaint('fill', t.value)
    if (t.dataset.strokePick !== undefined) return setPaint('stroke', t.value)
    if (t.dataset.text !== undefined) {
      const s = ed.selected()[0]
      return ed.commit(() => ed.replace([{ ...s, text: t.value, tw: M.textWidth({ ...s, text: t.value }) }]))
    }
    const key = t.dataset.field, v = Number(t.value)
    if (!key || !Number.isFinite(v)) return
    if (key === 'doc-w' || key === 'doc-h') return ed.commit(() => (ed.doc[key === 'doc-w' ? 'w' : 'h'] = Math.max(16, Math.min(8000, v))))
    if (key === 'strokeWidth' && !ed.sel.size) return (ed.style.strokeWidth = Math.max(0, v))
    const sel = ed.selected()
    if (['x', 'y', 'w', 'h'].includes(key)) {
      const from = M.union(sel), to = { ...from, [key]: key === 'w' || key === 'h' ? Math.max(1, v) : v }
      return ed.commit(() => ed.replace(sel.map((s) => (key === 'x' || key === 'y' ? M.moved(s, to.x - from.x, to.y - from.y) : M.scaled(s, from, to)))))
    }
    const val = key === 'opacity' ? Math.max(0, Math.min(1, v / 100)) : Math.max(0, v)
    ed.commit(() => ed.replace(sel.map((s) => {
      const c = { ...s, [key]: val }
      if (key === 'fontSize') c.tw = M.textWidth(c)
      return c
    })))
  })

  // ── layers: frontmost first ──
  const ICON = {
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    off: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A10 10 0 0112 6c6 0 10 6 10 6a17 17 0 01-3.3 3.9M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.6 0 3-.4 4.3-1"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
    open: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/></svg>',
  }
  const TYPE = { rect: '▭', ellipse: '◯', line: '╱', path: '∿', text: 'T', svg: '◇' }
  function renderLayers() {
    $('layers').innerHTML = [...ed.doc.shapes]
      .reverse()
      .map((s) => `<li class="layer${ed.sel.has(s.id) ? ' on' : ''}" data-layer="${s.id}"><span class="ty">${TYPE[s.type]}</span><span class="nm">${esc(s.name)}</span><button class="lb" data-eye="${s.id}" title="${s.hidden ? 'Show' : 'Hide'}">${s.hidden ? ICON.off : ICON.eye}</button><button class="lb" data-lock="${s.id}" title="${s.locked ? 'Unlock' : 'Lock'}">${s.locked ? ICON.lock : ICON.open}</button></li>`)
      .join('') || '<li class="wos-muted wos-small">Nothing drawn yet.</li>'
  }
  $('layers').addEventListener('click', (e) => {
    const eye = e.target.closest('[data-eye]'), lock = e.target.closest('[data-lock]'), row = e.target.closest('[data-layer]')
    if (eye) return ed.commit(() => ed.replace([{ ...ed.get(eye.dataset.eye), hidden: !ed.get(eye.dataset.eye).hidden }]))
    if (lock) return ed.commit(() => ed.replace([{ ...ed.get(lock.dataset.lock), locked: !ed.get(lock.dataset.lock).locked }]))
    if (!row) return
    const id = row.dataset.layer
    if (e.shiftKey) ed.sel.has(id) ? ed.sel.delete(id) : ed.sel.add(id)
    else ed.sel = new Set([id])
    ed.changed()
  })
  $('layers').addEventListener('dblclick', (e) => {
    const row = e.target.closest('[data-layer]')
    if (!row) return
    const s = ed.get(row.dataset.layer)
    const nm = row.querySelector('.nm')
    nm.outerHTML = `<input value="${esc(s.name)}">`
    const input = row.querySelector('input')
    input.focus()
    input.select()
    const done = () => {
      const name = input.value.trim()
      if (name && name !== s.name) ed.commit(() => ed.replace([{ ...s, name }]))
      else renderLayers()
    }
    input.addEventListener('keydown', (k) => k.key === 'Enter' && input.blur())
    input.addEventListener('blur', done)
  })
  $('forward').onclick = () => ed.arrange(1)
  $('backward').onclick = () => ed.arrange(-1)

  ed.onChange(() => {
    renderProps()
    renderLayers()
  })

  // ── top bar ──
  $('undo').onclick = ed.undo
  $('redo').onclick = ed.redo
  $('zoom-in').onclick = () => ed.zoomAt(1.25)
  $('zoom-out').onclick = () => ed.zoomAt(0.8)
  $('fit').onclick = ed.fit
  $('grid').onclick = () => {
    ed.grid = !ed.grid
    $('grid').classList.toggle('on', ed.grid)
    ed.changed()
  }
  $('new').onclick = () => {
    if (ed.doc.shapes.length && !confirm('Start a new drawing? This one is replaced (Undo brings it back).')) return
    ed.commit(() => {
      ed.doc = { w: ed.doc.w, h: ed.doc.h, shapes: [] }
      ed.sel = new Set()
    })
  }

  // ── files ──
  $('export-svg').onclick = () => wos.files.save('drawing.svg', M.toSVG(ed.doc))
  $('export-png').onclick = () => {
    ed.error('')
    const img = new Image()
    img.onload = async () => {
      const k = 2 // twice the size, for sharp edges
      const c = document.createElement('canvas')
      c.width = ed.doc.w * k
      c.height = ed.doc.h * k
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      try {
        await wos.files.save('drawing.png', c.toDataURL('image/png').split(',')[1], { encoding: 'base64' })
      } catch (e) {
        ed.error('Could not make the PNG: ' + e.message)
      }
    }
    img.onerror = () => ed.error('Could not draw the PNG.')
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(M.toSVG(ed.doc))
  }

  /** New shapes from an SVG, fitted into the drawing and selected. */
  function place(shapes, fit) {
    if (!shapes.length) throw new Error('Nothing in it could be drawn.')
    const from = M.union(shapes)
    let placed = shapes
    if (fit && from.w && from.h) {
      const k = Math.min((ed.doc.w * 0.7) / from.w, (ed.doc.h * 0.7) / from.h)
      const to = { x: (ed.doc.w - from.w * k) / 2, y: (ed.doc.h - from.h * k) / 2, w: from.w * k, h: from.h * k }
      placed = shapes.map((s) => M.scaled(s, from, to))
    }
    placed = placed.map((s) => (s.type === 'text' ? { ...s, tw: M.textWidth(s) } : s))
    ed.commit(() => {
      ed.doc.shapes.push(...placed)
      ed.sel = new Set(placed.map((s) => s.id))
    })
  }
  $('import').onclick = async () => {
    ed.error('')
    try {
      const f = await wos.files.open({ accept: ['.svg'], as: 'text' })
      if (f) place(M.fromSVG(f.data), false)
    } catch (e) {
      ed.error(e.message)
    }
  }

  // ── drawing with AI: an SVG in the drawing's palette, brought in as shapes ──
  $('ai-open').onclick = () => {
    $('ai-bar').hidden = !$('ai-bar').hidden
    if (!$('ai-bar').hidden) $('ai-prompt').focus()
  }
  $('ai-close').onclick = () => ($('ai-bar').hidden = true)
  async function draw() {
    const what = $('ai-prompt').value.trim()
    if (!what) return $('ai-prompt').focus()
    ed.error('')
    $('ai-busy').hidden = false
    $('ai-go').disabled = true
    try {
      const text = await wos.ai.complete(`Draw: ${what}`, {
        system: `You draw vector illustrations as SVG. Answer with exactly one <svg> element, viewBox "0 0 ${ed.doc.w} ${ed.doc.h}", nothing else. Build it from separate simple shapes a person can edit afterwards: rect, circle, ellipse, line, polygon, polyline, path, text; one element per visible part, few groups, no transforms where a shape can be placed directly, no gradients, filters, masks, scripts or external references. Use these colours: ${ed.PALETTE.join(', ')}.`,
      })
      const m = /<svg[\s\S]*<\/svg>/i.exec(text)
      if (!m) throw new Error('No drawing came back. Try describing it differently.')
      place(M.fromSVG(m[0]), true)
      $('ai-prompt').value = ''
    } catch (e) {
      ed.error(e.message)
    } finally {
      $('ai-busy').hidden = true
      $('ai-go').disabled = false
    }
  }
  $('ai-go').onclick = draw
  $('ai-prompt').addEventListener('keydown', (e) => e.key === 'Enter' && draw())

  ed.load()
  new ResizeObserver(() => ed.applyView()).observe($('wrap'))
})()
