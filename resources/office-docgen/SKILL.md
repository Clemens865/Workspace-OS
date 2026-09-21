---
name: office-docgen
description: Generate real PowerPoint (.pptx), Excel (.xlsx) and Word (.docx) files from a JSON spec. Use whenever the user asks you to create, build, draft, or export a presentation, spreadsheet, or document — produce an actual office file, never paste its contents into chat.
---

# Office document generator (Workspace OS)

You are running inside **Workspace OS**. The command `wos-gen` is on your `PATH`
and produces genuine, editable Office Open XML files using python-pptx / openpyxl
/ python-docx. Use it instead of writing files by hand.

## How to use

1. Write a JSON **spec** to a temp file (use your Write tool).
2. Run:

   ```
   wos-gen <pptx|xlsx|docx> --spec <spec.json> --out "<workspace>/<Name>.<ext>"
   ```

   Write the `--out` file into the current workspace folder unless told otherwise.
   On success the last line is `WROTE:<absolute path>`. The file opens
   automatically in the Workspace OS canvas — do **not** also paste its contents.

## Spec schemas

### pptx
Modern, themed deck. Pick a `layout` per slide; a minimal spec still looks good.
```json
{
  "theme": { "palette": { "bg": "FFFFFF", "ink": "1A2233", "primary": "2D5BFF", "accent": "FF8A3D", "muted": "8A93A6" }, "font": "Inter" },
  "slides": [
    { "layout": "cover",   "kicker": "Q3 2026", "title": "Big Bold Title", "subtitle": "..." },
    { "layout": "section", "kicker": "Section 01", "title": "Where we stand", "subtitle": "..." },
    { "layout": "bullets", "title": "...", "bullets": ["Top point", { "text": "Sub-point", "level": 1 }], "notes": "speaker notes" },
    { "layout": "table",   "title": "...", "table": { "headers": ["Region","Revenue"], "numericCols": [2], "rows": [["EMEA","480,000"]] } },
    { "layout": "chart",   "title": "...", "chart": { "type": "bar", "categories": ["Q1","Q2"], "series": [{ "name": "Rev", "values": [3,4] }] } },
    { "layout": "image",   "title": "...", "imagePath": "/abs/path.png" },
    { "layout": "closing", "title": "Thank you", "subtitle": "..." }
  ]
}
```
Layouts: `cover` (full-bleed hero), `section` (divider), `bullets` (real bullets,
`{text,level}` for indent), `table` (banded rows; `numericCols` right-aligns),
`chart` (themed bar/line/pie), `image`, `closing`. `theme.font` picks the sans
(default Inter, with a graceful fallback). Old specs (`layout:"title"`, flat
`theme.primary/accent`, string bullets) still render — upgraded styling applies.

**Live-metric anchors** — add a `"metrics"` array to any slide to place big
"stat card" values that a spreadsheet can drive live:
```json
{ "layout": "bullets", "title": "Headline numbers",
  "metrics": [ { "tag": "revenue", "text": "1200", "label": "Revenue" } ] }
```
Each `tag` becomes a named shape `wos-metric-<tag>` (the anchor); `text` is the
literal shown. See the live Excel→PPT recipe below.

### Live Excel→PowerPoint deck (numbers bound to the spreadsheet)
1. `wos-gen xlsx --spec model.json --out "<ws>/Model.xlsx"`
2. `wos-metric create "Revenue" --source "<ws>/Model.xlsx!Sheet1!B2"` (per figure)
3. `wos-gen pptx --spec deck.json --out "<ws>/Deck.pptx"` — put each figure in a
   slide's `"metrics"` (step above) so the deck has the anchor.
4. `wos-metric link "Revenue" --file "<ws>/Deck.pptx" --target "revenue"` (per figure)
5. `wos-metric sync-all` — stamps the current values into the deck.

Then whenever the xlsx changes: `wos-metric refresh-all && wos-metric sync-all`.
To only MIRROR values once (no live link), skip 2/4/5 and put numbers in the spec.

### xlsx
```json
{
  "sheets": [
    {
      "name": "Sheet1",
      "headers": ["Region", "Units", "Revenue"],
      "rows": [["EMEA", 1200, "=B2*850"]],
      "totalRow": ["Total", "=SUM(B2:B2)", "=SUM(C2:C2)"],
      "currencyCols": [3], "percentCols": [], "freezeHeader": true
    }
  ]
}
```
Cells whose string starts with `=` become formulas. `currencyCols`/`percentCols`
are 1-based column numbers.

### docx
```json
{
  "title": "Document Title",
  "sections": [
    { "heading": "Heading", "level": 1, "paragraphs": ["..."], "bullets": ["..."],
      "table": { "headers": ["A","B"], "rows": [["1","2"]] }, "pageBreak": false }
  ]
}
```

Keep specs minimal — every field except the top-level array is optional.
