# Workspace Apps — Blueprint

*Forged 2026-08-25 from an adversarial design review: red-team critique, three
alternative architectures, prior-art research, comparative scoring, and
devil's-advocate stress-testing. This document records the winner AND the
losers, so the next reader knows why the chosen shape is the chosen shape.*

## 1. Executive Summary

**The problem.** The agent produces documents and one-shot runs, but a user's
recurring personal tool — "my invoice tracker", "a lead dashboard over my
spreadsheet" — has nowhere durable to live, no launcher, and no way to travel
to another workspace.

**The chosen approach.** *Loom-first Cartridges*: one **Apps** rail entry and
one package/permission grammar hosting two tiers. Tier 1 (the default): the
app is a **declarative text file** — data bindings over existing workspace
readers + a fixed widget vocabulary + verbs — rendered by one trusted native
surface. Tier 2 (the reviewed escape hatch): the app is **sandboxed
single-file HTML** in a null-origin iframe with a deliberately tiny, versioned
`window.wos` bridge.

**Why this won.** The declarative tier dissolves the two hardest objections —
security (no untrusted code exists) and correctness (numbers flow through
readers the repo already tests) — while the cartridge tier keeps the "build me
anything" promise honest without becoming a plugin OS. ~90% of the needed
infrastructure already ships: the Canvas sandboxed-iframe pattern, the
actionBridge validation shape, the capability catalog, the Agent Foundry
lifecycle, and `claude -p --resume`.

**Key risk and mitigation.** Any app granted a write verb (`cases.note`,
`memory.remember`) can whisper attacker-authored text into stores the user's
main agent treats as ground truth — prompt-injection laundering that rides
features working as designed. Mitigation: provenance-tag app-written state,
keep **send** permanently absent from the app verb set, and accept the
residual explicitly (worst case = a bad draft a human still approves).

## 2. Concepts Explored

| # | Concept | One line | Verdict | Score |
|---|---------|----------|---------|-------|
| C0 | Naive React component | Agent writes a component imported into the trusted shell | **Rejected** — in-renderer code inherits the full `window.workspace` bridge (PTY spawn, file writes, send-mail in two calls); the shipped CSP (`script-src 'self'`, no eval) forbids the runtime evaluation it needs. Disqualified by the codebase's own invariants. | 26 |
| C1a | Webview cartridges | App folder hosted in `<webview>` + custom `wos-app://` protocol + preload bridge | **Rejected** — `will-attach-webview` hardening (http(s)-only, preload stripped) exists precisely to forbid this; amending it re-opens the webview-layer class of bugs the sign-in-loop saga paid for. | 40 |
| C1b | Iframe cartridges | App folder hosted in a Canvas-style sandboxed srcDoc iframe (allow-scripts, **no** allow-same-origin, no preload) + postMessage bridge | **Adopted as Tier 2** — the only code-bearing shape compatible with the security posture; host component = structural caller identity. | 50 |
| C2 | The Loom | App = one declarative `.tool.md` (bindings + ~8 widgets + verbs) rendered by one trusted surface; hostile specs inert | **Adopted as Tier 1 (default)** — dissolves the security question, collapses "renders but wrong numbers" into validatable wrong-bindings, exports as one diffable text file. | 58 |
| C3 | Standing Editions | Agent-regenerated static no-script page + intent-links appending to an inbox the next run settles | **Absorbed** as the optional `triggers:` block (cron/watcher/manual headless refresh) — a report you can only petition is not an "application", but the ritual mechanic is valuable. | 55 |

Industry anchors: Claude Artifacts (host-brokered `complete()` — the closest
shape), VS Code webviews (postMessage/CSP playbook, `getState` persistence),
Figma (JS-realm sandboxing always loses; origin isolation only), Obsidian
(unsandboxed plugins → incident record — the path NOT taken), Notion/Airtable
(most "apps" are data + views, not code).

## 3. Architecture

