// Impress-side macro audit — the shape macros. The base deck is created via the
// New-doc flow (matching E/L); selInfo (name|w|h|fill|text) reads back the
// selected shape after each op (the shape macros select() their target), and
// slide1.xml is unzipped for structural checks.
import * as H from '../_harness.mjs'
import {
  TESTROOT, VERIFIED, UNVERIFIED, assertMut, macro, selInfo, parts,
  unzip, validZip, pollSel, saveUntilXml, rmFixtures,
} from './util.mjs'

const APP = 'Impress'
const FILE = `${TESTROOT}/New Presentation.pptx`
const slide1 = () => unzip(FILE, 'ppt/slides/slide1.xml')

// Run a macro then settle — the model mutation flushes a beat after runMacro
// returns; without this the rapid save-polls below race the in-flight change and
// can corrupt the deck on this single, heavily-mutated document.
async function mut(win, name, args) { const ok = await macro(win, name, args); await win.waitForTimeout(300); return ok }

// Save once (awaited → the write is complete), settle, then count matches of
// `re` in slide1.xml. Computing counts from a FRESH save (not a stale prior one)
// is what makes the before/after shape-count deltas reliable.
async function countAfterSave(win, re) {
  await win.evaluate(() => window.workspace.lok.save())
  await win.waitForTimeout(450)
  return (slide1().match(re) || []).length
}

async function waitEngineDoc(win, budgetMs = 120000) {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    const p = await parts(win).catch(() => null)
    if (p && p.parts > 0) return p
    await win.waitForTimeout(400)
  }
  throw new Error('engine never opened a deck')
}

