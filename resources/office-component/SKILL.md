---
name: office-component
description: Create reusable PowerPoint design components (Framer-style assets) in Workspace OS from a natural-language request. Use when the user asks to make/generate/design a component, asset, card, timeline, badge, callout, or any reusable slide element.
---

# Office Component generator

You create reusable design **components** for the Workspace OS PowerPoint editor by
running the `wos-component` CLI. Components appear in the app's **Components** panel
(in any `.pptx`), where the user inserts instances and edits their variables.

## How to use

1. Translate the user's request into a component JSON spec (schema below).
2. Write it to a temp file and run:

   ```sh
   wos-component add --spec /tmp/my-component.json
   ```

   (Or pipe it: `cat spec.json | wos-component add -`.) You can pass an array to add several.
3. Tell the user to open/reopen the Components panel to see and insert it.

Use `wos-component list` to see existing components.

## Component schema

A single object (or an array of them). All fields optional except a sensible `name`.

| field | type | notes |
|-------|------|-------|
| `name` | string | shown in the library |
| `type` | `shape`\|`card`\|`media`\|`captured`\|`block`\|`range` | default `shape` |
| `blockKind` | `heading`\|`callout`\|`signature`\|`quote` | for `type:block` (Word) |
| `rangeKind` | `kpi`\|`header`\|`table` | for `type:range` (Excel cells) |
| `body` | string | block/range secondary text (body, value, etc.) |
| `variants` | `[{name,fill,fontColor}]` | named instance states (shape/card/media) |
| `base` | `rect`\|`roundrect`\|`ellipse`\|`text` | for `type:shape` |
| `fill` | number | decimal RGB (see colors) |
| `fillKind` | `solid`\|`gradient`\|`pattern` | for `type:shape` |
| `gradTo` | number | gradient end color |
| `line` | number | outline color, `-1` = none |
| `lineWidth` | number | 1/100 mm (e.g. 100 = 1 mm) |
| `dash` | `solid`\|`dashed`\|`dotted`\|`dashdot` | |
| `fontColor` | number | text color |
| `text` | string | title (card) / caption (media) / label (shape) |
| `image` | string | absolute image path (media) |
| `w`, `h` | number | overall size, 1/100 mm |
| `elements` | string[] | **for `type:captured`** — multi-shape definition (below) |

**Units:** geometry is 1/100 mm → `1000` = 1 cm, `9000` ≈ 9 cm.
**Colors:** decimal RGB = `R*65536 + G*256 + B`. Examples: black `0`, white `16777215`,
red `16711680`, green `65280`, blue `255`, teal `1810836`, orange `15564081`, slate `4210752`.
`-1` means "none".

## Multi-shape components (`type: captured`)

For anything with more than one shape (timeline, list, stat grid, badge…), use
`type: "captured"` with an `elements` array. Each element is a pipe-delimited string,
positioned **relative to the component's top-left**:

```
kind|relX|relY|w|h|fill|line|lineWidth|cornerRadius|fontColor|text
```

- `kind`: `rect` | `roundrect` | `ellipse` | `line` | `text` | `image`
- `relX,relY,w,h`: 1/100 mm (line draws from bottom-left to top-right of its box)
- `fill`,`line`: decimal RGB, `-1` = none
- `lineWidth`,`cornerRadius`: 1/100 mm
- `fontColor`: decimal RGB; `text`: the string (only for text shapes; omit otherwise)

Also set top-level `w`,`h` to the overall bounding size. The first text element is
named `title` and the first filled shape `bg`, so instances stay editable.

### Example — a 3-step teal timeline

```json
{
  "name": "Timeline (3)",
  "type": "captured",
  "w": 16000, "h": 3000,
  "elements": [
    "line|400|1400|15200|1|-1|1810836|60|0|0|",
    "ellipse|400|1100|700|700|1810836|-1|0|0|0|",
    "ellipse|7650|1100|700|700|1810836|-1|0|0|0|",
    "ellipse|14900|1100|700|700|1810836|-1|0|0|0|",
    "text|0|2000|1500|800|-1|-1|0|0|4210752|Step 1",
    "text|7250|2000|1500|800|-1|-1|0|0|4210752|Step 2",
    "text|14500|2000|1500|800|-1|-1|0|0|4210752|Step 3"
  ]
}
```

### Example — a simple card

```json
{ "name": "Callout", "type": "card", "fill": 1810836, "fontColor": 16777215, "text": "Key point", "w": 10000, "h": 5000 }
```

### Word content blocks (`type: block`)

For Word documents, `type: block` inserts flowing text (not a floating shape) at the
cursor. Set `blockKind`, `text` (title/name/author), `body`, and for callouts `fill`.

```json
{ "name": "Important note", "type": "block", "blockKind": "callout", "text": "Note", "body": "Remember to review before sending.", "fill": 15131490 }
```

## Notes
- Keep `elements` ≤ 60. Avoid `|` inside text.
- Pick colors that match the user's described palette; default to tasteful, high-contrast choices.
- After adding, briefly confirm what you created and remind the user to reopen the Components panel.
