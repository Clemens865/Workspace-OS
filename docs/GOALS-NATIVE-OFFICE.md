# Goals — Full Native Office (Word / Excel / PowerPoint)

The standard: a manager can **create, write, format, edit, and save** real
office documents entirely inside Workspace OS — no other app, no Docker. Every
capability below is backed by an automated e2e test (`e2e/lok-*.mjs`).

Status: ✅ done · 🔨 building this pass · ⬜ planned

## A. Document lifecycle (all formats)
- ✅ A1. Open existing `.docx/.xlsx/.pptx` (live engine)
- ✅ A2. Edit content — type / delete, **visible live** (fixed: input-driven repaint)
- ✅ A3. Save back to the original file
- 🔨 A4. **Create a new** blank Word / Excel / PowerPoint from within the app
- ⬜ A5. Save-As / export to another format (PDF export ✅; docx→odt etc. ⬜)

## B. Word (Writer)
- ✅ B1. Type text at the cursor; click to place cursor; caret shown
- ✅ B2. Bold / Italic / Underline (toolbar)
- 🔨 B3. **Paragraph styles** — Heading 1 / Heading 2 / Normal (style dropdown)
- 🔨 B4. **Undo / Redo** (⌘Z / ⇧⌘Z + toolbar)
- ⬜ B5. Lists (bullet / numbered)
- ⬜ B6. Font size, color, alignment

## C. Excel (Calc)
- ✅ C1. Click a cell, type a value, Enter commits
- ✅ C2. Sheet navigation (tabs)
- 🔨 C3. **Formulas** — type `=SUM(...)`, evaluates (verified by reopen)
- ⬜ C4. Cell formatting (bold, number format), column/row ops

## D. PowerPoint (Impress)
- ✅ D1. Slide navigation (tabs)
- 🔨 D2. **Edit slide text** — click a text placeholder, type, save
- ⬜ D3. Add / duplicate / delete slides

## Test matrix (the workflows we assert)
1. **Word create+write** (the headline flow): create new `.docx` → Heading 1 →
   type "Hello" → new paragraph → Normal → type a sentence → bold a word → save →
   reopen → assert "Hello" + the sentence persisted with a heading style.
2. **Word edit**: open existing → edit → undo → redo → save → reopen → verify.
3. **Excel**: create/open → type a value + a `=SUM` formula → save → reopen →
   assert the computed result is present.
4. **PowerPoint**: open → switch slide → edit placeholder text → save → reopen →
   assert the new text persisted.

Each becomes an automated test so "it works" is provable, not asserted.