```
                                ┌─ Apps rail entry (RAIL_ITEMS + AppsSurface)
                                │
        ┌───────────────────────┴──────────────────────────┐
        │  TIER 1 — Loom tool (default)                     │
        │  <workspace>/Apps/<slug>/tool.md                  │
        │  frontmatter: name, icon, permissions[],          │
        │    bindings (xlsx range | metric | collection |   │
        │    case), widgets (table tiles board chart form), │
        │    verbs (cell-write | action | agent),           │
        │    triggers? (cron | watch | manual)              │
        │  rendered by ONE trusted ToolSurface.tsx          │
        │  filters = tiny non-Turing DSL, never JS          │
        └───────────────────────┬──────────────────────────┘
                                │ promotion (explicit, consent-gated)
        ┌───────────────────────┴──────────────────────────┐
        │  TIER 2 — Cartridge (reviewed escape hatch)       │
        │  <workspace>/Apps/<slug>/app.json + index.html    │
        │    + data/ (plain files, host-brokered)           │
        │  hosted: sandbox="allow-scripts" srcDoc iframe,   │
        │    null origin, no preload (HtmlRenderer pattern) │
        │  bridge: postMessage → AppHost validates          │
        │    sender-frame identity + manifest grant →       │
        │    typed IPC → main re-validates (2 chokepoints)  │
        │  window.wos v1 (5 calls, schema-versioned):       │
        │    complete(prompt,{stream})  getState/setState   │
        │    metric.get  collection.records                 │
        └───────────────────────┬──────────────────────────┘
                                │
        ┌───────────────────────┴──────────────────────────┐
        │  SHARED SPINE                                     │
        │  • permissions[] drawn from capabilityCatalog ids │
        │    — ONE grammar, ONE consent sheet, and the      │
        │    per-actor enforcement the catalog names as     │
        │    missing, built once for both tiers             │
        │  • ONE agent broker: every complete()/agent-verb  │
        │    → queued claude -p (--resume per app, safe     │
        │    mode, EMPTY tool allowlist, no MCP secrets,    │
        │    light model alias) behind a global cap (2–4)   │
        │    + per-app daily budget + cost telemetry        │
        │  • lifecycle = Agent Foundry pattern: describe →  │
        │    meta-agent proposes validated spec → user      │
        │    approves → plain files → RE-VALIDATED on       │
        │    every load                                     │
        │  • export = zip the folder; import = consent      │
        │    sheet + re-validation; all paths workspace-    │
        │    relative, realpath-clamped to the root         │
        │  • destructive/outbound verbs: route through the  │
        │    existing Review approval cards; SEND does not  │
        │    exist in the app verb set, permanently         │
        └───────────────────────────────────────────────────┘
```

**Data flow (Tier 1):** tool.md → validated spec → binding resolver in main
(reusing xlsx readers / metrics.ts / collections / cases) → ToolSurface
renders → verb click → existing writer/action path (approval card if
destructive) → watcher refresh.

**Data flow (Tier 2):** iframe postMessage → AppHost (checks
`event.source === iframe.contentWindow && event.origin === 'null'`, then the
manifest grant) → typed IPC → main validator → broker/store/reader → reply by
reqId.

## 4. Implementation Roadmap

