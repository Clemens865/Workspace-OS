# PPTX Feature Test Matrix

Every PowerPoint function the app exposes, with the behavior expected of the
leading original (Microsoft PowerPoint) as the parity benchmark. Each case has
an ID; the automated suite (`e2e/office/pptx-suite.mjs`) implements them 1:1
and reports pass/fail. Verification layers per case: **UI** (driven through the
real ribbon/menu path), **model** (`WosSelInfo` / engine state), **pixels**
(canvas changes to the expected color/arrangement), **file** (saved
`ppt/slides/slideN.xml` contains the right OOXML).

Legend: ✅ automated · 🖐 manual-only (needs native dialog/interactive input) ·
⏳ known-deferred (documented engine limitation)

## 1. Shape insertion (Design ▸ Shapes)

| ID | Case | PowerPoint-parity expectation | Auto |
|----|------|-------------------------------|------|
| INS-01 | Insert rectangle | Shape appears centered-ish on slide, selected, resize handles visible | ✅ |
| INS-02 | Insert rounded rectangle | Same, with corner radius | ✅ |
| INS-03 | Insert ellipse | Same | ✅ |
| INS-04 | Insert line | Line shape, selectable | ✅ |
| INS-05 | Insert arrow | Line with arrowhead | ✅ |
| INS-06 | Insert text box | Empty text shape, ready for text | ✅ |
| INS-07 | Pen polygon (click points → Enter) | Custom closed polygon like PPT freeform | ✅ (macro layer) |
| INS-08 | Insert image (file picker → embedded on slide) | Image placed as slide shape, embedded not linked | 🖐 (native dialog) |

## 2. Fill (Design ▸ Fill)

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| FILL-01 | Solid fill via swatch | Selected shape turns that color instantly; persists as `<a:solidFill>` | ✅ |
| FILL-02 | Solid fill via color picker | Same for arbitrary color | ✅ (same code path as FILL-01) |
| FILL-03 | No fill | Shape becomes transparent, outline remains | ✅ |
| FILL-04 | Gradient presets (Blue/Teal/Sunset/Green/Purple) | Two-color gradient like PPT gradient fill; persists as `<a:gradFill>` | ✅ |
| FILL-05 | Pattern/hatch presets (6) | Hatch pattern like PPT pattern fill; persists as `<a:pattFill>` | ✅ |

## 3. Outline & stroke (Design ▸ Outline/Stroke)

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| STRK-01 | Outline color via swatch | Shape border recolors; `<a:ln><a:solidFill>` | ✅ |
| STRK-02 | No outline | Border removed | ✅ |
| STRK-03 | Stroke width (Hairline→Heavy) | Border thickens visibly; `<a:ln w="…">` | ✅ |
| STRK-04 | Dash styles (dashed/dotted/dash-dot) | Border dashes; `<a:prstDash>`/custDash | ✅ |

## 4. Effects

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| EFF-01 | Shadow toggle | Drop shadow appears/disappears; `<a:effectLst>` on save | ✅ |

## 5. Text in shapes

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| TXT-01 | Double-click shape → type → click away | Text lands in shape (like PPT in-place editing) | ✅ |
| TXT-02 | Set shape text (component/agent path) | `WosShapeText settext` writes text, visible + in selInfo | ✅ |
| TXT-03 | Font color on shape text | Text recolors | ✅ |
| TXT-04 | Bold/italic on shape text via ribbon Home | Formatting applies inside shape edit mode | ✅ |

## 6. Selection & direct manipulation

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| SEL-01 | Click shape → handles appear | 8 handles track engine GRAPHIC_SELECTION exactly | ✅ |
| SEL-02 | Drag shape → moves | Position updates live; drop persists new position | ✅ |
| SEL-03 | Drag corner handle → resizes | Size updates; aspect per PPT rules | ✅ |
| SEL-04 | Click empty area → deselect | Handles disappear | ✅ |

## 7. Arrange (z-order, align, delete)

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| ARR-01 | Bring to front / send to back | Overlap order flips (pixel-verified with 2 overlapping shapes) | ✅ |
| ARR-02 | Bring forward / send backward | One step in z-order | ✅ |
| ARR-03 | Align left/center/right/top/middle/bottom | Shape snaps to slide edges/center like PPT Align-to-Slide | ✅ |
| ARR-04 | Delete shape | Shape gone, pixels restored | ✅ |

## 8. Slide operations

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| SLD-01 | New slide | Slide count +1, rail updates, canvas switches | ✅ |
| SLD-02 | Delete slide | Count −1 | ✅ |
| SLD-03 | Duplicate slide | Copy with identical content | ✅ |
| SLD-04 | Go to slide (rail click) | Canvas shows target slide < 300ms | ✅ |
| SLD-05 | Reorder slide (rail drag) | Order changes, persists | ✅ |
| SLD-06 | Slide background (this slide) | BG color changes only current slide | ✅ |
| SLD-07 | Slide background (all slides) | All slides change | ✅ |
| SLD-08 | Background none | Reverts to white/theme | ✅ |

## 9. Persistence & round-trip (the PowerPoint acid test)

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| PER-01 | ⌘S then reopen | All shapes/fills/strokes/text exactly as left | ✅ |
| PER-02 | Saved file opens in real PowerPoint | OOXML uses standard elements (solidFill/gradFill/pattFill/ln/effectLst) | ✅ (XML-schema grep) |
| PER-03 | Export PDF | PDF produced, non-empty | ✅ |
| PER-04 | Export PNG | Image produced | ✅ |

## 10. Editing chrome

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| CHR-01 | Undo / redo | Shape ops undoable like PPT | ✅ |
| CHR-02 | Zoom in/out | Canvas rescales crisply, selection overlay tracks | ✅ |
| CHR-03 | Present mode | Full-screen show, arrows navigate, Esc exits | ✅ (open/close) |
| CHR-04 | Thumbnails update after edit | Rail thumbnail reflects the edit within ~1s | ✅ |
| CHR-05 | Typing latency in shape text | Key→pixels under ~150ms P95 (subjective "instant") | ✅ (measured) |

## 11. Components (beyond-PPT features — still must not break)

| ID | Case | Expectation | Auto |
|----|------|-------------|------|
| CMP-01 | Insert shape component | Instance lands with component styling | ✅ |
| CMP-02 | Insert card component | Group with bg+title | ✅ |
| CMP-03 | Instance override (fill/text/size) | Only that instance changes | ✅ |

## 12. Known-deferred (documented, expected-fail)

| ID | Case | Status |
|----|------|--------|
| DEF-01 | Insert chart (column/bar/line/pie/area) | ⏳ `.uno:InsertObjectChart` doesn't persist headlessly (PROGRESS.md §5) |
| DEF-02 | Transitions/animations | ⏳ not built |
| DEF-03 | SmartArt/themes/speaker notes | ⏳ not built |
