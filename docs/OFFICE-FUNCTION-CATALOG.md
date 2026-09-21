# Office Function Catalog & Build Roadmap

The standard: feature parity with the everyday surface of **Word / Excel /
PowerPoint** (and their LibreOffice equivalents Writer / Calc / Impress), built
**one function at a time**, each one wired into the UI and proven by an **e2e
test with screenshots**.

## 1. Why this is tractable

We drive LibreOffice through **LOKit UNO commands**. Almost every menu item in
Office maps to a `.uno:Command` we can post to the engine. So most functions are
small units: surface a control → post a command → assert the visible result.

Build tiers (how much work each function is):
- **T1 — toggle/command**: one `.uno:` call, no args (Bold, Undo, AlignLeft). Button → command → test.
- **T2 — command + args**: font name/size, color, style, number format — a control feeding `postUnoCommand` JSON args.
- **T3 — needs a dialog**: insert table, page setup, find & replace. Either a custom Workspace-OS panel that posts UNO args, or render LibreOffice's own dialog via **LOKit JSDialog** (a sub-capability to build once, then reused).
- **T4 — panel + live state**: styles gallery, conditional formatting, track-changes, charts, animations — a side panel that reads engine state (via `getCommandValues` / `STATE_CHANGED` callbacks) and writes back.

## 2. UI integration model — what goes where

```
┌─ Title / breadcrumb ───────────────────────── [Save] [Export▾] [⋯] ┐
├─ RIBBON (tabbed, contextual per doc type) ─────────────────────────┤
│  Writer:  Home · Insert · Layout · References · Review · View       │
│  Calc:    Home · Insert · Formulas · Data · Layout · View           │
│  Impress: Home · Insert · Design · Transitions · Animate · View     │
├─ contextual mini-toolbar (on selection)  ──────────────────────────┤
│                                                          ┌─ right ─┐│
│   CANVAS (live LOKit tiles)                              │ panels  ││
│                                                          │ styles/ ││
│                                                          │ comments││
│                                                          │ design  ││
├─ status bar: page/sheet · word/cell count · zoom ──────────────────┤
│  Calc sheet tabs / Impress slide strip                             │
```

- **Ribbon** (tabbed toolbar) replaces today's single strip. Tabs and groups are
  contextual: Writer/Calc/Impress each get their own tab set. This is the MS
  "ribbon" / LibreOffice "notebookbar" model — scales to hundreds of commands.
- **Mini-toolbar**: a small floating bar on text/cell/object selection (font,
  size, B/I/U, color) for fast access.
- **Right panels** (toggleable): Styles, Comments/Review, Design/Themes,
  Animations, Conditional Formatting, Chart properties. Built on T4.
- **Status bar**: word count / cell ref / slide number, zoom, language.
- **File/Backstage**: New (✓), Open (✓), Save (✓), **Export ▾** (formats),
  Print, Document properties.
- **Backbone work** (prereqs that unlock many functions):
  - **B1. Ribbon scaffold** — the tabbed/grouped container + contextual switching.
  - **B2. Selection state sync** — reflect engine state on buttons (bold on/off,
    current style, font) via `STATE_CHANGED` + `getCommandValues`.
  - **B3. LOKit JSDialog bridge** — render the engine's own dialogs as tiles +
    forward input, unlocking every T3 dialog at once.
  - **B4. e2e harness** — `e2e/office/_harness.mjs`: open/new a doc, run an
    action, screenshot before/after, assert persisted result. Every function
    test uses it.

## 3. Definition of done (every function)

1. Control wired in its ribbon/panel location (per the map above).
2. Posts the correct `.uno:` command (with args if T2+).
3. **e2e test** that performs the action **in the UI** and:
   - asserts the visible/engine result (canvas change and/or persisted file),
   - captures a **before/after screenshot** into `e2e/office/shots/`.
4. tsc clean, unit tests green.

## 4. Catalog — Writer (Word)

