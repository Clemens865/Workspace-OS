# Mail — feature matrix, gaps, and the plan to close them

**Status:** working document · started 2026-08-07 · audited against the code, not recalled

The target: a mail client a person can live in, matching what Outlook, Apple Mail
and Gmail have trained everyone to expect — plus the things only this workspace
can do. Organised by **where the function lives in the UI**, because "we have
search" and "search is where a person looks for it" are different claims.

Legend: **✅ have** · **◐ partial** · **❌ missing**

---

## 1. Folder rail (left column)

| Feature | Outlook / Apple / Gmail | Ours | Notes |
|---|---|---|---|
| Folder tree | all three | ✅ | flat list, special-use icons |
| **Unread counts per folder** | all three | ✅ | IMAP STATUS, one connection; omitted rather than guessed |
| Nested / collapsible folders | all three | ✅ | delimiter detected; missing parents synthesised |
| Drag a message onto a folder | all three | ✅ | journalled + undoable like any move |
| Favourites / pinned folders | Outlook, Apple | ✅ | right-click to pin; persisted per account |
| Unified inbox across accounts | Apple, Outlook | ❌ | we have multi-account, no unified view |
| New folder / rename / delete | all three | ◐ | create shipped; delete refuses a non-empty folder |
| Resize / collapse the rail | all three | ✅ | drag grip, persisted |

## 2. Message list (middle column)

| Feature | Them | Ours | Notes |
|---|---|---|---|
| Envelope list, newest first | all three | ✅ | now one page per fetch, not the whole folder |
| Paging / infinite scroll | all three | ◐ | "Load more" button, offset-based |
| **Conversation threading** | all three | ✅ | grouped in SQL; unread if ANY message is |
| **Unread / read styling** | all three | ✅ | and now actually persists to the server |
| Flag / star | all three | ✅ | hover action |
| **Archive / Delete on the row** | all three | ✅ | journalled + undoable; delete = move to Trash |
| **Multi-select + bulk actions** | all three | ✅ | sequential, not parallel — avoids the connection storm |
| Swipe / hover quick actions | Apple, Gmail | ✅ | hover actions shipped |
| Sort (date / sender / size / unread) | all three | ✅ | applied in SQL, so it sorts the folder not the page |
| Filter chips (unread, flagged, attachments) | Gmail, Outlook | ✅ | write real operators into the box |
| Attachment indicator | all three | ✅ | |
| Avatars / sender images | Gmail, Outlook | ✅ | initials + derived hue; NO network fetch |
| Preview text (snippet) | all three | ✅ | |
| Density / compact mode | Gmail, Outlook | ✅ | remembered globally |
| Select-all across a query | Gmail | ✅ | selects every listed row, search results included |

## 3. Reading pane (right column)

| Feature | Them | Ours | Notes |
|---|---|---|---|
| Sandboxed HTML render | all three | ✅ | iframe, strict CSP, no scripts, no network |
| Remote-image blocking + "load anyway" | all three | ✅ | opt-in per message; CSP widened to images only |
| Reply / Reply all / Forward | all three | ✅ | |
| **Open / save attachments** | all three | ✅ | on-demand fetch; sender filename treated as hostile |
| Inline images (cid:) | all three | ◐ | data: URIs allowed; cid resolution unverified |
| Print / export to PDF | all three | ✅ | offscreen window, not the sandboxed iframe |
| Show original / raw source | all three | ✅ | bounded to 200 KB |
| Conversation view in the pane | Gmail, Outlook | ❌ | depends on §2 threading |
| Mark unread / move / delete from the pane | all three | ✅ | pane toolbar; acts then advances |
| Next / previous message | all three | ✅ | follows the CURRENT row order, incl. search hits |
| Translate | Outlook, Gmail | ❌ | agent could do this well |

## 4. Compose

