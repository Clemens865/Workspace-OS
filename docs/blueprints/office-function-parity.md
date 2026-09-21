# Office function parity — LibreOffice engine vs. Workspace OS UI

> Status: ANALYSIS, 4 September 2026. Source of truth for the engine side is the mounted LibreOffice tree (`/Volumes/LOBuild/core`: `sw/sc/sd/uiconfig/*/menubar`, `popupmenu`, `toolbar`, plus the command labels in `officecfg/.../UI/*Commands.xcu`). Source of truth for the app side is the code as of v0.1.104 (`Ribbon.tsx`, `menu-office.ts`, `calcMenu.ts`, `LokRenderer.tsx`, `useLokActions.ts`, `lokMacros.ts`, `handlers/lok.ts`, `wos-lok-host.cpp`). Supersedes the placement columns of `docs/OFFICE-FUNCTION-CATALOG.md` (June 2026) and `docs/office-feature-inventory.md`.

## 1. The short version

The engine already implements essentially everything Writer, Calc and Impress can do. The app exposes a small, well-chosen slice of it:

| | LibreOffice menu entries | Workspace OS today |
|---|---|---|
| Writer | 553 entries (File…Help), 6 context menus | ~60 functions (ribbon + native Format/Insert menus), **no context menu** |
| Calc | 483 entries, 9 context menus | ~75 functions, context menu for cell / row header / column header only |
| Impress | 437 entries, 7 context menus | ~70 functions (mostly shape design via macros), **no context menu** |
| Reachable `.uno:` commands | ~2,100 defined | **108** dispatched from the UI, plus ~45 `Wos*` model macros |

Three structural gaps explain most of the difference, and they are the real work; the individual functions are cheap once these exist:

1. **Right-click is dead on Writer and Impress**, and Calc has it only on three targets. LibreOffice ships 22 target-specific context menus; they are the natural home for about a third of everything below.
2. **Dialogs.** Every LibreOffice item ending in "…" opens a dialog. We have eight React dialogs, and a bitmap tunnel for native dialogs that cannot scroll, drag or take modifier keys. Everything dialog-shaped is blocked until we pick one of the two ways forward in §5.
3. **State.** Menus and buttons don't know what is selected. Only 28 toggle states are read from the engine; nothing is disabled contextually, so a wrong-context click silently no-ops (the slide-table buttons are the worst case). Both the native menu and a future context menu need `STATE_CHANGED` and `getCommandValues` for enabled/checked state.

Everything else is placement, and §3 gives the rule for where each kind of function goes.

## 2. What the UI has today

**Ribbon** (`Ribbon.tsx`): Writer `Home · Insert · Layout · Review · View`; Calc `Home · Insert · Data · View`; Impress `Home · Insert · Design · View`. Font group shared (font, size, B/I/U/S, sub/super, colour, highlight, clear, change case). Writer adds five paragraph styles, alignment, lists, indent, line spacing, page/column breaks, footnote/endnote, margins/orientation/header/footer/page number (macros), comment insert, track-changes toggle. Calc adds number formats, alignment/merge/wrap, borders dialog, format painter, sort/filter/AutoSum/freeze, insert/delete rows and columns, fill, hide/show, conditional formatting and validation dialogs, charts, date/time, a formula bar with 50-function autocomplete, sheet tabs. Impress adds slide ops, a five-layout picker, shapes, pen, image, vectorize, fill/outline/gradient/pattern/stroke/shadow, arrange/align/distribute, slide background, slide-table structure and cell format, notes pane, slide rail with drag reorder, present mode.

**Native menu bar** (`menu-office.ts`, only while a document is active): Edit (undo/redo/clipboard/find), Format (the font group, change case, fixed font/size/colour lists, align, lists, indent; Impress shape submenus), Insert (table, image, hyperlink, special character; per-app extras), View (zoom, a few toggles). File has no Save As / Export / Print preview / Properties; there is no Table, Sheet, Data, Slide, Slide Show, Tools or Styles menu.

**Right-click**: Calc cell, row header, column header (`calcMenu.ts`, engine-verified). Nothing on Writer, Impress, sheet tabs, slide thumbnails, shapes, images, tables, charts.

**Left-click / drag**: cell cursor and range select with edge auto-scroll, text caret and selection rects, shape select/move/resize with ghost and model-API commit, column/row header resize and double-click autofit, header band select, sheet tab click/double-click rename, slide thumbnail click and drag reorder, hyperlink click into the in-app browser, pen tool. Missing: fill handle, rotate handle, crop handles, AutoFilter dropdown arrows, comment anchors, table row/column grips, ruler, Ctrl-wheel zoom, sheet-tab and slide-thumbnail right-click.

**Dialogs**: React — Insert Table, Format Cells, Borders, Conditional Format, Data Validation, Margins, Special Character, Hyperlink, Find & Replace bar, Properties. Native bitmap tunnel (`DialogOverlay`) — used by Sort, Function wizard, Define Name, Pivot, Print area, Row height / Column width, Paste Special, Insert/Delete cells; single-point clicks and a short key table only.

**Engine channels** (what a new function can be built on):

| Channel | Good for | Limits |
|---|---|---|
| `.uno:Command` with optional JSON args | toggles, one-shot actions, parameterised formatting | anything that opens a dialog becomes a `WINDOW` callback |
| `WosXxx` Basic macro (model API) | structural edits, geometry, anything headless dialogs would do | args via /tmp files, 64 KB per module (two modules), `On Error Resume Next` hides failures, callbacks muted during the macro |
| Native dialog tunnel (`paintWindow`) | occasional complex dialogs | no drag/scroll/resize/modifiers; looks foreign |
| `getCommandValues` | reading state (only `SheetGeometryData` used today) | one call per query |
| Callbacks | cursor, selection, state, cell formula, hyperlink, window | not handled: comments, search results, validity list button, table selected, content control, tooltip, password |

## 3. Where a function goes — the placement rule

The question "left click or menu" has a stable answer once functions are sorted by *how the user thinks of them*:

| Kind of function | Home | Why |
|---|---|---|
| **Spatial** — the user points at the thing (resize a column, drag a fill handle, rotate a shape, click a filter arrow, open a comment) | **Left-click / drag on the canvas** | The target *is* the argument; a menu would need to ask "which one". |
| **Contextual** — acts on what is under the pointer (insert row here, wrap this image, edit this hyperlink, rename this sheet) | **Right-click menu, per target** | LibreOffice's 22 popup menus are the spec; each target gets exactly its list. |
| **Frequent formatting** — the 40 things a manager does hourly | **Ribbon** (Home tab), plus a **mini-toolbar** on text/cell selection | Discoverable and one click; state shown on the button. |
| **Occasional but must exist** — page setup, references, data tools, slide show settings | **Native menu bar**, mirroring LibreOffice's top-level menus per app | Completeness guarantee: if it's in the engine it's in the menu, searchable through ⌘K. |
| **Stateful / list-like** — styles, comments, tracked changes, navigator, transitions, animations, names | **Right-hand panel** | Needs live engine state and a list, not a one-shot click. |
| **Whole-document mode** — outline, slide sorter, master, page-break view, web layout | **View tab + View menu**, radio group | Exclusive modes, rarely toggled. |

Two consequences for the native menu bar: it grows per app to **File · Edit · View · Insert · Format · Styles · Table · Tools** (Writer), **… Sheet · Data …** (Calc), **… Slide · Slide Show …** (Impress), following LibreOffice's own order so anyone who knows Office finds things. And the ribbon stays a curated subset; it is not where completeness lives.

Legend for the tables below: **✅** wired · **🟡** partial (exists but wrong scope, no state, or one path only) · **❌** missing. Mechanism: `uno` one-shot command · `uno+args` · `macro` model API · `dialog` needs a dialog (React or JSDialog, see §5) · `panel` stateful side panel · `mode` view mode via LOK. Home: **Menu** = native menu bar path · **Ribbon** tab › group · **RC:target** = right-click on that target · **Canvas** = left-click/drag affordance · **Panel**.
## 4. Writer — gap map by LibreOffice menu

### File
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Save / Save As… / Save a Copy | `.uno:Save`, `SaveAs` | 🟡 Save only (ribbon + ⌘S) | `saveAs(path, filter)` exists in the host | Menu File › Save As… ⇧⌘S (Electron save dialog + export path) |
| Export as PDF / Export… | `ExportToPDF` | ✅ ribbon Export ▾ | `exportAs` | keep; add Menu File › Export ▸ |
| Print / Print Preview / Printer settings | `Print`, `PrintPreview` | 🟡 print = PDF + open | mode + system print dialog | Menu File › Print… ⌘P (system dialog on the exported PDF); Print Preview as a View mode |
| Properties… | `SetDocumentProperties` | 🟡 read-only modal | dialog | Menu File › Properties…; make title/author editable |
| Templates, Versions, Compare/Merge, Digital signatures, Send | | ❌ | | Out of scope for now (Compare Document is worth a case-level agent action later) |

### Edit
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Undo / Redo / Repeat | `Undo`, `Redo`, `Repeat` | ✅ / ✅ / ❌ | uno | Menu Edit (add Repeat ⌘Y) |
| Cut / Copy / Paste / Select All | | ✅ | uno via editRouter | Menu Edit · RC:text · ⌘ keys |
| Paste Special ▸ Unformatted, Paste Special… | `PasteUnformatted`, `PasteSpecial` | ❌ | uno / dialog | Menu Edit › Paste Special ▸; RC:text; ⇧⌥⌘V unformatted |
| Selection mode (block), Select Text | `SelectionModeBlock` | ❌ | uno toggle | Menu Edit › Selection Mode ▸ |
| Find & Replace | `SearchDialog` | ✅ own bar (Writer/Calc) | macro | keep; add Menu Edit › Find Next ⌘G / Previous ⇧⌘G |
| Go to Page… | `GotoPage` | ❌ | uno+args (`GotoPage {PageNumber}`) | Menu Edit › Go to Page… ; ⌘K "page 12"; status bar page click |
| Track Changes: Record, Show, Accept/Reject (one, all, next, previous), Manage, Comment, Protect | `TrackChanges`, `ShowTrackedChanges`, `AcceptTrackedChange`… | 🟡 record toggle only | uno + panel (needs `REDLINE_TABLE` callbacks / `getCommandValues('.uno:AcceptTrackedChanges')`) | Ribbon Review › Changes (Record, Show, Accept, Reject, Next, Previous); Panel "Changes" list; RC:text on a change (Accept/Reject this) |
| Comments: reply, resolve, delete, delete thread, delete all | `ReplyComment`, `ResolveComment`, `DeleteComment`… | ❌ (insert only, not even rendered) | callbacks `COMMENT` + panel | Panel "Comments" (thread list, reply, resolve); Canvas margin anchors; RC:comment |
| Hyperlink edit / open / copy / remove | `EditHyperlink`, `OpenHyperlink`, `CopyHyperlinkLocation`, `RemoveHyperlink` | 🟡 insert + click-open | uno / React dialog reuse | RC:text on a link (Open, Edit…, Copy address, Remove); Menu Edit › Hyperlink |
| Fields…, Footnote edit, Index entry, Citation | `FieldDialog`, `EditFootnote`… | ❌ | dialog | Menu Edit › Reference ▸; RC:text on a field |
| External Links…, OLE object, Exchange Database | | ❌ | | Out of scope |
| Direct Cursor, Edit Mode (read-only toggle) | `ShadowCursor`, `EditDoc` | ❌ | uno toggle | Menu Edit (Edit Mode useful for "review only" cases) |

