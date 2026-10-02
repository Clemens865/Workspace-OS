// Phase Q — PowerPoint speaker notes: per-slide presenter notes persist into the
// .pptx (ppt/notesSlides/notesSlideN.xml). Proven against the REAL engine — set
// notes via the macro/IPC path (WosSetNotes), save via window.workspace.lok.save,
// unzip the saved .pptx and assert the note text is in the notes part + the slide
// carries a notesSlide relationship. Also: set→get round-trip, 2nd-slide notes
// independent. Unit tests / ok:true are NOT proof — this reads the saved bytes.
import * as H from './_harness.mjs'
import { execSync } from 'child_process'
import path from 'path'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const r = H.makeReporter('PHASE Q — PowerPoint speaker notes')
if (!H.enginePresent()) { console.log('SKIP: engine/host missing'); process.exit(0) }

const NOTE1 = 'Open with the Q3 revenue beat and thank the team'
const NOTE2 = 'Deep dive: churn dropped two points after the redesign'

// All notesSlide parts concatenated — the notes are numbered by creation order,
// not slide order, so we test membership across the whole notesSlides directory.
const allNotesXml = (file) => {
  try {
    const names = execSync(`unzip -Z1 '${file}' 'ppt/notesSlides/notesSlide*.xml'`, { encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean)
    return names.map((n) => { try { return execSync(`unzip -p '${file}' '${n}'`, { encoding: 'utf8' }) } catch { return '' } }).join('\n')
  } catch { return '' }
}
const notesSlide1Xml = () => { try { return execSync(`unzip -p '${file}' ppt/notesSlides/notesSlide1.xml`, { encoding: 'utf8' }) } catch { return '' } }
// The slide→notesSlide relationship: slide1's rels must reference a notesSlide.
const slide1RelsHasNotes = () => {
  try { return /notesSlide/i.test(execSync(`unzip -p '${file}' ppt/slides/_rels/slide1.xml.rels`, { encoding: 'utf8' })) } catch { return false }
}

const setNotes = (idx, text) => win.evaluate(({ idx, text }) => window.workspace.lok.setNotes(idx, text), { idx, text })
const getNotes = (idx) => win.evaluate((idx) => window.workspace.lok.getNotes(idx), idx)
const saveEngine = () => win.evaluate(() => window.workspace.lok.save())

// Impress cold-boot can wedge mid-render (~1/3 runs — a documented throughput
// limit, not a bug). A lone wedged launch is not a failure: retry the whole
// launch + fresh-deck creation a few times before giving up.
let app, win, created
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    ;({ app, win } = await H.launch())
    created = await H.newDoc(win, 'PowerPoint')
    break
  } catch (e) {
    console.log(`  [boot] attempt ${attempt} wedged (${String(e.message).split('\n')[0]}); retrying…`)
    try { await app?.close() } catch { /* */ }
    app = undefined; win = undefined
  }
}
if (!win) { console.log('  ✗ engine never booted a fresh deck after 4 attempts'); process.exit(1) }

// Persist the deck BEFORE the first notes insert (save-storm caveat: keep the
// e2e to a few saves and get the file on disk early).
await saveEngine()

// Resolve the REAL saved path from the engine — the app may auto-increment the
// filename ("New Presentation 2.pptx") if a same-named file lingered, so never
// trust the nominal newDoc path for the unzip assertions.
const info = await win.evaluate(() => window.workspace.lok.fileInfo()).catch(() => null)
const fileName = info?.name || path.basename(created)
const file = path.join(path.dirname(created), fileName)
console.log(`  [file] asserting against ${file}`)

// Add a 2nd slide so we can prove per-slide independence, then persist.
await win.getByTitle('New slide').click()
await H.poll(async () => (await win.evaluate(() => document.querySelectorAll('[data-slide-tab], [class*=partActive], [class*=partTab]').length)) >= 2)
await saveEngine()

// --- Set notes on slide 1 (index 0) via the macro/IPC path ---
const set1ok = await setNotes(0, NOTE1)
r.ok(set1ok === true, 'WosSetNotes returns ok for slide 1')

// --- Round-trip: read it straight back from the engine (before any save) ---
const rt = await getNotes(0)
r.ok((rt?.text ?? '') === NOTE1, `set→get round-trip returns the note text (got: "${(rt?.text ?? '').slice(0, 40)}")`)

// --- Set notes on slide 2 (index 1) — must be independent of slide 1 ---
await setNotes(1, NOTE2)
const rt2 = await getNotes(1)
r.ok((rt2?.text ?? '') === NOTE2, 'slide 2 notes read back independently')
// Slide 1's notes must NOT have been overwritten by the slide-2 set.
const rt1again = await getNotes(0)
r.ok((rt1again?.text ?? '') === NOTE1, "slide 2's notes did not clobber slide 1's")

await H.shot(win, 'Q-notes-set')

// --- Persist and assert against the SAVED .pptx bytes ---
const persisted = await H.poll(async () => { await saveEngine(); return allNotesXml(file).includes(NOTE1) }, { timeout: 12000 })
r.ok(persisted, 'slide-1 note text persists in ppt/notesSlides/*.xml of the saved .pptx')
r.ok(allNotesXml(file).includes(NOTE2), 'slide-2 note text also persists in the saved notesSlides')
r.ok(notesSlide1Xml().length > 0, 'ppt/notesSlides/notesSlide1.xml exists in the saved deck')
r.ok(slide1RelsHasNotes(), 'slide1 carries a notesSlide relationship (slide→notesSlide rel)')

// --- Reopen the saved file in the engine and confirm the note survived a full
// close→reopen round-trip (read straight from the freshly-loaded document). ---
await win.evaluate(() => window.workspace.lok.close()).catch(() => {})
await win.waitForTimeout(400)
await win.evaluate((p) => window.workspace.lok.open(p), file)
await win.waitForTimeout(800)
const afterReopen = await H.poll(async () => {
  const n = await getNotes(0)
  return (n?.text ?? '') === NOTE1 ? n : false
}, { timeout: 10000 })
r.ok(afterReopen && afterReopen.text === NOTE1, 'note text survives close→reopen of the .pptx')

await app.close()
process.exit(r.done() ? 0 : 1)
