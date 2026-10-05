// SVG Generator — a Workspace OS app. A designer's brief, not "keep it simple":
// the model draws one SVG to a professional standard in the chosen format,
// style and palette; then (Art director on) it looks at its own render and
// returns an improved version. SVGs show as images (an image cannot run
// scripts); the last twelve are kept, as drafts and finals.
const $ = (id) => document.getElementById(id)

const FORMATS = {
  square: { w: 512, h: 512, label: 'square (icon, logo, spot illustration)' },
  wide: { w: 1280, h: 720, label: 'wide 16:9 (graphic, diagram, hero)' },
  banner: { w: 1500, h: 500, label: 'banner 3:1 (header, section graphic)' },
}

const STYLES = {
  logo: 'Logo mark: a distinctive, ownable symbol built on one clear idea; geometric construction on a grid with precise curves and consistent stroke or shape weight; works in one colour and at 16 px; generous clear space around it; the accent only where it carries meaning.',
  icon: 'Line icon: strokes of one weight (2 units per 24, scaled to the canvas), round caps and joins, consistent corner radii, crisp geometry built from exact arcs and lines, one accent detail; reads instantly at small sizes.',
  flat: 'Flat editorial illustration: solid shapes from the palette, considered negative space, depth from overlapping planes and tints of the palette (not outlines), a clear focal point and a quiet secondary layer.',
  isometric: 'Isometric illustration: true 30° isometric projection, three consistent face shades derived from the palette, crisp edges, a small composed scene with a clear subject.',
  diagram: 'Product diagram, like a polished SaaS landing-page graphic: rounded cards with thin borders on the surface colour, a line icon inside each, connectors (dashed or solid arrows) with equal spacing, steps or a timeline with nodes, the key step highlighted in the accent; a large, faint background motif for depth; exact alignment.',
  duotone: 'Duotone illustration: the line colour and the accent with tints of both, soft linear gradients, bold simple shapes, calm and premium.',
  sketch: 'Ink sketch: fine, slightly irregular pen strokes drawn with confident gesture, light hatching for shade, a few accent touches; feels hand-made, not clip-art.',
}

const DETAIL = {
  1: 'Restrained: few elements, every one essential; let the space do the work.',
  2: 'Considered: a full composition with supporting detail and one secondary layer.',
  3: 'Rich: layered and detailed, many purposeful elements, fine secondary detail and texture, still clearly organised.',
}

const DESIGNER = [
  'You are a senior brand designer and illustrator at a top studio. You draw ONE SVG to a professional, portfolio standard: it must look designed, never like clip-art or a default icon.',
  'Craft rules: a clear focal point and hierarchy; balanced negative space and optical centring; align to an 8-unit grid; one consistent stroke weight per role; consistent corner radii; precise geometry from exact coordinates, arcs and paths (no wobbly approximations unless the style is a sketch); layering for depth (a large low-contrast background motif, the subject, highlights); gradients only in <defs> and only where they add depth; nothing cut off by the canvas edge unless intended.',
  'Colour: use only the palette you are given (and opacity or tints of it). When the palette has a background, the first element is a full-size rect in that colour.',
  'Text only when the description asks for words; then font-family="Inter, Helvetica Neue, Arial, sans-serif", a clear type scale, and it must fit.',
  'Answer with exactly one <svg> element: xmlns="http://www.w3.org/2000/svg", the viewBox you are given, no width or height, no <script>, no event attributes, no <foreignObject>, no external references (no http links, no external images or fonts).',
].join('\n')

const REFINE = 'This is the SVG you drew, and the image shows how it renders. Critique it as an art director against the brief: composition and balance, hierarchy, spacing and alignment, palette use, line consistency, level of detail, anything clipped, broken or generic. Then redraw it as a clearly better version that fixes every point (not a copy with small changes). Answer with the improved <svg> only.'

let format = 'square'
let style = 'flat'
let palette = PALETTES[1]
let detail = 2
let current = null
let showing = 'final'

// The "Workspace" palette follows the kit (and so the theme).
function colours(p) {
  if (!p.fromKit) return p
  const css = getComputedStyle(document.documentElement)
  const t = (n) => css.getPropertyValue(n).trim()
  return { ...p, bg: t('--paper'), surface: t('--mist') || t('--paper'), line: t('--ink'), muted: t('--muted'), accent: t('--accent') }
}

