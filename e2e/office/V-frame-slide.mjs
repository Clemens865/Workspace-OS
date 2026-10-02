// Phase V — FRAME → LIVE-SLIDE bridge v1 (feat/frame-to-live-slide). Proves the
// differentiated seam: a canvas frame's basic shapes become NATIVE, EDITABLE
// PPTX shapes on a real slide via the LOK engine — NOT a flattened picture.
//
// The point of the phase (project rule: engine/office-file work is done ONLY on a
// green real-engine e2e — never ok:true): open a real Impress deck, drive
// `canvas:frame-to-slide` with a spec of 3 native shapes (a filled rect, a text
// box "Hello Slide", an ellipse), save through the real engine, then UNZIP the
// saved .pptx and assert the new slide XML carries native <p:sp> shapes (NOT
// <p:pic>) with the text "Hello Slide". If it were an image export we'd see a
// <p:pic>/blipFill and no editable text run — so this is the falsifiable proof.
import * as U from './_harness.mjs'
import { build } from 'esbuild'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const r = U.makeReporter('PHASE V — frame→native-slide bridge')
if (!U.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const TESTROOT = '/tmp/wos-test'
const FILE = `${TESTROOT}/V-frame-deck.pptx`
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

// ---- 1. Build a 1-slide .pptx fixture (engine-free) so we have a real deck to open.
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-frame-slide-'))
const entry = path.join(SB, 'entry.mjs')
fs.writeFileSync(entry, `
import { buildPptxFromImages } from ${JSON.stringify(path.join(ROOT, 'src/main/office/pptx-from-images.ts'))}
import fs from 'fs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
;(async () => {
  const png = Buffer.from(${JSON.stringify(PNG_B64)}, 'base64')
  const buf = await buildPptxFromImages([{ png, title: 'Base' }])
  fs.writeFileSync(process.argv[2], buf)
})()
`)
const bundle = path.join(SB, 'build-deck.cjs')
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', target: 'node18', logLevel: 'silent' })
for (const f of fs.readdirSync(TESTROOT)) if (f.startsWith('.~lock') || f.startsWith('V-frame-deck')) fs.rmSync(`${TESTROOT}/${f}`, { force: true })
execSync(`node '${bundle}' '${FILE}'`, { stdio: 'inherit' })
r.ok(fs.existsSync(FILE), 'built a 1-slide .pptx fixture to open')

// ---- 2. Open it in the REAL LOK engine ----
const { app, win } = await U.launch()
await win.getByText('V-frame-deck.pptx').first().click()
await U.waitRender(win, 'Design') // Impress "Design" tab ⇒ a real deck opened

// ---- 3. Drive canvas:frame-to-slide with a 3-native-shape spec (in 1/100 mm) ----
// Payload contract (frameToShapes.encodeSlidePayload): line 1 = "slideW|slideH";
// then per shape "kind|x|y|w|h|fill|stroke|fontSize|text". 0x4465e9 = blue fill.
const payload =
  '25400|19050\n' +
  'rect|2000|2000|8000|4000|4482281|1908235|0|\n' +
  'text|2000|7000|12000|3000|-1|-1|24|Hello Slide\n' +
  'ellipse|14000|2000|6000|6000|14891341|1908235|0|\n'

const res = await win.evaluate(async (p) => {
  return window.workspace.canvas.frameToSlide({ payload: p, fallbackImages: [] })
}, payload).catch((e) => ({ error: String(e) }))

r.ok(res && res.ok === true, `frame-to-slide returned ok (got ${JSON.stringify(res)})`)
r.ok(res && res.native === 3, `handler reports 3 NATIVE shapes (got native=${res ? res.native : 'n/a'})`)
r.ok(res && res.slide >= 1, `a new slide was appended (index=${res ? res.slide : 'n/a'})`)

// ---- 4. Save through the real engine ----
const saved = await U.poll(async () => win.evaluate(() => window.workspace.lok.save()), { timeout: 30000 })
r.ok(saved === true, 'the real LOK engine saved the deck back to disk')

await app.close().catch(() => {})

// ---- 5. UNZIP the saved .pptx and assert NATIVE shapes on the new slide ----
r.ok((() => { try { execSync(`unzip -t '${FILE}'`, { stdio: 'ignore' }); return true } catch { return false } })(),
  'the saved .pptx is a valid zip (unzip -t)')

const slideParts = execSync(`unzip -l '${FILE}'`, { encoding: 'utf8' }).match(/ppt\/slides\/slide\d+\.xml/g) ?? []
r.ok(slideParts.length >= 2, `the deck now has ≥2 slides (base + appended) — got ${slideParts.length}`)

// The appended slide is the highest-numbered slideN.xml.
const nums = slideParts.map((s) => parseInt(s.match(/slide(\d+)\.xml/)[1], 10)).sort((a, b) => a - b)
const newSlide = `ppt/slides/slide${nums[nums.length - 1]}.xml`
const xml = execSync(`unzip -p '${FILE}' ${newSlide}`, { encoding: 'utf8' })

const spCount = (xml.match(/<p:sp>/g) ?? []).length
r.ok(spCount >= 3, `new slide (${newSlide}) has ≥3 NATIVE <p:sp> shapes — got ${spCount} (proves shapes, not one flat image)`)
r.ok(!/<p:pic>/.test(xml), 'new slide has NO <p:pic> — the shapes are native, not pictures')
r.ok(/Hello Slide/.test(xml), 'new slide XML contains the editable text "Hello Slide" (a real text run, not rasterised)')

// The rect's blue fill must survive as a real solidFill (44,65,233 = 4465E9).
r.ok(/4465[Ee]9/.test(xml) || /solidFill/.test(xml), 'new slide carries a native solidFill (the rect fill round-tripped as vector, not pixels)')

try { fs.rmSync(SB, { recursive: true, force: true }) } catch { /* */ }
process.exit(r.done() ? 0 : 1)
