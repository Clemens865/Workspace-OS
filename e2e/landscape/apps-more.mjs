/**
 * The built-in Illustrator Light and Hairline, and moving apps as files (real
 * app, real sandbox, a fake Claude, the Save/Open dialogs answered by the test).
 *
 * - Illustrator Light: drawing a rectangle by dragging, selecting it, colouring
 *   it from the palette, undo, layers, the drawing kept across a reopen, an
 *   SVG export, and an AI drawing that arrives as separate, editable shapes.
 * - Hairline: the nineteen figures draw; a new figure is made from an idea,
 *   its first draft breaks a rule (a timer of its own), the check catches it,
 *   the fix passes, it runs in a frame of its own, and once kept it is in the
 *   gallery.
 * - Export and import: an app leaves as one .wosapp file without its data,
 *   comes back as a new app after the person sees what it may do.
 *
 * Run: npm run e2e:landscape
 */
import { _electron as electron } from 'playwright'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { killAll } from '../office/_harness.mjs'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')

let fails = 0
let total = 0
const check = (n, c, d) => {
  total++
  if (c) console.log(`  PASS  ${n}`)
  else {
    console.error(`  FAIL  ${n}${d ? ` — ${d}` : ''}`)
    fails++
  }
}

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-apps-more-')))
const ws = path.join(tmp, 'workspace')
fs.mkdirSync(ws)
const callsFile = path.join(tmp, 'calls.json')
const fake = path.join(tmp, 'claude.cjs')
const example = path.join(root, 'resources/apps/hairline/skill/example-terrain.js')
fs.writeFileSync(
  fake,
  `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (!args.includes('-p')) { process.stdout.write('2.1.266 (Claude Code)\\n'); process.exit(0); }
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { prompt += c; });
process.stdin.on('end', () => {
  const file = ${JSON.stringify(callsFile)};
  const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  const system = args[args.indexOf('--append-system-prompt') + 1] || '';
  calls.push({ prompt: prompt.slice(0, 4000), system: system.slice(0, 600), rules: system.includes('## 01 · hit'), index: system.includes('Cam(azDeg, k, S)'), palette: /Use these colours: #/.test(system), found: (/The checks found:\\n- ([a-z]+): rule (\\d+)/.exec(prompt) || []).slice(1).join(' ') });
  fs.writeFileSync(file, JSON.stringify(calls));
  let text = 'Done.';
  if (system.includes('You are the AI inside "Hairline"')) {
    const good = fs.readFileSync(${JSON.stringify(example)}, 'utf8').replace('name: "terrain"', 'name: "dune"');
    // The first draft runs a timer of its own (rule 07); the fix does not.
    text = prompt.includes('The checks found') ? good : good.replace('const bag = disposer();', 'const bag = disposer();\\n  setTimeout(() => {}, 10);');
  }
  if (system.includes('You are the AI inside "Illustrator Light"')) text = '<svg viewBox="0 0 800 600"><rect x="100" y="100" width="200" height="120" fill="#d97757"/><circle cx="500" cy="300" r="80" fill="#2d9d8f"/><path d="M0 0 L10 10" stroke="#1b2730"/></svg>';
  process.stdout.write(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: text }) + '\\n');
});
`,
)
fs.chmodSync(fake, 0o755)
const calls = () => (fs.existsSync(callsFile) ? JSON.parse(fs.readFileSync(callsFile, 'utf8')) : [])

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: ws, CLAUDE_BIN: fake, WOS_ACTION_DIR: path.join(root, 'resources/wos-action'), WOS_NO_MEANING: '1', WOS_NO_TIDY: '1' },
})
// The test answers the Save and Open dialogs.
const answer = (kind, file) =>
  app.evaluate(({ dialog }, { kind, file }) => {
    if (kind === 'save') dialog.showSaveDialog = async () => ({ canceled: false, filePath: file })
    else dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] })
  }, { kind, file })