function svgFrom(text) {
  const m = /<svg[\s\S]*<\/svg>/i.exec(text)
  if (!m) throw new Error('No SVG came back. Try describing it differently.')
  // An image cannot run scripts anyway; keep the file clean too. As an image (and a file), an SVG needs its namespace.
  let svg = m[0].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
  if (!/xmlns=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return svg
}
const dataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

/** The SVG as a PNG data: URL, for the art director's look and for "Save as PNG". */
async function rasterize(svg, w, h, scale = 1) {
  const img = new Image()
  img.src = dataUrl(svg)
  await img.decode()
  const c = document.createElement('canvas')
  c.width = Math.round(w * scale)
  c.height = Math.round(h * scale)
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/png')
}

function brief(what) {
  const f = FORMATS[format]
  const p = colours(palette)
  return [
    `Draw: ${what}`,
    `Format: viewBox="0 0 ${f.w} ${f.h}", ${f.label}.`,
    `Style: ${STYLES[style]}`,
    `Palette (${p.name}): ${p.bg ? `background ${p.bg}, ` : 'no background (transparent), '}surface ${p.surface}, line ${p.line}, muted ${p.muted}, accent ${p.accent}.`,
    `Detail: ${DETAIL[detail]}`,
  ].join('\n')
}

function show(item, which) {
  current = item
  showing = which || (item.final ? 'final' : 'draft')
  const svg = showing === 'final' && item.final ? item.final : item.draft
  $('empty').hidden = true
  $('result').hidden = false
  $('preview').src = dataUrl(svg)
  $('source').textContent = svg
  $('versions').hidden = !item.final
  document.querySelectorAll('#versions button').forEach((b) => b.classList.toggle('on', b.dataset.v === showing))
}
const shown = () => (current ? (showing === 'final' && current.final) || current.draft : null)

async function recent() {
  return (await wos.storage.get('recent')) || []
}
async function remember(item) {
  const list = [item, ...(await recent()).filter((x) => x.at !== item.at)].slice(0, 12)
  await wos.storage.set('recent', list)
  await renderRecent()
}
async function renderRecent() {
  const list = await recent()
  $('recent').innerHTML = ''
  if (!list.length) {
    $('recent').innerHTML = '<span class="wos-muted wos-small">Nothing yet.</span>'
    return
  }
  for (const item of list) {
    const b = document.createElement('button')
    b.title = item.what
    b.innerHTML = '<img alt="">'
    b.querySelector('img').src = dataUrl(item.final || item.draft || item.svg)
    b.onclick = () => show(item.draft ? item : { ...item, draft: item.svg })
    $('recent').appendChild(b)
  }
}

function busy(text) {
  $('busy').hidden = !text
  $('busy-text').textContent = text || ''
  for (const id of ['go', 'again', 'refine']) $(id).disabled = !!text
}

async function refine(item, ask) {
  const f = FORMATS[item.format] || FORMATS.square
  const png = await rasterize(item.final || item.draft, f.w, f.h, f.w > 900 ? 1 : 1.5)
  const text = await wos.ai.complete(`${ask}\n\nThe brief:\n${item.brief}\n\nThe SVG:\n${item.final || item.draft}`, { system: DESIGNER, images: [png] })
  return svgFrom(text)
}

async function generate() {
  const what = $('what').value.trim()
  if (!what) return $('what').focus()
  $('error').hidden = true
  try {
    busy('Drawing…')
    const b = brief(what)
    const item = { what, format, style, palette: palette.id, detail, brief: b, draft: svgFrom(await wos.ai.complete(b, { system: DESIGNER })), at: Date.now() }
    show(item, 'draft')
    await remember(item)
    if ($('director').checked) {
      busy('The art director is looking at it…')
      item.final = await refine(item, REFINE)
      show(item, 'final')
      await remember(item)
    }
  } catch (e) {
    $('error').textContent = e.message
    $('error').hidden = false
  } finally {
    busy(null)
  }
}

async function refineAgain() {
  if (!current) return
  $('error').hidden = true
  try {
    busy('The art director is looking at it…')
    // The version on screen is the one to improve.
    const base = { ...current, final: null, draft: shown(), brief: current.brief || `Draw: ${current.what}` }
    current.final = await refine(base, REFINE)
    show(current, 'final')
    await remember(current)
  } catch (e) {
    $('error').textContent = e.message
    $('error').hidden = false
  } finally {
    busy(null)
  }
}

function name() {
  return (current?.what || 'drawing').replace(/[^\w\s-]/g, '').trim().slice(0, 40).replace(/\s+/g, '-').toLowerCase() || 'drawing'
}

// ── controls ──
function segment(id, set) {
  document.querySelectorAll(`#${id} button`).forEach((b) => {
    b.onclick = () => {
      set(b.dataset.v)
      document.querySelectorAll(`#${id} button`).forEach((x) => x.classList.toggle('on', x === b))
    }
  })
}
segment('formats', (v) => (format = v))
segment('versions', (v) => current && show(current, v))
$('style').onchange = (e) => (style = e.target.value)
$('detail').oninput = (e) => {
  detail = Number(e.target.value)
  $('detail-text').textContent = ['', 'Restrained', 'Considered', 'Rich'][detail]
}

function renderPalettes() {
  $('palettes').innerHTML = ''
  for (const p of PALETTES) {
    const c = colours(p)
    const b = document.createElement('button')
    b.className = 'palette' + (p === palette ? ' on' : '')
    b.title = p.name
    b.dataset.palette = p.id
    b.innerHTML = '<span class="dots"></span><span class="wos-small"></span>'
    b.lastChild.textContent = p.name
    for (const k of ['bg', 'surface', 'line', 'accent']) {
      const d = document.createElement('i')
      d.style.background = c[k] || 'transparent'
      if (!c[k]) d.className = 'none'
      b.firstChild.appendChild(d)
    }
    b.onclick = () => {
      palette = p
      renderPalettes()
    }
    $('palettes').appendChild(b)
  }
}
wos.onTheme(renderPalettes)

$('go').onclick = generate
$('again').onclick = generate
$('refine').onclick = refineAgain
$('what').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate()
})
$('code').onclick = () => {
  $('source').hidden = !$('source').hidden
  $('code').textContent = $('source').hidden ? 'Show the code' : 'Hide the code'
}
$('save').onclick = async () => {
  if (current) await wos.files.save(name() + '.svg', shown())
}
$('save-png').onclick = async () => {
  if (!current) return
  const f = FORMATS[current.format || 'square']
  const png = await rasterize(shown(), f.w, f.h, 2)
  await wos.files.save(name() + '.png', png.split(',')[1], { encoding: 'base64' })
}
renderPalettes()
renderRecent()
