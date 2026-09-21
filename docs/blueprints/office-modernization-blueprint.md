# Office Modernization Blueprint

> Final system blueprint from a completed idea-forge validation.
> Topic: Should Workspace-OS rebuild its office suite (Word/Excel/PowerPoint) from scratch in Rust — and if not, what is the state-of-the-art path?
> Status: **DECIDED**. This is the document the team steers from.
> Date: 2026-07-05 · Team: 1 dev + AI agents · Constraint: must keep shipping (no multi-month disappearance).

---

## 1. Executive Summary

**Problem.** Workspace-OS (Electron IWE) today edits real `.docx/.xlsx/.pptx` by driving a bundled headless LibreOffice engine (C++ LOKit → canvas), and the PRD benchmark — "a manager goes 3 full days without opening any external app" — implicitly demands faithful two-way file exchange with MS-Office-using colleagues. The open question was whether to throw that engine away and rebuild the office suite from scratch in Rust for a cleaner, faster, more agent-native core.

**Verdict on the Rust rebuild.** Rejected. The difficulty of an office suite is the *domain* — bug-for-bug OOXML compatibility against a closed reference implementation — and the choice of language is orthogonal to it; a from-scratch Rust engine scored 12/70 and implies ~120–200 engineer-years (LibreOffice embodies ~3,151 person-years), which directly violates the "no two-year disappearance" constraint.

**Chosen path.** Keep the LibreOffice engine as the authoritative **fidelity floor**, and add value as independently-shippable *layers on top of the real file*: a Rust/WASM GPU render skin for live feel (C2), opt-in modeled-block editing over real files (C1-lite), and a fail-safe liveness sidecar (C3-safe). Liveness is always *additive* and *keyed to file+path*, and every live feature must degrade to a correct, openable file — never a hole — across a round-trip through genuine MS Office.

**Key risk + mitigation.** The load-bearing assumption is that the *current* engine already round-trips real corporate files (redlines, fields, SmartArt, native charts, pivots) without loss; if it does not, no grand architecture matters. Mitigation: **Phase 0 — the $0 disproof** gates everything — 20 real files through the current save path, reopened in real MS Office, diffed visually and structurally, before any new architecture is built.

---

## 2. Concepts Explored

| ID | One-line description | Why considered | Score | Verdict / disposition |
|----|----------------------|----------------|-------|------------------------|
| **C0** | From-scratch Rust engine targeting OOXML fidelity | "Rewrite it properly in a safe, fast language" — the obvious instinct | **12/70** | **REJECTED.** Difficulty is the domain (bug-for-bug OOXML vs a closed reference), Rust is orthogonal. ~120–200 eng-yrs vs LibreOffice's ~3,151 person-yrs; OnlyOffice needed 100+ people / 5+ yrs even being OOXML-native. Violates "no 2-yr disappearance." |
| **C0b** | Mechanical 1:1 OpenOffice → Rust port | "Don't design, just translate the proven code" | *dominated* | **STRICTLY DOMINATED** (below C0). ~10M LOC touched = full from-scratch cost; preserves all cruft = zero product gain; staying 1:1 forces `Rc<RefCell>`/`unsafe` to reproduce C++ aliasing (SolarMutex, UNO, VCL) → nullifies Rust's only benefit. c2rust can't handle C++ templates/UNO. Only legit neighbor = decades-long incremental oxidation, which buys nothing over today's bundled LO. |
| **C1** | Semantic Overlay "Palimpsest" — immutable OOXML substrate + CRDT block projection | Highest-scoring; promised lossless round-trip "by construction" + near-free collab | **55/70** | **FOLDED (interior only).** Load-bearing claim broken by Devil's Advocate: OOXML is a zip of *interdependent shared parts*, not independent byte-regions. Keep its block-lifting for *fully-modeled* elements; **drop "lossless by construction"**; re-serialize shared-part edits through LO. |
| **C2** | Modernize the Felt Layer — Rust/WASM GPU render core, LO as geometry oracle | Best 3-month value; ships now with zero fidelity risk | **47/70** | **ADOPTED as the execution track.** Not a strategic fork — the *skin*. LO headless stays the authoritative geometry oracle; GPU core (vello/wgpu + parley/cosmic-text/taffy) owns live feel only. Already partly validated by `spike/vector-rendering`. |
| **C3** | Kill the File — "Workspace is the Document" (live typed object graph, OOXML as export) | Only category-leap; differentiation 10/10; agent-native | **42/70** | **FOLDED (boundary discipline).** Devil's Advocate: lossy ingest → legally-defective contracts (B1), stale numbers in boardrooms (B2), dangling refs (B3), silent agent corruption (B4), onboarding cliff (B5), worse export than today (B6). Keep the vision **only as a fail-safe sidecar** that always degrades to a correct file. |