const win = await app.firstWindow({ timeout: 20000 })
win.on('pageerror', (err) => console.log(`  [pageerror] ${err.message}`))
await win.waitForSelector('#root', { timeout: 20000 })
const saved = await win.evaluate(() => JSON.stringify({ ...localStorage }))
await win.evaluate(() => {
  const K = 'workspace-os:settings'
  let c = {}
  try { c = JSON.parse(localStorage.getItem(K) || '{}') } catch { /* fresh */ }
  localStorage.setItem(K, JSON.stringify({ ...c, startOn: 'landscape', terminalOpen: false, sessionCases: 'manual', agentModel: '', learnFromSessions: false }))
})
await win.reload()
await win.waitForSelector('[data-shell="landscape"]', { timeout: 20000 })
for (let i = 0; i < 40 && (await win.$('[class*="_splash_"]')); i++) {
  await win.keyboard.press('Enter').catch(() => {})
  await win.waitForTimeout(400)
}
const settle = (ms = 600) => win.waitForTimeout(ms)
// WOS_SHOT_DIR=<dir>: keep pictures for a look by eye.
const shot = async (name) => process.env.WOS_SHOT_DIR && (await settle(700), await win.screenshot({ path: path.join(process.env.WOS_SHOT_DIR, name) }))
const until = async (fn, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    if (await Promise.resolve().then(fn).catch(() => false)) return true
    await settle(250)
  }
  return false
}
const appFrame = async () => {
  const el = await win.waitForSelector('[data-testid="apps-view"] [data-testid="app-frame"]', { timeout: 10000 })
  let f = null
  await until(async () => (f = await el.contentFrame()) && (await f.evaluate(() => typeof window.wos === 'object' && document.readyState === 'complete')), 10000)
  return f
}
const openApp = async (id) => {
  await win.click('[data-dock="apps"]')
  await win.waitForSelector('[data-testid="apps-view"]', { timeout: 8000 })
  if (await win.$('[data-testid="apps-back"]')) await win.click('[data-testid="apps-back"]')
  if (await win.$(`[data-testid="apps-add-${id}"]`)) await win.click(`[data-testid="apps-add-${id}"]`)
  else await win.click(`[data-app-card="${id}"]`)
  return appFrame()
}

