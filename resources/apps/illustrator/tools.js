// Illustrator Light: what the pointer and the keyboard do, tool by tool.
;(function () {
  const ed = window.Ed, M = window.Model
  const $ = (id) => document.getElementById(id)
  const canvas = $('canvas')
  const HINTS = {
    select: 'Click to select, shift-click to add, drag on empty space to select an area. Arrows nudge (shift: 10).',
    rect: 'Drag to draw a rectangle. Shift keeps it square.',
    ellipse: 'Drag to draw an ellipse. Shift keeps it round.',
    line: 'Drag to draw a line. Shift keeps it straight.',
    pen: 'Click to place points. Click the first point to close; double-click or Enter to finish; Esc to cancel.',
    pencil: 'Drag to draw freehand.',
    text: 'Click where the text should start, then type. Enter to finish.',
  }

  ed.setTool = (t) => {
    finishPen(false)
    ed.tool = t
    document.querySelectorAll('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t))
    canvas.style.cursor = t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair'
    $('hint').textContent = HINTS[t]
    ed.drawOverlay()
  }
  document.querySelectorAll('#tools [data-tool]').forEach((b) => (b.onclick = () => ed.setTool(b.dataset.tool)))

  const styled = (extra) => ({ fill: ed.style.fill, stroke: ed.style.stroke, strokeWidth: ed.style.strokeWidth, ...extra })
  const boxOf = (a, b, square) => {
    let w = b[0] - a[0], h = b[1] - a[1]
    if (square) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m }
    return { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) }
  }

  let drag = null // what the pointer is doing between down and up
  let pen = null // the points of a path being placed
  let space = false

  function finishPen(close) {
    if (!pen) return
    const pts = pen
    pen = null
    ed.preview = null
    if (pts.length >= 2) {
      const s = M.make('path', styled({ points: pts, closed: close, fill: close ? ed.style.fill : 'none' }))
      ed.commit(() => {
        ed.doc.shapes.push(s)
        ed.sel = new Set([s.id])
      })
    } else ed.drawOverlay()
  }

  function startText(at) {
    const r = canvas.getBoundingClientRect(), wrap = $('wrap').getBoundingClientRect()
    const input = document.createElement('input')
    input.className = 'text-edit'
    const size = 24
    input.style.left = r.left - wrap.left + ed.view.x + at[0] * ed.view.z + 'px'
    input.style.top = r.top - wrap.top + ed.view.y + (at[1] - size) * ed.view.z + 'px'
    input.style.fontSize = size * ed.view.z + 'px'
    $('wrap').appendChild(input)
    setTimeout(() => input.focus())
    const done = () => {
      const text = input.value.trim()
      input.remove()
      if (!text) return
      const s = M.make('text', { x: at[0], y: at[1], text, fontSize: size, fill: ed.style.stroke === 'none' ? ed.PALETTE[0] : ed.style.stroke, stroke: 'none', strokeWidth: 0 })
      s.tw = M.textWidth(s)
      ed.commit(() => {
        ed.doc.shapes.push(s)
        ed.sel = new Set([s.id])
      })
      ed.setTool('select')
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done()
      if (e.key === 'Escape') input.remove()
      e.stopPropagation()
    })
    input.addEventListener('blur', done)
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.focus()
    const p = ed.toDoc(e.clientX, e.clientY)
    ed.error('')
    // Pan: the middle button, or space held.
    if (e.button === 1 || space) {
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, view: { ...ed.view } }
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0) return
    const t = ed.tool
    if (t === 'text') return startText(p)
    if (t === 'pen') {
      if (pen && pen.length > 2 && Math.hypot(p[0] - pen[0][0], p[1] - pen[0][1]) < 8 / ed.view.z) return finishPen(true)
      pen = pen ? [...pen, p] : [p]
      return
    }
    canvas.setPointerCapture(e.pointerId)
    if (t === 'rect' || t === 'ellipse' || t === 'line') { drag = { kind: 'draw', start: p }; return }
    if (t === 'pencil') { drag = { kind: 'pencil', points: [p] }; return }

    // select
    const handle = e.target.dataset?.handle
    if (handle) {
      drag = { kind: 'resize', handle, start: p, from: M.union(ed.selected()), shapes: ed.selected().map((s) => structuredClone(s)), before: JSON.stringify({ doc: ed.doc, sel: [...ed.sel] }) }
      return
    }
    const hitId = e.target.closest?.('[data-id]')?.dataset.id
    if (hitId) {
      if (e.shiftKey) {
        ed.sel.has(hitId) ? ed.sel.delete(hitId) : ed.sel.add(hitId)
        ed.changed()
        return
      }
      if (!ed.sel.has(hitId)) ed.sel = new Set([hitId])
      drag = { kind: 'move', start: p, shapes: ed.selected().filter((s) => !s.locked).map((s) => structuredClone(s)), before: JSON.stringify({ doc: ed.doc, sel: [...ed.sel] }), moved: false }
      ed.changed()
      return
    }
    if (!e.shiftKey) ed.sel = new Set()
    drag = { kind: 'marquee', start: p, keep: new Set(ed.sel) }
    ed.changed()
  })

  canvas.addEventListener('pointermove', (e) => {
    const p = ed.toDoc(e.clientX, e.clientY)
    if (pen && !drag) {
      ed.preview = { d: M.pathD({ points: [...pen, p] }), dots: pen }
      return ed.drawOverlay()
    }
    if (!drag) return
    if (drag.kind === 'pan') {
      ed.view = { ...drag.view, x: drag.view.x + e.clientX - drag.sx, y: drag.view.y + e.clientY - drag.sy }
      return ed.applyView()
    }
    if (drag.kind === 'draw') {
      if (ed.tool === 'line') {
        let q = p
        if (e.shiftKey) { const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1]; q = Math.abs(dx) > Math.abs(dy) ? [p[0], drag.start[1]] : [drag.start[0], p[1]] }
        drag.end = q
        ed.preview = { d: `M${drag.start[0]} ${drag.start[1]} L${q[0]} ${q[1]}` }
      } else ed.preview = { rect: (drag.box = boxOf(drag.start, p, e.shiftKey)) }
      return ed.drawOverlay()
    }
    if (drag.kind === 'pencil') {
      drag.points.push(p)
      ed.preview = { d: M.pathD({ points: drag.points }) }
      return ed.drawOverlay()
    }
    if (drag.kind === 'marquee') {
      const box = boxOf(drag.start, p, false)
      ed.preview = { rect: box, marquee: true }
      ed.sel = new Set(drag.keep)
      for (const s of ed.doc.shapes) {
        if (s.hidden || s.locked) continue
        const b = M.bbox(s)
        if (b.x >= box.x && b.y >= box.y && b.x + b.w <= box.x + box.w && b.y + b.h <= box.y + box.h) ed.sel.add(s.id)
      }
      return ed.changed()
    }
    if (drag.kind === 'move') {
      const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1]
      drag.moved = drag.moved || Math.hypot(dx, dy) * ed.view.z > 2
      if (!drag.moved) return
      ed.replace(drag.shapes.map((s) => M.moved(s, Math.round(dx), Math.round(dy))))
      return ed.changed()
    }
    if (drag.kind === 'resize') {
      const f = drag.from, h = drag.handle
      let x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h
      if (h.includes('w')) x0 = p[0]
      if (h.includes('e')) x1 = p[0]
      if (h.includes('n')) y0 = p[1]
      if (h.includes('s')) y1 = p[1]
      if (e.shiftKey && f.w && f.h && h.length === 2) {
        const k = Math.max(Math.abs(x1 - x0) / f.w, Math.abs(y1 - y0) / f.h)
        if (h.includes('w')) x0 = x1 - f.w * k; else x1 = x0 + f.w * k
        if (h.includes('n')) y0 = y1 - f.h * k; else y1 = y0 + f.h * k
      }
      const to = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(1, Math.abs(x1 - x0)), h: Math.max(1, Math.abs(y1 - y0)) }
      ed.replace(drag.shapes.map((s) => M.scaled(s, f, to)))
      return ed.changed()
    }
  })

  canvas.addEventListener('pointerup', () => {
    const d = drag
    drag = null
    if (!d) return
    ed.preview = null
    if (d.kind === 'draw') {
      if (ed.tool === 'line' && d.end && Math.hypot(d.end[0] - d.start[0], d.end[1] - d.start[1]) > 2) {
        const s = M.make('line', styled({ x1: d.start[0], y1: d.start[1], x2: d.end[0], y2: d.end[1], fill: 'none' }))
        ed.commit(() => { ed.doc.shapes.push(s); ed.sel = new Set([s.id]) })
      } else if (d.box && d.box.w > 2 && d.box.h > 2) {
        const s = M.make(ed.tool, styled({ ...d.box, radius: 0 }))
        ed.commit(() => { ed.doc.shapes.push(s); ed.sel = new Set([s.id]) })
      } else ed.drawOverlay()
    } else if (d.kind === 'pencil') {
      const points = M.simplify(d.points, 1.2 / ed.view.z)
      if (points.length > 1) {
        const s = M.make('path', styled({ points, smooth: true, fill: 'none' }))
        ed.commit(() => { ed.doc.shapes.push(s); ed.sel = new Set([s.id]) })
      } else ed.drawOverlay()
    } else if (d.kind === 'move' || d.kind === 'resize') {
      if (d.kind === 'move' && !d.moved) return
      // The change as one step of history: what was there before the drag.
      ed.past.push(d.before)
      ed.future = []
      ed.changed()
      ed.save()
    } else ed.drawOverlay()
  })

  canvas.addEventListener('dblclick', (e) => {
    if (ed.tool === 'pen' && pen) {
      pen = pen.slice(0, -1) // the double-click's second click placed a point too
      finishPen(false)
      return
    }
    // Double-click a text to change it.
    const s = ed.get(e.target.closest?.('[data-id]')?.dataset.id)
    if (s?.type === 'text') {
      const text = prompt('Text', s.text)
      if (text != null && text.trim()) ed.commit(() => ed.replace([{ ...s, text: text.trim(), tw: M.textWidth({ ...s, text: text.trim() }) }]))
    }
  })

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    if (e.ctrlKey || e.metaKey) ed.zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
    else {
      ed.view.x -= e.deltaX
      ed.view.y -= e.deltaY
      ed.applyView()
    }
  }, { passive: false })

  // ── the keyboard ──
  const KEYS = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', p: 'pen', b: 'pencil', t: 'text' }
  let clip = null
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea, select')) return
    const mod = e.metaKey || e.ctrlKey
    const k = e.key.toLowerCase()
    if (e.key === ' ') { space = true; canvas.style.cursor = 'grab'; e.preventDefault(); return }
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); return }
    if (mod && k === 'a') { e.preventDefault(); ed.sel = new Set(ed.doc.shapes.filter((s) => !s.hidden && !s.locked).map((s) => s.id)); ed.changed(); return }
    if (mod && k === 'd') { e.preventDefault(); ed.duplicate(); return }
    if (mod && k === 'c') { clip = ed.selected().map((s) => structuredClone(s)); return }
    if (mod && k === 'v' && clip?.length) { e.preventDefault(); ed.paste(clip); return }
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); ed.zoomAt(1.25); return }
    if (mod && k === '-') { e.preventDefault(); ed.zoomAt(0.8); return }
    if (mod && k === '0') { e.preventDefault(); ed.fit(); return }
    if (mod && k === ']') { e.preventDefault(); ed.arrange(1); return }
    if (mod && k === '[') { e.preventDefault(); ed.arrange(-1); return }
    if (e.key === 'Enter' && pen) { finishPen(false); return }
    if (e.key === 'Escape') {
      if (pen) { pen = null; ed.preview = null; ed.drawOverlay(); return }
      ed.sel = new Set(); ed.changed(); return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && ed.sel.size) { e.preventDefault(); ed.remove(); return }
    if (e.key.startsWith('Arrow') && ed.sel.size) {
      e.preventDefault()
      const n = e.shiftKey ? 10 : 1
      const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0
      ed.commit(() => ed.replace(ed.selected().filter((s) => !s.locked).map((s) => M.moved(s, dx, dy))))
      return
    }
    if (!mod && KEYS[k]) ed.setTool(KEYS[k])
  })
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { space = false; ed.setTool(ed.tool) }
  })

  // ── edits the panels and keys share ──
  ed.remove = () => ed.commit(() => { ed.doc.shapes = ed.doc.shapes.filter((s) => !ed.sel.has(s.id) || s.locked); ed.sel = new Set() })
  ed.paste = (list) => {
    const copies = list.map((s) => ({ ...M.moved(s, 16, 16), id: M.id() }))
    ed.commit(() => { ed.doc.shapes.push(...copies); ed.sel = new Set(copies.map((s) => s.id)) })
  }
  ed.duplicate = () => ed.sel.size && ed.paste(ed.selected())
  ed.arrange = (dir) => {
    if (!ed.sel.size) return
    ed.commit(() => {
      const a = ed.doc.shapes
      const order = dir > 0 ? [...a.keys()].reverse() : [...a.keys()]
      for (const i of order) {
        const j = i + dir
        if (!ed.sel.has(a[i].id) || j < 0 || j >= a.length || ed.sel.has(a[j].id)) continue
        ;[a[i], a[j]] = [a[j], a[i]]
      }
    })
  }
  ed.setTool('select')
})()