**The synthesis in one line:** C1 fails at the *interior*, C3 fails at the *boundary* — they fail at **opposite ends**, so they are complementary. The answer is **layered, not a single winner**: C2 skin (render now) → C1-lite modeled-block editing over real files → C3 liveness as a safe sidecar, all sitting on the unchanged LO fidelity floor.

---

## 3. The Verdict on "Rebuild in Rust"

**Language vs domain.** An office suite is hard because OOXML fidelity is defined empirically by a closed reference implementation (Microsoft Office), not by a spec you can implement to completion. The cost lives in the *long tail of compatibility* — every field code, every SmartArt layout, every pivot-cache quirk, every tracked-change merge rule. Rewriting in Rust changes the language of the code; it does not shrink that tail by one entry. **Rust is orthogonal to the actual difficulty.**

**Why C0 is a dead end.** ~120–200 engineer-years for a 1-dev-plus-agents team is a multi-year disappearance that ships nothing MS-compatible in the interim. LibreOffice ≈ 3,151 person-years of accumulated compatibility work; OnlyOffice needed 100+ people over 5+ years *even being OOXML-native from day one*. Re-deriving that tail from scratch is the entire risk of the project with none of the product upside.

**Why C0b is worse than C0.** A mechanical 1:1 port touches ~10M LOC (the full from-scratch cost) while *preserving every legacy quirk* (zero product gain). Worse, staying faithful to C++ object graphs — SolarMutex, UNO, VCL aliasing — forces `Rc<RefCell>` and `unsafe` everywhere, which *nullifies Rust's safety*, the sole reason to port. Tooling can't rescue it: `c2rust` handles neither C++ templates nor UNO. The only intellectually honest neighbor is Firefox/librsvg-style *incremental oxidation* — a decades-long, ~100-engineer maintenance posture that keeps the C++ core and buys nothing over the bundled LO we already ship.

**Where Rust IS legitimately used in the chosen path.** Rust earns its place on the *additive* layers, never in the fidelity engine:
- **C2 GPU render core** — `vello`/`wgpu` compositor, `parley`/`cosmic-text` text shaping, `taffy` layout — compiled to WASM, owning only the *live feel* while LO remains the geometry oracle.
- **New-doc-model tooling** — the modeled-block editor (C1-lite), the liveness sidecar store, the agent-diff engine, the fail-safe re-serialization glue.

The fidelity engine stays LibreOffice C++. **We do not rewrite what already works and is 3,151 person-years deep; we build the new, differentiating surface in Rust on top of it.**

---

## 4. Chosen Architecture — the Layered Hybrid

Three layers. Each independently shippable. Value flows *upward*; authority flows *downward*; every upper layer **must** degrade cleanly to the layer below.

