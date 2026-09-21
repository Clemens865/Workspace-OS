# Workspace-OS — Product Roadmap (per-part + overall)

*Written 2026-07-22, grounded in the actually-shipped state on `master`. Companion to `expansion-roadmap.md` (the cross-tool "borrowable functions" strategy) and `HANDOFF.md` (live status). ✓ = shipped & test-green · ◐ = partial · ○ = planned.*

## North-star
**"A manager goes 3 consecutive days without opening any external app."** One Electron window; documents are the center; the AI can touch anything; local-first/sovereign; runs on the user's Claude subscription. **The moat = live transclusion (one value flows true across every surface) + the reviewable agent (Living Feed approve/revert).** Every roadmap item is judged by whether it compounds those two.

---

## Per-part roadmaps

### 📊 Excel / Calc
✓ Cells, ranges, formulas, AutoSum · conditional formatting · data validation · find & replace · charts (5 types) · **live metrics + ranges + Collections (record→layout, views, cards)** · headers/geometry/drag-resize.
- ○ **Freeze panes / split view** (deferred office staple)
- ○ **Pivot tables** (engine-supported; needs macro + UI)
- ○ **Formula-aware liveness** — a metric sourced from a *formula* cell that recalcs (today sources a literal/value cell)
- ○ **Named-range manager** UI
- ○ **Sparklines / in-cell mini-charts**

### 📝 Word / Writer
✓ Formatting, styles, track-changes · page layout (margins/orientation/headers/footers/page-numbers) · tables · content-controls + bookmarks (liveness anchors) · find & replace · **live docx tables + Collections card layouts** (`docx-cards-writer`).
- ◐ **Card/table insert gesture** (`WosInsertDocCards` — the bookmark-pair seeder) — engine-touching, **now unblocked** (engine restored)
- ○ **Comments / review workflow** (surface in the Living Feed)
- ○ **Mail-merge from a Collection** (records → letters — natural extension of Collections)
- ○ **Styles/ToC/cross-references** management
- ○ **Footnotes/citations** (compounds the knowledge base)

### 📈 PowerPoint / Impress
✓ Shapes (insert/color/fill/stroke/size/effect/pattern) · slide backgrounds · speaker notes · arrange/group · slide charts + tables · vector slide thumbnails · **live slide tables** · deck export from canvas (image).
- 🔄 **frame→live-slide bridge v1** — canvas frame → NATIVE editable slide shapes (building now, real-engine-gated)
- ○ **frame→live-slide v2** — a frame as source-of-truth that keeps its slide *synced* (liveness moat on canvas→slide)
- ○ **Transitions / animations** (deferred)
- ○ **Slide master / theme editor**
- ○ **Present mode** polish (exists; deepen)

### ✉️ Mail
✓ Native IMAP read + SMTP send + reply/forward · multi-provider presets + autoconfig · **Google + Microsoft OAuth** · advanced Rich compose (themes, structured blocks, CTA) · **brand kit** · **live `{{metric}}` data in emails** · **agent-drafted replies → Living Feed** · triage · demo mailbox.
- ○ **Real-account validation** (user click-test — the one gap; Gmail app-pw works today, Hotmail via Azure client-id)
- ○ **Search / threading / folders-as-first-class** deepening
- ○ **Attachments-from-workspace** (attach a live doc/Collection render)
- ○ **Rules / smart filing** (agent-assisted)
- ○ **Hosted-link interactivity** (approve-in-email via a link back into Workspace-OS — the deferred piece)

### 💬 Teams / Communication (next north-star channel)
○ **Not started.** The PRD names Teams/messages as a fragmentation source. Options, in order of sovereignty-fit:
- ○ **Matrix / XMPP** (open, self-hostable, local-first) — best principle-fit
- ○ **Slack** (already an MCP connector — the *agent* can post; a native *UI* is separate)
- ○ **Microsoft Teams** (Graph API + OAuth — reuse the MS OAuth we built; but proprietary, cloud-gated)
- Recommended v1: a **unified "messages" surface** fed by Matrix + the Slack connector, fused with the Living Feed (a message needing a reply = a card, agent drafts it — mirrors the email fusion).

---

## Cross-cutting surfaces (not "office" but core)

### 🎨 Canvas (open/infinite)
✓ tldraw `.wcanvas` · persistence · SVG export · deck export (image). 🔄 frame→native-slide (building). ○ live-sync frames, ○ multiplayer (explicitly NOT building — contradicts local-first).

### 🧠 Knowledge base
✓ `[[wikilinks]]` · backlinks · **graph view** · **related-notes** (co-citation, no ML) · **markdown preview + live transclusion** (a note whose numbers stay true).
- ○ `[[`-autocomplete in the editor (Monaco) · ○ daily notes · ○ **HNSW semantic search** (needs an embedding dep — a bundle-size/sovereignty decision for you) · ○ tags/properties (Bases-style).