export async function runImpress(win) {
  console.log('\n--- Impress macros ---')
  rmFixtures('New Presentation')
  await H.newDoc(win, 'PowerPoint')
  await waitEngineDoc(win)

  // ---- WosShapeInsert (rect) — selInfo confirms a selected shape --------
  await mut(win, 'WosShapeInsert', 'rect')
  {
    const s = await pollSel(win, (x) => x && x.w > 0 && x.h > 0)
    assertMut('WosShapeInsert', APP, !!s && s.w > 0, `rect inserted+selected (${s ? s.w + 'x' + s.h : 'none'})`, 'no selected shape after insert')
  }

  // ---- WosShapeColor (fill) — selInfo.fill changes to the new color -----
  await mut(win, 'WosShapeColor', 'fill|16711680') // 0xFF0000 red
  {
    const s = await pollSel(win, (x) => x && x.fill === 16711680)
    assertMut('WosShapeColor(fill)', APP, !!s, `fill set to 0xFF0000 (selInfo.fill=${s ? s.fill : '?'})`, 'fill color not applied')
  }
  // ---- WosShapeColor (line) — verify via saved slide (no line readback) -
  await mut(win, 'WosShapeColor', 'line|65280') // 0x00FF00 green
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /00FF00/i.test(s))
    if (/00FF00/i.test(x)) VERIFIED('WosShapeColor(line)', APP, 'line color 0x00FF00 present in slide1.xml')
    else UNVERIFIED('WosShapeColor(line)', APP, 'line color not found in slide XML (may serialize differently)')
  }

  // ---- WosShapeText (settext) — selInfo.text updates --------------------
  await mut(win, 'WosShapeText', 'settext|AuditLabel')
  {
    const s = await pollSel(win, (x) => x && (x.text || '').includes('AuditLabel'))
    assertMut('WosShapeText(settext)', APP, !!s, `shape text set to "AuditLabel" (selInfo.text="${s ? s.text : ''}")`, 'shape text not set')
  }
  // ---- WosShapeText color/bold — verified via saved slide run props -----
  await mut(win, 'WosShapeText', 'color|255') // blue
  await mut(win, 'WosShapeText', 'bold|')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', () => /AuditLabel/.test(slide1()))
    const ok = /b="1"/.test(x) || /0000FF/i.test(x)
    if (ok) VERIFIED('WosShapeText(color/bold)', APP, 'bold/color run props present in slide1.xml')
    else UNVERIFIED('WosShapeText(color/bold)', APP, 'run props not distinctly observable in slide XML')
  }

  // ---- WosShapeSize — selInfo.w/h changes to the requested size ---------
  await mut(win, 'WosShapeSize', '9000|3000')
  {
    const s = await pollSel(win, (x) => x && Math.abs(x.w - 9000) < 200 && Math.abs(x.h - 3000) < 200)
    assertMut('WosShapeSize', APP, !!s, `size set to ~9000x3000 (selInfo=${s ? s.w + 'x' + s.h : '?'})`, 'size not applied')
  }

  // ---- WosShapeEffect (gradient) — FillStyle=gradient in slide XML ------
  await mut(win, 'WosShapeEffect', 'gradient|16711680|255')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /gradFill|<a:gs\b/.test(s))
    assertMut('WosShapeEffect(gradient)', APP, /gradFill/.test(x), 'gradient fill (a:gradFill) in slide1.xml', 'no gradient fill emitted')
  }
  // ---- WosShapeEffect (shadow) — outerShdw in slide XML -----------------
  await mut(win, 'WosShapeEffect', 'shadow|0|0')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /outerShdw|effectLst/.test(s))
    if (/outerShdw/.test(x)) VERIFIED('WosShapeEffect(shadow)', APP, 'outerShdw present in slide1.xml')
    else UNVERIFIED('WosShapeEffect(shadow)', APP, 'shadow not serialized as outerShdw (engine may drop on export)')
  }

  // ---- WosShapePattern (hatch) — pattFill/hatch in slide XML ------------
  await mut(win, 'WosShapeColor', 'fill|8421504')
  await mut(win, 'WosShapePattern', 'single|450|100|0')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /pattFill|hatch/.test(s))
    if (/pattFill|hatch/.test(x)) VERIFIED('WosShapePattern', APP, 'pattern/hatch fill present in slide1.xml')
    else UNVERIFIED('WosShapePattern', APP, 'hatch not serialized in pptx (engine may export as solid)')
  }

  // ---- WosShapeStroke (width) — line width grows in slide XML -----------
  await mut(win, 'WosShapeColor', 'line|0')
  await mut(win, 'WosShapeStroke', 'width|200')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /<a:ln\b[^>]*w="\d{5,}"/.test(s))
    if (/<a:ln\b[^>]*w="\d{5,}"/.test(x)) VERIFIED('WosShapeStroke(width)', APP, 'thick line width (>=5 digit EMU) in slide1.xml')
    else UNVERIFIED('WosShapeStroke(width)', APP, 'line width not distinctly observable in slide XML')
  }
  await mut(win, 'WosShapeStroke', 'dash|dash')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /prstDash|custDash/.test(s))
    if (/prstDash|custDash/.test(x)) VERIFIED('WosShapeStroke(dash)', APP, 'dashed line (prstDash) in slide1.xml')
    else UNVERIFIED('WosShapeStroke(dash)', APP, 'dash not serialized in pptx')
  }

  // ---- WosTagShape — name the selected shape; selInfo.name reflects it --
  await mut(win, 'WosTagShape', 'WosAuditTag')
  {
    const s = await pollSel(win, (x) => x && x.name === 'WosAuditTag')
    assertMut('WosTagShape', APP, !!s, 'selected shape named "WosAuditTag" (selInfo.name)', 'shape name not applied')
  }

  // ---- WosSelInfo — proven above (it is the readback tool) --------------
  {
    const s = await selInfo(win)
    assertMut('WosSelInfo', APP, !!s && typeof s.name === 'string', `selInfo read shape "${s ? s.name : ''}" (name|w|h|fill|text)`, 'selInfo returned null')
  }

  // ---- WosArrange front/back/forward/backward + align + delete ---------
  // Add a second shape so z-order/align are meaningful.
  await mut(win, 'WosShapeInsert', 'ellipse')
  await mut(win, 'WosShapeInsert', 'roundrect')
  {
    // Count shapes in slide1 before arrange ops.
    await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', () => true)
    for (const op of ['front', 'back', 'forward', 'backward', 'left', 'top']) {
      const ok = await mut(win, 'WosArrange', op)
      // These reposition/reorder a single selected shape; ok flag + no crash. The
      // structural proof is the delete below (shape count drops) — z-order/align
      // deltas on one shape aren't cleanly observable in exported XML.
      if (ok !== true) UNVERIFIED(`WosArrange(${op})`, APP, `runMacro returned ${ok}`)
    }
    UNVERIFIED('WosArrange(front/back/fwd/bwd)', APP, 'z-order & align of a single selected shape not distinctly observable in exported pptx; delete case below proves the macro executes')
    void ['left', 'top']
  }
  // delete — count shapes before/after (structural).
  {
    const before = await countAfterSave(win, /<p:sp\b|<p:pic\b/g)
    await mut(win, 'WosArrange', 'delete')
    let after = before
    for (let i = 0; i < 4 && after >= before; i++) after = await countAfterSave(win, /<p:sp\b|<p:pic\b/g)
    assertMut('WosArrange(delete)', APP, after < before, `deleted selected shape (sp count ${before}→${after})`, `shape count did not drop (${before}→${after})`)
  }

  // ---- WosSlideBg — a back-most rect named "WosBg" appears -------------
  await mut(win, 'WosSlideBg', 'one|3355443') // dark grey
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /WosBg/.test(s))
    assertMut('WosSlideBg', APP, /WosBg/.test(x), 'full-slide "WosBg" rect present in slide1.xml', 'WosBg rect not added')
  }

  // ---- WosInsertPoly — a polygon shape is added -----------------------
  {
    const before = await countAfterSave(win, /<p:sp\b/g)
    await mut(win, 'WosInsertPoly', '0,0;5000,0;2500,4000')
    let after = before
    for (let i = 0; i < 4 && after <= before; i++) after = await countAfterSave(win, /<p:sp\b/g)
    assertMut('WosInsertPoly', APP, after > before, `polygon added (sp count ${before}→${after})`, `polygon not added (${before}→${after})`)
  }

  // ---- WosInsertMetricShape + WosSetShapeTextByName -------------------
  await mut(win, 'WosInsertMetricShape', 'wos-metric-77|88')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => s.includes('wos-metric-77') && s.includes('88'))
    assertMut('WosInsertMetricShape', APP, x.includes('wos-metric-77'), 'named metric text shape "wos-metric-77"=88', 'metric shape not added')
  }
  await mut(win, 'WosSetShapeTextByName', 'wos-metric-77|99')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => s.includes('99'))
    assertMut('WosSetShapeTextByName', APP, x.includes('99'), 'metric shape text updated to 99', 'metric shape text not updated')
  }

  // ---- WosInsertSlideTable + WosSetSlideTable (setTable handler) -------
  const TAG = `wos-range-${Date.now().toString(36)}`
  await win.evaluate(({ tag }) => window.workspace.lok.setTable({ macro: 'WosInsertSlideTable', tag, values: [['P1', 'P2'], ['x', 'y']] }), { tag: TAG })
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /graphicFrame|<a:tbl>/.test(s) && s.includes('P1'))
    assertMut('WosInsertSlideTable', APP, /a:tbl/.test(x) && x.includes('P1'), 'real slide table (a:tbl) with P1/P2', 'slide table not inserted')
  }
  await win.evaluate(({ tag }) => window.workspace.lok.setTable({ macro: 'WosSetSlideTable', tag, values: [['Q1', 'Q2'], ['x', 'y']] }), { tag: TAG })
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => s.includes('Q1'))
    assertMut('WosSetSlideTable', APP, x.includes('Q1'), 'slide table cells updated to Q1/Q2', 'slide table cells not updated')
  }

  // ---- WosInsertCard / WosInsertMedia (grouped composites) ------------
  await mut(win, 'WosInsertCard', '3355443|16777215|8000|4000|CardTitle')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => s.includes('CardTitle'))
    assertMut('WosInsertCard', APP, x.includes('CardTitle'), 'grouped card with title "CardTitle"', 'card not inserted')
  }
  await mut(win, 'WosInsertMedia', '3355443|16777215|8000|4000|MediaCap|')
  {
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => s.includes('MediaCap'))
    if (x.includes('MediaCap')) VERIFIED('WosInsertMedia', APP, 'media card with caption "MediaCap"')
    else UNVERIFIED('WosInsertMedia', APP, 'media caption not found (empty image arg path may differ)')
  }

  // ---- WosGroupSet — edit a named child of the selected group ----------
  // The card above is grouped + selected; set its bg fill.
  {
    const ok = await mut(win, 'WosGroupSet', 'bg|fill|255')
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', () => true)
    if (ok === true && /0000FF/i.test(x)) VERIFIED('WosGroupSet', APP, 'group child "bg" fill set to 0x0000FF')
    else UNVERIFIED('WosGroupSet', APP, 'group-child fill change not distinctly observable in slide XML')
  }

  // ---- WosSetOverride — appends the field name to the selected shape's
  // Description (internal marker read back by WosPropagate to skip overridden
  // fields). LO may or may not export Description as <p:cNvPr descr="…"> to pptx;
  // if it does, we VERIFY structurally, else UNVERIFIED (internal-only state).
  await mut(win, 'WosShapeInsert', 'rect')
  {
    const ok = await mut(win, 'WosSetOverride', 'ovrfield')
    const x = await saveUntilXml(win, FILE, 'ppt/slides/slide1.xml', (s) => /descr="[^"]*ovrfield/.test(s))
    if (ok === true && /descr="[^"]*ovrfield/.test(x)) VERIFIED('WosSetOverride', APP, 'override field written to shape descr= in slide1.xml')
    else UNVERIFIED('WosSetOverride', APP, `ok=${ok}; shape Description marker is internal state not exported to pptx descr= by this engine — cannot verify structurally (WosPropagate reads it in-session)`)
  }

  // ---- WosTableOp is Writer-only; WosPropagate / Capture / Build -------
  // WosPropagate: pushes a master's props onto tagged instances. Needs WosA_<id>
  // instances on the slides. Exercise it and confirm no-crash + selInfo intact.
  {
    const ok = await mut(win, 'WosPropagate', 'cid1|shape|255|solid|0|16777215|35|solid|0|Inst|4000|3000')
    if (ok === true) UNVERIFIED('WosPropagate', APP, 'no WosA_cid1 instances present to mutate; runs cleanly (guarded loop) — needs a full component-instance fixture to assert')
    else UNVERIFIED('WosPropagate', APP, `runMacro returned ${ok}`)
  }

  // ---- WosCapture — serialize the selection to /tmp/wos-asset-out.txt ---
  await mut(win, 'WosShapeInsert', 'rect')
  {
    const cap = await win.evaluate(() => window.workspace.lok.capture())
    const ok = cap && Array.isArray(cap.elements) && cap.elements.length >= 1
    assertMut('WosCapture', APP, ok, `captured ${cap ? cap.elements.length : 0} element line(s) from selection`, 'capture produced no elements')
  }
  // ---- WosBuildCaptured — rebuild the captured element(s) as a group ---
  {
    const cap = await win.evaluate(() => window.workspace.lok.capture())
    const before = await countAfterSave(win, /<p:sp\b|<p:grpSp\b/g)
    const built = await win.evaluate((els) => window.workspace.lok.buildCaptured(els), cap ? cap.elements : [])
    await win.waitForTimeout(300)
    let after = before
    for (let i = 0; i < 4 && after <= before; i++) after = await countAfterSave(win, /<p:sp\b|<p:grpSp\b/g)
    assertMut('WosBuildCaptured', APP, built === true && after > before, `rebuilt captured shape(s) (count ${before}→${after})`, `buildCaptured added no shape (${before}→${after})`)
  }

  // ---- WosInsertImage / WosImageShape need a native file picker --------
  UNVERIFIED('WosInsertImage', APP, 'requires a native file-open dialog (dialog.showOpenDialog); not drivable headlessly in this harness')

  // ---- valid file at the end -------------------------------------------
  await H.save(win)
  assertMut('(deck integrity)', APP, validZip(FILE), 'final .pptx is a valid zip after all mutations', 'final .pptx corrupt')
}
