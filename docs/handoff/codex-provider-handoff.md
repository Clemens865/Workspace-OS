# Codex provider — verification handoff

**Audience:** Codex (or any second reviewer) checking the Codex provider inside Workspace OS.
**State at handoff:** shipped in v0.1.120 (PR #51) and finished in the follow-up PR (connectors, live model list, stderr filter). Everything below was measured on codex-cli 0.153.4, macOS arm64, 2026-09-06.

Your job: double-check the claims, try to break the invariants, and report what you find. Do not "fix forward" silently — every change goes through a feature branch and PR.

## Implementation update — 2026-09-07

The five-stage parallel integration is implemented on `fix/codex-parallel-integration`.
The historical v0.1.120 measurements below describe the previous implementation;
this section supersedes its run transport, OAuth, skills, and cost descriptions.

| Stage | Implemented behavior |
|---|---|
| 1 — Persistence and correctness | Main-owned default model/effort persistence; provider-qualified conversations survive restart; Codex model picks round-trip through agent files; corrected standalone resume/profile arguments. |
| 2 — Internal tasks | Mail drafting, rich-email assistance, mail sift, Foundry, and bug analysis dispatch to the selected provider. Existing Claude runners receive their existing options. Codex failures never silently start Claude. Explicit provider picks can pin light tasks. |
| 3 — Workspace operations | A structured `workspace_action` tool invokes the existing grant checks directly. Main creates new Markdown/HTML/Office files without overwriting originals and exposes an allowlist of validated metric/range/collection operations. Codex grants are bound to the originating workspace. Codex discovers native skills; bundled office generation uses the app transport. |
| 4 — Interactive integration | Codex uses an owned App Server session for streaming, correlated approvals/questions, basic connector forms/URL requests, steering, cancellation, and token usage. Model/account diagnostics and supported reasoning efforts come from App Server. Native Codex PTYs receive model/persona/mode/context and independent grants. Connector headers use a refreshable helper; inherited connectors and notification hooks are disabled in managed runs. |
| 5 — Verification | Provider-dispatch, persistence, RPC, session, grant, and document/data tests; isolated live app and MCP proofs. Claude and Codex answered concurrently in the app. |

Claude's one-shot runners, command permission flags, skill installation, and native
permission-prompt detection remain in place. Shared format/persistence fixes and
additive metadata preserve the existing Claude flow. The Codex console bypasses
the Claude launcher after common workspace setup; it does not replace it.

Verification on codex-cli 0.153.4, macOS arm64:

- `npm test -- --reporter=dot`: **2,845 tests / 230 files passed** (local sockets require execution outside the development sandbox).
- `npm run build`: passed.
- `npm run typecheck`: passed against the existing baseline, **70 known errors / baseline 75**; this is not a zero-error typecheck.
- `node e2e/codex-parallel.mjs`: **10 checks passed** using a temporary app profile/workspace: live catalog, concurrent providers, token reporting, new conversation, full app restart/resume, Safe Markdown, Safe XLSX, Foundry with Claude unavailable, native Codex PTY selection, and structured-question controls.
- `node e2e/codex-mcp.mjs`: live read-only MCP call, dummy credential environment forwarding, unattended read policy, and token reporting passed.
- Standalone live probes: App Server text response and isolated internal JSON response passed.
- Native modules restored to the Node ABI after Electron tests.

To repeat the app proof: `npm run rebuild:electron && npm run build`, then
`node e2e/codex-parallel.mjs`; always restore with `npm run rebuild:node`.
Unlike the historical harness, this proof does not kill an existing Workspace app.

Remaining validation limits: real remote OAuth accounts were not connected for a
live refresh test. Basic elicitation fields and URL requests are supported;
unsupported complex connector forms are explicitly declined rather than guessed.
Protocol integration uses App Server experimental fields for dynamic tools and
should be rechecked when upgrading the supported Codex CLI. Dollar cost remains
unknown for Codex (`costKnown: false`); token counts are displayed separately.

## Review fixes — 2026-09-08

A second reviewer (Claude) re-ran the three live proofs (all green on codex-cli 0.153.4)
and ran a full-diff review of the App Server rewrite. Ten verified defects were fixed on
the same branch, each with a negative unit test:

| # | Defect | Fix |
|---|---|---|
| 1 | `workspace_action` was registered only on `thread/start`; every resumed turn ran without the tool the guidance calls the sanctioned write path | Registered on `thread/resume` too (probed live: resume honours `dynamicTools`) |
| 2 | Codex grants carried a root even with no workspace open, and the bridge compared it against a `null` context root → every action refused | Root is minted only from a real workspace; the bridge compares only when both sides have one |
| 3 | Thread config never set `sandbox_workspace_write.network_access` and hard-disabled web search; Full-mode routines lost outbound network | `network_access = !safeMode`; web search left to the user's config |
| 4 | A persona naming a Claude-only skill aborted the run before start | Skills are advisory (`matchCodexSkills`); a dim note names the missing one |
| 5 | A failed start called `finish(1)` **and** rethrew → the run was completed twice (queue and dock clobbered code/checkpoint) | `teardown()` without a completion on failure; a cancel during startup resolves instead of rejecting |
| 6 | A prompt typed while Codex was still starting bypassed the steer gate and opened a second thread on the same conversation | The run is claimed as Codex at submit time (`codexSteer.ts`), settled by main's reply |
| 7 | Global metric/range/collection records from another workspace could not be renamed and vanished from lists | Only refresh/sync (which follow stored paths to files) stay workspace-scoped |
| 8 | The native Codex PTY hard-required a working app-server and dereferenced a nullable config | App-server failure falls back to a plain launch; `config?.mcp_servers` |
| 9 | `skills.list` rejected when Codex was missing, leaving the native Agent menu empty | Returns `[]` for Codex on failure; RPC construction inside the try |
| 10 | A missing Codex binary was re-probed with a login shell on the main thread per catalog call, twice per Settings click | Negative cache (60 s TTL); Settings makes one refresh that carries the status |
| 11 | Dock runs set connector tools to `prompt`, so every connector READ raised an approval dialog; `e2e/agent-model.mjs` check 9 timed out unless a person clicked Allow | `default_tools_approval_mode = "writes"` for all managed runs: enabling the connector is the consent (as on the Claude path); writes still ask in the dock and are declined unattended |

`codexBearers.ts` was dead after the rewrite and is deleted. Still open (not defects):
the Codex guidance duplicates `buildSystemPrompt` with drift, and the reasoning-effort
allowlist in `providerSettings.ts` is frozen in source.

## 1. What the provider is

Workspace OS runs agents by spawning a coding CLI. Claude Code was the only provider; Codex is now the second one behind the **same launcher**. A model pick is a string:

| Pick | Meaning |
|---|---|
| `''` | Claude, the CLI's own default |
| `fable` / `opus` / `sonnet` / `haiku` | Claude alias → `claude --model <alias>` |
| `codex:` | Codex, the model set in `~/.codex/config.toml` |
| `codex:<slug>` | Codex → `codex exec -m <slug>` |

Picks live in three places, precedence high → low: the per-session chip in the dock, the agent's `wos_model:` front-matter line, Settings ▸ Models. Anything unparseable falls back to Claude default (`parseModelPick`).

## 2. Files to read (in this order)

| File | What it owns |
|---|---|
| `src/main/agent/modelPick.ts` | `parseModelPick`, alias validation (`MODEL_RE = /^[a-z0-9][a-z0-9.-]{0,60}$/`) |
| `src/main/agent/providers/codex.ts` | binary lookup, `codexArgs`, JSONL event parser, per-run **profile** writer, live **model list**, stderr noise filter |
| `src/main/agent/providers/codexBearers.ts` | mints OAuth bearers for remote connectors into the child env at spawn |
| `src/main/agent/launchRun.ts` | the shared launcher: checkpoint, PATH, grants, MCP injection, spawn, stream, artifacts; branches on `provider` |
| `src/main/handlers/agent.ts` | IPC: run, default model, `agent:list-models`; conversation → `"<provider>:<sessionId>"` |
| `src/main/handlers/agent-pty.ts` | the interactive dock session (TUI) |
| `src/main/handlers/runs.ts` | routines pick up the agent's `wos_model` |
| `src/renderer/src/lib/agentModels.ts` | Claude aliases (static) + Codex models (fetched from main) |
| `e2e/agent-model.mjs` | the live proof, 9 checks on the real CLIs |
| `src/main/agent/providers/codex.test.ts` | unit tests (args, events, profile TOML, model list, noise) |

## 3. How a Codex run is spawned

```
codex exec --json --skip-git-repo-check
  -c approval_policy="never"
  -c shell_environment_policy.inherit="all"
  [-m <slug>]
  [-p wos-run-<runId>]                       # only when connectors are enabled
  -C <workspace cwd>
  -s read-only | workspace-write             # Safe | Full
  [-c sandbox_workspace_write.network_access=true]   # Full only
  [-c developer_instructions="<persona + workspace guidance>"]   # first turn only
  -                                          # prompt on STDIN
```

Resume: `codex exec resume <thread_id> --json … -` (thread ids are UUIDs, validated before they touch argv).

Invariants that must hold (these are the security rules of the whole agent layer):

1. **The prompt never reaches argv.** Only validated aliases/slugs/UUIDs/profile names do. Check `codexArgs` and grep for template strings in argv construction.
2. **No secret is written to disk or argv.** Connector secrets are decrypted into the child env only; the profile file carries env var *names* (`env_vars = [...]`, `bearer_token_env_var = "…"`), never values. Verify by reading a profile while a run is live (`~/.codex/wos-run-*.config.toml`).
3. **The bridge is the safety boundary.** `wos-action` / `wos-gen` reach the app over a unix socket with a per-run grant token; "cannot send mail, cannot delete" is enforced in the app, not by the CLI's sandbox. Codex's sandbox is additional, not the guarantee.
4. **A conversation resumes only with the CLI that started it.** `handlers/agent.ts` stores `"codex:<uuid>"` and drops the resume id when the provider differs.

## 4. Measured Codex behaviour (do not take on faith — re-measure)

| Claim | How it was measured | What you should see |
|---|---|---|
| A layered profile (`-p`) **resets** `shell_environment_policy`; the `-c` override on argv does not survive it | `codex exec -p x -c shell_environment_policy.inherit=all` with a fake bin on PATH → `command not found`; adding `[shell_environment_policy] inherit = "all"` **inside** the profile → found | Profile files written by the app carry `approval_policy`, `[shell_environment_policy]`, and in Full mode `[sandbox_workspace_write] network_access = true` |
| `-c developer_instructions=…` still applies alongside `-p` | codeword MARMOSET in developer_instructions, `-p` present → model repeated it | Persona reaches the model with connectors enabled |
| MCP tool calls need `default_tools_approval_mode = "approve"` per server | without it: `MCP tool call requires approval, but approval policy is never` | Every `[mcp_servers.<id>]` table has the line |
| `env_vars = ["X"]` forwards the parent env var to a stdio MCP server | probe server echoed `CODEWORD=ALBATROSS` from `WOS_PROBE_SECRET` | Secrets flow env → server without touching disk |
| Safe mode (`-s read-only`) can still reach the app bridge (unix socket) | e2e check 8: `wos-action list` → REACHED | Safe-mode Codex agents can act through the app |
| Model names typed into source rot: `gpt-5`, `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.2-codex` all return HTTP 400 "not supported" today | `codex exec -m <name>` | The app never hard-codes a Codex slug; it reads `~/.codex/models_cache.json` (`visibility == "list"`, ordered by `priority`) |
| Codex prints tracing on stderr (`WARN codex_models_manager::manager: failed to refresh available models: timeout`) | seen in run consoles | `isCodexNoise` drops tracing lines only; other stderr still shows |

## 5. How to run the proofs

```bash
# unit (fast)
npx vitest run src/main/agent/providers/codex.test.ts src/main/agent/modelPick.test.ts

# live, real CLIs — needs `codex login` and Claude Code signed in; costs a few cents
npm run rebuild:electron && npm run build && node e2e/agent-model.mjs ; npm run rebuild:node
```

Expected: `agent model pick: 9 passed, 0 failed`. The nine checks: Claude default / per-run / persisted; Codex answers + token trailer; Codex resumes a thread (codeword WALRUS); bridge reachable in Full; bridge reachable in Safe; an enabled connector (filesystem) is called through the per-run profile (codeword PELICAN via `filesystem.read_text_file`).

Traps: run `npm run rebuild:node` before `npm test` (native modules are per-ABI). The dev harness launches `out/main/index.js`, so the shim installer needs `WOS_ACTION_DIR` (the harness sets it).

## 6. Verification checklist for you

Tick each, note the evidence.

- [ ] Read `codexArgs` and `writeCodexMcpProfile`; confirm nothing user-controlled reaches argv unvalidated (prompt, persona, file names, connector ids).
- [ ] Start a Codex run with a connector enabled; while it runs, `cat ~/.codex/wos-run-*.config.toml` — confirm no secret value, mode 0600, and that the file is gone after the run (also after killing the app mid-run: stale files older than 6 h are swept on the next run — is that acceptable?).
- [ ] Remote OAuth connector (Linear/Asana/Notion via OAuth): connect one in Settings, run Codex, confirm `bearer_token_env_var` in the profile and a successful tool call. This path is **unit-tested but not yet proven live** (no OAuth connector was connected on the dev machine).
- [ ] Interactive dock session with pick `codex:`: the TUI opens with `-s workspace-write`; connectors ride the same profile. Confirm the profile is removed when the session ends.
- [ ] Resume across providers: run a conversation with Claude, switch the chip to Codex, send again — expect a fresh Codex thread, no error.
- [ ] Safe mode: a Codex agent asked to edit a file must be refused by the sandbox (read-only) but `wos-gen` / `wos-action` must work.
- [ ] Idle timeout: a Codex run that prints nothing for the routine's idle window is killed and reports `[timeout]`.
- [ ] Token trailer: `codex · N in / M out` after every turn; Claude shows dollars — Codex reports no cost. Decide whether to estimate or leave as is.
- [ ] Try to break `parseCodexLine` with unknown item types, partial lines, non-UUID thread ids.
- [ ] Settings ▸ Models: the Codex group lists what `models_cache.json` lists (GPT-6-Astra first on this machine). Delete the cache file → only "Codex · Default" should appear, and the run still works.

## 7. Known gaps (decide, don't assume)

- **Cost.** Codex reports tokens, not dollars. The run ledger stores `costUsd: 0` for Codex runs.
- **Destructive-command deny list.** Claude runs get an explicit deny list on top of the allowlist; Codex relies on its sandbox and the pre-run git checkpoint.
- **Foundry.** The agent builder does not yet suggest a `wos_model:` line for Codex agents.
- **Gemini** is the next provider; the adapter seam is `provider` in `launchRun` + a `providers/<name>.ts` with `args`, `parseLine`, `resolveBinary`.

## 8. Reporting back

For every finding: file + line, what you observed, how to reproduce, severity (breaks an invariant in §3 → blocker). Put fixes on a branch `fix/codex-<topic>` with a PR; keep the e2e at 9/9 and add a check for anything you fix.