| Feature | Them | Ours | Notes |
|---|---|---|---|
| Plain + rich compose | all three | ✅ | incl. a Rich mode with themes |
| Attachments (outgoing) | all three | ✅ | bounded, base64 over IPC |
| **Server-side drafts** | all three | ✅ | IMAP APPEND to the localised Drafts folder |
| **Recipient autocomplete** | all three | ✅ | derived from the index — no contact store needed |
| **Signature** | all three | ✅ | per account; placed above the quote, idempotent |
| Cc / Bcc | all three | ✅ | |
| Threading headers on reply | all three | ✅ | In-Reply-To + References |
| Schedule send | Outlook, Gmail | ❌ | |
| Undo send | Gmail, Outlook | ✅ | 8s hold in memory; nothing leaves until it expires |
| Read receipts | Outlook | ❌ | deliberately skip |
| Live `{{metric:id}}` values | **nobody** | ✅ | ours; resolved true at send |

## 5. Global / toolbar

| Feature | Them | Ours | Notes |
|---|---|---|---|
| **Full-text search** | all three | ✅ | local FTS5 index over subject/sender/body |
| Search operators (`from:`, `has:attachment`) | all three | ✅ | from/to/subject/in/is/has; unknown ops stay literal |
| Search scope (folder / all mail) | all three | ✅ | `in:Archive` operator |
| **Keyboard shortcuts** | all three | ✅ | j/k, Enter, e, ⌫, s, /, Esc — panel-scoped |
| **Undo** | Gmail, Outlook | ✅ | journalled inverse, plain-language bar |
| Refresh / sync now | all three | ✅ | |
| New mail notification | all three | ✅ | polled on a tested backoff policy; banner, not auto-refresh |
| Rules / filters | all three | ❌ | the agent is the better answer |
| Snooze | Gmail, Outlook | ❌ | |
| Offline read | all three | ◐ | list + bodies cached; opening a message still needs IMAP |

## 6. Accounts & settings

| Feature | Them | Ours | Notes |
|---|---|---|---|
| Multi-account | all three | ✅ | |
| OAuth (Google, Microsoft) | all three | ✅ | client id ships |
| App-password / IMAP setup | all three | ✅ | autoconfig for common providers |
| Per-account signature / alias | all three | ◐ | signature done; alias not |
| Sync window ("last 30 days") | all three | ❌ | we index everything we touch |
| Notification preferences | all three | ❌ | |

## 7. Infrastructure (no UI, but everything depends on it)

| Feature | Ours | Notes |
|---|---|---|
| Local index (SQLite + FTS5) | ✅ | subject, sender, body |
| Incremental sync | ✅ | uid watermark; full listing only when pruning |
| One page per fetch | ✅ | was `uid 1:*` — the whole folder, every call |
| Batched deep fetch | ✅ | one connection per folder batch |
| Undo journal | ✅ | inverse per mutation, Message-ID keyed |
| **Cache-first list** | ✅ | index paints first, IMAP refreshes behind |
| **IDLE / push** | ◐ | polling behind a tested policy; true IDLE swaps in below the same interface |
| Connection pooling | ❌ | still connect-per-operation for single calls |
| Real-mailbox e2e (read) | ✅ | 16 assertions, read-only |
| Real-mailbox e2e (mutation) | ✅ | round-trips only; move+undo opt-in via env |

## 8. The part nobody else has

| Feature | Ours | Notes |
|---|---|---|
| Triage → needs-reply ranking | ✅ | pure, tested |
| Agent-drafted replies, draft-gated | ✅ | approve-before-send enforced |
| **Quick replies (positive / neutral / negative)** | ✅ | a stance, not a canned sentence; routed through the draft gate |
| **Commitments extracted with provenance** | ✅ | deterministic, precision-first; full source sentence mandatory |
| **Mail in the cockpit** | ✅ | mail joins the same needs-you list, labelled SEND |
| Live metrics in outgoing mail | ✅ | |
| Agent mailbox organisation | ✅ | granted 2026-08-08; journalled, one-action undo, still no send |

---

## Scorecard

Counted from the tables above — **78 features** across the eight surfaces.

| | Count | |
|---|---|---|
| ✅ shipped | **61** | 78% |
| ◐ partial | **6** | 7% |
| ❌ missing | **11** | 14% |

