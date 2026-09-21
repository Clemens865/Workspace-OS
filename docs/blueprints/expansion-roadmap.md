# Workspace-OS — Expansion Vision & Roadmap

*Synthesized 2026-07-12 from a full internal audit + live research across Framer, Gamma, Miro/tldraw, Obsidian, Mailchimp/MJML, and the MCP/agent ecosystem. This is a **steerable roadmap**, not a build order — nothing here is committed.*

---

## 1. The organizing thesis (read this first)

Every capability below is **commodity on its own** — website builders, deck generators, whiteboards, newsletter tools, knowledge bases, and MCP connectors all exist and are mostly free or cheap. Workspace-OS wins only when each is **routed through the two things nobody else owns together**:

1. **Live transclusion** — one number/table lives in one place, source-linked, and flows across real `.docx/.xlsx/.pptx` at true OOXML fidelity, agent-driven, fail-safe. (Shipped, PRs #14–#19.)
2. **The reviewable agent** — an in-app Claude console whose every action surfaces in the **Living Feed** as an approve/revert card with a checkpoint audit trail. (Shipped.)

> **The rule for every item on this roadmap:** if it doesn't compound liveness or the reviewable agent, it's a commodity and we either skip it or buy/embed it (never build it from scratch). If it *does*, it's defensible in a way no incumbent can copy — because none of them own a high-fidelity local office engine **and** an agent **and** a liveness layer.

The product one-liner this roadmap serves: **"a manager goes 3 days without opening any external app"** — local-first, sovereign, agent-native.

---

## 2. Where we are today

**Shipped and proven (on master):**
- Native office suite (Word/Excel/PPT via LibreOfficeKit, high OOXML fidelity), vector slide rendering, tile pipeline.
- **Live transclusion** — metrics + ranges, source-linked, cross-app, `wos-metric` CLI on the agent path.
- In-app **Claude agent console** (`claude -p`, runs on the user's subscription) + custom agents (`.claude/agents/*.md`).
- **Living Feed / Review surface** — agent runs as Keep/Revert cards; live HITL approval cards; checkpoint rollback.
- Interactive shape/design canvas + a **Framer-style component system** (variants, components, range-templates).
- Search indexer + local memory; multi-doc resident cache.
- **Engine hardened this session** — save-coalescing (Impress wedge fixed), fail-fast on sidecar death, macro serialization, a permanent StarBasic seed validator, leak/efficiency cleanups. All real-engine-e2e verified.

**Built but unmerged (on `feat/mail-foundation`, PR #28):**
- Native email client — IMAP read + SMTP send + reply/forward, multi-provider (Gmail/iCloud/Outlook/…), Google OAuth, and **agent-drafted replies surfacing as Review cards**.
- **A reusable secret vault** — `safe-secret-store.ts` (Electron `safeStorage`) + `account-store.ts` (encrypted secrets in a separate `0600` file, behind a swappable interface) + an OAuth/token-refresh flow.

> **Strategic dependency (important):** the secret vault the entire agent-platform direction needs *already exists*, but it lives inside the unmerged email branch. **Merging email is on the critical path for MCP + secure keys.** "Finish testing email" isn't a side quest — it unlocks the vault.

**Honest read on the Review / Living Feed surface** (founder flagged it as "great but early" — agreed): today it's a single-stream feed of one agent's runs. Its bones — an observable event store, edit vs action classification, checkpoint-backed revert, live HITL approval — are **exactly** the hard parts every competitor is still bolting on as webhooks. The gap is that it's single-agent and every action is gated one-by-one. Its evolution (below) is the highest-leverage surface we own.

---

## 3. The candidate capabilities (mapped to the moat)

### A. Agent platform — MCP connectors + secure key vault + agent fleet  ← *founder's stated near-term bet, highest priority*

| Borrowable | Source | How it compounds our moat | Effort |
|---|---|---|---|
| **In-app encrypted key vault** → inject secrets into MCP servers at spawn | safeStorage / 1Password patterns | Generalize the email branch's `SecretStore`/`account-store` into `src/main/secrets/`. User adds a key in Settings → encrypted at rest → decrypted **only** in main at spawn → injected as `childEnv` env var, never in argv/prompt/logs/transcript. | S |
| **MCP wiring for the terminal agent** | MCP spec 2025-11 | Workspace writes a `.mcp.json` (`${VAR}` refs only) and passes `--mcp-config` + `--strict-mcp-config` at the existing `agent.ts` spawn site; tools gated as `mcp__<server>__<tool>` in `agent-permissions.ts`. **The injection point already exists** (`agent.ts` builds `childEnv`). | M |
| **Connector catalog, Wave 1** | MCP registry | Ship headless-friendly first: **GitHub (PAT), Filesystem, Postgres, Playwright, Stripe** — secret is just an env var, no browser OAuth. Wave 2 (OAuth: Notion, Linear, Slack, Atlassian) reuses the email branch's OAuth flow. Wave 3 (hosted Gmail/Drive) is subscription-gated — and notably *validates our native-email decision*. | M→L |
| **Fleet lanes** in the Living Feed | Claude Agent SDK, GitHub Agent HQ | Extend `reviewStore` with `agentId` (attribution via `parent_tool_use_id`), render one lane per running agent (status/step/cost), launch N agents from the existing agent library. | S |
| **Risk-tiered, batched approval** ← *the defensible wedge* | LangGraph Inbox, OWASP ASI09 | Auto-approve the ~99% reversible/read-only tier; gate only outbound/irreversible actions; batch approvals across agents ("approve all 4 writes"); per-agent permission scopes. **Nobody has solved approval-fatigue-at-scale in a shipping product** — and we already own the approval surface. | M |

**Security model (non-negotiable):** decrypt only in main, only at spawn; `.mcp.json` holds `${VAR}` references (chmod 600, gitignored); least-privilege per-server tokens; refuse Linux `basic_text` safeStorage backend; redact secrets from any log; one-data-source-per-session to break the prompt-injection "lethal trifecta" exfil path.

### B. Creation surfaces — generation, design, canvas

| Borrowable | Source | How it compounds our moat | Effort |
|---|---|---|---|
| **Component → collection data-binding** | Framer CMS | Generalize the transclusion registry into a typed **collection model** (records + fields + references); bind a component variant slot to `{{field}}`. This extends liveness from *metric→doc* to *record→layout* — a repeated card/table driven by live data. Compounds two already-built systems. | M |
| **Brand-kit object** | Gamma / Mailchimp | Store palette/fonts/logo/approved images (via the vault + memory); inject into the agent prompt + component theme tokens so **all** generated output is on-brand in one shot. Small, feeds everything else. | S–M |
| **Agent-driven generative layout** | Gamma generative layout | Agent composes from our variant/range-template library per content block instead of one fixed slide master; whole-deck refinement routes through the Living Feed as approve/revert. Defensible only *with* liveness (figures stay source-linked). | M |
| **Open/infinite canvas (embed tldraw — MIT)** | Miro / tldraw | Don't build a canvas engine — embed tldraw, host our existing components as custom shapes. | M |
| **Frame → LOK-slide bridge** ← *unique seam* | Miro frames | A frame on the infinite canvas *is* a live, high-fidelity, source-linked Office slide. Spatial reasoning in, real `.pptx` out. No incumbent can do this. | M–L |

### C. Knowledge & communication

| Borrowable | Source | How it compounds our moat | Effort |
|---|---|---|---|
| **Agent-authored email/newsletter** (MJML compile + agent-emits-MJML + iframe preview) | Mailchimp / MJML / react-email | Reuses the agent's file-writing skill + our SMTP + Review cards. "Type a prompt → agent builds a designed responsive newsletter → preview → approve → send." The enabling primitive for a whole surface. | S |
| **Liveness-as-live-merge-tags** ← *pure moat* | (ours) | Transclusion tokens resolved at build+send: a newsletter whose numbers are **live and true**. No email tool on earth has source-linked metrics in a campaign. This is the story to lead with. | M |
| **Backlinks + wikilink stubs + graph** | Obsidian / Logseq | Turn the existing workspace + memory into a real knowledge base — and **the agent maintains the graph** (agent-linked, not hand-linked). Indexer already exists. Graph view + HNSW related-notes follow. | S→M |

---

## 4. Phased roadmap

**Phase 0 — unblock (housekeeping):**
- ✅ Engine hardening (done this session).
- ⏳ **Test + merge email (PR #28)** — unlocks the shared secret vault. *Critical path for Phase 1.*

**Phase 1 — Now (compounds what exists; the founder's bet):**
1. Generalize the vault into `src/main/secrets/` + a Settings key-manager. **[S]**
2. MCP wiring at the `agent.ts` spawn + Wave-1 connectors (GitHub/Filesystem/Postgres). **[M]**
3. Fleet lanes + **risk-tiered batched approval** in the Living Feed. **[S+M]**
4. Brand-kit object feeding docgen + email. **[S–M]**
5. Agent-authored email (MJML + iframe preview + Review-card send). **[S]**
6. Backlinks + wikilink stubs (knowledge base v1). **[S]**

**Phase 2 — Next (extend the moat):**
- Component→collection data-binding (record→layout liveness). **[M]**
- Liveness-as-merge-tags in email (the newsletter moat). **[M]**
- Agent-driven generative layout + whole-deck refine via Living Feed. **[M]**
- MCP Wave 2 (OAuth connectors, reusing the email OAuth flow). **[M]**
- Embed tldraw open canvas; host components as objects. **[M]**
- Graph view + HNSW related-notes. **[M]**

**Phase 3 — Later (structural leaps):**
- Frame→LOK-slide bridge (canvas region = live office slide). **[M–L]**
- Multi-agent coordinator/worker hierarchy; self-tuning approval policy (override-rate KPIs). **[L]**
- Bases-style DB views; MCP Wave 3 (hosted connectors). **[L]**
- Public website export target. **[L]**

**Explicitly NOT building:**
- Real-time multiplayer / CRDT sync — contradicts local-first/sovereign; it's Miro's moat, not ours.
- A from-scratch canvas engine — embed tldraw.
- Any commodity generator (deck/site/email) **without** liveness — undifferentiated race to the bottom.
- A mandatory cloud secret manager (Doppler/Vault) — offer 1Password BYO as opt-in only.

---

## 5. The single highest-leverage move

Ship **Phase 1, items 1–3 as one coherent vertical**: *user stores keys safely → Claude reaches MCP connectors through the terminal → spins up and approves N agents from the Living Feed.* It is entirely a **reframing of surfaces the repo already owns** (the `agent.ts` spawn, the `agent-permissions.ts` gate, the vault from the email branch, the Review store) plus attribution wiring — no new engine. It delivers the founder's stated direction end-to-end, and the **batched risk-tiered approval** inside it is the one thing the whole agent industry has not yet solved in a shipping product.

*Gated, as always, on: email merged first (for the vault), and each slice verified against real behavior — engine-e2e for engine work, real-socket/real-spawn for the agent/MCP path.*
