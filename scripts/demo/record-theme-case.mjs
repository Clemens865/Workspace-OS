#!/usr/bin/env node
/**
 * A second take: a case with its documents, Markdown opened as source, split
 * and rendered, and the switch from light to dark (and back) across the app.
 * Same rules as record-tour.mjs: the real app, one continuous take, a visible
 * pointer, a demo workspace and a scratch profile.
 *
 *   npm run build && node scripts/demo/record-theme-case.mjs   →  build/demo/workspace-os-theme-case.mp4
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { hideCursor } from './stagecraft.mjs'
import { ROOT, WS, dockTo, launch, point, seed, sleep, tap, until } from './tour-kit.mjs'

const OUT = path.join(ROOT, 'build', 'demo')
const RAW = path.join(OUT, 'theme-case-raw')
fs.rmSync(RAW, { recursive: true, force: true })
fs.mkdirSync(RAW, { recursive: true })
seed()

// The case's documents: Markdown with what rendering is for (headings, a table, a checklist, a quote, code).
const doc = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(WS, rel)), { recursive: true })
  fs.writeFileSync(path.join(WS, rel), text)
}
doc('Cases/Northwind/Contract summary.md', `# Northwind offer — summary

**Role:** Senior Product Manager, *Waypoint* routing platform
**Reports to:** Anna Berg, Head of Product
**Decide by:** 30 September 2026

## Terms

| Item | Offer | Market | Note |
|---|---|---|---|
| Salary | EUR 120,000 | EUR 115–125k | in range |
| Start | 1 March 2027 | — | could move to April |
| Remote | 2 days a week | 3 days | ask for 3 |
| Notice | 3 months | 3 months | fine |

## Before signing

- [x] Read the offer letter
- [x] Compare the salary with the market
- [ ] Ask about the remote days
- [ ] Confirm the start date

> "We would love to have you on the team by spring." — Anna Berg

## Counter-offer, draft

\`\`\`text
Salary   EUR 128,000
Remote   3 days a week
Start    1 April 2027
\`\`\`
`)
doc('Cases/Northwind/Risks.md', `# Risks

1. **Start date.** The Waypoint team is only complete in April; starting in March means a month without a team.
2. **Remote days.** Two days is below what Contoso offers.
3. **Scope.** The role description mentions *two* platforms; the letter names one.

---

*Next:* raise all three in the call with Anna on Thursday.
`)

const t0 = Date.now()
const { app, win } = await launch(RAW)
const $ = (sel) => win.locator(sel)
const dock = (id) => dockTo(win, id)

// The case, with its documents and a few notes, made before the take starts.
await win.evaluate(async (ws) => {
  const c = await window.workspace.cases.create({ title: 'Northwind contract review', type: 'task', description: 'Read the offer and decide by 30 September; prepare the counter-offer.' })
  for (const f of ['Cases/Northwind/Contract summary.md', 'Cases/Northwind/Risks.md']) await window.workspace.cases.addArtifact(c.id, `${ws}/${f}`)
  await window.workspace.cases.addNote(c.id, 'Read the offer letter; terms are in the summary.', 'you')
  await window.workspace.cases.addNote(c.id, 'Compared the salary with the market: in range. Remote days are the gap.', 'agent')
  await window.workspace.cases.addNote(c.id, 'Drafted the counter-offer in the summary.', 'agent')
}, WS)
await sleep(1200)
const startAt = (Date.now() - t0) / 1000

/** Holds until the rendered preview shows its text (its frame starts up on first use), then a beat more. */
async function renderedPreview() {
  const ok = await until(async () => {
    const fr = await win.$('[class*="mdPreviewPane"] iframe')
    const f = fr && (await fr.contentFrame())
    return !!f && (await f.evaluate(() => document.body.innerText.trim().length > 20))
  }, 8000)
  if (!ok)
    console.log('  preview stayed empty:', JSON.stringify(await win.evaluate(() => {
      const panes = [...document.querySelectorAll('[class*="mdPreviewPane"]')]
      return panes.map((p) => ({ visible: p.offsetWidth > 0, frames: p.querySelectorAll('iframe').length, srcdoc: (p.querySelector('iframe')?.getAttribute('srcdoc') || '').length, text: p.innerText.slice(0, 80) }))
    })))
  await sleep(2500)
}