### View
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Normal / Web layout | `PrintLayout`, `BrowseView` | ❌ | mode | Ribbon View › Layout radio; Menu View |
| Page layout: single / multiple / book | `SinglePagePerRow`… | ❌ | uno | Menu View › Page Layout ▸ |
| Rulers (H/V) | `Ruler`, `VRuler` | ❌ (no ruler at all) | own overlay from `getCommandValues` page geometry | Ribbon View › Show › Ruler; Canvas: drag margins/indents/tab stops on it |
| Formatting marks, boundaries, images, whitespace, field shadings, field names, hidden paragraphs | `ControlCodes` ✅, `ShowBoundaries`, `ShowGraphics`, `ShowWhitespace`, `Marks`, `Fieldnames`, `ShowHiddenParagraphs` | 🟡 marks only | uno toggles | Ribbon View › Show (checkboxes with state); Menu View |
| Show tracked changes / comments / resolved comments | `ViewTrackChanges`, `ShowAnnotations`, `ShowResolvedAnnotations` | ❌ | uno toggles | Ribbon Review › Show ▾; Menu View |
| Styles / Navigator / Gallery / Sidebar | `ViewSidebarStyles`, `Navigator` | ❌ | panel (own React, fed by `getCommandValues('.uno:StyleApply')` list and a heading outline) | Ribbon View › Panels; Menu View; Panel "Styles", Panel "Navigator" (headings, tables, images, bookmarks) |
| Full screen | | ✅ app-level | | keep |
| Zoom: page, page width, optimal, presets, Zoom… | `ZoomPage`, `ZoomPageWidth`, `Zoom100Percent`… | 🟡 numeric only | client zoom | Ribbon View › Zoom (add Fit page / Fit width); status-bar zoom slider; **Canvas: ⌘-wheel and pinch** |

### Insert
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Page break / column break / manual break… | `InsertPagebreak` ✅, `InsertColumnBreak` ✅, `InsertBreak` | 🟡 | uno / dialog | Ribbon Insert › Breaks ▾ (add section break via `InsertBreak` args); Menu Insert › More Breaks ▸ |
| Image… | `InsertGraphic` | ✅ | | keep; RC:text › Insert image |
| Chart… | `InsertObjectChart` | ❌ in Writer (Calc/Impress have it) | macro like `WosInsertChart` with inline data | Ribbon Insert › Chart ▾; Menu Insert |
| Media (audio/video), Gallery, Scan | | ❌ | | Out of scope |
| OLE / Formula / QR code | `InsertObjectStarMath`, `InsertQrCode` | ❌ | dialog | Menu Insert › Object ▸ (QR code is cheap: `InsertQrCode` args) |
| Shapes: line, freeform, curve, polygon, basic, arrows, symbols, stars, callouts, flowchart | `BasicShapes.*`, `ArrowShapes.*`… | ❌ in Writer (Impress has 6 via macro) | `uno+args` e.g. `.uno:BasicShapes.rectangle` draws interactively; or `WosShapeInsert` | Ribbon Insert › Shapes ▾ gallery (all apps); Menu Insert › Shape ▸ |
| Section…, Content from document, Frame | `InsertSection`, `InsertDoc`, `InsertFrame` | ❌ | dialog | Menu Insert |
| Text box | `DrawText` | 🟡 Impress only | uno | Ribbon Insert › Text box (all apps) |
| Comment | `InsertAnnotation` | 🟡 (invisible) | uno + panel | Ribbon Review › Comment ⌥⌘C; RC:text › Comment |
| Fontwork | | ❌ | | Out of scope |
| Caption… | `InsertCaptionDialog` | ❌ | dialog | RC:image / RC:table › Insert caption…; Menu Insert |
| Hyperlink… | `HyperlinkDialog` | ✅ own dialog | | keep; RC:text; ⌘K conflicts with palette → keep Insert › Hyperlink |
| Bookmark…, Cross-reference… | `InsertBookmark`, `InsertReferenceField` | ❌ | dialog | Ribbon References › Bookmark, Cross-reference; Menu Insert |
| Special character | `InsertSymbol` | ✅ own dialog | | keep |
| Formatting marks: no-break space, soft hyphen, etc. | `InsertNonBreakingSpace`… | ❌ | uno | Menu Insert › Formatting Mark ▸ (⇧⌘Space for no-break space) |
| Footnote / Endnote / special… | `InsertFootnote` ✅, `InsertEndnote` ✅, `InsertFootnoteDialog` | 🟡 | | Ribbon References; RC:text › Footnote |
| Table of Contents / Index / Bibliography, index entry, citation | `InsertMultiIndex`, `InsertIndexesEntry` | ❌ | dialog (TOC insert with defaults is `uno+args`) | Ribbon References › Table of Contents ▾ (default TOC one click, Custom… dialog), Update; RC:text inside a TOC › Update / Edit / Delete index |
| Page number…, Field ▸ (date, time, page count, title, author) | `PageNumberWizard`, `InsertDateField`, `InsertPageCountField`, `InsertTitleField`, `InsertAuthorField` | 🟡 page number only | uno | Ribbon Insert › Field ▾; Menu Insert › Field ▸ |
| Header / Footer on-off per page style | `InsertPageHeader`, `InsertPageFooter` | ✅ via macro | | keep; **Canvas: double-click the header area to edit it** (engine already does this on click) |
| Envelope, Signature line | | ❌ | | Out of scope |
### Format (Writer)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Bold, italic, underline, strikethrough, sub/superscript | | ✅ | uno | Ribbon Home › Font; Menu Format › Text; mini-toolbar |
| Double underline, overline, shadow, outline, small caps | `UnderlineDouble`, `Overline`, `Shadowed`, `OutlineFont`, `SmallCaps` | ❌ | uno | Menu Format › Text ▸; Ribbon Home › Font overflow ▾ |
| Grow / shrink font | `Grow`, `Shrink` | 🟡 Calc only | uno | Ribbon Home › Font (all apps) ⇧⌘> / ⇧⌘< |
| Change case (upper, lower, sentence, title, toggle, cycle) | | 🟡 4 of 6 | uno | add Toggle and Cycle (⇧F3) |
| Line spacing 1 / 1.15 / 1.5 / 2, paragraph spacing ±, indent ± | | 🟡 (no 1.15, no para spacing) | uno | Ribbon Home › Paragraph ▾ |
| Align left/center/right/justify; top/center/bottom (in frames, cells) | | ✅ / ❌ | uno | Ribbon; RC:table cell › Align ▸ |
| Clone formatting (format painter) | `FormatPaintbrush` | 🟡 Calc only | uno mode | Ribbon Home › Clipboard (all apps); RC:text |
| Clear direct formatting | | ✅ | | keep |
| Spotlight (styles, direct formatting) | | ❌ | uno toggles | Menu Format › Spotlight ▸ |
| Character…, Paragraph… | `FontDialog`, `ParagraphDialog` | ❌ | **dialog** (character spacing, kerning, position; para indents, tabs, borders, keep-with-next) | RC:text › Character…, Paragraph…; Menu Format; Ribbon Home group launcher ↘ |
| Lists: none/unordered/ordered, promote/demote (with subpoints), move up/down, restart numbering, add to list, unnumbered entry | `RemoveBullets`, `DecrementLevel`, `MoveUp`, `NumberingStart`, `ContinueNumbering`… | 🟡 two toggles + indent | uno | Ribbon Home › Paragraph list ▾ (styles gallery + these ops); RC:text in a list › List ▸; Tab/⇧Tab promote-demote already engine-handled |
| Bullets and Numbering… | `OutlineBullet` | ❌ | dialog | Menu Format |
| Theme… | `ThemeDialog` | ❌ | dialog | Menu Format |
| Page Style… (margins, size, orientation, columns, background, header/footer distances) | `PageDialog` | 🟡 margins/orientation via macro | dialog (or extend `WosPageMargins` family with size/columns) | Ribbon Layout (add Size ▾ A4/Letter, Columns ▾ 1/2/3, Page colour); Menu Format › Page Style…; **Canvas: ruler drag for margins** |
| Title page…, Comments…, Asian guide | | ❌ | | Out of scope |
| Columns… | `FormatColumns` | ❌ | uno+args works for section columns | Ribbon Layout › Columns ▾ |
| Watermark… | `Watermark` | ❌ | uno+args (`Watermark {Text, Font, Angle, Transparency, Color}`) | Ribbon Layout › Watermark ▾ (Draft / Confidential / Custom…) |
| Sections… | `EditRegion` | ❌ | dialog | Menu Format |
| Image ▸ crop, replace, compress, save, filters, colour, properties, size check | `Crop`, `ChangePicture`, `CompressGraphic`, `SaveGraphic`, `GraphicFilter*`, `GraphicDialog` | ❌ | uno (crop = **Canvas handles**), dialog for properties | RC:image (Crop, Replace…, Save as…, Filters ▸, Properties…); contextual ribbon tab "Picture" when an image is selected |
| Text box & shape: position/size, line, area, text attributes | `TransformDialog`, `FormatLine`, `FormatArea`, `TextAttributes` | 🟡 Impress fill/line via macro | macro (reuse `WosShapeColor/Stroke/Effect` on Writer) or dialog | RC:shape; contextual ribbon tab "Shape" (all apps, same controls as Impress Design) |
| Frame and object properties | `FrameDialog` | ❌ | dialog | RC:frame › Properties… |
| Name…, Alt text… | `NameGroup`, `ObjectTitleDescription` | ❌ | dialog (tiny, React) | RC:image/shape |
| Anchor ▸ (to page, paragraph, character, as character) | `SetAnchorToPage`, `SetAnchorToPara`, `SetAnchorToChar`, `SetAnchorAtChar` | ❌ | uno | RC:image/shape › Anchor ▸; Picture tab |
| Wrap ▸ (none, parallel, optimal, before, after, through, in background, contour, first paragraph) | `WrapOff`, `WrapOn`, `WrapIdeal`, `WrapLeft`, `WrapRight`, `WrapThrough`, `WrapContour`, `WrapAnchorOnly` | ❌ | uno | RC:image/shape › Wrap ▸; Picture tab › Wrap ▾ |
| Arrange ▸ (front, forward, back, backward, to foreground/background) | `BringToFront`, `ObjectForwardOne`, `ObjectBackOne`, `SendToBack` | 🟡 Impress via macro | uno works directly in Writer | RC:image/shape › Arrange ▸; Picture/Shape tab |
| Rotate or flip ▸ (rotate mode, 90° L/R, 180°, reset, flip H/V) | `RotateLeft`, `RotateRight`, `Rotate180`, `FlipVertical`, `FlipHorizontal`, `ToggleObjectRotateMode` | ❌ | uno; **Canvas: rotate handle** above the selection box | RC:image/shape › Rotate or Flip ▸; Picture tab |
| Group ▸ (group, ungroup, enter, exit) | `FormatGroup`, `FormatUngroup`, `EnterGroup`, `LeaveGroup` | ❌ | uno | RC:shape (multi-select) › Group ⌘G / Ungroup ⇧⌘G; Shape tab |

