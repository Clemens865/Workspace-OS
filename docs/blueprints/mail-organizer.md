# Mail: from client to obligation queue

**Status:** blueprint · 2026-08-05 · analysis grounded in the code as of `d4064b0`

---

## 1. The governing constraint

From `docs/WORKSPACE-OS-DOSSIER.md` §10.3:

> *If a feature does not compound liveness or the reviewable agent, it is a
> commodity. Skip it, or embed it — never build it from scratch.*

A better inbox is a commodity. Superhuman and Shortwave have already won that
race, and we will not out-polish them on triage keyboard shortcuts.

Mail earns its place here for one reason: **a mail is rarely just a mail — it is
an obligation attached to an artifact.** "Can you send the Q3 deck by Friday" is
a to-do whose completion lives in the Files surface, whose content lives in a
`.pptx`, and whose numbers live in a metric. Closing that loop requires the
documents, the agent and the mailbox in one process. Nobody else has all three.

**So the target is not a mail client. It is an obligation queue over the mailbox.**

---

## 2. Honest inventory (what is actually there)

**Working today**

| Piece | Where |
|---|---|
| IMAP read — folders, paged messages, fetch | `src/main/mail/imap-client.ts` |
| SMTP send, reply/forward threading headers | `src/main/mail/send-service.ts` |
| OAuth (Google + Microsoft), client id shipped | `src/main/mail/oauth/` |
| Needs-reply triage — pure, 4 gates + scoring | `src/main/mail/triage.ts` |
| Draft-gated approve-and-send cards | `src/renderer/src/components/Review/mailReviewModel.ts` |
| Folder list · message list · reader · compose | `src/renderer/src/components/Mail/MailPanel.tsx` |

**Missing, and load-bearing**

1. **No search.** `MailPanel`'s `filter` box filters only the messages already
   loaded into the pane. On a real mailbox this reads as broken.
2. **No threading.** Messages are flat per folder.
3. **No local store.** Every view is a live IMAP round-trip — the reason a first
   sync feels slow.

**The finding that reframes the guardrail question**

There is **no delete, no move, no flag, no expunge** anywhere in the mail code.
`imap-client.ts` exposes `listFolders`, `listMessages`, `fetchMessage` — nothing
else. The agent's capability entry (`capabilityCatalog.ts`) grants
`mail.triage`, `mail.draftReply`, `mail.read` and states plainly: *you NEVER send
mail.*

So today's guarantee — *never delete or send without human approval* — holds
because **the capability does not exist**, not because a policy forbids it. That
is the strongest form the guarantee can take, and it is exactly what an organizer
would dismantle: filing, archiving and labelling are all mutations.

**That tension is the design problem.** Not "what rules do we add" but *how do we
buy organizing power without spending the guarantee.*

---

## 3. Design

### 3.1 Classification is a sidecar, never a server-side move

The liveness layer already established the pattern: links live beside the file,
so deleting them leaves the document untouched. Mail classification follows it.

Categories are **derived, recomputable and stored locally**. They are never
written to the server as destructive moves. Delete the local store and the
mailbox is byte-identical — the same fail-safe property, applied to a new domain.

Three orthogonal axes, not a folder tree:

| Axis | Values | Source |
|---|---|---|
| **Obligation** | needs you · waiting on them · FYI · done | `triage.ts` already computes this |
| **Kind** | human · bulk · notification · transactional · calendar | `triage.ts` already *detects* bulk and automated senders, then discards the signal |
| **Relation** | which project / document / metric it touches | new — **this is the moat** |

Two of the three axes are nearly free: the signals exist and are thrown away.

### 3.2 The guardrail: an inverse-op journal, not a permission prompt

**The rule: never let the agent's power exceed the undo you have actually built.**

The shadow-git checkpoint gives this for files, but it cannot see IMAP state. So
mail needs its own: an append-only journal in which every agent mutation records
its **inverse**, making "undo the last hour of filing" one click rather than an
archaeology exercise.

Then tier actions by what is genuinely recoverable:

| Tier | Actions | May the agent do it? |
|---|---|---|
| Reversible, private | mark read · label · move · archive | **Yes** — journalled, one-click undo |
| Recoverable | move to Trash | Yes, journalled — **never expunge** |
| Irreversible, public | **send · expunge** | **Never.** Human-only, always. |

Two rules keep this durable:

- **Never call expunge.** IMAP deletion is `\Deleted` + expunge; skip the expunge
  and every "deletion" stays recoverable from the server's own Trash.
- **Keep send physically absent from the agent's capability set**, rather than
  discouraged in a prompt. The bug reporter already proves this discipline: a
  tool grant is a guarantee, a prompt instruction is a hope.

### 3.3 UI: hide the healthy

The cockpit paradigm was chosen deliberately over a Kanban board as "too today".
Mail should obey it rather than become a third pane of rows:

- A **Today** view — what needs you, ranked by the score triage already computes.
- Bulk and newsletters **collapse into a digest**, not 200 rows. The
  `List-Unsubscribe` / `List-Id` / `Precedence` detection for this already exists.
- **Threads, not messages.**
- Every surfaced item shows **why** it surfaced. `triage.ts` already produces a
  human reason string, and the UI currently under-uses it.

### 3.4 Cockpit: commitments, with provenance

`selectNeedsYou` already labels items `REVIEW / SEND / DECISION / ERROR`, and a
drafted reply is precisely a `SEND`. Drafted replies therefore drop into the
cockpit with almost no new machinery — `useCockpitData` just has to read
`mailReviewStore` alongside `reviewStore`.

The deeper piece is **commitments**: *"you said you'd send the deck Friday"* as a
cockpit to-do. But `cockpitModel.ts` sets the discipline in its own header — no
fabricated confidence, real signals only. An LLM-extracted commitment is exactly
that kind of uncertain signal.

**So: a commitment always carries the sentence it came from and a link to the
mail.** Never a bare to-do you cannot audit. This mirrors the memory system's
mandatory provenance, and for the same reason — a confident, unattributable claim
is worse than none.

---

## 4. Sequence

Ordered by what unblocks the rest.

| # | Step | Why here |
|---|---|---|
| 1 | **Local mail index (SQLite + FTS5)** | Fixes the slow load *and* is the precondition for search, threading, categorisation and any agent work. Nothing else is worth starting first. |
| 2 | Threading + real search | Trivial once 1 exists; impossible before. |
| 3 | Action journal + reversible-tier IMAP verbs | **Undo before power**, in that order. |
| 4 | The Today view | Needs 1–2 for speed, 3 for filing. |
| 5 | Mail into the cockpit | Cheap once 4 exists. |
| 6 | Commitments with provenance | The differentiator — and the likeliest to be wrong, so it goes last. |

---

## 5. Two cautions

**The commitment extractor is the piece most likely to produce confident
nonsense.** It wants an offline eval against a real mailbox before it is allowed
anywhere near the cockpit. The project has already paid for this lesson in the
office engine: a command that dispatches cleanly and does nothing looks exactly
like one that works.

**A local index of your mail is a new store of sensitive data.** It belongs in
`app.getPath('userData')` — beside `search-index.db`, and explicitly *not* in a
workspace folder, which is copyable and shareable. This is the same reasoning
that split personal memory from workspace memory into two databases.
