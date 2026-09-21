# Workspace OS — Office Feature Inventory & Roadmap

Working vs. missing features for Word, Excel, and PowerPoint, benchmarked against
Microsoft Office (Win + Mac), with Apple iWork / Google notes from research.

**Key framing:** the app runs a full bundled **LibreOffice** engine, so almost
every "missing" feature is *already supported by the engine* and only needs UI
surfacing (a ribbon control + sometimes a native dialog). Truly out-of-scope
items are limited to cloud/AI/real-time-collaboration.

Legend: 🟢 working today · 🟡 missing — **engine supports it, needs UI** · 🔴 missing — out of current scope (cloud/AI/collab)

Shared across all three (🟢): live native editing, ⌘S save, Undo/Redo, zoom,
Export (per-type: Word→PDF/docx/odt/rtf/txt/html/epub · Excel→PDF/xlsx/ods/csv/html ·
PPT→PDF/pptx/odp/png/html), document properties, crisp HiDPI rendering, text
selection, native Insert-Table / Special-Character / Hyperlink dialogs.

---

## 📝 Word

### 🟢 Working
- **Font:** family, size, bold, italic, underline, strikethrough, super/subscript, font color, highlight, clear formatting
- **Paragraph:** align (left/center/right/justify), bulleted & numbered lists, increase/decrease indent, line spacing (1.0/1.5/2.0)
- **Styles:** Body / Title / Heading 1–3
- **Insert:** table (native dialog), special character (native), hyperlink (native), page break
- **Review:** insert comment, track changes (toggle), Find & Replace
- **File/Export:** 7 formats incl. PDF & docx

### 🟡 Missing — engine supports, needs UI
- **Font/character:** change case, character spacing/kerning, underline styles, double-strikethrough, text effects (shadow/outline)
- **Paragraph:** paragraph dialog (exact spacing before/after, first-line/hanging indent, tab stops), borders & shading, keep-with-next/widow control
- **Layout (whole tab):** margins, orientation, paper size, columns, section breaks, headers & footers, page numbers, watermark, page color/border, line numbers
- **Insert:** images/pictures, shapes, text boxes, charts, equations, footnotes/endnotes, bookmarks, cross-references, fields (date/time/page), frames
- **References (whole tab):** table of contents, captions, citations & bibliography, index, table of authorities
- **Review:** spelling & grammar, word count, thesaurus, accept/reject-changes UI, compare documents, protect/restrict
- **Styles:** full style manager, character styles, apply/modify, more built-ins
- **View:** web/outline layout, navigation pane, multi-page/page-width zoom presets, split window, ruler/gridlines
- **Mailings:** mail merge (engine has it)

### 🔴 Out of current scope
- Real-time co-authoring, sharing links, cloud version history
- Copilot/AI drafting, Designer, dictation, Immersive Reader, online video/screenshot

---

## 📊 Excel

### 🟢 Working
- **Font:** full character group (as Word)
- **Number:** currency, percent, date, inc/dec decimals, **Format Cells dialog** (category + decimals + thousands, live sample)
- **Alignment:** left/center/right, merge cells, wrap text
- **Cells:** insert/delete rows & columns, AutoSum
- **Data:** sort ascending/descending, AutoFilter, AutoSum
- **Formulas:** *any* formula works (engine computes) — typed directly incl. SUM/AVERAGE/etc.
- **Insert:** table, special character, hyperlink, page break
- **Sheets:** multi-sheet navigation (sheet tabs)
- **File/Export:** PDF/xlsx/ods/csv/html

### 🟡 Missing — engine supports, needs UI
- **Formulas:** Insert-Function (fx) picker / function library, named ranges manager, formula auditing (trace precedents/dependents), show formulas
- **Number/format:** accounting/fraction/scientific/custom formats (extend Format Cells), cell fill color, **borders** UI, cell styles
- **Conditional formatting:** value rules, data bars, color scales, icon sets *(Calc supports all)*
- **Data tools:** data validation / drop-down lists, multi-level Sort dialog, remove duplicates, subtotals, group/outline, text-to-columns
- **Analysis:** **PivotTables** (Calc "DataPilot"), **charts**, sparklines, what-if/goal-seek
- **Sheet structure:** add/rename/delete/reorder/color sheet, freeze panes, split, protect sheet/range
- **Editing:** Find & Replace (not yet exposed for Calc), paste special, autofill series
- **Print/layout:** print ranges, headers/footers, page setup

### 🔴 Out of current scope
- Power Query / Power Pivot / Data Model, Solver/Analysis ToolPak
- Real-time co-authoring, Analyze-Data AI, macros/VBA, linked data types (Stocks/Geo)

---

## 📽 PowerPoint

### 🟢 Working
- **Slides:** new, duplicate, delete; multi-slide navigation (tabs)
- **Text:** edit placeholder/box text (double-click + type), full **Font** group
- **Insert:** table, special character, hyperlink, page break
- **File/Export:** PDF/pptx/odp/png/html

### 🟡 Missing — engine supports, needs UI
- **Text/paragraph:** bullets & numbering, alignment, line spacing, columns, WordArt-style effects *(no Paragraph group on the PPT Home tab yet)*
- **Slides:** reorder (drag), sections, change layout, slide master, reset slide, slide numbers
- **Insert:** images, shapes, text boxes, charts, SmartArt, icons, audio, video, equations
- **Design:** themes & variants, slide size (4:3/16:9/custom), background styles/fill
- **Transitions:** slide transitions + effect options + timing *(Impress supports)*
- **Animations:** entrance/emphasis/exit/motion-path, animation order *(Impress supports)*
- **Slide Show:** start show, presenter view/notes, rehearse timings *(Impress supports)*
- **View:** outline, slide sorter, notes page, guides/gridlines
- **Notes:** speaker notes per slide

### 🔴 Out of current scope
- Morph transition, Designer/Design Ideas, Cameo/screen recording
- Real-time co-authoring, Copilot deck generation, Speaker Coach, live captions

---

## Recommended priority (high value, engine-backed, achievable)

1. **Word — Layout tab**: margins, orientation, size, columns, headers/footers, page numbers (most-felt gap for documents)
2. **Excel — Conditional formatting + Borders + Insert Function picker** (everyday spreadsheet polish), then **Charts** and **PivotTables**
3. **PowerPoint — Paragraph group (bullets/align) + Insert Image/Shape**, then **Transitions** and **Slide Show / presenter view**
4. **Cross-app — Insert Image/Picture** (universal, high demand)
5. **Cross-app — Spelling & grammar**, **Find & Replace everywhere**

Each follows the proven pattern: surface a ribbon control, and for parameterized
operations add a small native dialog driving the existing UNO bridge.