```
                      ┌───────────────────────────────────────────────┐
   user / agents  ──▶ │  LAYER 3 — LIVENESS SIDECAR   (C3-safe)        │  additive, opt-in
                      │  live metrics · transclusion · agent edits     │
                      │  store: redb/automerge, keyed to file+path     │
                      │  FAIL-SAFE: every live value is ALSO written    │
                      │  as a literal into the real file; stale link →  │
                      │  plain value, never a hole. Agent edit → a       │
                      │  reviewable per-file DIFF before any write.     │
                      └───────────────────────────┬───────────────────┘
                                                  │ degrades to ▼ (literal values in real parts)
                      ┌───────────────────────────┴───────────────────┐
                      │  LAYER 2 — MODELED-BLOCK EDITING  (C1-lite)    │  opt-in per element
                      │  lift ONLY fully-modeled blocks into CRDT      │
                      │  (yrs/automerge); unmodeled parts pass through │
                      │  opaque. NO "lossless by construction" claim.  │
                      │  Shared-part edits (styles/numbering/rels) are │
                      │  RE-SERIALIZED THROUGH LO, not byte-patched.   │
                      └───────────────────────────┬───────────────────┘
                                                  │ degrades to ▼ (plain LO open/edit/save)
                      ┌───────────────────────────┴───────────────────┐
                      │  LAYER 1 — FIDELITY FLOOR   (unchanged LO)     │  authoritative
                      │  bundled headless LibreOffice / LOKit          │
                      │  authoritative geometry + OOXML read/write     │
                      │  THE reference for correctness. Never bypassed  │
                      │  on the save path.                              │
                      └───────────────────────────┬───────────────────┘
                                                  │ renders into ▼
                      ┌───────────────────────────┴───────────────────┐
                      │  RENDER SKIN — FELT LAYER   (C2, cross-cutting)│  live feel only
                      │  Rust/WASM GPU: vello/wgpu + parley/cosmic-text│
                      │  + taffy. Owns live feel; LO stays the GEOMETRY │
                      │  ORACLE — skin geometry is diffed against LO.  │
                      └───────────────────────────────────────────────┘
```

**Component inventory.**

| Component | Tech | Role | Layer |
|-----------|------|------|-------|
| Fidelity engine | bundled headless LibreOffice / LOKit (C++) | Authoritative OOXML read/write + geometry | L1 |
| Render skin | Rust/WASM — vello, wgpu, parley, cosmic-text, taffy | Live feel; geometry validated against LO oracle | Skin (C2) |
| Modeled-block store | yrs / automerge (CRDT) | Lift *fully-modeled* blocks for structured editing | L2 |
| Shared-part re-serializer | LO save path | Route styles/numbering/rels edits through LO, never byte-patch | L2 |
| Liveness sidecar | redb + automerge, keyed to `(file, path-id)` | Live metrics, transclusion, agent edits | L3 |
| Agent-diff engine | Rust | Produce reviewable per-file diff before any write | L3 |

**Data flow (edit → save).** User/agent acts on L3 or L2 → change is projected down: modeled blocks re-serialize through LO (L1), live values are written as **literals** into the real parts *and* recorded as links in the sidecar → LO writes the `.docx/.xlsx/.pptx` → render skin repaints from LO geometry. On next open, sidecar re-hydrates live links from `(file, path-id)`; any link that no longer resolves shows its last literal value.

**The fail-safe rule (stated explicitly, non-negotiable):**
> Every liveness or modeling feature must, at all times, leave behind a file that opens correctly in genuine MS Office with a *correct literal value in place*. A transcluded metric writes a real number into the `.xlsx` **and** records the live link. A stale or broken link degrades to that plain literal value — **never to a hole, an error token, or a dangling reference.** Modeling is opt-in and never claims byte-identity. Agent edits produce a reviewable per-file diff before any write reaches disk.

---

## 5. Implementation Roadmap

Phased spine: **Phase 0 gates everything.** Each later phase is INDEPENDENTLY SHIPPABLE — you can stop after any one and still have a coherent, better product. Sizes: S ≈ days, M ≈ 1–3 weeks, L ≈ 1–2 months (1 dev + agents).