### Styles
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Paragraph styles: body, title, subtitle, H1–H3, quotation, preformatted; list styles; character styles (emphasis, strong, source) | `StyleApply` with family | 🟡 5 paragraph styles in a `<select>` | uno+args (`StyleApply {Style, FamilyName}`) | Ribbon Home › Styles **gallery** (rendered previews, all families) ; Menu Styles (mirrors LO list) ; RC:text › Paragraph ▸ / Character ▸ |
| Edit style, update from selection, new from selection, load from template, manage | `EditStyle`, `StyleUpdateByExample`, `StyleNewByExample`, `DesignerDialog` | ❌ | dialog / panel | Panel "Styles" (list + apply + update-from-selection + new); Menu Styles |

### Table (Writer)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Insert table… | `InsertTable` | ✅ own dialog | | keep; add a **grid picker** in Ribbon Insert › Table ▾ (hover N×M) |
| Insert rows above/below, columns before/after; delete row/column/table | | 🟡 native Insert menu only (`WosTableOp`), **no ribbon, no right-click** | macro (or `.uno:InsertRowsBefore` etc. which work in Writer tables) | **RC:table cell** (Insert ▸, Delete ▸); contextual ribbon tab "Table"; Menu Table |
| Select cell / row / column / table | `EntireCell`, `EntireRow`, `EntireColumn`, `SelectTable` | ❌ | uno | RC:table › Select ▸; **Canvas: click row/column grips at the table edge** |
| Row height / optimal / distribute; column width / optimal / distribute | `SetRowHeight`, `SetOptimalRowHeight`, `DistributeRows`, `SetColumnWidth`, `SetOptimalColumnWidth`, `DistributeColumns` | ❌ | uno / dialog for exact value | RC:table › Size ▸; **Canvas: drag cell borders** (engine handles the drag; needs cursor feedback) |
| Merge / unmerge cells, merge / split table | `MergeCells`, `SplitCell`, `MergeTable`, `SplitTable` | ❌ | uno / dialog (split cell asks count) | RC:table; Table tab |
| Protect / unprotect cells | | ❌ | uno | Menu Table |
| AutoFormat styles… (Academic, Elegant, Financial, Box List…) | `AutoFormat`, table style names | ❌ | uno+args (`TableStyleName`?) or dialog | Table tab › Styles gallery; RC:table › Style ▸ |
| Number format…, number recognition | `TableNumberFormatDialog`, `TableNumberRecognition` | ❌ | dialog / toggle | Menu Table |
| Header rows repeat, row to break across pages | `HeadingRowsRepeat`, `RowSplit` | ❌ | uno toggles | Table tab; Menu Table |
| Convert text↔table | `ConvertTextToTable`, `ConvertTableToText` | ❌ | dialog | Menu Table › Convert ▸ |
| Edit formula, Sort… | `InsertFormula`, `TableSort` | ❌ | dialog | Menu Table |
| Table properties… (borders, background, alignment, text flow) | `TableDialog` | ❌ | **dialog** | RC:table › Table properties…; Table tab launcher |
| Insert caption, paragraph break above table | `InsertCaptionDialog`, `InsertParagraphBreakBeforeTable`? | ❌ | | RC:table |

### Tools (Writer)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Spelling…, automatic spell checking | `SpellingAndGrammarDialog`, `SpellOnline` | ❌ | toggle works (`SpellOnline` draws the red wave in tiles); dialog for the checker | Ribbon Review › Spelling (toggle) ; RC:text on a misspelling › suggestions (needs `getCommandValues('.uno:SpellCheckIgnoreAll')`-style query; LO exposes suggestions through the context menu path, so this rides on the RC:text menu) |
| Thesaurus / Synonyms | `ThesaurusDialog` | ❌ | dialog | RC:text › Synonyms ▸ |
| Language ▸ for selection / paragraph / all | `SetLanguageSelectionMenu`… | ❌ | uno+args (`LanguageStatus`) | Ribbon Review › Language ▾; status bar language click |
| Hyphenation… | `Hyphenate` | 🟡 auto only | | keep |
| Word count | `WordCountDialog` | ❌ | `getCommandValues('.uno:WordCountDialog')`? no — read via `STATE_CHANGED .uno:StateWordCount` | **Status bar** live words/characters (selection-aware); Ribbon Review |
| Accessibility check, Translate | | ❌ | | Translate belongs to an agent, not a dialog |
| AutoCorrect ▸ while typing / apply / options | `OnlineAutoFormat`, `AutoCorrectDlg` | ❌ | toggle / dialog | Menu Tools › AutoCorrect ▸ |
| AutoText, ImageMap, Redact, Auto-redact | | ❌ | | Out of scope (Redact = agent) |
| Heading numbering…, line numbering…, footnote settings… | `ChapterNumberingDialog`, `LineNumberingDialog`, `FootnoteDialog` | ❌ | dialog | Menu Tools; Ribbon Layout › Line numbers ▾ (on/off via `LineNumberingDialog` args is not possible; needs dialog) |
| Mail merge wizard, Bibliography, Address book | | ❌ | | Out of scope (mail merge = agent + Mail surface later) |
| Update ▸ all / fields / indexes / links / charts / page formatting | `UpdateAll` ✅, `UpdateFields`, `UpdateAllIndexes`, `UpdateAllLinks`, `UpdateCharts`, `Repaginate` | 🟡 | uno | Ribbon References › Update ▾; Menu Tools › Update ▸ |
| Protect document ▸ fields / bookmarks; Calculate; Sort… | | ❌ | uno / dialog | Menu Tools |
| Macros, Development tools, XML filter, Extensions, Customize, Options | | ❌ | | Out of scope by design (agents replace macros) |
## 5. Calc — gap map by LibreOffice menu

File and the shared Edit items are as for Writer. Calc-specific:

