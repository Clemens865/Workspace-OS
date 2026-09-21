# Workspace-OS — Dogfood Test Guide

*Everything below is shipped on `master` and green in automated tests. What's left is the stuff only a human can judge: real credentials, real inboxes, and agent output **quality**. ~10–15 min total. Note anything that breaks + the exact on-screen text.*

The app is open. Five surfaces to try, easiest first.

---

## 1. Knowledge base (no setup — start here) · ~2 min
1. In your workspace, make two markdown notes, e.g. `A.md` containing `See [[B]] and [[Ghost]]` and `B.md` with any text.
2. Open `A.md`, then open the **Knowledge** tab in the left sidebar.
3. **Pass:** with `B.md` open you see **A.md** under *Backlinks*; opening `A.md` shows *Outgoing* → **B** (resolved, clickable) and **Ghost** (unresolved stub). Create `Ghost.md` → the stub resolves.

---

## 2. MCP connectors · ~3 min
1. **Settings → Connectors & Keys.**
2. Enable **Filesystem** (needs no key). In the agent console, ask: *"Using the filesystem tool, read <some file> and summarize it."*
   - **Pass:** the agent uses an `mcp__filesystem__*` tool and answers from the file.
3. *(Optional)* **GitHub:** paste a GitHub **Personal Access Token** (entered here only — never share it in chat), enable GitHub, then ask the agent about one of your repos/issues.
   - **Pass:** it answers using live GitHub data.

> Security note: keys are encrypted in your OS keychain and never appear in logs or the agent prompt. If you're on Linux and it warns about insecure storage, that's the intended refusal — don't store a key there.

---

## 3. Agent fleet + approvals · ~2 min
1. Open **two agent tabs** and start a task in each.
2. Open **Living Feed → Fleet** (toggle at the top).
   - **Pass:** two lanes, one per agent, with live status.
3. When an agent asks permission, approve/deny from its card. *(Optional: Settings → auto-approve reversible — leave OFF unless you want to try it; irreversible actions always ask.)*

---

## 4. Email · ~4 min · needs a real account
1. **Mail** tab → **Add account** → type your address (servers auto-fill) or pick a preset.
2. Enter the password. **iCloud / Gmail / Outlook need an app-specific password** (generate it in that provider's security settings — your normal password won't work over IMAP). → **Test connection**.
   - **Pass:** connection succeeds; folders + messages load; a message opens and renders (remote images blocked by default — expected).
3. **Reply** to a message → send to yourself → **Pass:** it arrives and threads under the original.

---

## 5. Advanced everyday email · ~3 min · builds on email
*Not a newsletter — a normal 1:1 email that's richer than a plain-text box.*
1. **Mail → compose a new message** (or reply to one) → switch the composer to **Rich**.
2. Pick a **theme**, write a few lines, and try the toolbars:
   - **Assist**: "Tighten" / "Make it warmer" / "Draft from my notes" — the agent edits your draft in place.
   - **Insert live data**: drop in a `{{metric}}` or a live table from your workspace — it resolves to the *real current number*.
   - **Insert a CTA button.**
3. **Pass:** the preview shows a clean, designed email; any live value shows the real number; send it to yourself with one real recipient.
4. **The judgment calls (only you can make these):**
   - Does the **design** look genuinely modern/good in your real inbox (Gmail/Apple Mail/Outlook)?
   - Is the **agent-assist writing** actually good — tighter/clearer, or generic?
   - Does live-data-in-a-normal-email feel like the superpower it's meant to be?

> Honest limit: email clients strip interactivity, so buttons/layout/live-data work in-inbox, but true "click-to-approve inside the email" isn't possible — that'd need a link back into Workspace-OS (not built yet).

---

## What to report back
- Which of 1–5 worked, and any exact error text on screen.
- For **email**: which provider, and whether connect + read + send worked.
- For **newsletter** and **agent replies**: your honest read on **quality** (good enough to send? too generic?).

That last point matters most — the plumbing is proven; the agent's *output quality* is what I can't measure and you can.