Remaining: unified inbox · folder rename UI · sync window · notification
preferences · per-account alias · surfacing commitments in the cockpit.
(5), global (4), the differentiators (4), settings (2), infrastructure (2).

---

## The delivery cycle

Every feature goes through the same five steps. Nothing is called done at step 3.

| Step | What it means here |
|---|---|
| **1. Implement** | Smallest change that does the real thing. No stubs, no "wired but inert". |
| **2. Test** | Unit tests on the pure logic. Hostile input where input comes from outside. |
| **3. Validate** | If it touches IMAP, prove it against the REAL mailbox — a fake IMAP passing is the evidence that let a broken message-open ship. |
| **4. Review** | Re-read the diff for the failure mode that looks like success. Most defects in this project were found here, not in step 2. |
| **5. Optimise** | Only once correct. Usually: stop doing per-item network calls. |

---

## Delivery record — what shipped, and what each step found

The point of recording this is the **Review** column: it is where most real
defects surfaced, and the pattern is consistent — they were things that passed
their tests and would have looked fine in use.

### Phase 1 — the everyday client ✅ complete

| # | Feature | Test | Validate | Review found |
|---|---|---|---|---|
| 1 | Unread counts per folder | — | real mailbox | Use IMAP STATUS, not open-each-folder; omit a folder that fails rather than showing 0 |
| 2 | Conversation threading | 5 index tests | real mailbox | A thread is unread if ANY message is; sort by NEWEST message or a revived thread stays buried |
| 3 | Multi-select + bulk actions | — | real mailbox | Must run SEQUENTIALLY — 30 parallel IMAP ops is the storm that broke message-open |
| 4 | Keyboard shortcuts | — | click-test | Bind on the panel, not the window, or typing in search is hijacked |
| 5 | Attachments open/save | 16 tests, hostile input | click-test | `..\..\x` survives `path.posix.basename()` untouched — Windows traversal needed its own normalisation |
| 6 | Cache-first list | — | click-test | Precedence must be explicit (search → live → cache) or stale mail shows as current |

### Phase 2 — compose ✅ complete

| # | Feature | Test | Validate | Review found |
|---|---|---|---|---|
| 7 | Server-side drafts | 11 tests, MIME parsed back | real mailbox | Drafts folder is localised ("Entwürfe") — find by `\Drafts` flag; supersede by move-to-Trash, never delete |
| 8 | Recipient autocomplete | 8 index tests | — | Unescaped LIKE: typing `%` dumped the whole address book |
| 9 | Signature | 22 tests | — | German attribution puts the NAME last ("schrieb Ana:") — every German reply would have been signed at the bottom |
| 10 | Undo send | 14 queue tests | — | "Send now" + expiring timer must not double-send; cancel() must REFUSE after delivery starts rather than lie |

### Phase 3 — reading pane (1 of 4)

| # | Feature | Test | Validate | Review found |
|---|---|---|---|---|
| 11 | Opt-in remote images | 6 sanitizer tests | — | The sanitizer replaced each URL with `"1"` — the "load images later" its own comment promised was impossible to build |

### Cross-cutting, delivered alongside

| Feature | Test | Validate | Review found |
|---|---|---|---|
| Local index + threading | 42 tests | — | FTS5 punctuation would throw on `foo@bar.com`; an empty query dumped the mailbox |
| Two-tier sync | 25 tests | real mailbox | An envelope re-sync must not wipe deepened rows; never prune from a partial page |
| Incremental sync | 5 tests | real mailbox | `highestUid` existed from day one and nothing called it — every sync re-listed from the top |
| One page per fetch | 5 tests | real mailbox | `uid 1:*` fetched the WHOLE folder to show 30 |
| Undo journal | 20 tests | — | Inverse must search the DESTINATION; undo stack must replay newest-first |
| Move/flag/undo verbs | 13 tests | **12/12 real mailbox** | A moved message is renumbered — undo must re-resolve by Message-ID |
| Batched deep fetch | 4 tests | real mailbox | One connection per MESSAGE throttled Outlook and broke clicking |