### Edit / View
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Paste Special ▸ unformatted / text only / numbers only / formula only / transposed / dialog | `PasteOnlyText`, `PasteOnlyValue`, `PasteOnlyFormula`, `PasteTransposed`, `PasteSpecial` | 🟡 dialog item in RC:cell (bitmap tunnel) | uno one-shots for the five variants | RC:cell › Paste Special ▸ (five one-click variants first, dialog last); Menu Edit; ⇧⌘V = values only |
| Select ▸ row / column / data area / unprotected / visible rows/columns / sheets | `SelectRow`, `SelectColumn`, `SelectData`, `SelectVisibleRows`… | 🟡 row/column via header click | uno | Menu Edit › Select ▸; ⌘⇧Space/⌘Space (row/column) ; ⌘* data area |
| Cell edit mode, cell protection toggle, links to external files, edit mode | `SetInputMode` (F2), `CellProtection`, `EditLinks` | ❌ | uno | F2 on canvas; Menu Edit |
| Track changes record / show / manage / comment / protect / compare / merge | `TraceChangeMode`, `ShowChanges`, `AcceptChanges` | ❌ | uno + panel | Ribbon Review tab (Calc has none today: add Review with Comments, Changes, Spelling, Protect) |
| Normal / page break view | `NormalViewMode`, `PagebreakMode` | ❌ | mode | Ribbon View › Layout radio |
| Formula bar, headers, grid lines toggles | `InputLineVisible`, `ViewRowColumnHeaders` ✅, `ToggleSheetGrid`/`ViewGrid` ✅ | 🟡 | uno toggles with state | Ribbon View › Show |
| Value highlighting, column/row highlighting, hidden indicator, show formulas | `ViewValueHighlighting`, `ViewColumnRowHighlighting`, `ViewHiddenColRow`, `ToggleFormula` | ❌ | uno toggles | Ribbon View › Show; ⌘` show formulas |
| Comments show/hide | `ShowAnnotations` | ❌ | uno | Ribbon Review |
| Split window; freeze rows & columns; freeze first row / first column | `SplitWindow`, `FreezePanes` ✅, `FreezePanesRow`, `FreezePanesColumn` | 🟡 | uno | Ribbon View › Window (Freeze ▾ with the three options, Split); RC:row/column header (already in LO's list) |
| Function list, Navigator, Styles panel | `FunctionBox`, `Navigator` | ❌ | panel | Panel "Functions" (search + insert, extends the autocomplete list); Panel "Navigator" (sheets, names, ranges, charts) |
| Zoom presets / fit | | 🟡 | | as Writer; **Canvas ⌘-wheel** |

### Insert (Calc)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Image, Chart, Sparkline, Pivot table | `InsertGraphic` ✅, `InsertObjectChart` ✅ (macro), `InsertSparkline`, `DataDataPilotRun` ✅ (tunnel) | 🟡 | sparkline = uno+args (`InsertSparkline` with `InputRange`) | Ribbon Insert › Sparkline ▾ (line/bar/win-loss over the selection); RC:cell › Sparklines ▸ |
| Shapes, text box, Fontwork | | ❌ | as Writer (`WosShapeInsert` already targets the sheet's DrawPage) | Ribbon Insert › Shapes ▾ / Text box |
| Function… (wizard) | `FunctionDialog` | 🟡 bitmap tunnel (no scroll) | React "Insert function" dialog fed by our function catalogue, or JSDialog | Ribbon Formulas tab (new: Insert function, AutoSum ▾, Named ranges, Show formulas, Trace); formula bar `fx` button |
| Named range or expression…; Names ▸ define / manage / insert / create / labels | `InsertName`, `AddName`, `DefineName` 🟡 tunnel, `CreateNames` | 🟡 | React dialog (name + range) / panel | Ribbon Formulas › Names ▾; **Name box** left of the formula bar (type a name, Enter defines it; dropdown lists names, click jumps); Panel Navigator |
| Comment | `InsertAnnotation` | ❌ in Calc | uno + callbacks | RC:cell › Insert comment ⇧F2; Ribbon Review; **Canvas: red corner triangle, hover shows, click edits** |
| Hyperlink, special character, formatting marks | | ✅ / ✅ / ❌ | | keep |
| Date, Time, Field ▸ (date variable, sheet name, title) | `InsertCurrentDate` ✅, `InsertCurrentTime` ✅, `InsertFieldSheet`, `InsertFieldDocTitle` | 🟡 | uno | Ribbon Insert › Field ▾ |
| Headers and footers… | `EditHeaderAndFooter` | ❌ | dialog (or extend the Writer header macro to page styles in Calc) | Ribbon Layout tab (new for Calc: margins, orientation, size, print area ✅, print titles, header/footer, scale to fit, page breaks); Menu Insert |
| Form controls | | ❌ | | Out of scope |

### Format (Calc)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Text ▸ (as Writer) + Wrap text ✅ | | 🟡 | uno | Ribbon Home › Font ▾ overflow |
| Align ▸ H and V | | ✅ | | keep; mini-toolbar |
| Number format ▸ general / number / percent / currency / date / time / scientific / thousands; inc/dec decimals | | ✅ (ribbon + Format Cells dialog) | uno | keep; add a **Number format ▾ combo** on the ribbon showing the current format (state from `.uno:NumberFormatStandard` etc.) |
| Clone formatting, clear direct formatting | | ✅ | | keep |
| Cells… (Format Cells: numbers, font, effects, alignment, borders, background, protection) | `FormatCellDialog` | 🟡 numbers only + separate Borders dialog | React dialog expanded to tabs (font/alignment via uno, borders via `WosSetBorder`, background `BackgroundColor`, protection `CellProtection`) | RC:cell › Format cells… ⌘1; Menu Format; Home group launcher |
| Row ▸ height / optimal / hide / show; Column ▸ width / optimal / hide / show | | ✅ RC + ribbon (height/width via tunnel) | replace tunnel with a tiny React prompt → `WosSetSize` | RC:row/column header; Home › Cells › Format ▾ |
| Merge and unmerge ▸ merge & center / merge / unmerge | `ToggleMergeCells` ✅, `MergeCells`, `SplitCell` | 🟡 toggle only | uno | Ribbon Home › Alignment › Merge ▾ (three options); RC:cell |
| Character…, Paragraph… | | ❌ | dialog | Menu Format (rare in Calc) |
| Page style… | `PageFormatDialog` | ❌ | dialog / macros | Layout tab (see Insert › Headers) |
| Conditional ▸ condition / colour scale / data bar / icon set / date / manage… | `ConditionalFormatDialog`, `ColorScaleFormatDialog`, `DataBarFormatDialog`, `IconSetFormatDialog`, `ConditionalFormatManagerDialog` | 🟡 one condition + colour via macro | extend `WosCondFormat` (colour scale, data bar, icon set are model-API entries) + a "Manage rules" panel | Ribbon Home › Styles › Conditional ▾ (presets gallery: highlight >, <, between, duplicates; colour scales; data bars; icon sets; Manage rules…); RC:cell › Conditional formatting ▸ |
| AutoFormat styles…, spreadsheet theme, Theme… | `AutoFormat`, `ChooseDesign`, `ThemeDialog` | ❌ | dialog | Ribbon Home › Styles › Format as table ▾ (gallery → `AutoFormat` args); Menu Format |
| Cell styles: default, accent 1–3, heading 1–2, good/bad/neutral, error/warning, footnote/note; update / manage | `DefaultCellStyles`, `Accent1CellStyles`, `GoodCellStyles`… | ❌ | uno one-shots (each is a command) | Ribbon Home › Styles **gallery** (12 tiles); RC:cell › Styles ▸ |
| Image ▸ crop / original size / fit to cell / replace / compress; Chart ▸; Sparklines ▸ (edit, delete, group) | `Crop`, `OriginalSize`, `FitCellSize`, `EditSparkline`, `DeleteSparkline` | ❌ | uno | RC:image / RC:chart / RC:cell with sparkline |
| Text box & shape, name, alt text, anchor (to cell / to cell resize / to page), arrange, flip, group | as Writer; `SetAnchorToCell`, `SetAnchorToCellResize`, `SetAnchorToPage` | ❌ | uno / reuse Impress macros | RC:shape/image; contextual Shape / Picture tab |

### Sheet
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Insert cells… / rows above-below / columns before-after; delete cells… / rows / columns | | ✅ (RC:cell + ribbon; cells dialog via tunnel) | replace the Insert/Delete Cells tunnel with a 4-option React popover (shift down / right / entire row / column → `InsertCell {FillMode}`) | keep; Menu Sheet |
| Insert / delete page break (row, column) | `InsertRowBreak`, `InsertColumnBreak`, `DeleteRowbreak`, `DeleteColumnbreak` | ❌ | uno | Layout tab › Breaks ▾; RC:row/column header in page-break view |
| Insert sheet…, at end, from file…, external links…; delete sheet | `Insert`, `Add`, `InsertSheetFromFile`, `Remove` | ✅ via `WosSheetOp` (insert at end, delete) | macro; "from file" = dialog | **RC:sheet tab** (Insert sheet, Delete, Rename, Duplicate, Move or copy…, Hide, Show ▸, Tab colour ▾, Protect…, Select all sheets); Menu Sheet |
| Clear cells… (contents / formats / comments / all) | `Delete` (dialog) vs `ClearContents` ✅ | 🟡 | uno one-shots exist: `ClearContents`, `.uno:Delete` with args? — prefer a small popover: Contents / Formats / Comments / Everything | RC:cell › Clear ▸; Home › Cells › Clear ▾ |
| Cycle cell reference types (F4) | `ToggleRelative` | ❌ | uno | F4 in the formula bar; Menu Sheet |
| Fill ▸ down / right / up / left / sheets… / series… / random… | `FillDown` ✅, `FillRight` ✅, `FillUp`, `FillLeft`, `FillSeries`, `RandomNumberGeneratorDialog` | 🟡 | uno; series = dialog or `FillSeries` args; **Canvas: fill handle** (small square at the cell-cursor corner; drag = `AutoFill` via mouse events or `WosFill` macro with the target range) | Canvas fill handle first; Home › Cells › Fill ▾; RC:cell › Fill ▸ |
| Named ranges (see Insert), Cell comments ▸ edit / hide / show / delete / delete all | `EditAnnotation`, `HideNote`, `ShowNote`, `DeleteNote`, `DeleteAllNotes` | ❌ | uno + `COMMENT` callback | RC:cell › Comment ▸ (Edit, Show/Hide, Delete); Review tab |
| Rename, hide, show…, move or copy…, duplicate, tab colour…, right-to-left, sheet events | `RenameTable` ✅, `Hide`, `Show`, `Move`, `DuplicateSheet`, `SetTabBgColor` | 🟡 rename/move-by-one only | macro (`WosSheetOp` extended) / uno (`DuplicateSheet`, `Hide`, `SetTabBgColor {TabBgColor}`) | RC:sheet tab; **Canvas: drag a sheet tab to reorder**; Menu Sheet |
| Navigate ▸ go to sheet… / previous / next | `JumpToTable`, `JumpToPrevTable`, `JumpToNextTable` | 🟡 native Go menu list | uno | ⌥⌘← / ⌥⌘→ (Excel: ⌃PgUp/PgDn); Go menu ✅ |

### Data
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Sort… / ascending / descending | `DataSort` 🟡 tunnel, `SortAscending` ✅, `SortDescending` ✅ | 🟡 | React sort dialog (up to 3 keys, header row, case) → `DataSort` args (`ByRow`, `SortKey1`, `IsCaseSensitive`, `ContainsHeader`) | Ribbon Data › Sort ▾; RC:cell › Sort ▸ (A→Z, Z→A, Custom…); **Canvas: AutoFilter arrow menu** |
| AutoFilter; more filters ▸ standard / advanced / reset / hide / clear | `DataFilterAutoFilter` ✅, `DataFilterStandardFilter`, `DataFilterSpecialFilter`, `DataFilterRemoveFilter`, `ClearAutoFilter` | 🟡 toggle only, **no dropdown arrows** | **Canvas: filter buttons in header cells** (positions from `SheetGeometryData` + `getCommandValues('.uno:AutoFilter')`? — LO's `VALIDITY_LIST_BUTTON`/autofilter popup arrives as a `WINDOW` callback of type "dropdown"; render it as our own popover: sort, search, value checklist, colour, top 10) | Canvas arrows; Ribbon Data › Filter ▾; RC:cell › Filter ▸ (Filter by selected value, Clear) |
| Duplicates… | `HandleDuplicateRecords` | ❌ | dialog (new in LO 25.x) | Ribbon Data › Remove duplicates |
| Define / select / refresh range | `DefineDBName`, `SelectDB`, `DataAreaRefresh` | ❌ | dialog | Menu Data |
| Pivot table ▸ insert or edit / refresh / delete | `InsertPivotTable` 🟡 tunnel, `RecalcPivotTable`, `DeletePivotTable` | 🟡 | pivot layout needs a real dialog or a **React field-list panel** (rows/columns/values/filters drag targets → `DataPilot` via macro `WosPivot`) | Ribbon Data › Pivot table; **RC:pivot** (Refresh, Properties…, Filter…, Delete); Panel "Pivot fields" while a pivot is selected |
| Calculate ▸ recalculate / hard / formula to value / auto | `Calculate`, `CalculateHard`, `ConvertFormulaToValue`, `AutomaticCalculation` | ❌ | uno | Ribbon Formulas › Calculation; F9 / ⇧⌘F9 |
| Validity…, Subtotals…, Form… | `Validation` ✅ (React), `DataSubTotals`, `DataForm` | 🟡 | dialog | Ribbon Data › Validation ✅, Subtotals… (React: group by column, function, columns) |
| Streams, XML source, Data provider, Multiple operations | | ❌ | | Out of scope |
| Text to columns… | `TextToColumns` | ❌ | dialog (delimiter picker → `TextToColumns` args) | Ribbon Data › Text to columns |
| Consolidate… | `DataConsolidate` | ❌ | dialog | Menu Data |
| Group and outline ▸ group / ungroup / auto-outline / remove / hide-show details | `Group`, `Ungroup`, `AutoOutline`, `ClearOutline`, `HideDetail`, `ShowDetail` | ❌ | uno (+ **Canvas: outline bar with +/− buttons** left of row headers, from `SheetGeometryData` group info) | Ribbon Data › Outline; ⌥⇧→ / ⌥⇧← |
| Statistics ▸ (sampling, descriptive, ANOVA, correlation, covariance, moving average, regression, t/F/z/chi tests, Fourier) | `SamplingDialog`, `DescriptiveStatisticsDialog`… | ❌ | dialog | Menu Data › Statistics ▸ (all dialog; JSDialog candidates; an agent does these better) |
| Goal seek…, Solver…, Scenarios… | `GoalSeekDialog`, `SolverDialog`, `ScenarioManager` | ❌ | dialog | Ribbon Data › What-if ▾ (Goal seek is a small React dialog: formula cell, target, variable cell → `GoalSeek` via macro) |
| Detective ▸ trace precedents / dependents / errors, remove, refresh, mark invalid | `ShowPrecedents`, `ShowDependents`, `ClearArrows`, `ShowErrors`, `ShowInvalid` | ❌ | uno (arrows render in tiles) | Ribbon Formulas › Auditing; RC:cell › Trace ▸ |
| Protect sheet…, protect structure…, share | `Protect`, `ToolProtectionDocument` | ❌ | dialog (password) | Ribbon Review › Protect sheet; RC:sheet tab |
| AutoInput (autocomplete in cells), AutoCorrect | `AutoComplete` | ❌ | toggle | Menu Tools |
## 6. Impress — gap map by LibreOffice menu

### Edit / View
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Duplicate… (object copies with offset), Paste Special | `CopyObjects`, `PasteUnformatted` | ❌ | dialog / uno | RC:shape › Duplicate ⌘D (one copy, offset 0.5 cm without dialog); Menu Edit |
| Find & Replace | | ❌ Impress (bar disabled) | extend `WosFindReplace` to iterate draw pages' text shapes | keep the bar; enable for Impress |
| Point edit mode, glue points | `ToggleObjectBezierMode`, `GlueEditMode` | ❌ | uno (points render in tiles; handles need our overlay) | RC:shape › Edit points; Shape tab |
| Fields…, external links, OLE | | ❌ | | Out of scope |
| Normal / Outline / Notes / Slide sorter / Master slide / Master notes / Master handout | `NormalMultiPaneGUI`, `OutlineMode`, `NotesMode`, `DiaMode`, `SlideMasterPage`, `NotesMasterPage`, `HandoutMode` | ❌ (rail + notes pane only) | mode (LOK `setPart`+ view-mode uno; sorter can be **our own grid** over `slidesSvg`, outline = a React outliner writing back via `WosShapeText`) | Ribbon View › Views radio (Normal, Outline, Slide sorter, Notes, Master); Menu View; **status-bar view buttons** |
| Slide pane, notes pane, views tab bar, rulers | | 🟡 rail ✅ notes ✅ | | Ribbon View › Show |
| Grid and helplines: display grid ✅, grid to front, helplines while moving, snap guides ▸ (display, to front, snap to grid / guides / border / points / margins) | `GridVisible` ✅, `GridFront`, `HelplinesMove`, `HelplinesVisible`, `GridUse`, `HelplinesUse`, `SnapFrame`, `SnapPoints`, `SnapBorder` | 🟡 | uno toggles | Ribbon View › Guides ▾ (checkboxes); RC:slide › Grid and guides ▸ ; **Canvas: our own smart guides** during drag (centre/edge alignment lines from `WosSelInfo` of siblings) |
| Comments, colour/grayscale, slide layout / transition / animation panes, styles, colour bar | `ShowAnnotations`, `OutputQuality*`, `ModifyPage`, `SlideChangeWindow`, `CustomAnimation` | ❌ | uno / panel | Panels (see Slide / Format) |
| Zoom ▸ + zoom & pan, previous / next, object zoom | `ZoomMode`, `ZoomPrevious`, `ZoomNext`, `ZoomObjects` | 🟡 | client | Ribbon View › Zoom (Fit slide, Fit width, Zoom to selection); **Canvas ⌘-wheel and pinch** |

### Insert
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Image ✅, audio/video, chart ✅ (macro), table ✅ | `InsertAVMedia` | 🟡 | media = uno with FileName (renders poster only in tiles) | Ribbon Insert › Media (video poster + link; playback in present mode is out of scope) |
| Photo album, animated image, scan, Fontwork, OLE, QR code | | ❌ | | Out of scope except QR (`InsertQrCode` args) → Ribbon Insert › QR code |
| Shapes: line, curves, polygons, symbol, arrows, flowchart, callouts, stars | `Line`, `Bezier_Unfilled`, `SymbolShapes.*`, `ArrowShapes.*`, `FlowChartShapes.*`, `CalloutShapes.*`, `StarShapes.*` | 🟡 6 kinds via macro | extend `WosShapeInsert` with the CustomShape geometry names (`smiley`, `right-arrow`, `flowchart-process`, `cloud-callout`, `star5`…) — the engine's shape types are strings | Ribbon Insert › Shapes ▾ gallery (grouped like PowerPoint: Lines, Rectangles, Basic, Block arrows, Flowchart, Stars & banners, Callouts); Menu Insert › Shape ▸; **Canvas: click-drag to draw** (`.uno:BasicShapes.x` enters draw mode; the engine draws on mouse drag) |
| Snap guide… | `CapturePoint` | ❌ | dialog | RC:ruler (when rulers exist) |
| Text box ✅, comment, hyperlink ✅, special character ✅, formatting marks | `InsertAnnotation` | 🟡 | comment: uno + `COMMENT` callback + panel | Ribbon Review (new for Impress: Comments, Spelling); Panel Comments |
| Slide number, Field ▸ (date fixed/variable, time, author, slide number, slide title, slide count, file name) | `InsertSlideField`, `InsertDateFieldFix`, `InsertAuthorField`, `InsertSlideTitleField`, `InsertSlidesField`, `InsertFileField` | ❌ | uno (inserts into the current text edit) | Ribbon Insert › Field ▾; Menu Insert › Field ▸ |
| Header and footer… (date, footer text, slide number, apply to all) | `HeaderAndFooter` | ❌ | dialog → React (three checkboxes + text, applies via `HeaderAndFooter` args or `WosSlideFooter` macro on the master) | Ribbon Insert › Header & footer; Design tab |
| Form controls | | ❌ | | Out of scope |

### Format (Impress)
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Text ▸, spacing ▸, align ▸ (H + V in cells), lists ▸ (promote/demote/move) | | 🟡 shared font group + para; V-align ❌ | uno (`CellVertTop`… for table cells) | Ribbon Home; RC:textbox › Character…/Paragraph…; RC:table cell › Align ▸ |
| Clear direct formatting, styles ▸ (edit, update, new, manage) | `SetDefault`, `EditStyle`… | 🟡 clear ✅ | panel | Panel Styles (drawing + presentation styles) |
| Character…, Paragraph…, Bullets and numbering…, Theme… | `FontDialog`, `ParagraphDialog`, `OutlineBullet`, `ThemeDialog` | ❌ | dialog | RC:textbox; Menu Format |
| Table ▸ rows / columns / merge / unmerge / delete / select / properties | | ✅ structure via `WosSlideTableOp` (last row/col only), cell format via macro | fix scope: resolve the **selected cell** from `TABLE_SELECTED` callback / `getCommandValues('.uno:TableSelection')`?  — LO exposes the cell address via `LOK_CALLBACK_TABLE_SELECTED`; use it | **RC:table** (Insert ▸, Delete ▸, Merge, Split, Size ▸, Properties…); contextual Table tab; **Canvas: drag cell borders** |
| Image ▸ crop, original size, replace, compress, save, filters, colour, crop dialog | | ❌ | uno; **Canvas crop handles** (`Crop` toggles crop mode; engine shows crop handles in tiles) | RC:image; contextual Picture tab |
| Text box and shape ▸ position & size…, text attributes…, line…, area… | `TransformDialog`, `TextAttributes`, `FormatLine`, `FormatArea` | 🟡 fill/line/stroke/gradient/pattern/shadow via macros | React "Position & size" (x, y, w, h, rotation → `WosShapeMove/Size` + `RotateAngle` via macro); Area/Line = current Design controls promoted to a **Format shape panel** (fill: none/solid/gradient/pattern/image; line: colour/width/dash/arrowheads; effects: shadow/transparency/glow) | RC:shape › Format shape… (opens the panel); contextual Shape tab; Panel |
| Shadow, Text along path, Interaction… | `FillShadow` ✅ macro, `FontWork`, `AnimationEffects` | 🟡 | | Interaction (click → go to slide / URL) = React dialog; RC:shape › Interaction… |
| Name…, Alt text…, Distribute selection, Rotate (mode) | `NameGroup`, `ObjectTitleDescription`, `DistributeSelection` ✅ (H/V), `ToggleObjectRotateMode` | 🟡 | uno; **Canvas rotate handle** | RC:shape; Shape tab |
| Flip ▸ V / H | `MirrorVert`, `MirrorHorz` | ❌ | uno | RC:shape › Flip ▸; Shape tab › Rotate ▾ |
| Convert ▸ curve / polygon / contour / 3D / bitmap / metafile | `ChangeBezier`, `ChangePolygon`, `ConvertInto3D`, `ConvertIntoBitmap` | ❌ | uno | RC:shape › Convert ▸ (menu only) |
| Align objects ▸, Arrange ▸ (front, forward, backward, back, in front of, behind, reverse), Group ▸ | | ✅ via `WosArrange` (front/back/forward/backward, align, distribute); group ❌ | uno `FormatGroup` / `FormatUngroup` / `EnterGroup` / `LeaveGroup` | RC:shape › Arrange ▸ / Align ▸ / Group ⌘G; Shape tab (already Design); **Canvas: double-click a group to enter it** |

### Slide
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| New ✅, duplicate ✅, delete ✅, insert slide from file…, rename…, hide / show, jump to last edited | `InsertPage`, `DuplicatePage`, `DeletePage`, `ImportSlideFromFile`, `RenameSlide`, `HideSlide`, `ShowSlide` | 🟡 | uno (`RenameSlide {Name}`, `HideSlide` needs the slide selected → set part first) | **RC:slide thumbnail** (New slide, Duplicate, Delete, Rename…, Hide/Show, Layout ▸, Move ▸, Slide transition…, Properties…); Ribbon Home › Slides; Menu Slide |
| Layout ▸ (16 auto-layouts) | `AssignLayout?WhatLayout:long=n` | 🟡 5 via `WosSetLayout` | list all 16 with **rendered thumbnails** | Ribbon Home › Layout ▾ gallery; RC:slide / RC:thumbnail › Layout ▸ |
| Set background image…, slide properties… (size, orientation, background, numbering) | `SelectBackground`, `SlideSetup` | 🟡 colour bg via macro | React "Slide size" (16:9 / 4:3 / custom → `WosSlideSize` macro on all pages + master) + background image via `WosSlideBg` extension | Ribbon Design › Slide size ▾, Background ▾ (colour ✅, gradient, image…); RC:slide › Background…; Menu Slide › Slide Properties… |
| Change slide master…, delete master, master background / objects, master elements… | `PresentationLayout`, `DisplayMasterBackground`, `DisplayMasterObjects`, `MasterLayouts` | ❌ | master view (mode) + uno toggles | Ribbon Design › Masters ▾ (list from `getCommandValues`? — enumerate via macro `WosMasters`); Ribbon View › Master; RC:slide › Master ▸ |
| Move ▸ start / up / down / end | `MoveSlideFirst`, `MoveSlideUp`, `MoveSlideDown`, `MoveSlideLast` | 🟡 drag ✅ | uno | RC:thumbnail › Move ▸; ⌘↑ / ⌘↓ on the rail |
| Navigate ▸ first / previous / next / last / go to… | `FirstSlide`, `PreviousSlide`, `NextSlide`, `LastSlide`, `GotoSlide` | 🟡 rail click, Go menu | uno / `setPart` | PgUp/PgDn/Home/End on the rail; Menu Slide › Navigate ▸ |
| Summary slide, expand slide | `SummaryPage`, `ExpandPage` | ❌ | uno | Menu Slide (agent territory) |
| Slide transition (type, variant, duration, sound, advance, apply to all) | `SlideChangeWindow` (sidebar) | ❌ | **panel** — LO exposes transitions only through the sidebar; write via macro `WosTransition` (`oSlide.Effect`, `Speed`, `Change`, `Duration`, `TransitionType/Subtype`) and read the same way | Ribbon **Transitions tab** (gallery of the ~15 OOXML-safe transitions, duration, apply to all, advance on click / after N s); RC:thumbnail › Slide transition… |
| Animation (entrance, emphasis, exit, motion; order, timing, trigger) | `CustomAnimation` (sidebar) | ❌ | **panel** — macro `WosAnimate` via `oSlide.MainSequence` (presentation.EffectNode) for a curated set (Appear, Fade, Fly in, Wipe, Zoom; emphasis Pulse; exit Fade) + order list | Ribbon **Animations tab** (gallery + Animation pane with the sequence, reorder, timing); RC:shape › Animate ▸ |

### Slide Show
| Function | Command | Status | Mechanism | Home |
|---|---|---|---|---|
| Start from first ✅ / current, rehearse timings, custom show…, remote, settings… | `Presentation` ✅ (own PresentMode), `PresentationCurrentSlide`, `RehearseTimings`, `CustomShowDialog`, `PresentationDialog` | 🟡 | own React present mode (already renders `partTile`); add "from current" (start at the active part), a **presenter view** (notes ✅ exist + next slide + timer on a second window), and loop / auto-advance from the transition data | Ribbon Slide Show tab (From beginning ⌥⌘P, From current ⇧⌘Return, Presenter view, Rehearse, Set up); RC:thumbnail › Start from here |

### Tools (Impress)
Spelling and language as Writer (Review tab). Minimize presentation (compress images) = agent or `PresentationMinimizer` dialog later. ImageMap, colour replacer, media player, forms, macros: out of scope.
## 7. The right-click menus, target by target

These are LibreOffice's own popup menus reduced to what a manager uses, in the order LibreOffice uses. Every item is an existing `.uno:` command or an existing app dialog unless marked. Build them as one data-driven model like `calcMenu.ts`, keyed by target, with `enabled`/`checked` read from the state map.

**Writer · text** — Cut · Copy · Paste · Paste unformatted ─ Character… · Paragraph… · Bullets & numbering… ─ Paragraph style ▸ (Body, H1–H3, Title, Quote, Preformatted) · Character style ▸ (None, Emphasis, Strong, Source) ─ Clone formatting · Clear direct formatting ─ Insert comment · Insert hyperlink… · Footnote ─ Synonyms ▸ · spelling suggestions (when on a misspelling) ─ Page style…
**Writer · text on a hyperlink** — adds Open link · Edit link… · Copy link address · Remove link.
**Writer · text in a list** — adds List ▸ (No list, bullet/number styles, Promote, Demote, Restart numbering, Add to list).
**Writer · text in a tracked change** — adds Accept change · Reject change · Next · Previous.
**Writer · table cell** — Cut/Copy/Paste ─ Insert ▸ (rows above/below, columns before/after) · Delete ▸ (rows, columns, table) · Select ▸ (cell, row, column, table) ─ Merge cells · Unmerge ─ Size ▸ (row height…, optimal, distribute rows; column width…, optimal, distribute columns) ─ Table style ▸ · Header row repeats ─ Character… · Paragraph… ─ Insert caption… · Table properties…
**Writer · image** — Cut/Copy/Paste ─ Crop · Replace… · Save as… · Compress… ─ Anchor ▸ · Wrap ▸ · Align ▸ · Arrange ▸ · Rotate or flip ▸ ─ Insert caption… · Alt text… · Properties…
**Writer · shape / text box** — Cut/Copy/Paste ─ Edit points · Position & size… · Line… · Area… · Text attributes… ─ Anchor ▸ · Wrap ▸ · Align ▸ · Arrange ▸ · Flip ▸ · Group ▸ ─ Insert hyperlink… · Alt text…
**Writer · comment** — Reply · Resolve · Delete · Delete thread · Delete all comments by author · Delete all.

**Calc · cell** (extend today's) — add Paste special ▸ (unformatted, text, numbers, formulas, transposed, dialog…) · Selection list (`DataSelect`) · Data validation… · Sort ▸ · Filter ▸ · Insert comment / Edit / Show-hide / Delete ─ Styles ▸ (12 cell styles) · Conditional formatting ▸ · Sparklines ▸ · Clear ▸ (contents/formats/comments/all) · Trace ▸ · Hyperlink items when on a link.
**Calc · row / column header** (extend) — add Freeze rows & columns · Split window · Group / Ungroup · Page break insert/remove.
**Calc · sheet tab** (new) — Insert sheet… · Delete sheet · Rename… · Duplicate · Move or copy… · Hide · Show ▸ · Tab colour ▾ · Protect sheet… · Select all sheets · Right-to-left.
**Calc · shape / image / chart** (new) — as Writer minus wrap; chart adds Edit chart (enters chart edit mode, `.uno:ChartMenu` items: chart type, data ranges, titles, legend, axes) · Refresh · Cut/Copy/Paste.
**Calc · pivot table** (new) — Refresh · Filter… · Properties (field panel) · Delete.
**Calc · AutoFilter button** — Sort A→Z / Z→A · Sort by colour · Top 10 · Empty / Not empty · Search + value checklist · Clear filter.

**Impress · slide (empty area)** — Cut/Copy/Paste ─ Layout ▸ (16) · Background… · Change slide master… · Slide transition… · Slide properties… ─ Grid and guides ▸ ─ Navigate ▸ · Move ▸ (in sorter).
**Impress · slide thumbnail (rail)** — New slide · Duplicate · Delete · Rename… · Hide/Show · Layout ▸ · Move ▸ · Slide transition… · Start slideshow from here.
**Impress · text box** — Cut/Copy/Paste ─ Character… · Paragraph… · Bullets… ─ Shrink text on overflow (toggle) · Position & size… · Format shape… ─ Align ▸ · Arrange ▸ · Group ▸ ─ Animate ▸ · Interaction… · Alt text…
**Impress · shape / image** — as text box plus Edit points · Flip ▸ · Convert ▸ · Crop (image) · Replace image… · Save as… · Duplicate.
**Impress · table** — Cut/Copy/Paste ─ Insert ▸ · Delete ▸ · Merge · Unmerge · Size ▸ ─ Character… · Paragraph… ─ Align ▸ (incl. vertical) · Arrange ▸ ─ Table properties…

## 8. The left-click and drag affordances to add

All are overlays on our side that end in a `.uno:` command, a mouse event to the engine, or a `Wos*` macro; none needs a dialog.

| Affordance | Apps | Engine hook | Notes |
|---|---|---|---|
| **⌘-wheel and pinch zoom**, centred on the pointer | all | client zoom | today only buttons and ⌘± |
| **Mini-toolbar** floating above a text/cell/shape selection | all | uno | font, size, B/I/U, colour, highlight, align; shape: fill/outline; appears on mouse-up with a selection |
| **Fill handle** at the cell-cursor corner | Calc | `WosFill` macro (`oRange.fillAuto(direction, count)`) or engine drag | double-click fills down to the neighbour's extent |
| **AutoFilter arrows** in header cells + popover | Calc | `WINDOW` callback type dropdown → own popover; apply via `DataFilterStandardFilter` args or macro `WosFilter` | the single most-used Excel gesture missing |
| **Name box** left of the formula bar | Calc | `getCommandValues('.uno:NamedRanges')`? → macro `WosNames list`; jump via `GoToCell {ToPoint}` | type `Q3_total` + Enter defines a name |
| **Outline +/− bar** beside row/column headers | Calc | `HideDetail` / `ShowDetail` per group; geometry from `SheetGeometryData` (has `groupLevels`) | |
| **Sheet-tab drag reorder**, tab colour strip, right-click | Calc | `WosSheetOp move\|<to>` (extend) ; `SetTabBgColor` | |
| **Comment anchors**: red triangle (Calc), margin bubble (Writer/Impress); hover preview, click to open thread | all | `LOK_CALLBACK_COMMENT` + `getCommandValues('.uno:ViewAnnotations')` | prerequisite for the Comments panel |
| **Tracked-change marks** in the margin, click → accept/reject popover | Writer | `getCommandValues('.uno:AcceptTrackedChanges')` (redline list with rects) | |
| **Rotate handle** above the selection box | all | macro `WosShapeRotate <deg>` (`oShape.RotateAngle`) | Shift snaps to 15° |
| **Crop handles** when Crop is active | all | `.uno:Crop` toggles engine crop mode; handles drawn in tiles, our overlay just tracks `GRAPHIC_SELECTION` | |
| **Smart guides** during move/resize (edges/centres of siblings, slide centre) | Impress, shapes elsewhere | `WosSelInfo`-style sibling geometry read once per drag | replaces LO's snap lines |
| **Table grips**: row/column select handles at the table edge, border drag to resize, hover + on edges to insert | Writer, Impress | `EntireRow` / `EntireColumn` / `SetRowHeight` via macro; insert via `WosTableOp` at the hovered index | needs the table cell address → `TABLE_SELECTED` callback |
| **Double-click header/footer area** to edit; double-click a group to enter it; double-click a chart to edit it | Writer / all / all | engine already switches on the click; we need the cursor feedback and an "Exit" chip | |
| **Ruler** with margin, indent and tab-stop drags | Writer | `getCommandValues('.uno:PageDialog')`? no — page geometry from `DOCUMENT_SIZE` + `WosPageMargins` read; indents via `.uno:ParaLeftMargin` args | a later item |
| **Status bar**: page x/y, words, sheet, cell sum/avg/count of selection, slide n/N, zoom slider, view-mode buttons, language | all | `STATE_CHANGED` for `StatePageNumber`, `StateWordCount`, `StateTableCell`, `StatusBarFunc`, `Zoom` | free once the state map is generic |

## 9. Dialogs: the one decision that unblocks the rest

About 90 of the entries above end in "…". Three options; the recommendation is the third.

1. **Keep tunnelling native dialogs as bitmaps** (today's `DialogOverlay`). Cheapest, but they look foreign, cannot scroll or drag, and each needs its own key handling. Acceptable only as a stopgap for rare dialogs (Statistics, Consolidate, Sections).
2. **Build the LOKit JSDialog bridge** (`LOK_FEATURE_...` `jsdialog` in `initializeForRendering`, callbacks type `JSDIALOG`). The engine then emits every dialog as a JSON widget tree; one React renderer for ~25 widget kinds (dialog, tabcontrol, fixedtext, edit, spinfield, combobox, listbox, checkbox, radiobutton, pushbutton, colorlistbox, drawingarea…) covers all of LibreOffice's dialogs at once, styled as ours. Collabora Online proves the approach. Cost: one to two weeks for the renderer plus fixes as odd dialogs appear; the payoff is every "…" item for free, including ones we would never hand-write (Paragraph, Character, Page Style, Table Properties, Pivot layout, Sort, Statistics).
3. **Hand-written React dialogs for the top twenty, JSDialog for the long tail.** The twenty are the ones a manager meets weekly and where our version can be *better* than LibreOffice's: Sort, Insert/Delete cells, Clear ▸, Format Cells (full), Insert function, Define name, Paste special, Text to columns, Goal seek, Slide size, Header & footer (Impress), Position & size, Format shape panel, Hyperlink ✅, Insert table ✅ + grid picker, Character (basic), Paragraph (basic), Page setup (Writer, Calc), Watermark, Table of contents. Everything else rides on JSDialog.

Option 3 keeps the product feel where it matters and stops the endless "one more dialog" tax. The JSDialog bridge is therefore the first backbone item.

## 10. Backbone work, in order

| # | Work | Unlocks |
|---|---|---|
| B1 | **Generic state map**: forward all `STATE_CHANGED`, add `getCommandValues` for `.uno:StyleApply`, named ranges, comments, redlines, table selection; push a compact `officeState` to main for the native menu (`enabled`/`checked`) and to the ribbon/context menus | every checkbox, radio and disabled item; the status bar; no more silent no-ops |
| B2 | **Context-menu framework** for Writer and Impress, plus the new Calc targets (sheet tab, shape, image, chart, pivot, filter button): one model file per app like `calcMenu.ts`, target detection from `GRAPHIC_SELECTION` / `TABLE_SELECTED` / hyperlink-at-point / cell content | §7 in full, roughly 150 functions |
| B3 | **JSDialog bridge** + React widget renderer | §9; every "…" item |
| B4 | **Native menu bar mirrors LibreOffice per app** (File · Edit · View · Insert · Format · Styles · Table/Sheet/Slide · Data/Slide Show · Tools), built from one command table shared with the ribbon and the ⌘K palette (label, command, accelerator, state key) | completeness; ⌘K "insert footnote" works |
| B5 | **Comments and tracked changes**: `COMMENT` callback, redline list, margin anchors, Comments panel, Review tab in all three apps | the review workflow managers actually do with agents' drafts |
| B6 | **Canvas affordances** §8 in priority order: ⌘-wheel zoom, mini-toolbar, fill handle, AutoFilter arrows, name box, comment anchors, rotate handle, table grips, smart guides, outline bar, ruler, status bar | the "feels like Excel" layer |
| B7 | **Contextual ribbon tabs** (Picture, Shape, Table, Chart) that appear on selection, with the Impress Design controls generalised to all apps | one place for object formatting |
| B8 | **Modes**: Impress sorter / outline / master / presenter view; Calc page-break view; Writer web layout and print preview | View tab completeness |
| B9 | **Impress transitions and animations** via macros + two ribbon tabs and an Animation pane | the last big PowerPoint gap |

Order of value for the user's day: B1 → B2 → B6 (first four items) → B3 → B4 → B5 → B7 → B8 → B9. B1 and B2 together are about a week and change the app more than anything else on this list.

## 10a. Built so far

- **2026-09-04 — B1 + B2 first cut (branch feat/office-parity-b1).** Right-click on Writer, Calc and Impress sends a real right button to the engine, which selects what is under the pointer and answers with its own popup menu (`LOK_CALLBACK_CONTEXT_MENU`, JSON with commands, enabled and checked state). `officeMenu.ts` curates it (mnemonics stripped, disabled and headless-impossible entries dropped, our React dialogs routed, menu aliases such as `.uno:Heading1ParaStyle` resolved to their `StyleApply` target with JSON args, query-form URLs converted). `ContextMenu.tsx` gained submenus, check marks and disabled state. Calc's row/column header menus stay app-defined (headers are outside the tile area). `officeState.ts` reads `STATE_CHANGED` (`true`/`false`/`disabled`) for the ribbon (greyed buttons) and pushes a compact snapshot to the native menu bar (`menu:set-office-state` → check marks and greyed items, coalesced rebuild). The host now survives malformed UNO arguments instead of dying with every open document. Proof: `e2e/office/AJ-context-menu.mjs` (engine, 21 checks) and `AK-context-menu-ui.mjs` (live app, 15 checks). Not yet at that point: `TABLE_SELECTED`/`CONTEXT_CHANGED` consumers, Calc sheet-tab and slide-thumbnail menus, keyboard navigation inside the menu.
- **2026-09-04 — B2 completed (branch feat/office-parity-b2).** Sheet-tab menu (insert, duplicate, rename, delete, move, hide, show ▸ by name, tab colour ▸) and slide-thumbnail menu (new, duplicate, rename, delete, hide/show, layout ▸ all 16, move ▸, start slideshow from here), both app-defined models (`partMenu.ts`) acting on the clicked part by index; tab drag-reorder; hidden sheets leave the strip and hidden slides dim. `TABLE_SELECTED` edges plus the last press point name the cell a slide-table operation acts on (`tableGeometry.ts`; the macro takes an explicit row/col). `CONTEXT_CHANGED` is stored for contextual UI. Menus take keyboard focus: ↑↓ move, → opens a submenu, ← returns, Enter picks, Esc closes. New Basic Module3 (`WosSlideOp`, `WosPartInfo`); the host falls back Module1 → Module2 → Module3. Proof: AJ 29, AK 27, macro audit 53/0.
- **2026-09-04 — B6 first slice (branch feat/office-parity-b6a).** ⌘/ctrl-wheel and trackpad-pinch zoom anchored on the pointer (`wheelZoom.ts`, native non-passive listener on the scroll host). A floating selection toolbar (`MiniToolbar.tsx`): text (bold, italic, underline, colour, highlight, alignment), cells (bold, italic, fill, colour, alignment, wrap), shapes (fill, outline, front/back); shown when the engine's selection rects or Calc's `CELL_SELECTION_AREA` land with the pointer up, hidden on the next press or keystroke. The Calc fill handle (`FillHandle.tsx`, `fillPlan.ts`): a square at the selection corner, a dashed preview while dragging, and `WosFill` (`fillAuto` on the union) on release — a 1, 2 series continues as 3, 4, 5. Proof: AJ 30, AL-canvas-affordances 12. Open: a synthetic Playwright mouse drag over Writer text produced no selection rects in the harness (keyboard selection does); to be checked by hand.
- **2026-09-04 — B3 JSDialog bridge (branch feat/office-parity-b3).** It turned out this engine build already emits ~205 of its dialogs as JSON widget trees under LibreOfficeKit (`LOK_CALLBACK_JSDIALOG`, 46): full tree on open, `update` subtrees, `action` messages (hide/show/enable/disable/select/focus), `close`. `jsdialogModel.ts` parses and folds them; `JsDialog.tsx` renders the tree with our own controls (containers, grids with placement, frames, tabs, labels, buttons incl. response buttons, check/radio, entries, multi-line, spin/formatted fields, list/combo boxes, tree views, icon views, images/drawing areas) and reports back through a new `dlgevent` host command → `sendDialogEvent` (`{id, cmd, type, data}` per `vcl/jsdialog/executor.cxx`). The bitmap tunnel is suppressed for any window that has a JSON tree. Proof: `AM-jsdialog.mjs` 9/9 — Sort opens as ours (no tunnel), Descending → OK sorts the saved .xlsx, Writer's Paragraph dialog shows its ten tab pages and closes on Escape. §9's decision is therefore taken: JSDialog for the long tail, hand-written React only where ours is better.
- **2026-09-04 — B4 native menu bar (branch feat/office-parity-b4).** One data table (`src/main/office-menu-table.ts`) describes the office menu bar per app in LibreOffice's order — Edit · View · Insert · Format · Styles · Table (Writer) / Sheet + Data (Calc) / Slide + Slide Show (Impress) · Tools — with ~380 leaf commands, accelerators, and which toggles carry the engine's check mark; File gains Save / Export ▸ / Properties… for office documents. The native menus (`menu-office.ts`) and the ⌘K palette (`menu:office-commands`, run through `menu:run-action` so a palette pick equals a menu click) are both built from it. A unit test checks every `.uno:` name against the engine's command registry (`src/main/__fixtures__/uno-commands.json`, 2,040 names) — and caught that the ribbon's Gridlines toggle had always dispatched a non-existent `.uno:ViewGrid` (fixed to `ToggleSheetGrid`). Proof: `AN-menubar.mjs` 18/18 (menus per app, Format ▸ Text ▸ Double Underline saved to .docx, View ▸ Formatting Marks check mark follows the engine, Table ▸ Insert Table…, palette "overline" → Enter, Data ▸ Sort… opens the JSDialog, Slide ▸ Duplicate, Slide Show ▸ Start).
- **2026-09-04 — B5 comments and tracked changes (branch feat/office-parity-b5).** A Review panel (`ReviewPanel.tsx`, `reviewModel.ts`) shows the engine's own comment threads (`getCommandValues('.uno:ViewAnnotations')`: add at the cursor, reply, resolve, delete) and tracked changes (`.uno:AcceptTrackedChanges`: record on/off, accept/reject one by index or all), re-read on the engine's COMMENT and REDLINE callbacks; margin anchors mark comments on the canvas and open the panel. Every app gains a Review ribbon tab (comments, tracking for Writer, spelling). Two engine facts learned on the way: inserting or replying to a comment leaves the caret inside the comment box, so an Escape follows those commands or later keystrokes go into the comment; and the accept/reject index item is taken only as `"unsigned short"`. Proof: `AO-review.mjs` 12/12 (comment → word/comments.xml, reply, resolve, margin anchor, Record → `<w:ins>`, Accept clears it in the list and the file; Calc note → xl/comments1.xml).
- **2026-09-04 — B6 second slice (branch feat/office-parity-b6b).** The engine's message boxes (Yes/No confirmations) now render as our dialog and are answered with Enter/Escape on their window (the JSON response event does nothing for them, and their tree carries no id of its own — it borrows the WINDOW callback's). The AutoFilter dropdown arrives as a `modalpopup` JSDialog and opens as a popup at the click point, with sort items and the value checklist; its sub-dropdowns are closed as a group. A Calc **name box** (jump to an address or range, select or define a name) sits beside the formula bar. A **status bar** shows page and word/character counts (Writer, from the model via `WosDocStatus`), sheet and the engine's selection summary (Calc, `StateTableCell`), slide position (Impress), and a zoom slider. A **rotate handle** above a selected shape turns it about its centre (`WosShapeRotate`, Shift snaps to 15°). Proof: `AP-affordances-2.mjs` 13/13.
- **2026-09-04 — B7 contextual tabs + B8 view modes (branch feat/office-parity-b7).** The ribbon gains contextual tabs that appear with the selection and vanish with it: **Shape** (fill, outline, arrange, rotate/flip, group, position and size, alt text, delete), **Picture** (crop, compress, wrap, arrange, replace) when the engine's `CONTEXT_CHANGED` names a graphic, and **Table** in Writer and Impress (rows and columns, merge/split, borders, alignment, delete) when `TABLE_SELECTED` is live; the tab activates itself on first appearance and the previous tab returns afterwards. View ▸ Mode buttons switch what the engine renders — Writer Normal / Web, Calc Normal / Page break, Impress Normal / Notes / Master — and the document size is re-read after each mode command because the engine re-lays out silently. A shape inserted from Design is selected on insertion (its bounds come back from the macro through `lok:lastshape`; a macro's own selection never reaches the renderer because host callbacks are muted during macros, and a click at its centre picks the placeholder underneath). Proof: `AQ-context-modes.mjs` 11/11 (Writer table → Table tab → row below grows the saved table; Web/Normal reshape the page; Calc Page break; Impress arrow → Shape tab → Flip horizontally writes `flipH="1"` to the .pptx; Notes view is taller than the slide; Master lights the engine state). Impress Outline and Slide sorter render 0×0 headless and stay for a client-side pass (B8 rest).
- **2026-09-04 — B9 transitions and animations (branch feat/office-parity-b9).** Two model-API macros. `WosTransition` sets a slide's SMIL `TransitionType`/`Subtype` pair (the pair the pptx exporter maps to PowerPoint's own transitions), duration, and advance (on click / automatically after N s), for one slide or all, and reads every slide back. `WosAnim` clones a preset from the engine's own effects.xml — ~210 presets, loaded through the public `AnimationsImport` service; its root node is reached by core reflection because the class hides `XAnimationNodeSupplier` from Basic introspection — targets the selected shape, and rebuilds the main sequence into LibreOffice's click / with / after container tree the way `EffectSequenceHelper::implRebuild` does; remove, clear, reorder, trigger, duration and delay all go through the same rebuild. Numbers are written as typed doubles (`CreateUnoValue`): an integral Basic double lands in an `Any` as Integer and the exporter then drops the timing. Two ribbon tabs: **Transitions** (gallery of the 18 PowerPoint-safe transitions, duration, on click / after N s, apply to all) and **Animations** (entrance / emphasis / exit presets, start trigger, Animation pane). The **Animation pane** lists the current slide's sequence in play order with move up/down, trigger, duration, delay, remove and remove all. The slideshow honours automatic advance. Slide ▸ Slide Transition… / Custom Animation… in the menu bar and the slide-thumbnail menu open the tabs. Learned the hard way: a macro module assembled with `\\n` instead of `\n` becomes one line and silently kills EVERY macro — the validator now rejects it, and a keyword-named parameter (`oN` reads as `On`) does the same and is rejected too. Proof: `AR-animations.mjs` 14/14 (Fly in + Spin → pane order → saved presetID 2/8 with click/with triggers → remove → Fade, after 1 s, apply to all → `<p:fade/> advTm="1000"` → second slide → slideshow advances by itself).
- **2026-09-04 — B6c canvas affordances + B8 remainder (branch feat/office-parity-b6c).** Calc **outline bar**: Data ▸ Group and Outline (menu + Data tab Group/Ungroup) groups the selected rows or columns through `WosOutline` (XSheetOutline: group / ungroup / hideDetail / showDetail / autoOutline / clearOutline); the groups come back in `.uno:SheetGeometryData`'s `groups` run (per level `start:size:hidden:visible`), and the headers grow a −/+ strip per level; collapsed rows save as hidden. Writer **ruler** above the page: margins, left / first-line / right indent markers and tab stops, all draggable; click adds a tab stop, double-click removes one. The engine's RULER_UPDATE never fires headless, so the geometry is read from the model (`WosRulerInfo`: page width, margins, paragraph indents, tab stops — tab positions are relative to the paragraph's left indent, as the API keeps them) and written with `WosParaFmt` / `WosPageMargins`. **Table grips** (Writer + Impress) on the engine's `TABLE_SELECTED` geometry: column grips above and row grips beside the table select a row / column (click + shift-click on the cells), a + on hover inserts one, the corner selects the table, inner borders drag to resize (`WosTableGeom rowheight|colwidth` for Writer — a full-width table spans the page text area, its Width property is not in a document unit — `WosSlideTableOp` for Impress). **Smart guides**: while a shape is dragged its edges and centre snap (8 px) to the other shapes' edges and centres (`WosShapeRects`, read once per drag) and to the page edges and centre, with the matched line drawn; Alt disables. **Slide sorter** (grid of engine-rendered slides, click / double-click / drag-reorder / right-click) and **Outline view** (every slide's title and bullets editable, `WosSlideText` — placeholders are matched by `ShapeType`, `supportsService` does not report the presentation services) for Impress, **Print preview** (every page side by side, Export PDF) for Writer — all client-side, because the engine renders these modes 0×0 headless. Two document-switch leaks fixed on the way: the caret-visible flag and the table geometry of the previous document survived into the next one (a shape drag then went to the engine as a text drag; a table's grips stayed mounted). Proof: `AS-affordances-3.mjs` 15/15.
- **2026-09-04 — B10 leftover placements (branch feat/office-parity-b10).** The §4–§6 items that had a ribbon home but no button yet. Writer: a **References** tab (one-click table of contents from the outline via `WosInsertToc`, custom index dialog, update all, footnote/endnote, caption, bookmark, cross-reference, fields), Layout gains Columns…, a **Watermark** picker (Draft / Confidential / Sample / Remove / Custom — a rotated grey header text shape via `WosWatermark`, because `.uno:Watermark` opens its dialog whatever arguments it is given, in every form including a Basic dispatch of the typed item) and Line numbering…; the Picture tab gains Wrap and Anchor groups; Review gains Thesaurus. Calc: Home ▸ **Cell styles** gallery (`StyleApply` on the CellStyles family — the `Accent1CellStyles`-style one-shots do nothing under LOK) and Format as table (AutoFormat); a **Layout** tab (margin presets and orientation through the page-style macros, which now resolve Calc's sheet page style; headers & footers, page style, row/column breaks, print area); a **Formulas** tab (function wizard, recalculate / hard / autocalculate / formula-to-value, show formulas, precedents / dependents / errors / invalid / clear); Data gains Text to columns, Remove duplicates, Consolidate, Define range and What-if (Goal seek, Solver, Scenarios); View ▸ Show gains value highlighting, formulas and row/column highlighting. The engine sends no STATE_CHANGED for the Calc view toggles, so `WosViewInfo` reads them back from the view settings after each toggle and the ribbon lights from that. Impress: Insert gains Slide number (`InsertPageField` — a field goes into text, so the caret must be in a text box), a Field picker, Header & footer… and QR code…; the Shape tab gains Duplicate…; **Find & Replace now works in Impress** through the engine's own `.uno:ExecuteSearch` (the model has no XReplaceable there), with the count taken from the SEARCH_RESULT_SELECTION / SEARCH_NOT_FOUND callbacks. Proof: `AT-placements.mjs` 12/12. With this, every backbone item B1–B10 of §10 is built and proven on the engine.
- **2026-09-04 — Calc sort asks to expand the selection (branch feat/calc-sort-expand).** Sort A→Z / Z→A on a column picked inside a wider data block now asks, as Excel does: **Expand the selection** (the contiguous block around the column — `collapseToCurrentRegion` — is sorted by that column, rows travelling together, header row detected as text-over-number and kept) or **Continue with the current selection** (only the column). A selection already as wide as the block sorts straight away. Engine side `WosSort` (XSortable with a TableSortField on the picked column); the selection is resolved from the cell-selection rectangle sampled well inside the cells, because the rectangle is pixel-aligned a hair outside them and its edge resolved to the neighbouring column. Proof: `AU-sort-expand.mjs` 6/6.

## 11. Deliberately out

Forms and form controls, macros / Basic IDE / development tools, XML filters, extensions, customise / options dialogs, mail merge and bibliography database, Bluetooth / email send, TWAIN scanning, Fontwork, 3D conversion, media playback inside slides, Impress remote, Photo album, HTML / master-document creation, data streams / data provider / XML source, digital signatures, versions and check-in. Most of these are either replaced by agents in Workspace OS or belong to a different product.

## 12. Numbers to expect

Counting the tables above at menu-item granularity: Writer ~190 items to add (about 70 via right-click, 40 via ribbon, 60 menu-only, 20 canvas), Calc ~160 (60 right-click, 45 ribbon, 35 menu, 20 canvas), Impress ~140 (55 right-click, 40 ribbon, 25 menu, 20 canvas). Of the total, roughly 55% are one-line `.uno:` wirings once B1/B2/B4 exist, 25% need a dialog (B3), 15% need a macro extension, 5% need a new engine callback.
