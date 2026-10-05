#!/usr/bin/env node
/**
 * The stand-in for `claude` during the tour recording (scripts/demo/record-tour.mjs):
 * the same stream the real CLI prints, with scripted answers, so the tour
 * shows every feature without minutes of model time. What it answers is
 * chosen from the brief and the ask, as the e2e fakes do. Never used by the app itself.
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
if (!args.includes('-p')) {
  process.stdout.write('2.1.266 (Claude Code)\n')
  process.exit(0)
}
const system = args.includes('--append-system-prompt') ? args[args.indexOf('--append-system-prompt') + 1] : ''
const resumed = args.includes('--resume')
let prompt = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (c) => (prompt += c))
process.stdin.on('end', () => main().catch((e) => out(`(tour stand-in failed: ${e.message})`)))

const cwd = process.cwd()
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true })
  fs.writeFileSync(path.join(cwd, rel), text)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Streamed in pieces, as a session reads it; `whole` sends one message, as the one-shot runs (wiki, memory) read it. */
async function out(text, { pace = 18, size = 14, whole = false } = {}) {
  if (whole) process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) + '\n')
  else
    for (let i = 0; i < text.length; i += size) {
      process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: text.slice(i, i + size) } } }) + '\n')
      await sleep(pace)
    }
  process.stdout.write(JSON.stringify({ type: 'result', session_id: '7a7a7a7a-0000-4000-8000-' + String(Date.now()).slice(-12), is_error: false, result: text }) + '\n')
}