---

## Remaining work, with its plan

### Phase 3 — reading pane (3 left)

**12. ~~Move / mark-unread / next-prev from the pane~~ ✅.**
Implement: reuse the existing verbs; the pane has no action bar today.
Test: none needed beyond the verbs' own. Validate: mutation e2e already covers
move/flag round-trips. Review: next/prev must respect the CURRENT row order
(search results, not folder order). Optimise: prefetch the neighbouring message.

**13. ~~Print / export to PDF~~ ✅ (plus show-original).**
Implement: Electron `webContents.printToPDF` against the reader iframe.
Test: assert a non-trivial PDF byte length and a `%PDF` header. Validate:
click-test. Review: the CSP-locked iframe must not gain privileges to print.

**14. Conversation view in the pane.**
Implement: `listThread()` exists; render the chain with collapsed quoted text.
Test: ordering and collapse logic. Review: a 40-message thread must not fetch
40 bodies at once — this is where the connection storm returns.

### Phase 4 — infrastructure people feel

**15. IDLE / push + notification.** Implement: a long-lived IMAP connection per
account in IDLE. Review: this is the first PERSISTENT connection in the codebase
— it needs reconnect-with-backoff and must not resurrect after logout. Validate:
real mailbox, assert a new message appears without a manual refresh.

**16. Search operators** (`from:`, `to:`, `has:attachment`, `in:folder`,
`is:unread`). Implement: a parser producing structured filters; the index
already has the columns. Test: the parser is pure — hostile and malformed input.
Review: an unrecognised operator must search literally, not silently drop terms.

**17. ~~Sort and filter chips~~ ✅.** Implement: index-side ORDER BY and WHERE.
Review: sorting must apply to the whole folder, not just the loaded page —
otherwise it silently sorts 30 of 400.

### Phase 5 — the differentiators

**18. ~~Quick replies~~ ✅.** A *stance*, not a draft:
the agent writes from stated intent rather than guessing it. Flows through the
existing `canArmSend` draft gate — approve-before-send is not bypassed.
Review: the stance must be visible in the draft card, so a "positive" reply to
bad news is caught before sending.

**19. ~~Commitments with provenance~~ ✅ (extractor; surfacing next).** Extract "you said you'd send the deck
Friday". Every commitment carries the source sentence and a link to the mail —
the memory system's mandatory-provenance rule. Validate: an offline eval against
a real mailbox BEFORE it reaches the cockpit; this is the piece most likely to
produce confident nonsense.

**20. ~~Mail in the cockpit~~ ✅.** `selectNeedsYou` already labels SEND; drafted
replies drop in once `useCockpitData` reads `mailReviewStore` too.

**21. Agent mailbox organisation.** Grant the agent `mail.move`/`mail.flag`
behind the journal, with "undo everything the agent did since X" as one call
(`undoSince` exists). Review: this changes the load-bearing guarantee, so it
needs an explicit decision, not a quiet capability addition.

### Deferred deliberately

Read receipts (a tracking feature we should not add), rules/filters (the agent
is the better answer), and schedule-send (waiting on whether an unsent message
should survive a quit — the undo-send queue deliberately does not).

## Rules that hold throughout

- **Nothing destructive.** No delete verb, no expunge. Deleting is a move to
  Trash, forever.
- **Mutation ships with its undo.** Anything that changes the mailbox is
  journalled with an inverse before it is reported done.
- **The agent's capability set is the guarantee**, not a prompt. It grants
  read/triage/draft and nothing more until we deliberately change it.
- **IMAP-touching work is validated against a real mailbox**, not only a fake.
  `e2e/mail/real-mailbox.mjs` (read, 16 assertions) and
  `e2e/mail/real-mailbox-mutation.mjs` (12, round-trips only). Both are safe to
  run against a personal account: the mutation one flags-then-unflags and
  moves-then-moves-back, asserting the mailbox ends as it started.
