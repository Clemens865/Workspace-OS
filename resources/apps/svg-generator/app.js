// SVG Generator — a Workspace OS app. Asks the AI for one SVG, shows it as an
// image (an SVG shown as an image cannot run scripts), keeps the last twelve.
const $ = (id) => document.getElementById(id)
// The kit's palette, as the drawing's colour (read at runtime, so the app holds no colours of its own).
const css = getComputedStyle(document.documentElement)
const COLOURS = ['--ink', '--swatch-1', '--swatch-2', '--swatch-3', '--swatch-4', '--swatch-5'].map((t) => css.getPropertyValue(t).trim())
const STYLES = {
  line: 'clean line icon: strokes only, stroke-width 2 on a 24-unit grid scaled up, round caps and joins, no fills',
  flat: 'flat illustration: solid fills, no gradients, no outlines, simple geometric shapes',
  duotone: 'duotone illustration: the chosen colour plus a 25% tint of it, soft and calm',
  sketch: 'hand-drawn sketch: slightly irregular strokes, as if drawn with a fine pen',
}
let style = 'line'
let colour = COLOURS[0]
let current = null

function svgFrom(text) {
  const m = /<svg[\s\S]*<\/svg>/i.exec(text)
  if (!m) throw new Error('No SVG came back. Try describing it differently.')
  // An image cannot run scripts anyway; keep the file clean too. As an image (and a file), an SVG needs its namespace.
  let svg = m[0].replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '')
  if (!/xmlns=/.test(svg.slice(0, svg.indexOf('>')))) svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return svg
}
const dataUrl = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)

function show(item) {
  current = item
  $('empty').hidden = true
  $('result').hidden = false
  $('preview').src = dataUrl(item.svg)
  $('source').textContent = item.svg
}

async function recent() {
  return (await wos.storage.get('recent')) || []
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
    b.querySelector('img').src = dataUrl(item.svg)
    b.onclick = () => show(item)
    $('recent').appendChild(b)
  }
}

async function generate() {
  const what = $('what').value.trim()
  if (!what) return $('what').focus()
  $('error').hidden = true
  $('busy').hidden = false
  $('go').disabled = true
  try {
    const text = await wos.ai.complete(
      `Draw: ${what}\nStyle: ${STYLES[style]}\nMain colour: ${colour}`,
      { system: 'You draw SVGs. Answer with exactly one <svg> element: viewBox="0 0 256 256", no width/height, no <script>, no external references, no text unless asked. Keep it simple and well composed, centred with some breathing room.' },
    )
    const item = { what, style, colour, svg: svgFrom(text), at: Date.now() }
    show(item)
    const list = [item, ...(await recent())].slice(0, 12)
    await wos.storage.set('recent', list)
    await renderRecent()
  } catch (e) {
    $('error').textContent = e.message
    $('error').hidden = false
  } finally {
    $('busy').hidden = true
    $('go').disabled = false
  }
}

for (const c of COLOURS) {
  const b = document.createElement('button')
  b.className = 'swatch' + (c === colour ? ' on' : '')
  b.style.background = c
  b.title = c
  b.onclick = () => {
    colour = c
    document.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === b))
  }
  $('colours').appendChild(b)
}
document.querySelectorAll('#styles button').forEach((b) => {
  b.onclick = () => {
    style = b.dataset.style
    document.querySelectorAll('#styles button').forEach((x) => x.classList.toggle('on', x === b))
  }
})
$('go').onclick = generate
$('again').onclick = generate
$('what').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate()
})
$('code').onclick = () => {
  $('source').hidden = !$('source').hidden
  $('code').textContent = $('source').hidden ? 'Show the code' : 'Hide the code'
}
$('save').onclick = async () => {
  if (!current) return
  const name = current.what.replace(/[^\w\s-]/g, '').trim().slice(0, 40).replace(/\s+/g, '-').toLowerCase() || 'drawing'
  await wos.files.save(name + '.svg', current.svg)
}
renderRecent()
