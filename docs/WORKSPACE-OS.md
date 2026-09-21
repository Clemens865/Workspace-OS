# Workspace OS

**The only workspace you will ever need.**

*What it is, why it exists, where it stands (v0.1.78, August 2026), and what makes it different.*

---

## The Idea

A manager's day is a constant context switch: Outlook for email, Excel for
budgets, Word for reports, PowerPoint for decks, a browser for research, a
calendar somewhere else, and a separate AI tab for help. Every switch has a
cost — reload state, lose the train of thought, re-establish where you were.
The tools themselves are fine. **The fragmentation is the problem.**

Workspace OS ends the fragmentation: one window, every file type, every
communication channel, and a first-class AI agent that can work across all of
it — without switching apps, without losing context.

The benchmark we hold ourselves to: *a manager goes three consecutive days
without opening any external application.*

## The Vision

Six principles, held since the first PRD:

1. **Documents are the center, not code.** Word, Excel, PowerPoint, PDF are
   primary citizens. This is an IWE — an Integrated *Workspace* Environment —
   built for the people who live in the office suite.
2. **The AI can touch anything.** The agent has the same read/write access to
   a budget spreadsheet as to a strategy document, an email thread, or a
   calendar. It doesn't answer questions *about* your work; it does the work,
   in place.
3. **Zero app switching.** Not "most" tools — all of them, in one window.
4. **Sovereignty by default.** All data stays local. Open-source document
   engines. No telemetry, no cloud dependency.
5. **Subscription, not API.** Every AI feature runs through the user's
   existing Claude Code subscription. Zero additional cost, no API keys.
6. **Give managers the developer's sense of power.** The terminal, the
   agents, the automation — pointed at business work instead of code.

Two convictions shape everything built on top:

- **The artefact must survive the tool.** Cases are plain markdown. Documents
  are real .docx/.xlsx/.pptx. If Workspace OS disappeared tomorrow, nothing
  of yours would be trapped inside it.
- **Liveness over copies.** A number should live in one place and flow
  everywhere it's needed — spreadsheet to report to deck to email — updated
  at the source, true everywhere.

## What It Is Today (v0.1.78)

A macOS Electron application, ~600 TypeScript source files, 2,500+ tests,
shipped continuously (78 releases in ~10 weeks).

**A real office suite.** Word, Excel, and PowerPoint documents open and edit
natively via an embedded LibreOfficeKit engine with a custom-built rendering
layer — batched tile frames, native dialogs, charts, conditional formatting,
find & replace, tables. Gated by a real-engine end-to-end suite: office work
counts as done only when the actual engine proves it.

**Live transclusion — the differentiator.** One number or table lives in one
place and flows across Excel, Word, PowerPoint, and email. `wos-metric` links
are source-anchored, agent-drivable, and fail-safe (a broken link shows a
visible placeholder, never a silently wrong number).

**Native mail, fused with intelligence.** A full IMAP/SMTP client — read,
compose, send, undo-send, server drafts, signatures — plus the **Morning
Sift**: one cheap batched model pass sorts what's new into need-zones (needs
answer / your cases / worth a glance / noise), with verbs directly in each
row and "not right?" corrections that write permanent sender rules. Rich
compose builds designed HTML email from arrangeable blocks — text, headings,
images (inline CID attachments, the mechanism that actually renders in
Gmail/Outlook), live metrics, live tables, charts drawn client-safe with
table cells — with a full-screen split editor and live preview.

**Calendar with a full lifecycle.** ICS-native: day/week/month views,
drag-reschedule, surgical edits that preserve attendees, and writes that send
real invitations through iCloud — with the organizer address fetched, never
guessed.

**Cases — the thread of work.** A case holds why you applied, what the
recruiter said, which documents were produced, what happens next. Plain
markdown, readable without the app, written by human and agent alike. Notes
imply offers ("Prepare me for this conversation", "Put Thursday in the
calendar") that the person chooses to run — nothing fires by itself.

**The agent platform.** Claude Code embedded as the intelligence layer:
one-shot document generation (real .docx/.xlsx/.pptx via a Python skill
pipeline), an Agent Foundry that authors specialist agents from a plain
description, parallel multi-tab browser research fanning out subagents, a
⌘J terminal dock with live workspace context, MCP vault and connectors, and
a workspace memory system the agents read and write. Every agent write is
preceded by a git checkpoint — Keep/Revert cards make it reversible.

**The desk.** Home is not a dashboard of widgets but a calm surface that
answers "what needs me today": warm cases first, running agents as presence,
imminent meetings, and a clear-desk invitation when nothing does.

**An in-app browser** with real Chromium guests, tab groups, and agent
drive — navigate, extract, screenshot — feeding research directly into
documents and cases.

## What Stands Out

- **The agent works on your real artefacts** — the same spreadsheet you
  edit, the same mail account you send from — not on copies in a chat
  window.
- **Everything is reviewable and reversible**: checkpoints before agent
  writes, approval cards before destructive actions, an undo window before
  any mail leaves the machine. Send is treated as sacred — an agent that
  sends wrongly cannot be taken back, so agents draft and humans send.
- **Corrections become rules.** When the sift mis-zones a sender, one click
  teaches it permanently. The system gets personal by being corrected, not
  by being configured.
- **Verified, not vibed.** Real-engine e2e for office, live-app Playwright
  probes for UI claims, negative-case discipline for fixes — a green test
  that was never seen red doesn't count.
- **Local and sovereign** — the whole intelligence layer rides one consumer
  subscription, and the data never leaves the machine.

## What's Next

- **Workspace Apps** (blueprint complete, adversarially reviewed —
  `docs/blueprints/workspace-apps-blueprint.md`): users describe recurring
  personal tools and the agent builds them as durable, launchable, portable
  parts of the workspace. Two tiers: declarative no-code tools rendered by a
  trusted surface (default), sandboxed single-file cartridges with a tiny
  capability bridge (reviewed escape hatch). Next step: the Phase-0 probe.
- **Sift as the default way to read mail** — the stream you work down to
  zero, replacing the unread list.
- **Google/Microsoft platform integration** — Drive is built and awaits a
  client ID; Workspace/SharePoint follow the system-browser OAuth path.
- **Full-screen compose polish, team features, and the standing debt
  sweep** — tracked on the board.

---

*Repository conventions, architecture decisions, and the engineering
discipline behind all of this live in `CLAUDE.md`, `docs/PROGRESS.md`, and
`docs/blueprints/`.*
