# Design Brief — the Home screen of Workspace OS

> **How to use this:** paste this whole file into Claude (claude.ai or Claude
> Design) and ask for a **single self-contained HTML/CSS artifact** (no build
> step) mocking the screen in 2–3 distinct variants. It is self-contained —
> no other context needed. Iterate by asking for variations of the one you
> like. Companion to `cockpit-design-spec.md`, which designed the Cockpit
> surface in exactly this way.

---

## 1. The assignment

**The first screen a user ever sees.** Workspace OS is a local, calm,
Apple-like "Integrated Workspace Environment": office documents, mail,
calendar, a browser, a knowledge base, and a team of AI agents — one window.
Home must answer, in one glance, the first question of any session:

> **What happened, what needs me, and where was I?**

It shows a high-level view of every surface — cases (ongoing pursuits with
status), the next 48h of calendar, agents (some may be working *right now*),
recent files, recent browser pages, mail, notes — and it is **the user's
board**: they can show/hide areas, resize them, and reorder them.

## 2. What version 1 got wrong (be better than this)

We shipped a first version: a uniform 2-column grid of white cards, each with
an icon, a title, a 3px colored bar on top as "identity", and a short list.
Honest critique, in our own words:

- **Equal tiles = no hierarchy.** Everything shouts equally, so nothing does.
  Our own cockpit law says: hide the healthy; give weight only to what needs
  the human.
- **The colored top bars are decoration, not meaning.** Color-coding by app
  is a filing-cabinet idea; nobody thinks "amber = cases".
- **Icon + title + list rows is the default admin-dashboard pattern** — it
  reads as generated, not designed.
- It has an entrance animation but **no life** afterwards.

Keep the *capabilities* (customize: show/hide, size, order). Replace the
*look and the hierarchy* entirely.

## 3. House style — match precisely

**Calm, Apple-like, LIGHT, restrained. "Simple, not basic."** The calm of
visionOS widgets, the warmth of the film *Her*. NOT sci-fi, NOT neon, NOT a
dark dashboard, NOT a SaaS admin panel.

```
Background      #f5f5f7      (app canvas)
Card surface    #ffffff
Sunk surface    #f0f0f2      (recessed wells)
Ink (primary)   #1d1d1f
Ink-2           #6e6e73      (secondary text)
Ink-3           #8a8a8e      (tertiary / quiet)
Hairline        rgba(0,0,0,0.09)   (0.5px borders)
THE one blue    #0071e3      (single primary action ONLY)
Success/live    #30b44a
Warn ink        #8a5a00      Warn bg  #fff4e0
Card shadow     0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.06)
Radius          16px large · 10px small · 99px pill
Font            'Hanken Grotesk', -apple-system, system-ui, sans-serif
Mono (numbers)  ui-monospace, monospace
```

**The ONE-BLUE rule:** `#0071e3` marks the *single* primary action in a
context. Everything else is greyscale + hairlines. Warmth for "needs you"
comes from a very soft warm tint (`#fff4e0` / `#8a5a00`) + gentle elevation —
never from sprinkled color.

**Depth grammar:** needs-you = slightly elevated and warm · running = flat,
pale, hairline, gently breathing (~1.2s; freeze under
`prefers-reduced-motion`) · settled = quiet, low-contrast.

**Type does the identity work.** Areas are distinguished by typographic
hierarchy, spacing, and one small glyph — not by color chips.

## 4. The real data each area can show (use realistic content)

| Area | Truthful content available |
|---|---|
| Cases | "5 open · 2 need you"; per case: title + status (drafted / interview / offer / applied…) — warm when waiting on the human |
| Calendar | next events in 48h: time + title; today count |
| Agents | team size; per RUNNING agent: name + live one-line activity ("deep-reading linkedin.com") — this is the *alive* element |
| Files | recent documents (names like `Founder_Operator_Roles.xlsx`) |
| Browser | recent page titles + domains |
| Mail | connected accounts; (live unread counts come later — do not fake numbers) |
| Knowledge | recent notes (`.md` names) |
| Loader | first launch shows a small pixel-grid loader "Loading your workspace" + elapsed; cards then enter staggered — keep this beat |

## 5. Three directions to explore (make one artboard each, then we pick)

**A — "The morning briefing."** A vertical, document-like composition (like
our cockpit, its sibling). One plain-language line up top: *"Good morning.
Two cases need you, Jonas is scouting, next meeting 14:00."* Then zones by
NEED, not by app: **Needs you** (warm, cases + approvals) → **Live** (a faint
band of breathing agent presence) → **Next** (calendar strip) → **Trails**
(files · pages · notes as one quiet where-you-were band). Customization =
density + which zones, not tile positions.

**B — "The desk."** An asymmetric, editorial grid: ONE hero card — the
single most important thing right now, chosen automatically (a warm case, or
the running agent, or the next meeting) — with supporting cards at clearly
different sizes and type scales. Identity from headlines and glyphs;
whitespace as the luxury. Customization = pinning what may become the hero,
sizes, order.

**C — "The field."** Everything is a quiet presence cell on the canvas
(no card borders at all; hairline separations and sunk wells). The board
feels like one calm surface with regions, closer to visionOS. Warmth only
where a decision waits. Customization = arranging regions.

## 6. Hard constraints

- Light theme; the exact tokens above; Hanken Grotesk.
- No color-coded category bars/chips. No icon-grid look. No Kanban.
- Real names in mock content (from §4), never lorem ipsum.
- Subtle CSS motion only on *running* elements; reduced-motion safe.
- Must scale from an empty workspace (first run: no cases, no mail — design
  the empty state as an invitation, not an apology) to a busy one.
- Deliverable: ONE self-contained HTML file, the 2–3 variants as sections,
  light background, no external assets.
