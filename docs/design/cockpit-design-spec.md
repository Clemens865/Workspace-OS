# Design Brief — "The Cockpit" for Workspace-OS

> **How to use this:** Paste this whole file into Claude (claude.ai) and ask it to produce a **single self-contained HTML/CSS artifact** (no build step) mocking up the screens described in **§9**. It is written to be self-contained — Claude needs no other context. Iterate by asking for variations.

---

## 1. What we want you to design

The **home screen** of a desktop app where **one human directs a team of AI agents**. The human is a conductor: they delegate work, and agents do it (research the web, write documents, draft emails). This home screen — we call it **the Cockpit** — is where the human sees, at a glance, **what the team is doing, what's finished, and what needs a decision**, and where all outcomes converge into *one center*.

It must feel like **the workspace of tomorrow** — calm, alive, and self-explaining — **not** a 2015 SaaS task board (Trello/Asana/Kanban). We already tried a Kanban board of cards-in-columns; it felt dated. Don't reproduce it.

**Deliverable:** a polished, static, light-themed HTML/CSS mockup (inline styles or a `<style>` block; system fonts are fine). Prioritize *look and feel*. Motion via CSS is welcome but subtle.

---

## 2. The product context (so the content feels real)

- The app is a local "Integrated Work Environment": office docs (Word/Excel/PowerPoint), email, calendar, a web browser, a knowledge base, and an AI agent team — all in one window.
- A user can **forge a specialist agent** ("Job scout", "Market researcher", "Deck designer"), give it a task, and it **fans out to parallel sub-agents** that drive multiple browser tabs, then produce a **styled Excel + a polished PowerPoint** (with the deck's numbers *live-linked* to the sheet).
- So the cockpit shows real, varied work: web research in progress, a spreadsheet being built, a deck being laid out, an email drafted for approval, a mailbox being summarized.

---

## 3. The paradigm — six laws (follow these)

1. **Hide the healthy.** When work is nominal/running, it is *quiet, pale, recessed*. Only things that **need the human** are given visual weight (warmth, elevation, size). This is the inverse of a grid where every card looks equal. (Ref: airliner "dark cockpit" — silent when all is well.)
2. **Agents are alive, not cards.** A running agent is a small *living* element that evolves in place (a gentle breathing pulse, a live one-line status), read pre-attentively from **motion + light**, not parsed from a table row. (Ref: Apple Live Activities / Dynamic Island.)
3. **Every item speaks one plain-language line** — *what changed + why it matters* — with detail on demand. Language over chrome. (Ref: Axios "Smart Brevity".)
4. **A "needs-you" item is a self-contained decision:** the plain-language line + a **recommended default action** + one or two quiet alternatives, then it **vanishes** once acted on. Never more than a few "loud" items at once.
5. **Altitude, not pages.** The same surface re-shapes by the human's role/zoom: **CEO** (company weather) → **Head-of** (a function's flow) → **Team-lead** (today's decisions + the live team) → **Agent** (zoom into one agent's work). Flying *up* aggregates; flying *down* re-hydrates detail.
6. **Personal structure via a lens, not manual sorting.** The human can re-slice the *same* auto-triaged work by a **lens** (by team / type / project / urgency). They never drag cards between columns.

---

## 4. Look & feel — house style (match precisely)

**Calm, Apple-like, LIGHT, restrained. "Simple, not basic."** Think the calm of visionOS widgets and the warmth of the film *Her* — NOT sci-fi glow, holograms, neon, or dark dashboards.

**Exact design tokens (use these values):**
```
Background      #f5f5f7      (app canvas)
Card surface    #ffffff
Sunk surface    #f0f0f2      (recessed wells)
Ink (primary)   #1d1d1f
Ink-2           #6e6e73      (secondary text)
Ink-3           #8a8a8e      (tertiary / quiet)
Hairline        rgba(0,0,0,0.09)   (0.5px borders)
THE one blue    #0071e3      (primary action ONLY — see rule below)
Success/live    #30b44a
Warn ink        #8a5a00      Warn bg  #fff4e0
Card shadow     0 1px 2px rgba(0,0,0,.04), 0 10px 30px rgba(0,0,0,.06)
Radius          16px large · 10px small · 99px pill
Font            'Hanken Grotesk', -apple-system, system-ui, sans-serif
Mono (numbers)  ui-monospace, monospace   (costs/turns)
```

**The ONE-BLUE rule (important):** `#0071e3` is reserved for the **single primary action** in a given context (e.g. "Approve & send"). Everything else is greyscale/hairline/quiet. Do not sprinkle blue. Warmth for "needs-you" comes from a very soft warm tint + elevation (shadow/scale), not from blue.

**Depth grammar:** *needs-you* = elevated (soft shadow, slightly forward). *running* = flat/recessed, near-white, hairline only. *done* = settled, quiet, low-contrast.

**Motion:** only gentle breathing/drift on *running* elements (~1.2s pulse). Nothing dramatic. Respect `prefers-reduced-motion` (freeze it). Do **not** put motion on the decision cards — those want stillness.

---

## 5. The Cockpit — "Team-lead" home layout (the primary screen)

A **vertical, document-like** surface (NOT columns). Top to bottom:

- **Quiet header:** left = view tabs `Home · Stream · Map` (Home active). Right = a **lens** control (`by team ▾`) + an **altitude** segmented control (`CEO · Head-of · Team-lead · Agent`, Team-lead active) + a small search glyph.
- **One plain-language status line:** e.g. *"Calm. 16 of 18 tasks are healthy and moving. ~4 min needs you."*
- **● NEEDS YOU** — the only warm/elevated zone. ~2–4 **self-contained decision** items (see §6). If more, a quiet "＋N more".
- **◦ WORKING** — a faint, recessed band of ~12–15 **presence cells** (see §7), grouped by the active lens (e.g. Growth / Finance / Platform). Calm because each is small, pale, hairline-only.
- **✓ LANDED** — settled, quiet: 2–3 finished results (a deck, a spreadsheet, a doc) each with a small thumbnail + `→ open`, then "…N more, settled".

Generous whitespace. The eye should land on NEEDS YOU first, then optionally graze the living WORKING band, then the quiet LANDED sediment.

---

## 6. The decision item + the LABEL system (design this carefully — it's the crux)

Each **needs-you** item is a card that carries:
- A small **category LABEL** stating *what kind of action* is needed (this both informs and groups the list). Categories:
  - **REVIEW** — the agent changed files; keep or revert. (has an undo checkpoint)
  - **SEND** — an email/message is drafted, awaiting the human to send. (never auto-sends)
  - **DECISION** — an approval/choice with no undo.
  - **ERROR** — something failed and needs attention.
- The **agent's name** (e.g. "Mailer", "Analyst", "Planner").
- **One plain-language line:** *what changed + why it matters.* Examples:
  - SEND · *"The reply to Acme is drafted and reads well — send it, or tweak first."*
  - REVIEW · *"Q3 forecast dropped 4% after a supplier price change — keep it or revert."*
  - DECISION · *"Research says lead with the pricing slide — approve the new deck order."*
- A **recommended default primary action** (the single blue button) + 1–2 quiet secondaries + a ⌄ expander for detail.

**Label design bar:** think **Linear / Things 3** tag quality — small, crisp, legible, *quiet but unmistakable*, consistent. A tasteful approach: a hairline-outlined chip with a 5px category-colored dot + uppercase micro-type with letter-spacing. It must **never** compete with the one blue primary. Show the four categories used to **group and order** the needs-you list (e.g. ERROR → SEND → REVIEW → DECISION). **This label design is the single most important thing to get right — please explore 3–4 variations.**

---

## 7. The presence cell (a "living" agent)

A small element for one running agent, in the recessed WORKING band. Contains:
- A gentle **breathing pulse** (three staggered dots or a soft glow) — pale, *not* blue.
- The **agent/team name** (e.g. "Scout", "Analyst 2").
- A **live one-line status:** *"reading 5 rivals · 3/5"*, *"reconciling ledger"*, *"laying out 12 slides · 7/12"*.
- A tiny **cost** in mono (e.g. `$0.14`) and/or elapsed.
- Optional health dot (green calm / amber attention).

They must stay **calm at 15+**: small, pale, hairline, no shadow, glanceable in aggregate rather than read line by line.

---

## 8. The altitudes (the "fly" concept — design each as a variant)

Same laws, re-shaped by zoom. Design these as separate frames:

- **Team-lead** (primary, §5): decisions + presence band + landed.
- **CEO (fly up):** a calm "company weather" overview — ~6 **teams as soft regions/tiles**, each with a health tone (most calm-pale; one warm because it needs attention), a one-line momentum note (*"Growth · shipping fast"*, *"Pricing · stalled, burn up"*), and only the **1 decision** that is the CEO's. Hide-the-healthy at company scale. NOT KPI cards.
- **Head-of (mid):** one function's **flow** — horizontal stages `ideas → in-flight → your-call → shipped` with a few items; the "your-call" items are the warm zone; lane width can hint effort.
- **Agent (fly down):** zoom into **one agent** — its **activity trail** (a few checkmarked steps + current + next), turns, cost, elapsed, and the **artifact taking shape** (a document thumbnail with progress, e.g. "7/12 slides", "open in progress").

A tasteful **zoom/scale + crossfade** transition between altitudes (fly up = ease out from larger; fly down = land from smaller) sells the "altitude" metaphor.

---

## 9. What to produce (deliverables)

Please produce a **single self-contained HTML file** with these frames stacked (label each):
1. **Team-lead Home** — the primary screen (§5–7), populated with the realistic content above, at ~16–18 tasks so it reads calm-at-scale.
2. **A label-system study** — the four category labels (REVIEW/SEND/DECISION/ERROR) shown in **3–4 distinct visual treatments** side by side, so we can choose. (This is the priority.)
3. **CEO altitude** (§8) — the company-weather overview.
4. **Agent altitude** (§8) — the single-agent zoom.

Keep it light-themed, on the tokens in §4, calm and premium. Favor whitespace and restraint over density. If you must choose, **make it feel like *Her* and visionOS, not Minority Report.**

---

## 10. Avoid (these date it / break the feel)

- Kanban columns you drag cards between; equal-weight card grids; a "bordered card" as the default unit (becomes a baby webpage).
- Sci-fi glow, neon, holograms, gesture theater, dark "command center" chrome.
- The pale-purple "AI shimmer" gradient (already a cliché — will date fast).
- Sprinkling the blue; loud tag soup; metric/KPI tiles unlinked to real work.
- Fabricated precision (e.g. fake "confidence 0.63%") — only show signals we truly have: status, live activity line, turns, cost, elapsed, artifacts.

---

## 11. References to channel (one idea each)
- **Apple Live Activities / Dynamic Island** — a running process shown as a glanceable, evolving element.
- **Airbus "dark cockpit"** — silence when nominal; weight = attention.
- **Axios Smart Brevity** — one line: what changed + why it matters.
- **Linear / Things 3** — restrained, premium tag & list craft.
- **The film *Her* (Geoff McFetridge palette)** — warm, calm, gets out of the way.