| # | Function | Mechanism | UI place | Tier |
|---|---|---|---|---|
| Home / Font ||||
| | Bold / Italic / Underline | .uno:Bold/Italic/Underline | Home·Font | T1 ✅ |
| | Strikethrough / Sub / Superscript | .uno:Strikeout/SubScript/SuperScript | Home·Font | T1 |
| | Font family | .uno:CharFontName {args} | Home·Font | T2 |
| | Font size | .uno:FontHeight {args} | Home·Font | T2 |
| | Font color / highlight | .uno:Color / .uno:BackColor {args} | Home·Font | T2 |
| | Clear formatting | .uno:ResetAttributes | Home·Font | T1 |
| Home / Paragraph ||||
| | Align L/C/R/Justify | .uno:LeftPara/CenterPara/RightPara/JustifyPara | Home·Para | T1 |
| | Bulleted / numbered list | .uno:DefaultBullet / .uno:DefaultNumbering | Home·Para | T1 |
| | Indent increase/decrease | .uno:IncrementIndent/DecrementIndent | Home·Para | T1 |
| | Line spacing | .uno:SpacePara1/15/2 | Home·Para | T1 |
| | Borders & shading | .uno:SetBorderStyle / dialog | Home·Para | T3 |
| Home / Styles ||||
| | Heading/paragraph styles | .uno:StyleApply {args} | Home·Styles | T2 ✅ |
| | Style gallery / manage | StylesPanel | right panel | T4 |
| Insert ||||
| | Table | .uno:InsertTable (dialog) | Insert | T3 |
| | Image / from file | .uno:InsertGraphic | Insert | T3 |
| | Shape / text box | .uno:BasicShapes / .uno:DrawText | Insert | T2 |
| | Hyperlink | .uno:HyperlinkDialog | Insert | T3 |
| | Header / footer | .uno:InsertPageHeader/Footer | Insert | T2 |
| | Page / column break | .uno:InsertPagebreak | Insert | T1 |
| | Page number | .uno:InsertPageNumberField | Insert | T1 |
| | Special character | .uno:InsertSymbol | Insert | T3 |
| | Footnote / endnote | .uno:InsertFootnote | Insert | T2 |
| | Table of contents | .uno:InsertMultiIndex | Insert/Refs | T3 |
| Layout ||||
| | Margins / orientation / size | .uno:PageDialog (or args) | Layout | T3 |
| | Columns | .uno:FormatColumns | Layout | T3 |
| References / Review ||||
| | Spelling | .uno:SpellDialog | Review | T3 |
| | Word count | .uno:WordCountDialog / getCommandValues | status bar | T4 |
| | Track changes | .uno:TrackChanges | Review | T1 |
| | Comments accept/reject | .uno:AcceptTrackedChange etc. | Review panel | T4 |
| | Insert comment | .uno:InsertAnnotation | Review | T2 |
| View ||||
| | Zoom | client (✓) | status bar | ✅ |
| | Formatting marks | .uno:ControlCodes | View | T1 |

## 5. Catalog — Calc (Excel)

| # | Function | Mechanism | UI place | Tier |
|---|---|---|---|---|
| Home ||||
| | Type value / edit cell | key input (✓) | canvas | ✅ |
| | Bold/Italic/color/borders | .uno:Bold etc / .uno:SetBorderStyle | Home·Font | T1/T3 |
| | Number formats (currency/%/date/decimals) | .uno:NumberFormat* | Home·Number | T2 |
| | Merge & center | .uno:MergeCells / .uno:ToggleMergeCells | Home·Align | T1 |
| | Wrap text | .uno:WrapText | Home·Align | T1 |
| | Insert/delete row/column | .uno:InsertRows/DeleteRows/InsertColumns | Home·Cells | T1 |
| | Conditional formatting | .uno:ConditionalFormatDialog | right panel | T4 |
| | Sort & filter | .uno:DataSort / .uno:DataFilterAutoFilter | Home/Data | T3 |
| Formulas / Data ||||
| | Type formula (=SUM…) | key input | canvas | 🔨 next |
| | Function wizard | .uno:FunctionDialog | Formulas | T3 |
| | AutoSum | .uno:AutoSum | Formulas | T1 |
| | Data validation | .uno:Validation | Data | T3 |
| Insert ||||
| | Chart | .uno:InsertObjectChart | Insert | T4 |
| | Pivot table | .uno:DataDataPilotRun | Insert | T3 |
| Sheets ||||
| | Switch sheet | setPart (✓) | sheet tabs | ✅ |
| | Add / rename / delete sheet | .uno:Insert/Name/Remove | sheet tabs | T2 |

## 6. Catalog — Impress (PowerPoint)

