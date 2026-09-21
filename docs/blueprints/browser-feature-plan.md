# The browser: what to add, and where it goes

**Status:** plan · 2026-08-08 · written after the double-load fix made browsing trustworthy

---

## The thesis

**We are not rebuilding Chrome, and we should not try.** Chrome is twenty years
of work, and the parts users would miss most (extensions, autofill, sync) are
the parts that are hardest and least ours.

But a browser *inside a workspace* can do one thing Chrome structurally cannot:
**treat the web as a source rather than a destination.** Every page you read is
something the workspace could remember, search, quote into a document, or hand
to an agent. Chrome forgets a page the moment you close the tab, because it has
nowhere to put it. We do.

So the plan splits in two:

1. **Table stakes** — the things whose *absence* is felt every day. Build them
   plainly, without invention. Nobody wants a clever bookmark.
2. **The actual advantage** — page content becomes searchable workspace memory,
   and agents work on what you have read.

---

## Where it goes: one row of chrome, ⌘K for everything else

The hard constraint is that this browser lives inside a workspace that already
has chrome of its own. Stacking a full browser UI on top means two title bars,
two toolbars and two search boxes — the page ends up in a letterbox.

So: **one persistent row.** Everything else is summoned.

```
┌──────────────────────────────────────────────────────────────────┐
│ ●●●   ⌂ │ ◀ ▶ ↻ │ ⌕ linkedin.com/in/…            │ ★ │ ⋯ │ ▣ │   ← ONE row
├──────────────────────────────────────────────────────────────────┤
│ ▸ Research (4)   ▸ Hiring (2)   ● Asana   +                      │   ← tabs, collapsible
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│                          the page                                │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Three rules that keep it calm:

- **The omnibox is the only input.** Address, search, history, bookmarks, open
  tabs and commands are one ranked list. There is never a second search box.
- **The tab strip hides at one tab.** A single-tab browser shows no strip at
  all — it is pure noise until there is a choice to make.
- **Everything else lives in ⌘K or the ⋯ menu.** Downloads, zoom, find,
  history, reader mode. Present when summoned, invisible otherwise. This is the
  same instinct as the cockpit's *hide-the-healthy*.

Net cost versus today: **one extra row** (the tab strip, which already exists),
and it disappears when you have one tab.

---

## Part 1 — table stakes

Ordinary browser features, built plainly. Rough order by how often their absence
is felt.

| Feature | Where | Notes |
|---|---|---|
| **History** | new `src/main/browser/history.ts` | See Part 2 — this is the spine, not a list |
| **Autocomplete** | omnibox | One ranked query: history · bookmarks · open tabs · domain completion · search |
| **Bookmarks** | same store as history | A starred history row. No parallel system, no folder tree |
| **Find in page** ⌘F | `webContents.findInPage` | Electron gives this directly; small overlay, no layout shift |
| **Zoom** ⌘+/−/0 | `setZoomLevel`, per-origin | Persist per site, as Chrome and Safari do |
| **Downloads** | `will-download` on the partition | Land in the workspace Files surface, not a hidden folder — this is a workspace |
| **Session restore** | extend `browserTabs.ts` | Tabs already have stable ids and persist url/title/favicon; needs scroll + group |
| **Reader mode** | reuse `deepRead.ts` | Already extracts readable content for agents; rendering it for humans is nearly free |
| **Private window** | a non-persistent partition | One line of session config; the value is that it is genuinely separate |
| **Print / save as PDF** | `printToPDF` | Should offer "save into the workspace" as the default target |
| **Passwords / autofill** | *deliberately deferred* | Chromium's own password store is not exposed via Electron. Rolling our own credential store for arbitrary sites is a security surface I would not add casually — and `safeStorage` is already carrying mail credentials. Revisit as its own project |

### Extensions: no, and here is the reasoning

Electron can load some Chrome extensions, but implements only a fraction of the
`chrome.*` APIs — and the extensions people actually want (uBlock, 1Password)
depend on precisely the unimplemented parts. So the realistic outcome is a
feature that appears to exist and fails per-extension, which is worse than not
having it.

There is a second reason that matters more here. An extension runs arbitrary
code inside our browser partition — the same partition holding the user's live
sessions, and the one the agent reads. "The agent can see what is on the page"
stops being a guarantee the moment a third party can rewrite the page.

**Instead: page actions.** Small, declared, workspace-owned things that run on
the current page — and agents can author them. That is the Agent Foundry
pattern already in this repo, pointed at the browser. Same user-facing benefit,
none of the trust problem.

---

## Part 2 — the actual advantage

### 2.1 History is a full-text index of what you read

The single highest-value item here, and the reason to build history first.

Chrome's history is URLs and titles, so it only answers questions you can
already phrase. Ours should index **page content**, because then it answers the
question people actually have: *"what was that pricing page I looked at last
week?"*

Both halves already exist:

- `extractScript.ts` / `deepRead.ts` already pull readable page text — that is
  how the agent reads pages today.
- `mail-index.ts` already runs an SQLite **FTS5** index with ranking, snippets
  and `escapeLike` — a proven pattern in this codebase, on the same disk.

So this is mostly wiring, not invention: on `did-navigate`, extract text, store
`{url, title, text, visitedAt, favicon}`, index it. Bookmarks are a `starred`
column on the same table.

What it unlocks immediately:

- **Omnibox search over content**, not just titles
- **The agent's memory of your reading** — "summarise everything I read about
  X", "compare the three vendor pages I opened yesterday"
- **Provenance for transclusion** — a figure quoted into a document can point
  back at the page and the moment it was read

Two constraints to build in from the start, not bolt on:

- **Private windows are never indexed.** Non-negotiable, and it must be visible.
- **A visible, per-site off switch, and real deletion.** A local index of
  everything you have read is a genuinely sensitive object. It should be as easy
  to inspect and erase as it was to create, and "delete" must mean the FTS rows
  too, not just the visible list.

### 2.2 Tab groups by task, not by category

Manual tab categories are a chore that decays — people group tabs once and never
maintain it.

The workspace knows things Chrome does not: which project is active, which agent
run opened a tab, which document you were editing. So **group automatically by
the work that produced the tab**, with manual override as the fallback rather
than the mechanism:

- tabs an agent opened during a research run → that run's group
- tabs opened while a project was active → that project
- everything else → Ungrouped

This is also what makes session restore meaningful: reopening *Hiring* restores
a task, not eleven anonymous tabs.

### 2.3 Agentic capabilities

The drive layer already exists (`browserControl.ts` — navigate, extract,
interact, map, deepRead) and parallel multi-tab research already ships. The gap
is not capability, it is **reach**: these are things the agent can do, not
things the user can ask for at the moment they want them.

So surface them where the page is:

| Action | Built on |
|---|---|
| Summarise this page | `deepRead` (exists) |
| Extract this table → Calc | extract + docgen (exist) |
| Compare these N tabs → a table | multi-tab research (exists) |
| Watch this page for changes | history index + a diff |
| Quote this into the document I am writing | transclusion (exists) — with a live source link |
| File this into the knowledge base | knowledge base (exists) |

Note how few of these need new engines. The work is the *verb surface* — ⌘K on a
page, and a `PageAssistant` that offers these rather than only free-form chat.

**The guardrail carries over from mail:** an agent may read and propose freely,
but anything that leaves the machine — submitting a form, sending a message,
making a purchase — is *propose → human approves → act*. Same rule as
`never send or delete without approval`, same reason.

---

## Suggested order

**Phase 1 — the spine.** History + FTS index, bookmarks as starred rows, and the
unified omnibox on top. One store, one input. Everything later reads from it,
and it is what you feel every second.

**Phase 2 — the plain gaps.** Find-in-page, zoom, downloads → Files, session
restore, reader mode. Individually small, collectively the difference between "a
webview" and "a browser".

**Phase 3 — task groups + page actions.** Auto-grouping, and the ⌘K verb surface
over the existing agent capabilities.

**Deferred deliberately:** extensions (above), passwords/autofill (its own
security project), sync.

---

## The open question

`<webview>` remains officially discouraged by Electron — it "impacts rendering,
navigation, and event routing", and `WebContentsView` is the recommended
replacement. The double-load bug was ours, not the guest's, so this is no longer
urgent; `e2e/browser/window-vs-webview.mjs` exists to decide it on evidence.

But it is worth deciding **before** Phase 2, not after: downloads, zoom, find and
print all attach to the embedding layer, and doing that work twice would be the
expensive mistake.
