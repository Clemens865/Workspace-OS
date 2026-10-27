#!/usr/bin/env node
/**
 * Manual screenshots for the chapters added after v0.1.118: the landscape and
 * dock, Today, agents, Chat, Apps, Inbox, Cases, Library and Wiki, Memory,
 * Menu, the floating terminal and Settings. Same sample workspace and scripted
 * Claude as the tour (scripts/demo/tour-kit.mjs), so nothing personal appears
 * and no model time is used.
 *
 *   npm run build && node docs/manual/capture-landscape.mjs
 *   → docs/manual/img/4x-*.jpg (1500 px wide, the size of the other screenshots)
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { ASSETS, ROOT, appFrame, dockTo, launch, seed, sleep, tap, type, until } from '../../scripts/demo/tour-kit.mjs'
import { hideCursor } from '../../scripts/demo/stagecraft.mjs'

const IMG = path.join(ROOT, 'docs', 'manual', 'img')
const RAW = path.join(ROOT, 'build', 'manual-raw')
fs.rmSync(RAW, { recursive: true, force: true })
fs.mkdirSync(RAW, { recursive: true })
seed()

const { app, win } = await launch(RAW)
const $ = (sel) => win.locator(sel)
const dock = (id) => dockTo(win, id)
const busy = () => $('[data-testid="chat-stop"]').count().then((n) => n > 0)
const replied = async () => {
  await until(busy, 4000)
  await until(async () => !(await busy()), 30000)
  await sleep(1200)
}
const shots = []
const shot = async (name) => {
  await hideCursor(win)
  await sleep(500)
  const png = path.join(RAW, `${name}.png`)
  await win.screenshot({ path: png })
  const jpg = path.join(IMG, `${name}.jpg`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', 'scale=1500:-2', '-q:v', '3', jpg])
  if (r.status !== 0) throw new Error(`ffmpeg ${name}: ${r.stderr}`)
  shots.push(name)
  console.log(`  shot ${name}`)
}
const exists = (sel) => $(sel).count().then((n) => n > 0)

// Some work for the Inbox and Cases before the first shot.
await win.evaluate(async () => {
  await window.workspace.cases.create({ title: 'Northwind contract review', type: 'task', description: 'Read the offer and the contract; decide by 30 September.' })
  await window.workspace.cases.create({ title: 'Harbour Terminal weekly report', type: 'task', description: 'Site photos and notes into the weekly report.' })
  await window.workspace.memory.remember({ kind: 'preference', text: 'Send decks as PDF, never pptx', source: 'you told me', author: 'you' })
  await window.workspace.memory.remember({ kind: 'fact', text: 'The Harbour Terminal schedule slipped by two weeks', source: 'Q3 notes', author: 'agent' })
  window.dispatchEvent(new CustomEvent('wos:memory-changed'))
})
await sleep(2500)

// Overview: the team, then Today.
await shot('40-overview-team')
await tap(win, $('[data-testid="overview-switch"] [data-switch="today"]'), { settle: 2500 })
await shot('41-overview-today')
await tap(win, $('[data-testid="overview-switch"] [data-switch="team"]'), { settle: 1500 })

// An agent up close and its settings, then a case card continued as a session.
if (await tap(win, $('[data-testid="agent-face"]').first(), { settle: 2500 })) {
  await shot('42-agent-focus')
  if (await tap(win, $('[data-testid="agent-tab-settings"]'), { settle: 1500 })) await shot('42b-agent-settings')
  await win.keyboard.press('Escape')
  await sleep(1500)
}
if (await tap(win, $('[data-testid="work-face"]').first(), { settle: 2500 })) {
  await shot('43-work-focus')
  await win.keyboard.press('Escape')
  await sleep(1500)
}

// Chat: a plan, then a page made beside the work.
await dock('chat')
await type(win, $('[data-testid="chat-view"] textarea'), "Plan my week around the Northwind review, the board deck and Friday's site visit")
await win.keyboard.press('Enter')
await replied()
await win.setInputFiles('[data-testid="chat-file-input"]', path.join(ASSETS, 'Quarterly notes.txt'))
await sleep(900)
await type(win, $('[data-testid="chat-view"] textarea'), 'What stands out in these notes?')
await win.keyboard.press('Enter')
await replied()
await shot('44-chat')
await tap(win, $('[data-testid="chat-new"]'), { settle: 900 })
await type(win, $('[data-testid="chat-view"] textarea'), 'Make me a small landing page for a bakery called Brot & Butter')
await win.keyboard.press('Enter')
await replied()
await until(() => exists('[data-testid="chat-artifact"]'), 8000)
await sleep(2000)
await shot('45-chat-artifact')
if (await tap(win, $('[data-testid="chat-beside"]'), { settle: 2500 })) {
  await shot('46-chat-beside')
  await tap(win, $('[data-testid="chat-side-home"]'), { settle: 1500 })
}

// Apps: the gallery, then an app built from a sentence.
await dock('apps')
await sleep(1000)
await shot('47-apps-gallery')
await tap(win, $('[data-testid="apps-new"]'), { settle: 1500 })
await type(win, $('[data-testid="chat-view"] textarea'), 'A reading list: to read, reading, done. Remember everything.')
await win.keyboard.press('Enter')
await replied()
await sleep(2500)
await shot('48-app-builder')
if (await tap(win, $('[data-testid="chat-app-open"]'), { settle: 1200 })) {
  const f = await appFrame(win)
  await type(win, f.locator('#title'), 'The Left Hand of Darkness')
  await tap(win, f.locator('#add'), { settle: 900 })
  await shot('49-app-open')
  await tap(win, $('[data-testid="apps-back"]'), { settle: 1500 })
}

// Inbox: what waits, then what happened.
await dock('inbox')
await sleep(1500)
await shot('50-inbox')
if (await tap(win, $('[data-switch="history"]').first(), { settle: 1500 })) await shot('51-inbox-history')

// Cases, in each view.
await dock('cases')
await sleep(1500)
for (const mode of ['shelf', 'map', 'board', 'sessions']) {
  if (await tap(win, $(`[data-testid="cases-mode"] [data-mode="${mode}"]`), { settle: 1500 })) await shot(`52-cases-${mode}`)
}

// Library: files, the wiki, memory.
await dock('library')
await type(win, $('[data-testid="library-search"]'), 'Northwind')
await sleep(1800)
await shot('53-library-files')
await tap(win, $('[data-switch="notes"]'), { settle: 1200 })
await tap(win, $('[data-testid="wiki-add"]'), { settle: 500 })
await type(win, $('[data-testid="wiki-find"]'), 'offer')
await tap(win, $('[data-wiki-file="Work/Northwind offer.md"]'), { settle: 500 })
await until(() => exists('[data-testid="library-notes"] [data-note="Northwind Logistics.md"]'), 20000)
await sleep(2000)
await shot('54-library-wiki')
await tap(win, $('[data-switch="memory"]'), { settle: 2000 })
await shot('55-library-memory')

// Menu, and from there the Cockpit (if it is still there) and Settings.
await dock('menu')
await sleep(1500)
await shot('56-menu')
const hasCockpit = await exists('[data-menu="cockpit"]')
console.log(`  menu has cockpit: ${hasCockpit}`)
if (hasCockpit) {
  await tap(win, $('[data-menu="cockpit"]'), { settle: 2500 })
  await shot('57-cockpit')
  await dock('menu')
  await sleep(1200)
}
const chatsOnRail = await exists('[data-rail="chats"], [aria-label="Chats"]')
console.log(`  stage rail shows Chats: ${chatsOnRail}`)
if (await tap(win, $('[data-menu="settings"]'), { settle: 2500 })) await shot('58-settings')

// The terminal, floating.
await dock('overview')
await dock('terminal')
if (await tap(win, $('[data-testid="terminal-float-btn"]'), { settle: 1500 })) await shot('59-terminal-float')

await app.close()
console.log(`\n${shots.length} screenshots in ${IMG}: ${shots.join(', ')}`)
