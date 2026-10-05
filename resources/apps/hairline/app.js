// Hairline — the figures of @lucasmarkes/hairline (MIT), loaded by the kit as window.hairline.
const $ = (id) => document.getElementById(id)
const FIGURES = [
  ['riffle', 'Riffle', 'A tray of eight cards; the card under the pointer stands up.'],
  ['terrain', 'Terrain', 'Eighty-one pillars that rise around the pointer.'],
  ['exploded', 'Exploded', 'An app window in four layers; moving across opens the gap.'],
  ['phosphor', 'Phosphor', 'A dot matrix that fades like phosphor where you paint it.'],
  ['slow', 'Slow', 'Crates on a belt; hovering slows the clock.'],
  ['turntable', 'Turntable', 'Blocks on a turntable; a flick spins it.'],
  ['keyboard', 'Keyboard', 'Sixty keys; the one under the pointer sinks.'],
  ['elevator', 'Elevator', 'Four floors; the pointer’s height picks one.'],
  ['phone', 'Phone', 'A phone in layers: glass, board, battery, shell.'],
  ['laptop', 'Laptop', 'A laptop whose lid follows the pointer.'],
  ['terminal', 'Terminal', 'A terminal; the pointer scrolls its history.'],
  ['cabinet', 'Cabinet', 'A rack of blades that slide out toward the pointer.'],
  ['branches', 'Branches', 'A commit graph; the commit under the pointer rises.'],
  ['vault', 'Vault', 'A vault door; turn the dial to the combination.'],
  ['lockers', 'Lockers', 'Twelve lockers; the one under the pointer opens.'],
  ['padlock', 'Padlock', 'A padlock that opens as the pointer comes near.'],
  ['patch', 'Patch', 'A patch panel whose cables lean away.'],
  ['dish', 'Dish', 'A dish on a gimbal that aims at the pointer.'],
  ['router', 'Router', 'A router whose antennas lean toward the pointer.'],
]
let live = []
let focus = null

function clear() {
  live.forEach((f) => f.destroy())
  live = []
}

function gallery() {
  clear()
  focus = null
  $('focus').hidden = true
  $('gallery').hidden = false
  $('grid').innerHTML = ''
  for (const [id, name, what] of FIGURES) {
    const card = document.createElement('button')
    card.className = 'figure'
    card.dataset.figure = id
    card.innerHTML = `<div class="art"></div><strong>${name}</strong><span>${what}</span>`
    card.onclick = () => open(id)
    $('grid').appendChild(card)
    live.push(hairline[id](card.querySelector('.art'), { intensity: 0.5, label: `${name}: ${what}` }))
  }
}

async function open(id) {
  clear()
  const [, name, what] = FIGURES.find((f) => f[0] === id)
  const saved = (await wos.storage.get('intensity:' + id)) ?? 0.5
  $('gallery').hidden = true
  $('focus').hidden = false
  $('name').textContent = name
  $('what').textContent = what
  $('intensity').value = saved
  $('intensity-value').textContent = Number(saved).toFixed(2)
  $('big').innerHTML = ''
  $('code').hidden = true
  focus = { id, name, figure: hairline[id]($('big'), { intensity: saved, label: `${name}: ${what}`, onRead: (t) => ($('readout').textContent = t) }) }
  live.push(focus.figure)
}

$('intensity').oninput = (e) => {
  const v = Number(e.target.value)
  $('intensity-value').textContent = v.toFixed(2)
  if (!focus) return
  focus.figure.update({ intensity: v })
  wos.storage.set('intensity:' + focus.id, v)
}
$('back').onclick = gallery

const snippet = (id, v) => `import { ${id} } from '@lucasmarkes/hairline'\n\nconst figure = ${id}(document.getElementById('figure'), { intensity: ${v} })\n// figure.update({ intensity: 0.8 }); figure.destroy()`
$('snippet').onclick = () => {
  if (!focus) return
  $('code').textContent = snippet(focus.id, Number($('intensity').value))
  $('code').hidden = !$('code').hidden
  $('snippet').textContent = $('code').hidden ? 'Show the code' : 'Hide the code'
}

// A page that works on its own: the figure, the library, and the Workspace OS ink and paper.
$('save').onclick = async () => {
  if (!focus) return
  const lib = document.querySelector('script[data-wos-lib="hairline"]').textContent
  const css = getComputedStyle(document.documentElement)
  const t = (n) => css.getPropertyValue(n).trim()
  const v = Number($('intensity').value)
  const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>${focus.name}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:${t('--paper')}}
#figure{width:min(720px,90vw);--hairline-plate:${t('--paper')};--hairline-hi:${t('--ink')};--hairline-edge:${t('--ink-2')};--hairline-mid:${t('--muted')};--hairline-lo:${t('--faint')}}</style>
</head><body><div id="figure"></div>
<script>${lib.replace(/<\/script/gi, '<\\/script')}</script>
<script>hairline.${focus.id}(document.getElementById('figure'), { intensity: ${v} })</script>
</body></html>`
  await wos.files.save(`${focus.id}.html`, page)
}

// The two faces: the gallery, and making a figure (maker.js).
function tab(name) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name))
  if (name === 'gallery') {
    $('make').hidden = true
    gallery()
    window.hairlineMaker?.renderMine()
  } else {
    clear()
    $('gallery').hidden = true
    $('focus').hidden = true
    $('make').hidden = false
  }
}
document.querySelectorAll('#tabs button').forEach((b) => (b.onclick = () => tab(b.dataset.tab)))
window.hairlineApp = { tab }

gallery()
