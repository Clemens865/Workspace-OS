#!/usr/bin/env node
/*
 * wos-component — Workspace OS component generator (backs the office-component
 * skill). Writes reusable design components into the app's library so they show
 * up in the PowerPoint Components panel. No network, no API — pure local JSON.
 *
 *   wos-component add --spec <file.json>     # file holds a component or array
 *   echo '<json>' | wos-component add -      # spec from stdin
 *   wos-component list                       # print the current library
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const STORE = process.env.WOS_COMPONENTS_PATH ||
  path.join(os.homedir(), 'Library', 'Application Support', 'workspace-os', 'components.json')

function readAll() {
  try { const a = JSON.parse(fs.readFileSync(STORE, 'utf8')); return Array.isArray(a) ? a : [] } catch { return [] }
}
function writeAll(list) {
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE, JSON.stringify(list, null, 2))
}

const pick = (v, opts, d) => (typeof v === 'string' && opts.includes(v) ? v : d)
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

function sanitize(input) {
  const c = input || {}
  const id = typeof c.id === 'string' && /^[a-z0-9]+$/i.test(c.id) ? c.id : Math.random().toString(36).slice(2, 10)
  return {
    id,
    name: (typeof c.name === 'string' ? c.name : 'Component').slice(0, 60),
    type: pick(c.type, ['shape', 'card', 'media', 'captured', 'block', 'range'], 'shape'),
    blockKind: pick(c.blockKind, ['heading', 'callout', 'signature', 'quote'], 'heading'),
    rangeKind: pick(c.rangeKind, ['kpi', 'header', 'table'], 'kpi'),
    variants: Array.isArray(c.variants)
      ? c.variants.slice(0, 6).map((v) => ({ name: (typeof (v || {}).name === 'string' ? v.name : 'Variant').slice(0, 30), fill: num((v || {}).fill, 5806300), fontColor: num((v || {}).fontColor, 0) }))
      : [],
    base: pick(c.base, ['rect', 'roundrect', 'ellipse', 'text'], 'rect'),
    fill: num(c.fill, 5806300),
    fillKind: pick(c.fillKind, ['solid', 'gradient', 'pattern'], 'solid'),
    gradTo: num(c.gradTo, 14543051),
    line: num(c.line, 2050940),
    lineWidth: Math.max(0, Math.min(2000, num(c.lineWidth, 0))),
    dash: pick(c.dash, ['solid', 'dashed', 'dotted', 'dashdot'], 'solid'),
    fontColor: num(c.fontColor, 0),
    text: (typeof c.text === 'string' ? c.text : '').slice(0, 200),
    body: (typeof c.body === 'string' ? c.body : '').slice(0, 500),
    image: (typeof c.image === 'string' ? c.image : '').slice(0, 1000),
    w: Math.max(100, Math.min(60000, num(c.w, 7000))),
    h: Math.max(100, Math.min(45000, num(c.h, 4500))),
    elements: Array.isArray(c.elements)
      ? c.elements.filter((e) => typeof e === 'string').slice(0, 60).map((e) => e.replace(/[\r\n]/g, ' ').slice(0, 400))
      : undefined,
  }
}

function readSpec(rest) {
  const si = rest.indexOf('--spec')
  if (si >= 0 && rest[si + 1] && rest[si + 1] !== '-') return fs.readFileSync(rest[si + 1], 'utf8')
  return fs.readFileSync(0, 'utf8') // stdin
}

const [, , cmd, ...rest] = process.argv
try {
  if (cmd === 'list') {
    console.log(JSON.stringify(readAll(), null, 2))
  } else if (cmd === 'add') {
    const spec = JSON.parse(readSpec(rest))
    const items = Array.isArray(spec) ? spec : [spec]
    const list = readAll()
    const names = []
    for (const it of items) {
      const c = sanitize(it)
      const i = list.findIndex((x) => x.id === c.id)
      if (i >= 0) list[i] = c
      else list.push(c)
      names.push(`${c.name} [${c.id}]`)
    }
    writeAll(list)
    console.log(`Added/updated ${items.length} component(s): ${names.join(', ')}`)
    console.log('Open (or reopen) the Components panel in a PowerPoint doc to use them.')
  } else {
    console.error('usage: wos-component add --spec <file.json|->   |   wos-component list')
    process.exit(1)
  }
} catch (err) {
  console.error('wos-component error:', err.message)
  process.exit(2)
}