// ── canned material ──
const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Brot &amp; Butter</title>
<style>
body{margin:0;background:#fbfcfd;color:#1b2730;font:16px/1.6 Inter,system-ui,sans-serif}
header{padding:72px 8vw 40px;border-bottom:1px solid rgba(27,39,48,.09)}
h1{margin:0;font:400 54px/1.1 Newsreader,Georgia,serif}
.sub{color:#3b4a55;max-width:520px;margin-top:14px}
main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:36px 8vw}
.item{border:1px solid rgba(27,39,48,.09);border-radius:18px;padding:22px}
.item h3{margin:0 0 6px;font:400 22px Newsreader,Georgia,serif}
.price{color:#d97757;font-weight:500}
footer{padding:0 8vw 48px;color:#7a8893}
</style></head><body>
<header><h1>Brot &amp; Butter</h1><p class="sub">Sourdough baked before sunrise, every day, in the old bakery on Lindengasse.</p></header>
<main>
<div class="item"><h3>Country loaf</h3><p>Wheat and rye, 36 hours of rest.</p><span class="price">€ 6.40</span></div>
<div class="item"><h3>Seeded rye</h3><p>Sunflower, flax and pumpkin.</p><span class="price">€ 5.80</span></div>
<div class="item"><h3>Butter croissant</h3><p>Laminated by hand, 27 layers.</p><span class="price">€ 2.60</span></div>
</main>
<footer>Open Tuesday to Saturday, 7:00 to 14:00 · Sunday 8:00 to 12:00</footer>
</body></html>`

const WEEK = `## Your week, planned

Three things carry the week; everything else fits around them.

| Day | Focus | Block |
|---|---|---|
| Mon | Northwind contract review | 9:00 to 11:30 |
| Wed | Board deck, numbers from the cost model | 14:00 to 16:00 |
| Fri | Harbour Terminal site visit | all morning |

**Keep free:** Tuesday afternoon, for whatever the Monday review turns up.

\`\`\`text
Mon  ████████░░  contract
Wed  ██████░░░░  deck
Fri  ██████████  site
\`\`\`

Want me to put these blocks in your calendar?`

const PLANE = `<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><path d="M40 132 L212 56 L156 200 L124 150 Z" fill="none" stroke="#d97757" stroke-width="6" stroke-linejoin="round"/><path d="M124 150 L212 56" stroke="#d97757" stroke-width="6" stroke-linecap="round"/><path d="M40 196 C72 180 96 186 116 172" fill="none" stroke="#7a8893" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12"/><circle cx="58" cy="76" r="20" fill="#f8e3da"/></svg>`

const SCENE = `<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="380" width="800" height="220" fill="#d9efec"/>
<circle cx="610" cy="140" r="64" fill="#fbefd9"/>
<polygon points="120,380 260,210 400,380" fill="#2d9d8f"/>
<polygon points="300,380 470,170 640,380" fill="#3b4a55"/>
<polygon points="430,250 470,170 510,250" fill="#fbfcfd"/>
<rect x="560" y="300" width="90" height="80" fill="#d97757"/>
<polygon points="545,300 605,250 665,300" fill="#1b2730"/>
<rect x="590" y="335" width="26" height="45" fill="#fbefd9"/>
</svg>`

const APP = {
  json: JSON.stringify({ name: 'Reading list', description: 'Books to read, reading and done: add one, move it along, and see the year at a glance.', icon: '📚', permissions: [], entry: 'index.html' }, null, 2),
  html: `<!doctype html>
<html><head><title>Reading list</title><link rel="stylesheet" href="style.css"></head>
<body>
<div class="wos-app">
  <div class="wos-header"><h1 class="wos-title">Reading list</h1><span class="wos-chip accent" id="count"></span></div>
  <div class="wos-main wos-stack">
    <div class="wos-row"><input class="wos-input" id="title" placeholder="A book to read" style="flex:1"><button class="wos-btn primary" id="add">Add</button></div>
    <div class="cols" id="cols"></div>
  </div>
</div>
<script src="app.js"></script>
</body></html>`,
  css: `.cols{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.col h3{margin:0 0 10px}
.book{display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:8px;border:1px solid var(--line);border-radius:var(--radius);background:var(--paper)}
.book span{flex:1}
.col.done .book span{color:var(--muted);text-decoration:line-through}`,
  js: `const COLS = [['want', 'To read'], ['now', 'Reading'], ['done', 'Done']]
let books = []
const save = () => wos.storage.set('books', books)
function render() {
  document.getElementById('count').textContent = books.filter((b) => b.at === 'done').length + ' read this year'
  document.getElementById('cols').innerHTML = COLS.map(([k, label]) => {
    const list = books.filter((b) => b.at === k)
    return '<div class="col ' + k + '"><h3>' + label + '</h3>' + (list.length ? list.map((b) => '<div class="book"><span></span>' + (k !== 'done' ? '<button class="wos-btn small ghost" data-next="' + b.id + '">Next</button>' : '') + '</div>').join('') : '<div class="wos-empty">Nothing here yet.</div>') + '</div>'
  }).join('')
  let i = 0
  for (const [k] of COLS) for (const b of books.filter((x) => x.at === k)) document.querySelectorAll('.book span')[i++].textContent = b.title
}
document.getElementById('add').onclick = () => {
  const t = document.getElementById('title').value.trim()
  if (!t) return
  books.push({ id: Date.now(), title: t, at: 'want' })
  document.getElementById('title').value = ''
  save()
  render()
}
document.getElementById('cols').onclick = (e) => {
  const id = Number(e.target.dataset.next)
  const b = books.find((x) => x.id === id)
  if (!b) return
  b.at = b.at === 'want' ? 'now' : 'done'
  save()
  render()
}
wos.storage.get('books').then((v) => {
  books = v || [{ id: 1, title: 'The Overstory', at: 'now' }, { id: 2, title: 'Seeing Like a State', at: 'want' }, { id: 3, title: 'Piranesi', at: 'done' }]
  render()
})`,
}

async function main() {
  // Wiki: the offer letter becomes linked pages.
  if (/You keep a wiki/.test(prompt)) {
    return out(JSON.stringify({ pages: [
      { title: 'Northwind Logistics', type: 'organization', summary: 'Hamburg logistics company that offered the PM role on Waypoint.', body: 'Northwind Logistics is based in Hamburg and runs the routing platform [[Waypoint]].\n\n- Offered the Senior Product Manager role on 12 September 2026; salary EUR 120,000, start 1 March 2027.\n- Contact: [[Anna Berg]], Head of Product.' },
      { title: 'Anna Berg', type: 'person', summary: 'Head of Product at Northwind Logistics.', body: 'Head of Product at [[Northwind Logistics]]; signed the offer for the [[Waypoint]] role.' },
      { title: 'Waypoint', type: 'project', summary: "Northwind's routing platform.", body: 'The routing platform of [[Northwind Logistics]]. The PM role reports to [[Anna Berg]].' },
    ] }), { whole: true })
  }
  if (/WORTH REMEMBERING/.test(prompt)) return out(JSON.stringify({ memories: [] }), { whole: true })

  // Apps' own AI calls.
  const inside = /You are the AI inside "([^"]+)"/.exec(system)?.[1]
  if (inside === 'SVG Generator') return out(PLANE, { pace: 6, size: 80 })
  if (inside === 'Illustrator Light') return out(SCENE, { pace: 6, size: 80 })
  if (inside === 'Hairline') {
    const kernelDir = path.join(__dirname, '..', '..', 'resources', 'apps', 'hairline', 'skill')
    return out(fs.readFileSync(path.join(kernelDir, 'example-terrain.js'), 'utf8').replace('name: "terrain"', 'name: "dunes"'), { pace: 4, size: 120 })
  }

  // The app builder: writes its one app.
  const slug = /the folder Apps\/([a-z0-9-]+)\//.exec(system)?.[1] || (resumed && /Apps\/([a-z0-9-]+)\//.exec(prompt)?.[1])
  if (slug || /design check found/.test(prompt)) {
    const s = slug || 'new-app'
    write(`Apps/${s}/app.json`, APP.json)
    write(`Apps/${s}/index.html`, APP.html)
    write(`Apps/${s}/style.css`, APP.css)
    write(`Apps/${s}/app.js`, APP.js)
    await sleep(1800)
    return out('Built your reading list: three columns, To read, Reading and Done. Add a book at the top and press **Next** to move it along; it remembers everything when you come back.')
  }

  // Chat.
  if (/talking with the person in the Chat/.test(system) || resumed) {
    if (/landing page|bakery/i.test(prompt)) {
      await sleep(900)
      write('Artifacts/Brot & Butter.html', PAGE)
      return out('I made a one-page site for **Brot & Butter**: the headline, three loaves with prices, and the opening hours, in calm Workspace OS colours. It is open beside the chat.')
    }
    const file = /Context files[^\n]*\n([^\n]+)/.exec(prompt)?.[1]?.trim()
    if (file && fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim()
      return out(`I read **${path.basename(file)}**. In short:\n\n- ${text.split(/\n+/).slice(0, 3).join('\n- ')}\n\nThe quarter looks on track; the open risk is the Harbour Terminal schedule.`)
    }
    return out(WEEK, { pace: 14 })
  }
  return out('Done.')
}