| Phase | What to build | Depends on | Validation criteria (gate) | Size | Shippable |
|-------|---------------|-----------|----------------------------|------|-----------|
| **0 — The $0 disproof** | Run the 20-file corpus through the *current, unchanged* engine's save path; reopen in genuine MS Office; diff visually + structurally (unzip, compare parts). No new code beyond a harness. | nothing | Corpus round-trips with **no loss of redlines, fields, SmartArt, chart-nativeness, pivots**. If it fails → that loss is **problem #1**; fix the boundary before any architecture. | S | **GATE** (not a feature) |
| **0.5 — Boundary fixes (conditional)** | Only if Phase 0 fails: fix the specific loss classes the corpus exposed, in the LO save path/config. | Phase 0 fail-list | Re-run corpus → clean round-trip. | S–M | ✅ yes |
| **1 — Felt-layer skin (C2)** | Rust/WASM GPU render core for live feel; start **Impress shape compositor** + **Calc grid**; Writer text-layout **last**. LO stays geometry oracle. | Phase 0 pass | Skin geometry diffs against LO oracle within tolerance on the corpus; no visible two-toned render seam; wgpu-in-Electron plumbing stable. | L | ✅ yes (pure polish, zero fidelity risk) |
| **2 — Modeled-block editing (C1-lite)** | Lift *fully-modeled* blocks into CRDT; unmodeled parts pass through opaque; **shared-part edits re-serialized through LO**. No lossless-by-construction claim. | Phase 0 pass | Edit a modeled block → save → reopen in MS Office → block reattaches to correct text (defeats **A1**); shared-part edit survives (**A2**); half-modeled table / cross-seam tracked change does not lose data (**A3/A4**). | L | ✅ yes |
| **3 — Liveness sidecar (C3-safe)** | Smallest first: **one** additive live feature — a transcluded **Metric** that writes a real value into a real `.xlsx` and re-syncs on open. Then agent-diff review flow. | Phase 0 pass (independent of 1/2) | Fail-safe invariant holds across a Word round-trip: stale link → literal value, never a hole (defeats **B2/B3**); agent "update Q3→Q4" produces a reviewable diff, no silent wide corruption (**B4**); "just give me the docx" ≥ today's quality (**B6**). | M (first feature) → L | ✅ yes (feature-by-feature) |

**Sequencing note.** Phases 1, 2, 3 all depend only on Phase 0 passing (or 0.5 remediating) — they do **not** depend on each other and may be pursued in any order or parallel. Recommended order = 1 → 3 (smallest live feature) → 2, because C2 ships visible value fastest and the single-metric sidecar is the cheapest proof of the fail-safe model.

---

## 6. Test Specifications

**The 20-file round-trip corpus (real, messy, corporate).** At minimum it must include:
1. Redlined multi-author MSA with comments and tracked changes across sections.
2. Board deck with SmartArt + native (non-image) charts + embedded fonts.
3. Financial model: pivots + array formulas + conditional formatting + a linked external range.
4. Document with numbered clauses + cross-reference fields + a generated TOC.
5. Mail-merge document with content controls.
…plus 15 more spanning macros-present-but-unused, comments threads, footnotes/endnotes, headers/footers with fields, embedded objects (OLE), section breaks with differing page setup, RTL/CJK text, revision history, and large (200-page) documents.

**Structural-diff method.**
1. Round-trip: open in current engine → save → reopen in **genuine MS Office** (not LibreOffice — the reference must be the closed impl the PRD benchmark implies).
2. **Visual diff:** render both, compare page images for reflow/style drift.
3. **Structural diff:** `unzip` both OOXML packages; compare the part list (were unknown sidecar parts dropped? — the A1 failure mode) and diff key parts (`document.xml`, `styles.xml`, `numbering.xml`, `_rels`, `charts/`, `smartart/`).

**Per-phase acceptance.**
- **Phase 0:** zero loss of redlines, fields, SmartArt, chart-nativeness, pivots across all 20. Any loss = a named defect on the boundary backlog.
- **Phase 1 (C2):** skin-rendered geometry matches the LO oracle within tolerance on all 20; no render seam (defeats **A6**).
- **Phase 2 (C1-lite):** modeled-block edits survive a Word re-save with correct reattachment and no shared-part corruption (**A1–A5**).
- **Phase 3 (C3-safe):** the fail-safe invariant test below passes for every live feature.

**The fail-safe invariant test (the one that governs all liveness):**
> For every live feature, construct the state, save, round-trip the file through **genuine MS Office**, then: (a) verify the file opens with a *correct literal value* present; (b) break/stale the live link and confirm it degrades to that literal — not a hole, error token, or dangling ref; (c) for agent-driven edits, confirm a reviewable per-file diff is produced before write. A live feature that cannot pass (a)+(b)+(c) does not ship.