/** The case, its documents, and one opened as source, split and rendered. */
async function caseAndMarkdown(full) {
  await dock('cases')
  await tap(win, $('[data-case]').filter({ hasText: 'Northwind contract review' }), { settle: 1500 })
  await sleep(1200)
  if (full) {
    await tap(win, $('[data-testid="case-open"] [data-tab="files"]'), { settle: 1500 })
    await tap(win, $('[data-testid="case-open"] [data-tab="notes"]'), { settle: 1500 })
    await tap(win, $('[data-testid="case-open"] [data-tab="overview"]'), { settle: 900 })
  }
  await tap(win, $('[data-testid="case-open"] button').filter({ hasText: 'Contract summary.md' }), { settle: 2200 })
  if (full) {
    await point(win, $('.monaco-editor').first(), { dy: -40 })
    await sleep(1500)
  }
  await tap(win, $('button[title="Split (editor + preview)"]'), { settle: 300 })
  await renderedPreview()
  await tap(win, $('button[title="Preview (live values)"]'), { settle: 300 })
  await renderedPreview()
  if (full) {
    // The second document, rendered.
    await dock('cases')
    await tap(win, $('[data-testid="case-open"] button').filter({ hasText: 'Risks.md' }), { settle: 1800 })
    await tap(win, $('button[title="Preview (live values)"]'), { settle: 300 })
    await renderedPreview()
    if (process.env.WOS_SHOT_DIR) await win.screenshot({ path: path.join(process.env.WOS_SHOT_DIR, 'risks-preview.png') })
    if (process.env.WOS_DIAG)
      console.log('  panes:', JSON.stringify(await win.evaluate(async () => {
        const out = []
        for (const p of document.querySelectorAll('[class*="mdPreviewPane"]')) {
          const fr = p.querySelector('iframe')
          const r = fr?.getBoundingClientRect()
          out.push({ visible: p.offsetWidth > 0, frame: r && [Math.round(r.width), Math.round(r.height)], srcdoc: (fr?.getAttribute('srcdoc') || '').slice(-200), text: fr?.contentDocument?.body?.innerText?.slice(0, 60) ?? null })
        }
        return out
      })))
  }
}

// ── light ──
console.log('take: light')
await point(win, $('[data-testid="landscape-dock"]'), { dy: -300 })
await sleep(1500)
await caseAndMarkdown(true)

// ── to dark, in Settings ──
console.log('take: to dark')
await dock('menu')
await tap(win, $('[data-menu="settings"]'), { settle: 1800 })
await point(win, $('[data-testid="theme-light"]'))
await sleep(800)
await tap(win, $('[data-testid="theme-dark"]'), { settle: 2500 })
// Settings is a dialog over the stage: close it, or the next click only closes it.
await win.keyboard.press('Escape')
await sleep(700)

// ── dark, across the app ──
console.log('take: dark')
await caseAndMarkdown(false)
await dock('overview')
await sleep(2000)
await dock('chat')
await sleep(1500)
await dock('apps')
await sleep(800)
await tap(win, $('[data-testid="apps-add-hairline"]'), { settle: 3000 })
await tap(win, $('[data-testid="apps-back"]'), { settle: 1200 })
await dock('library')
await sleep(1800)

// ── and back to light ──
console.log('take: back to light')
await dock('menu')
await tap(win, $('[data-menu="settings"]'), { settle: 1500 })
await tap(win, $('[data-testid="theme-light"]'), { settle: 2000 })
await win.keyboard.press('Escape')
await sleep(700)
await dock('overview')
await hideCursor(win)
await sleep(1500)

const video = win.video()
await app.close()
const out = path.join(OUT, 'workspace-os-theme-case.mp4')
const r = spawnSync('ffmpeg', ['-y', '-ss', String(Math.max(0, startAt - 0.3)), '-i', await video.path(), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { encoding: 'utf8' })
if (r.status !== 0) {
  console.error(r.stderr.slice(-1500))
  process.exit(1)
}
const dur = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }).stdout.trim()
console.log(`\n${out}  (${Math.round(Number(dur))} s, ${Math.round(fs.statSync(out).size / 1e6)} MB)`)