| # | Function | Mechanism | UI place | Tier |
|---|---|---|---|---|
| Home ||||
| | New slide | .uno:InsertPage | Home | T1 |
| | Duplicate / delete slide | .uno:DuplicatePage / .uno:DeletePage | Home/strip | T1 |
| | Slide layout | .uno:AssignLayout {args} | Home | T2 |
| | Edit placeholder text | click + key input | canvas | 🔨 |
| | Font / paragraph (shared with Writer) | .uno:* | Home | T1/T2 |
| Insert ||||
| | Text box / shape / image | .uno:DrawText / BasicShapes / InsertGraphic | Insert | T2/T3 |
| | Table / chart | .uno:InsertTable / InsertObjectChart | Insert | T3/T4 |
| Design / Transitions / Animate ||||
| | Theme / master | .uno:PresentationLayout | Design | T4 |
| | Slide size | .uno:PageSetup | Design | T3 |
| | Slide background | .uno:PageBackground | Design | T3 |
| | Transition | SlideTransitionPanel | right panel | T4 |
| | Animation | CustomAnimationPanel | right panel | T4 |
| Slide Show / View ||||
| | Normal / Outline / Sorter | view modes | View | T3 |
| | Slide navigation | setPart (✓) | slide strip | ✅ |

## 7. Export formats (cross-app)

LibreOffice converts to all of these via `saveAs(url, format, filter)` — wire an
**Export ▾** menu, each entry one filter string + a save dialog, each with a test
that asserts a valid file is produced.

- **Writer**: PDF ✅ · PDF/A · DOCX · DOC · ODT · RTF · TXT · HTML · EPUB · XHTML
- **Calc**: PDF · XLSX · XLS · ODS · CSV · TSV · HTML
- **Impress**: PDF · PPTX · PPT · ODP · PNG/JPG (per slide) · SVG · HTML
- **Any**: print (.uno:Print / system print)

## 8. Phased build backlog (add one-by-one)

Each item = build + UI placement + e2e-with-screenshot. Ordered by value.

**Phase A — backbone**
1. B4 e2e harness (`_harness.mjs`, screenshot before/after)
2. B1 ribbon scaffold (tabbed, contextual)
3. B2 selection state sync (button active states, current style/font)

**Phase B — Writer everyday**
4. Alignment (L/C/R/justify) · 5. Bullets · 6. Numbered list · 7. Indent ±
8. Font family · 9. Font size · 10. Font color · 11. Highlight
12. Strikethrough/sub/superscript · 13. Clear formatting · 14. Line spacing
15. Insert page break · 16. Insert comment · 17. Track changes toggle
18. Word count (status bar)

**Phase C — Export & file**
19. Export▾ menu (PDF/A, DOCX, ODT, RTF, TXT, HTML, EPUB) · 20. Print
21. Save As (format) · 22. Document properties

**Phase D — Calc everyday**
23. Formula entry (=SUM) · 24. AutoSum · 25. Number formats · 26. Bold/borders
27. Merge & center · 28. Wrap text · 29. Insert/delete row/col · 30. Sort/filter
31. Add/rename/delete sheet

**Phase E — Impress everyday**
32. Edit placeholder text · 33. New/duplicate/delete slide · 34. Slide layout
35. Insert text box / shape / image

**Phase F — dialogs (needs B3 JSDialog bridge)**
36. B3 JSDialog bridge · 37. Insert table · 38. Page setup (margins/orientation)
39. Find & replace · 40. Hyperlink · 41. Special character · 42. Insert image

**Phase G — panels (T4)**
43. Styles gallery · 44. Comments/Review panel · 45. Conditional formatting
46. Charts · 47. Slide transitions · 48. Animations

**Phase H — long tail**
49. TOC · 50. Footnotes · 51. Columns · 52. Pivot tables · 53. Themes/master
54. Outline/sorter views · 55. Data validation · …

## 9. Test convention

`e2e/office/<NN>-<slug>.mjs` per function, using `_harness.mjs`:
- arrange (new/open doc), act (drive the UI control), assert (canvas pixels
  changed and/or the saved file contains the expected markup),
- write `e2e/office/shots/<NN>-before.png` and `<NN>-after.png`.
A runner (`npm run e2e:office:all`) executes the suite; screenshots are the
visual proof log.