---

## 7. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **The $0 disproof FAILS** — current engine already loses redlines/fields/SmartArt/charts (meta-risk) | Medium | Critical | This is *why Phase 0 is first and cheap*. A failure re-scopes the whole project to boundary fixes (Phase 0.5) before any architecture — turning a hidden fatal risk into a known, bounded task. |
| **LO render seam** — modeled (crisp) vs opaque (LO-rendered) regions look two-toned (A6) | Medium | Medium | C2 skin renders *all* regions from LO geometry; modeled blocks composite in the same pipeline, not a separate visual path. Seam is an explicit Phase-1 acceptance gate. |
| **GPU / LO geometry divergence** — skin geometry silently drifts from the LO oracle (C2 core risk) | Medium | High | LO remains the geometry oracle; skin geometry is continuously *diffed* against LO on the corpus; divergence beyond tolerance blocks the frame / falls back to LO raster. |
| **Collab convergence** — CRDT ops vs substrate re-serialization don't commute → silent divergence (A5) | Medium | High | Drop "lossless by construction." Shared-part edits go through LO (single serializer); CRDT lifts only fully-modeled blocks; convergence tested on multi-author corpus files. |
| **Modeled-block reattachment** — Word re-save renumbers structure; block reattaches to wrong text (A1) | Medium | High | Path-IDs re-resolved via LO structure after each save; Phase-2 acceptance explicitly tests reattachment across a Word round-trip. |
| **Lossy liveness** — a live value leaves a hole / stale number in an already-sent artifact (B2/B3) | Low (by design) | High | Fail-safe rule: every live value is *also* a literal in the file; stale link → literal, never a hole. Enforced by the fail-safe invariant test. |
| **Silent agent corruption** — "update all Q3→Q4" corrupts widely and invisibly (B4) | Medium | High | Agent edits produce a reviewable per-file diff before write; no direct-to-disk agent writes. |
| **Adoption / mental-model** — "where's my file?" onboarding cliff (B5) | Low (by design) | Medium | The file stays authoritative and always present; liveness is additive and opt-in. There is no file to lose, so no cliff. |
| **wgpu-in-Electron plumbing** — GPU integration instability | Medium | Medium | Partly de-risked already by `spike/vector-rendering`; keep LO raster fallback path always available. |
| **Scope creep back toward C0/C3-pure** — temptation to "just rewrite it" or "kill the file" | Medium | High | This blueprint is the anchor: C0/C0b are rejected, C3-pure is folded to sidecar-only. Any such proposal must first beat the fail-safe/fidelity gates. |

---

## 8. Open Questions (validate during implementation, not before)

1. **What tolerance defines "geometry matches the LO oracle"?** Pixel? Sub-pixel? Per-glyph advance? Set empirically in Phase 1 against the corpus.
2. **Which OOXML elements qualify as "fully modeled"** (safe to lift into CRDT) vs must stay opaque? Grows incrementally; start with the highest-value, lowest-risk (e.g. Calc cell ranges, Impress shapes) and expand only when a class passes the A1–A5 gates.
3. **How is `(file, path-id)` kept stable** across Word re-saves that renumber structure? Prototype the re-resolution strategy in Phase 2; measure reattachment accuracy on the corpus.
4. **Does the transcluded-Metric literal-write** ever conflict with a user's manual edit of the same cell? Define precedence (last-writer? sidecar-wins-on-open? prompt?) when the Phase-3 feature meets real use.
5. **Where does agent-diff review live** in the UX so it's not friction the user routes around? Test with real agent edits in Phase 3.
6. **Is genuine MS Office scriptable in CI** for automated round-trip diffing, or is a manual/periodic verification loop needed? Resolve during Phase 0 harness build.
7. **Writer text-layout on the GPU skin** — deferred to last in Phase 1; revisit whether it's worth the risk at all, or whether Writer stays LO-raster indefinitely while Impress/Calc get the skin.

---

*End of blueprint. Steer from Section 5 (roadmap) and Section 4 (fail-safe rule). Phase 0 gates everything — do it before writing any architecture code.*
