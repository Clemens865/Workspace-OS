// Phase U — CANVAS → DECK bridge v1 (feat/canvas-to-pptx). Proves the engine-free
// builder produces a REAL, office-valid .pptx: build a 3-image deck with
// buildPptxFromImages, write it into the workspace, OPEN it in the real LOK
// engine (via the tree), and assert the engine SEES 3 slides + the file is a
// valid zip. This is the point of the phase — structural plausibility isn't
// enough; only the real engine opening it proves the OOXML is valid.
//
// The builder imports only jszip (no electron / no LibreOffice), so we bundle it
// with esbuild and run it in plain node to synthesise the fixture, then drive the
// real app to open it.
import * as U from './_harness.mjs'
import { build } from 'esbuild'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const r = U.makeReporter('PHASE U — canvas→pptx bridge')
if (!U.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const TESTROOT = '/tmp/wos-test'
const FILE = `${TESTROOT}/U-canvas-deck.pptx`
const validPptx = () => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } }
const slidePartCount = () => {
  try { return execSync(`unzip -l '${FILE}'`, { encoding: 'utf8' }).match(/ppt\/slides\/slide\d+\.xml/g)?.length ?? 0 } catch { return 0 }
}

// A tiny real 1×1 PNG so each slide references genuine media bytes.
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ---- 1. Build a 3-image .pptx with buildPptxFromImages (engine-free) ----
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-canvas-pptx-'))
const entry = path.join(SB, 'entry.mjs')
fs.writeFileSync(entry, `
import { buildPptxFromImages } from ${JSON.stringify(path.join(ROOT, 'src/main/office/pptx-from-images.ts'))}
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
// async IIFE — the bundle is CJS (top-level await isn't allowed there).
;(async () => {
  const png = Buffer.from(${JSON.stringify(PNG_B64)}, 'base64')
  const buf = await buildPptxFromImages([
    { png, title: 'One' },
    { png, title: 'Two' },
    { png, title: 'Three' },
  ])
  fs.writeFileSync(process.argv[2], buf)
})()
`)
const bundle = path.join(SB, 'build-deck.cjs')
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node18', logLevel: 'silent' })

for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith('.~lock') || f.startsWith('U-canvas-deck')) fs.rmSync(`${TESTROOT}/${f}`, { force: true })
execSync(`node '${bundle}' '${FILE}'`, { stdio: 'inherit' })

r.ok(fs.existsSync(FILE), 'buildPptxFromImages wrote a .pptx to disk')
r.ok(validPptx(), 'the generated .pptx is a valid zip (unzip -t)')
r.ok(slidePartCount() === 3, `the deck has 3 slide parts on disk (got ${slidePartCount()})`)

// ---- 2. Open it in the REAL LOK engine and assert the engine sees 3 slides ----
const { app, win } = await U.launch()
await win.getByText('U-canvas-deck.pptx').first().click()
await U.waitRender(win, 'Design') // Impress "Design" ribbon tab ⇒ a deck really opened

let parts = null
const deadline = Date.now() + 120000
while (Date.now() < deadline) {
  parts = await win.evaluate(() => window.workspace.lok.parts()).catch(() => null)
  if (parts && parts.parts > 0) break
  await win.waitForTimeout(400)
}

r.ok(!!parts, 'the LOK engine OPENED the generated deck (parts query returned)')
r.ok(parts && parts.parts === 3, `the ENGINE sees exactly 3 slides in the deck (engine reported parts=${parts ? parts.parts : 'n/a'})`)

await app.close().catch(() => {})
try { fs.rmSync(SB, { recursive: true, force: true }) } catch { /* */ }
process.exit(r.done() ? 0 : 1)