try {
  // ── Illustrator Light ──
  let f = await openApp('illustrator')
  const born = await f.evaluate(() => performance.timeOrigin)
  const shapes = () => f.evaluate(() => Ed.doc.shapes.map((s) => ({ type: s.type, fill: s.fill, w: s.w, x: s.x })))
  // Pick the tool until the app says it is picked (a click into a frame that is still settling can be lost).
  for (let i = 0; i < 3 && (await f.evaluate(() => Ed.tool)) !== 'rect'; i++) {
    await f.click('[data-tool="rect"]')
    await settle(200)
  }
  // The board is fitted into view after the app's first layout: wait until it stops moving.
  let box = null
  await until(async () => {
    const b = await (await f.$('#board')).boundingBox()
    const still = box && b && Math.abs(b.x - box.x) < 0.5 && Math.abs(b.width - box.width) < 0.5
    box = b
    return still
  }, 5000)
  await win.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 8 })
  await win.mouse.up()
  await settle(300)
  let list = await shapes()
  if (!list.length) console.log('  diag:', JSON.stringify(await f.evaluate((born) => ({ reloaded: performance.timeOrigin !== born, tool: Ed.tool, view: Ed.view, focus: document.activeElement?.id, board: document.getElementById('board').getBoundingClientRect().toJSON() }), born)), JSON.stringify(box))
  check('Illustrator: dragging with the rectangle tool draws a rectangle, selected', list.length === 1 && list[0].type === 'rect' && list[0].w > 50 && (await f.evaluate(() => Ed.sel.size)) === 1, JSON.stringify(list))
  check('…in the kit’s look: Inter, paper, the selection in the accent', await f.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Inter') && !!document.querySelector('#overlay .sel-box') && !!document.querySelector('style[data-wos-kit]')))
  const palette = await f.evaluate(() => Ed.PALETTE)
  await f.click(`#props [data-fill="${palette[2]}"]`)
  list = await shapes()
  check('…a palette colour fills it', list[0].fill === palette[2], JSON.stringify(list[0]))
  await f.click('#canvas', { position: { x: 5, y: 5 } }) // empty space: deselect
  await f.click('[data-tool="ellipse"]')
  await win.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.8, { steps: 6 })
  await win.mouse.up()
  await settle(300)
  check('…the ellipse is a second layer, frontmost first', (await f.$$eval('#layers [data-layer]', (els) => els.map((e) => e.textContent.trim()))).join('|').startsWith('◯Ellipse'))
  await f.press('#canvas', 'Meta+z')
  await settle(200)
  check('…and undo takes it back', (await shapes()).length === 1)
  // Moving the rectangle by dragging it.
  await f.click('[data-tool="select"]')
  const before = (await shapes())[0].x
  await win.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35)
  await win.mouse.down()
  await win.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.35, { steps: 6 })
  await win.mouse.up()
  await settle(200)
  check('…dragging a shape moves it', (await shapes())[0].x > before + 20, `${before} → ${(await shapes())[0].x}`)
  // AI: separate shapes, fitted in, selected.
  await f.click('#ai-open')
  await f.fill('#ai-prompt', 'two shapes')
  await f.click('#ai-go')
  await until(async () => (await shapes()).length >= 3, 15000)
  list = await shapes()
  check('…drawing with AI brings separate, editable shapes in, asked in the drawing’s palette', list.filter((s) => s.type === 'rect').length === 2 && list.some((s) => s.type === 'ellipse') && list.some((s) => s.type === 'svg') && calls().at(-1)?.palette === true, JSON.stringify(list))
  await shot('ill.png')
  const out = path.join(tmp, 'drawing.svg')
  await answer('save', out)
  await f.click('#export-svg')
  await until(() => fs.existsSync(out), 5000)
  const svg = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : ''
  check('…Export SVG writes a standalone file with every shape', /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="800" height="600"/.test(svg) && (svg.match(/<rect /g) || []).length >= 2 && /<ellipse /.test(svg), svg.slice(0, 200))
  await win.click('[data-testid="apps-back"]')
  f = await openApp('illustrator')
  await until(async () => (await shapes()).length >= 4, 5000)
  if ((await shapes()).length < 4) console.log('  stored:', JSON.stringify(await f.evaluate(() => wos.storage.get('drawing').then((d) => d && d.shapes.length))), 'store file:', fs.existsSync(path.join(ws, 'Apps/illustrator/data/store.json')) ? fs.readFileSync(path.join(ws, 'Apps/illustrator/data/store.json'), 'utf8').slice(0, 200) : 'none')
  check('…and the drawing is still there when the app opens again', (await shapes()).length >= 4)

  // ── Hairline ──
  f = await openApp('hairline')
  await until(() => f.evaluate(() => document.querySelectorAll('#grid [data-figure] svg').length === 19), 8000)
  check('Hairline: the nineteen figures draw, in the kit’s ink on its paper', (await f.evaluate(() => document.querySelectorAll('#grid [data-figure] svg').length)) === 19 && (await f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hairline-hi').trim())) === (await f.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ink').trim())))
  await shot('hairline-gallery.png')
  await f.click('#tabs [data-tab="make"]')
  await f.fill('#idea', 'Sand dunes that rise under the pointer')
  await f.click('#make-go')
  const made = await until(() => f.evaluate(() => !document.getElementById('make-result').hidden), 25000)
  const asks = calls().filter((c) => /You are the AI inside "Hairline"/.test(c.system))
  check('…a new figure: the first draft broke rule 07, the check caught it, the fix passed', made && asks.length === 2 && asks[1].found === 'clock 07', JSON.stringify(asks.map((a) => a.found)))
  check('…the brief carries the skill: the ten rules and the engine’s index', /ONE new figure in the Hairline style/.test(asks[0]?.system ?? '') && asks[0]?.rules === true && asks[0]?.index === true, JSON.stringify(asks[0] && { rules: asks[0].rules, index: asks[0].index }))
  const nested = await f.evaluate(() => {
    const fr = document.querySelector('#make-stage iframe')
    return { sandbox: fr?.getAttribute('sandbox'), name: document.getElementById('make-name').textContent }
  })
  check('…it runs in a frame of its own (scripts, no origin) and draws', nested.sandbox === 'allow-scripts' && nested.name === 'dune', JSON.stringify(nested))
  await shot('hairline-made.png')
  await f.click('#make-keep')
  await settle(500)
  await f.click('#tabs [data-tab="gallery"]')
  await until(() => f.evaluate(() => !!document.querySelector('#mine [data-mine="dune"]')), 6000)
  check('…kept, it is in the gallery among yours', await f.evaluate(() => !!document.querySelector('#mine [data-mine="dune"]') && !document.getElementById('mine-section').hidden))

  // ── export and import ──
  const pkg = path.join(tmp, 'Hairline.wosapp')
  await answer('save', pkg)
  await win.click('[data-testid="apps-export"]')
  await until(() => fs.existsSync(pkg), 5000)
  const { unzipSync } = await import('fflate')
  const names = fs.existsSync(pkg) ? Object.keys(unzipSync(new Uint8Array(fs.readFileSync(pkg)))) : []
  check('an app leaves as one .wosapp file, without its data', names.includes('hairline/app.json') && names.includes('hairline/skill/kernel.js') && !names.some((n) => n.includes('/data/')), JSON.stringify(names.slice(0, 8)))
  await win.click('[data-testid="apps-back"]')
  await answer('open', pkg)
  await win.click('[data-testid="apps-import"]')
  await win.waitForSelector('[data-testid="apps-import-offer"]', { timeout: 6000 })
  const offer = (await win.textContent('[data-testid="apps-import-offer"]')) ?? ''
  check('importing shows what it is and what it may do before adding it', /Add “Hairline”\?/.test(offer) && /It may use AI/.test(offer) && /sandboxed/.test(offer) && !fs.existsSync(path.join(ws, 'Apps/hairline-2')), offer)
  await win.click('[data-testid="apps-import-confirm"]')
  await until(() => fs.existsSync(path.join(ws, 'Apps/hairline-2/app.json')), 5000)
  check('…added, it is a new app beside the original, without the original’s data', fs.existsSync(path.join(ws, 'Apps/hairline-2/skill/kernel.js')) && !fs.existsSync(path.join(ws, 'Apps/hairline-2/data')) && fs.existsSync(path.join(ws, 'Apps/hairline/data')))
  const bad = path.join(tmp, 'evil.wosapp')
  const { zipSync } = await import('fflate')
  fs.writeFileSync(bad, zipSync({ 'evil/index.html': new TextEncoder().encode('<p>'), 'evil/run.sh': new TextEncoder().encode('rm -rf ~') }))
  await answer('open', bad)
  await win.click('[data-testid="apps-back"]').catch(() => {})
  await win.click('[data-testid="apps-import"]')
  await settle(800)
  check('a file with anything but an app’s kind of files is refused', !(await win.$('[data-testid="apps-import-offer"]')) && !fs.existsSync(path.join(ws, 'Apps/evil')))
} catch (e) {
  check('run completed', false, e.message)
} finally {
  await win
    .evaluate((saved) => {
      localStorage.clear()
      for (const [k, v] of Object.entries(JSON.parse(saved))) localStorage.setItem(k, v)
    }, saved)
    .catch(() => {})
  await app.close()
  fs.rmSync(tmp, { recursive: true, force: true })
}
console.log(`\n${total - fails}/${total} passed`)
process.exit(fails ? 1 : 0)