**Phase 0 — Disproof-of-need probe (S).** Before platform code: have the
meta-agent compile 30 real asks into Tier-1 specs on paper. Measure the
refusal rate. If ≥70–80% fit the vocabulary, proceed; the refusals size the
Tier-2 escape hatch. *(The critic's cheapest-disproof, kept honest.)*

**Phase 1 — Apps rail + Tier 1 read-only (M).**
`shellModel.ts` (RailId + RAIL_ITEMS), `AppsSurface.tsx` (launcher grid),
`ToolSurface.tsx` + 3 widgets (table, tiles, chart), `src/main/apps/`
(tool-spec parser + binding resolver with workspace-root realpath clamp),
`handlers/apps.ts`. Validation: invoice tracker + lead dashboard render live
from real spreadsheets; hostile spec (path escape, giant file) rejected with
line-numbered errors.

**Phase 2 — Verbs + build loop (M).** cell-write via the existing xlsx
writer, `action` via surfaceActions, `agent` verb via the broker (built here:
queue, global cap, per-app budget, empty allowlist); meta-agent authoring flow
(describe → spec → approve); watcher hot-reload. Validation: "mark invoice
paid" round-trips into the real .xlsx; 5 concurrent agent verbs never exceed
the cap; quota exhaustion degrades to a visible per-app notice.

**Phase 3 — Import/export + consent (S/M).** Zip export; import =
re-validation + capability-consent sheet (tier-labelled: "this app runs its
own code"); per-actor permission enforcement threaded through the chokepoint.
Validation: imported hostile manifest demanding undeclared capability ids is
refused; a tool granted only `read` physically cannot invoke a write verb even
with a forged message.

**Phase 4 — Tier 2 cartridges (M/L).** AppHost iframe + `window.wos` v1
(5 calls, schema version field from day one), promotion path from Tier 1,
Review-card routing for destructive verbs. Validation: a malicious cartridge
(spoofed postMessage, undeclared capability, exfil-via-complete attempt)
gets text-only results and nothing else; bridge contract survives a simulated
preload refactor untouched.

**Phase 5 — Triggers (S).** `triggers:` block → headless broker runs +
edition-style refresh; per-app daily run budget. Validation: a cron'd tool
cannot starve the mail sift (shared cap observed under load).

## 5. Test Specifications

- **Spec parser/validator (pure, vitest):** valid spec round-trips; unknown
  widget/verb/capability id rejected; binding path `../../etc/passwd` and
  symlink-out-of-root rejected (realpath containment, the `validateFilePath`
  discipline); DSL: no property access, no calls, bounded length.
- **Broker:** N=10 queued calls never exceed cap; SIGTERM mid-call rejects the
  app promise with a typed error; budget exhaustion → typed `quota` error;
  spawn args contain an empty allowlist and no MCP env.
- **Bridge (Tier 2):** message from a second iframe with correct shape but
  wrong `event.source` is dropped; undeclared capability → typed denial;
  reply reqId correlation under interleaving; schema-version mismatch → the
  upgrade prompt, not a crash.
- **Consent/import:** manifest permissions beyond catalog ids refused;
  re-validation runs on EVERY load, not just import (hand-edited file can't
  smuggle a grant — the `parseAgent` precedent).
- **Real-engine e2e (the house gate):** build a tool from a fixture ask via
  the real meta-agent; open it from the rail; assert live numbers against the
  fixture .xlsx; run the negative case (revert the grant, assert refusal).
- **Live-app probes** (the Playwright `_electron` pattern proven on the mail
  preview) for anything "looks dead": iframe height, bridge round-trip
  latency, hot-reload.

## 6. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Prompt-injection laundering: app writes to cases/memory that the main agent later trusts | Medium | High | Provenance-tag app-written state; main agent treats it as data-not-instructions; **send permanently absent**; residual ACCEPTED explicitly |
| Widget-vocabulary / DSL creep erodes the "inert spec" guarantee | High | Medium | Organizational line: complexity routes to the agent verb or promotion to Tier 2, never into the DSL; DSL stays non-Turing by test |
| Bridge API versioning debt vs weekly releases | Medium | Medium | Keep v1 at 5 calls; schema version field from day one; contract tests decoupled from preload internals |
| `claude -p` latency (1.5–3s cold start) makes in-app LLM feel slow | High | Low/Med | `--resume` per app + streamed first token + explicit thinking states; never call on render |
| Quota starvation of mail sift / interactive agent by unattended apps | Medium | High | One broker, global cap 2–4, per-app daily budget, cost telemetry surfaced per app |
| fd/process pressure at 15 apps (the EBADF scar) | Medium | High | No per-app processes in Tier 1; broker is the only spawn path; watcher paths bounded |
| Agent-built cartridges "render but wrong" with no supervising dev | High | Medium | Tier 1 default (numbers via tested readers); cartridges get the fixture-anchored e2e gate before install completes |
| Cross-machine import: dead paths, machine-bound secrets, userData stores | High | Medium | Workspace-relative paths enforced at validation; secrets never in the folder (needs-declaration, `.mcp.json` grammar); bindings re-resolve by name on import |
| Multi-user "team" apps assumed but no sync backend exists | Certain (v1) | Medium | Scope v1 single-user IN WRITING; pitch examples honest |

## 7. Open Questions

1. **The Phase-0 number.** What fraction of real asks compile to Tier-1
   specs? This decides how much Tier-2 investment is justified and when.
2. **Consent granularity.** Per-capability at install vs first-use prompts —
   needs a real-user test; both failure modes (rubber stamp / prompt storm)
   are documented in the review.
3. **Promotion UX.** When the vocabulary refuses, does the meta-agent offer
   promotion inline, and how is "this app now runs its own code" made felt,
   not just stated?
4. **Trigger quotas.** The right per-app daily budget for headless runs —
   instrument current daily claude-CLI consumption first.
5. **Provenance tagging.** The exact mechanism for marking app-written
   cases/memory entries as untrusted-source when the main agent reads them.