### 🤖 Agent platform
✓ In-app `claude -p` console · **Living Feed** (approve/revert) · **fleet lanes + risk-tiered batched approval** · **secure vault** (safeStorage) · **MCP connectors: API-key stdio (GitHub/Slack/Notion/Tavily/Brave/FS/Postgres) + remote-OAuth (Sentry, Path B)** · wos-metric / wos-collection / wos-mcp-token CLIs.
- ○ **Multi-agent coordinator/worker** (decompose a task → subagents; the fleet UI is ready) · ○ self-tuning approval policy · ○ more OAuth connectors (Linear, hosted-Notion).

### 🔗 Liveness (the moat itself)
✓ metric→doc (scalar) · range→grid · **record→layout (Collections)** + views + cards + CLI · **live email** · **live notes**. Spans **5 surfaces**. ○ formula-recalc sources · ○ live-sync canvas frames · ○ a "where is this value used" global index UI.

---

## STATUS REFRESH (2026-07-29) — read before planning from the horizons below

The horizons further down were written before a large amount of this got built.
Shipped since, and therefore NOT to be planned again:

- **In-app browser** — listed below as H2. Fully built: multi-tab, agent drive
  (navigate/click/extract/deepRead/screenshot), one tab per subagent for parallel
  fan-out. As of 2026-07-29 it is the **only** web path for a `research` agent
  (WebFetch/WebSearch are denied for them) so research is always visible on screen.
- **Agent platform** — Agent Foundry (describe → forge → approve), capability
  catalog incl. `webpage` (self-contained clickable HTML deliverables), MCP
  connectors + vault, Connected Accounts (login once, agent inherits the session).
- **Cockpit** — the live Calm Cockpit (needs-you / working / landed), wired to real
  runs, with live artifact previews.
- **Mail** — native IMAP/SMTP read + compose + send.
- **Liveness** — metrics and Collections across xlsx/docx/pptx.
- **Office** — Word Layout tab (margins/orientation/headers/page numbers), Excel
  range templates, charts, Impress slide-table editing, model-API shape drag.
- **Snapshots** — save/restore the desk.

**Actually remaining, in the agreed order:** Calendar → Teams/Slack (channel #2) →
PDF annotation → pivot tables → cross-app comments/review → live canvas↔slide sync.

**Known debt:** the reverted rendering-perf layer (must return WITH real render
verification — it broke initial .pptx render and the macro audit cannot see that) ·
the residual ~300ms Impress drop latency, measured as content-bound engine tile
cost (~65ms/tile on a real deck vs ~3.9ms synthetic) · the drag ghost has no
automated UI proof.

---

## Overall system roadmap (horizons)

**H1 — Now (finish the differentiated depth):**
- frame→live-slide native (building) · Word/PPT insert gestures (engine unblocked) · real-account email validation (yours) · a **dogfood pass** on the large surface built.

**H2 — Next (broaden the north-star):**
- **Communication channel #2** (Matrix/Slack messages + Living-Feed fusion) · **Calendar** (reuse the OAuth machinery) · multi-agent coordinator · mail-merge from Collections · the in-app browser (see below).

**H3 — Later (leaps & scale):**
- Live-sync canvas↔slide · HNSW semantic knowledge (dep decision) · pivot tables / advanced Calc · comments/review workflows across Word+PPT · public-website export from canvas · self-tuning approval.

**Explicitly NOT building:** real-time multiplayer (contradicts local-first) · a from-scratch office engine (keep LO) · any commodity feature without liveness/agent leverage · a mandatory cloud dependency.

---

## The in-app browser (shared with terminal agents) — assessment

**Verdict: strong, H2. It fits the north-star squarely** ("3 days without an external app" — research/web *is* the biggest remaining external app), and it's uniquely powerful *because* of our agent + Living Feed.

**What it is:** an in-app browser tab (Electron `WebContentsView`/`<webview>`) — the user browses inside Workspace-OS. **The differentiator:** the **terminal agent can see and drive it** — read the current page, click, fill, extract — via the **Playwright MCP** connector (already exists in the MCP ecosystem; we'd add it to our catalog and point it at the in-app browser's CDP endpoint) or a direct CDP bridge.

**Why it's defensible (not just "an embedded browser"):**
- The agent + browser + workspace in one context = "research this, pull the numbers into my sheet as a live metric, draft the email" — **one flow, no app-switching**, and every agent action is **reviewable in the Living Feed**.
- Compounds liveness: a browser-sourced value can become a live metric (web→metric→every doc).

**Effort:** M for the browser tab + CDP bridge; S to add Playwright MCP to the connector catalog (reuses the vault→spawn path we built).

**The hard part — security (must design up front):** an agent that can browse + read your private workspace + send email is the **"lethal trifecta"** (private data + untrusted web content + outbound comms = prompt-injection exfil risk). Mitigations, non-negotiable: the browser-driving agent runs **gated** (its actions are irreversible-tier → always Living-Feed approval, never auto), **least-privilege per session** (browse OR touch private data, not both silently), and untrusted page content is treated as data, never instructions. This is exactly the approval surface we already own — which is *why* we can ship this more safely than anyone bolting a browser onto an agent.

**Recommended slice:** (1) an in-app browser tab (view + navigate) → (2) Playwright MCP connector pointed at it, gated in the Living Feed → (3) "capture this page value as a live metric." Ship in that order; stop at each gate for a real security review.
