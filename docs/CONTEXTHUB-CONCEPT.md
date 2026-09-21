# ContextHub — Concept Evaluation for the IWE Roadmap

**Source:** `~/Documents/Software-Projects/ContextHub` (docs + prototypes only — no code)
**Method:** deep-read of `docs/blueprints/*`, `docs/vision/future-of-work-alignment.md`,
`docs/design/approval-ui-design-brief.md`, `prototypes/approval-ui/*.html`.
**Framing:** the earlier compound sweep dismissed ContextHub as "design reference only."
That is right about the *code* and wrong about the *idea*. This evaluates the idea.
**Date:** 2026-07-04.

---

## 1. What ContextHub is trying to be

ContextHub began as a **"GitHub for organizational knowledge"**: a total-capture substrate
that ingests everything a company produces (Slack, Drive, meetings, email, docs), stores it
verbatim, and continuously promotes the important 5% into human-approved, layered **knowledge
capsules** (individual → team → dept → company) via a quorum gate. Its own 6-agent adversarial
review then **killed that thesis** (GDPR/works-council illegality of warehousing, "mush
capsules" from topic-clustering, and Series-B surface area for two people) and pivoted to
**"Sovereign": converge *state*, not *data*.** The successor product is a **cross-tool
commitments ledger** (who owes what to whom, by when) plus a **per-pattern autonomy ladder**,
where content is never warehoused — it is fetched live under the user's own OAuth via MCP at
drill-down time. The one thing that survived every round intact is the human runtime on top:
a single **Action Surface (Living Feed)** where everything an agent needs a person for renders
as one card.

## 2. Architecture & state of build

**State: concept + design mockups. Nothing runs.** There is no `src/`, no `package.json`, no
schema deployed — only markdown blueprints and three static HTML prototypes of the approval UI
(Slack-embedded, triage-stack, decision-inbox). The "architecture" is a paper design that
evolved across two documents:

- **`contexthub-blueprint.md` (v1.0, 1074 lines)** — the warehoused version: 5 cognitive
  processing tiers (rule-based → local models → frontier only at synthesis), append-only
  artifact store + sidecar files, authority-weighted credibility scoring, quorum-gated capsule
  promotion, n8n connector layer, cost model. Thorough, and **explicitly superseded**.
- **`future-workspace-synthesis.md` (282 lines)** — the adversarial teardown that rejects the
  warehouse (scored 20/70) and selects **Sovereign**: commitments ledger (Postgres+pgvector),
  a closed 5-type ontology (Commitment / Decision / Signal / Draftable / Anomaly), an MCP
  **Adapter Compiler**, and a validation plan with cheapest-first *kill-tests* before any build.
- **`future-of-work-alignment.md`** — grounds the whole thing in Egor Pushkin's "work substrate"
  essays (work cells, mission graph, readiness frontier, behavioral identity, progressive
  autonomy, situational interfaces). ContextHub positions itself as the *knowledge/commitment*
  half of the substrate Pushkin describes for *work execution*.

The reasoning quality is high; the maturity is a well-argued PRD, not a prototype of the engine.

## 3. The interesting ideas (inventory)

| # | Idea | Why it matters |
|---|------|----------------|
| 1 | **The three-tier card: Glance → Draft → Full context** | The single best UX primitive here — surface an agent proposal at minimum load, one tap to the draft, one more to the provenance. Never a separate page. |
| 2 | **Two item families: Decisions (reversible, one-tap) vs Actions (irreversible, draft-gated)** | Encodes safety in the interaction: the draft *is* the gate for anything that "leaves the building." Directly answers "why users fear agent edits." |
| 3 | **Per-item chat thread as audit trail** | Every card carries a scoped chat grounded in *that item's* context; each state-changing turn is logged. The conversation *is* the record of how the human shaped the outcome. |
| 4 | **Progressive-autonomy ladder, per pattern** | suggest → draft → auto-with-digest → auto-silent, mined from observed verdicts; automatic silent demotion on any correction. Trust as an earned, per-pattern state — not a global switch. |
| 5 | **"Converge state, not data" (Sovereign pivot)** | The commitments ledger is small, owned, and legal; raw content stays federated under the user's OAuth. A genuinely sharper answer than warehousing. |
| 6 | **Queue-zero + equal-weight Approve/Reject** | Reward is an empty queue, reached identically by approving *or* rejecting — an explicit anti-rubber-stamp design. |
| 7 | **Honesty-about-gaps / Coverage Manifest** | The UI states when its coverage is incomplete ("30% of #exec excluded") instead of implying completeness. A trust instrument, not plumbing. |
| 8 | **Situational interface (Pushkin)** | The surface appears only when a human is needed and recedes otherwise — the substrate stays invisible. |
| 9 | **Kill-test-first validation discipline** | Cheapest-first tests with named casualties *before* build. A methodology worth stealing wholesale for any WOS feature spike. |

## 4. Relevance to Workspace-OS

**Is "context" a missing pillar in the IWE? Partly — but not the pillar ContextHub sells.**
Workspace-OS already has the *ingredients* the org-substrate concept would try to build from
scratch: FTS5 search over the workspace, the read-only Pulse cross-project memory, shadow-git
checkpoints, and an agent that runs with the current file in context. What WOS lacks is not a
company knowledge warehouse (wrong for a sovereign, single-user, local IWE — **skip**) but a
**coherent review-and-trust surface for agent runs**. And that is exactly the piece of
ContextHub that survived its own review.

**Overlap** — ContextHub's progressive-autonomy ladder ≈ WOS's existing safe/full agent modes;
its "situational interface" ≈ the agent panel appearing when needed; its provenance/approval
gate ≈ WOS's checkpoint + revert. The `IWE-GAP-ANALYSIS.md` independently flags the same holes
ContextHub's card grammar fills, as **MUST** items: a **DiffSheet** ("blind revert is why users
fear agent edits — IPC already exists, computed but never surfaced"), an **Agents/Runs rail**
with per-run status/cost, and **checkpoint timeline** trust surfaces.

**Extends** — the three-tier card (Glance → Draft → Full context) is a near-perfect fit for a
**WOS Agent Review surface**: *Glance* = one-line "what changed" + Apply/Discard; *Draft* = the
diff (via the existing `checkpoint:diff` IPC) or the generated doc; *Full context* = files
touched + the prompt/provenance. The Decision/Action split maps cleanly onto WOS reality:
in-workspace edits are reversible (checkpointed → one-tap safe), while doc-gen / outbound /
destructive ops are the draft-gated "Action" family. This is the card-anatomy IP, minus the
warehouse.

**Challenges** — Sovereign's "commitments ledger" hints that an IWE could be more than a doc
editor: a lightweight personal work-state layer (open loops, drafts, decisions across the
user's tools) rendered as a feed. That is a *much* larger bet and out of the current roadmap,
but it is the direction that would turn WOS's agent from a tool into a runtime. Worth a note,
not a sprint.

## 5. Verdict

**Skip the product. Adopt the interaction model.** ContextHub-as-a-company-knowledge-substrate
is wrong for Workspace-OS (org capture, GDPR surface, cross-tenant scale — none of it fits a
local sovereign IWE, and ContextHub's own review already killed it). But its **Living-Feed card
grammar + progressive-autonomy ladder** is a proven design answer to the exact **MUST** gaps in
`IWE-GAP-ANALYSIS.md` §4 (trust in agent edits) — and it is a *pattern*, not a codebase, so it
couples to nothing. Merge it into the roadmap as the design language for the Agents/Runs +
DiffSheet work, not as a parallel product.

**Highest-value first slice — the three-tier Agent Review card. Effort: M.**
In the agent panel, render each completed run as one card with the ContextHub read axis:
1. **Glance** — "Edited 3 files · quarterly-report.docx +2 −1" · **Apply / Discard** (equal weight).
2. **Draft** — the unified diff, surfaced from the **already-computed `checkpoint:diff`** IPC.
3. **Full context** — files touched, the prompt, cost/turns (already in the stream-json `result`).

Reversible in-workspace edits get the one-tap Decision treatment; doc-gen and destructive ops
get the draft-gated Action treatment. This closes the "blind revert" MUST, gives the
Agents/Runs rail its atomic component, and lands the single most valuable ContextHub idea with
zero new backend — the diff, checkpoints, and cost data all already exist in `src/main`.
