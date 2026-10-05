#!/usr/bin/env node
/**
 * A screen recording of the whole app, walked through the way the validation
 * tests walk it: one continuous take of the real app, no title cards, a
 * visible pointer. A demo workspace and home (nothing of the person's own),
 * and Claude's answers scripted (scripts/demo/tour-claude.cjs) so the tour
 * does not wait minutes for a model.
 *
 *   npm run build && node scripts/demo/record-tour.mjs   →  build/demo/workspace-os-tour.mp4
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { hideCursor } from './stagecraft.mjs'
import { ASSETS, ROOT, appFrame, dockTo, drag, launch, point, seed, sleep, tap, type, until } from './tour-kit.mjs'

const OUT = path.join(ROOT, 'build', 'demo')
const RAW = path.join(OUT, 'tour-raw')
fs.rmSync(RAW, { recursive: true, force: true })
fs.mkdirSync(RAW, { recursive: true })
seed()

const t0 = Date.now()
const { app, win } = await launch(RAW)
const $ = (sel) => win.locator(sel)
const dock = (id) => dockTo(win, id)
const busy = () => win.locator('[data-testid="chat-stop"]').count().then((n) => n > 0)
const replied = async () => {
  await until(busy, 4000)
  await until(async () => !(await busy()), 30000)
  await sleep(1200)
}

// A little life for Inbox and Cases, made before the take starts.
await win.evaluate(async () => {
  await window.workspace.cases.create({ title: 'Northwind contract review', type: 'task', description: 'Read the offer and the contract; decide by 30 September.' })
  await window.workspace.cases.create({ title: 'Harbour Terminal weekly report', type: 'task', description: 'Site photos and notes into the weekly report.' })
  await window.workspace.memory.remember({ kind: 'preference', text: 'Send decks as PDF, never pptx', source: 'you told me', author: 'you' })
  await window.workspace.memory.remember({ kind: 'fact', text: 'The Harbour Terminal schedule slipped by two weeks', source: 'Q3 notes', author: 'agent' })
  window.dispatchEvent(new CustomEvent('wos:memory-changed'))
})
await sleep(1500)
const startAt = (Date.now() - t0) / 1000
console.log('tour: overview')

// ── Overview: the team, then Today ──
await point(win, $('[data-testid="landscape-dock"]'), { dy: -300 })
await sleep(1800)
await tap(win, $('[data-testid="overview-switch"] [data-switch="today"]'), { settle: 2600 })
await tap(win, $('[data-testid="overview-switch"] [data-switch="team"]'), { settle: 1800 })

// ── Chat ──
console.log('tour: chat')
await dock('chat')
await type(win, $('[data-testid="chat-view"] textarea'), "Plan my week around the Northwind review, the board deck and Friday's site visit")
await win.keyboard.press('Enter')
await replied()
await point(win, $('[data-testid="chat-attach"]'))
await win.setInputFiles('[data-testid="chat-file-input"]', path.join(ASSETS, 'Quarterly notes.txt'))
await sleep(900)
await type(win, $('[data-testid="chat-view"] textarea'), 'What stands out in these notes?')
await win.keyboard.press('Enter')
await replied()
await tap(win, $('[data-testid="chat-new"]'), { settle: 900 })
await type(win, $('[data-testid="chat-view"] textarea'), 'Make me a small landing page for a bakery called Brot & Butter')
await win.keyboard.press('Enter')
await replied()
await until(() => $('[data-testid="chat-artifact"]').count().then((n) => n > 0), 8000)
await sleep(2500)
await tap(win, $('[data-testid="chat-beside"]'), { settle: 2500 })
await point(win, $('[data-testid="chat-side"]'))
await sleep(1500)
await tap(win, $('[data-testid="chat-side-home"]'), { settle: 1500 })

// ── Apps ──
console.log('tour: apps')
await dock('apps')
await sleep(800)
await tap(win, $('[data-testid="apps-add-svg-generator"]'), { settle: 500 })
let f = await appFrame(win)
await type(win, f.locator('#what'), 'A paper plane taking off')
await tap(win, f.locator('#go'), { settle: 300 })
await until(() => f.locator('#preview').getAttribute('src').then((s) => !!s && s.startsWith('data:')), 15000)
await sleep(2200)
await tap(win, $('[data-testid="apps-back"]'), { settle: 900 })

await tap(win, $('[data-testid="apps-add-illustrator"]'), { settle: 500 })
f = await appFrame(win)
await sleep(800)
const board = (await f.locator('#board').boundingBox()) ?? { x: 400, y: 300, width: 600, height: 450 }
const at = (fx, fy) => ({ x: board.x + board.width * fx, y: board.y + board.height * fy })
await tap(win, f.locator('[data-tool="rect"]'), { settle: 300 })
await drag(win, at(0.12, 0.18), at(0.42, 0.52))
await tap(win, f.locator('[data-tool="ellipse"]'), { settle: 300 })
await drag(win, at(0.55, 0.25), at(0.8, 0.6))
const palette = await f.evaluate(() => Ed.PALETTE)
await tap(win, f.locator(`#props [data-fill="${palette[3]}"]`), { settle: 700 })
await tap(win, f.locator('#ai-open'), { settle: 300 })
await type(win, f.locator('#ai-prompt'), 'A house by the mountains, flat shapes')
await tap(win, f.locator('#ai-go'), { settle: 300 })
await until(() => f.evaluate(() => Ed.doc.shapes.length > 4), 15000)
await sleep(2500)
await tap(win, $('[data-testid="apps-back"]'), { settle: 900 })

await tap(win, $('[data-testid="apps-add-hairline"]'), { settle: 500 })
f = await appFrame(win)
await sleep(1200)
for (const id of ['riffle', 'terrain', 'exploded', 'phosphor', 'slow']) await point(win, f.locator(`[data-figure="${id}"] .art`), { dx: 20, dy: 10 })
await sleep(800)
await tap(win, f.locator('[data-figure="terrain"]'), { settle: 1200 })
const slider = await f.locator('#intensity').boundingBox()
if (slider) await drag(win, { x: slider.x + slider.width * 0.5, y: slider.y + slider.height / 2 }, { x: slider.x + slider.width * 0.9, y: slider.y + slider.height / 2 })
await point(win, f.locator('#big'), { dx: -60, dy: 20 })
await sleep(1500)
await tap(win, f.locator('#tabs [data-tab="make"]'), { settle: 600 })
await type(win, f.locator('#idea'), 'Sand dunes that rise under the pointer')
await tap(win, f.locator('#make-go'), { settle: 300 })
await until(() => f.evaluate(() => !document.getElementById('make-result').hidden), 30000)
await point(win, f.locator('#make-stage'), { dx: 40 })
await sleep(2000)
await tap(win, $('[data-testid="apps-back"]'), { settle: 900 })

await tap(win, $('[data-testid="apps-new"]'), { settle: 1500 })
await type(win, $('[data-testid="chat-view"] textarea'), 'A reading list: to read, reading, done. Remember everything.')
await win.keyboard.press('Enter')
await replied()
await until(async () => /Design check/.test((await $('[data-testid="chat-thread"]').textContent()) ?? '') || !(await busy()), 8000)
await sleep(2000)
await tap(win, $('[data-testid="chat-app-open"]'), { settle: 1000 })
f = await appFrame(win)
await type(win, f.locator('#title'), 'The Left Hand of Darkness')
await tap(win, f.locator('#add'), { settle: 900 })
await tap(win, f.locator('[data-next]').first(), { settle: 1200 })
await tap(win, $('[data-testid="apps-back"]'), { settle: 1800 })

// ── Library: files, notes and the wiki, memory ──
console.log('tour: library')
await dock('library')
await type(win, $('[data-testid="library-search"]'), 'Northwind')
await sleep(1800)
await tap(win, $('[data-switch="notes"]'), { settle: 1200 })
await tap(win, $('[data-testid="wiki-add"]'), { settle: 500 })
await type(win, $('[data-testid="wiki-find"]'), 'offer')
await tap(win, $('[data-wiki-file="Work/Northwind offer.md"]'), { settle: 500 })
await until(() => $('[data-testid="library-notes"] [data-note="Northwind Logistics.md"]').count().then((n) => n > 0), 20000)
await sleep(2500)
await tap(win, $('[data-switch="memory"]'), { settle: 2500 })

// ── Inbox, Cases, Menu, Terminal ──
console.log('tour: inbox, cases, menu')
await dock('inbox')
await sleep(1500)
await dock('cases')
await sleep(1500)
await dock('menu')
await sleep(2000)
await dock('overview')
await dock('terminal')
await dock('terminal')
await hideCursor(win)
await sleep(1200)

const video = win.video()
await app.close()
const raw = await video.path()
const out = path.join(OUT, 'workspace-os-tour.mp4')
const r = spawnSync('ffmpeg', ['-y', '-ss', String(Math.max(0, startAt - 0.3)), '-i', raw, '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { encoding: 'utf8' })
if (r.status !== 0) {
  console.error(r.stderr.slice(-1500))
  process.exit(1)
}
const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim()
console.log(`\n${out}  (${Math.round(Number(dur))} s, ${Math.round(fs.statSync(out).size / 1e6)} MB)`)
