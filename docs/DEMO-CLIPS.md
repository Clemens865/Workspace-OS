# Demo clips

Recorded by `node scripts/demo/record-clips.mjs`. Each clip is a clean
full-frame 1512x945 screen recording — **no music, no subtitles, no zoom or
crop**, so it can be cut, re-timed and scored freely. The soundtrack and the
subtitle text live alongside rather than inside them.

Mock data is real: Mail uses the app's own built-in demo mailbox (in-memory,
no network), Calendar a real ICS feed served locally, and the workspace is a
seeded harbour-terminal project. The app runs against an isolated profile, so
nothing personal appears.

**18 clips, 150s of usable footage.**

| Clip | Seconds | What it shows |
|---|---|---|
| `overview-rail` | 10.5 | The rail — every surface in one window |
| `files-sort-filter` | 9.1 | Files — sorting and filtering |
| `files-views` | 18.2 | Files — four ways to look at a folder |
| `mail-inbox` | 8.1 | Inbox — reading a message |
| `mail-compose` | 7.5 | Composing a message |
| `calendar-week` | 3.6 | Calendar — a working week |
| `browser-page` | 3 | Browser — a real browser inside the workspace |
| `browser-assistant` | 7 | Browser — the assistant panel, and reclaiming the width |
| `agents-roster` | 3.2 | Agents — the team roster |
| `agents-new` | 8.1 | Agents — describing a new specialist |
| `office-editing` | 4.7 | Office — editing a real .docx in place |
| `feature-fullscreen` | 6.6 | Full-window mode |
| `feature-terminal` | 9.5 | Terminal — open, minimise, restore |
| `feature-terminal-side` | 7.4 | Terminal — docked below or to the side |
| `feature-new-tabs` | 6.2 | Terminal — a new shell, and a new agent |
| `browser-layout-flow` | 19.3 | The workspace rearranging around one task |
| `terminal-drag-file` | 7.2 | Dragging a file into the terminal |
| `mail-rich` | 10.6 | Mail — the rich composer and a live number |

### Recorded, but not for use yet

| Clip | Why it is held back |
|---|---|
| `office-liveness` | The metric value does not land in the document, so the number is never seen changing. Deliberately not fixed — it is one feature, and it is not what defines the product. |
| `cockpit` | Films honestly as "All calm — no agents running", which is the design working. Held back because how the cockpit should look and behave is still being decided. |

---

## overview-rail

**The rail — every surface in one window** · 10.5s · `build/demo/clips/overview-rail.mp4`

Starts on Home. The cursor moves down the left rail, opening Files, Mail, Calendar and Browser in turn. Each surface stays loaded; nothing reloads when you switch back.

## files-sort-filter

**Files — sorting and filtering** · 9.1s · `build/demo/clips/files-sort-filter.mp4`

The folder listed with Name / Kind / Date modified / Size columns. Sorting by size then by date reorders on real file metadata, and a kind filter narrows to spreadsheets while keeping the folders that lead somewhere.

## files-views

**Files — four ways to look at a folder** · 18.2s · `build/demo/clips/files-views.mp4`

Switches list to icons (real image thumbnails), to gallery (one large preview with a filmstrip), and to columns (Miller columns, where the whole path stays on screen while drilling down two levels).

## mail-inbox

**Inbox — reading a message** · 8.1s · `build/demo/clips/mail-inbox.mp4`

The inbox list with unread messages. The cursor opens one and the reading pane fills, showing sender, subject and body.

## mail-compose

**Composing a message** · 7.5s · `build/demo/clips/mail-compose.mp4`

A new message is opened and text typed into the body. Shows the composer, the send affordance, and that the app writes mail as well as reads it.

## calendar-week

**Calendar — a working week** · 3.6s · `build/demo/clips/calendar-week.mp4`

The week view populated with real events parsed from a live feed: site walks, contract calls, a board review. Shows the calendar is a real client, not a placeholder.

## browser-page

**Browser — a real browser inside the workspace** · 3s · `build/demo/clips/browser-page.mp4`

A live page loaded in the in-app browser: tab strip, address bar, and the page itself. Sessions, history and logins are the browser's own, not a preview pane.

## browser-assistant

**Browser — the assistant panel, and reclaiming the width** · 7s · `build/demo/clips/browser-assistant.mp4`

The right-hand Assistant reads the page you are on and offers what is possible with it. It collapses to give the full width back to the page, and a pinned tab brings it back.

## agents-roster

**Agents — the team roster** · 3.2s · `build/demo/clips/agents-roster.mp4`

The specialists available in this workspace, each with what it does and the access it has been granted. Any one can be opened to see how it thinks, or run in a fresh agent tab.

## agents-new

**Agents — describing a new specialist** · 8.1s · `build/demo/clips/agents-new.mp4`

The "New specialist" card opens the Foundry: you describe the agent you want in plain language and the app authors the specification. Shows the creation path, not a settings form.

## cockpit

**Cockpit — the calm overview  [NOT FOR USE]** · 3.4s · `build/demo/clips/cockpit.mp4`

The cockpit surface. It is deliberately quiet when nothing needs attention — the design hides the healthy and surfaces only what has changed or is waiting on you.

## office-editing

**Office — editing a real .docx in place** · 4.7s · `build/demo/clips/office-editing.mp4`

A Word document open in the native LibreOffice engine running locally: the full ribbon, and text typed straight into the page. The file on disk is the document — there is no upload and no round-trip.

## office-liveness

**Office — one number, everywhere  [NOT FOR USE]** · 7.5s · `build/demo/clips/office-liveness.mp4`

A figure is defined once and referenced by the document. Changing it at the source updates the open document immediately — the badge reads "live values in this file". Nothing is copied, so nothing can go stale.

## feature-fullscreen

**Full-window mode** · 6.6s · `build/demo/clips/feature-fullscreen.mp4`

Control-Command-F gives the active surface the whole window: the rail slides out and the tab strip folds away. Escape brings them back. An exit control stays visible throughout, so it is never a trap.

## feature-terminal

**Terminal — open, minimise, restore** · 9.5s · `build/demo/clips/feature-terminal.mp4`

Command-J opens the integrated terminal as a dock beneath the surface. Option-Command-J minimises it to a bar; the shell keeps running, so restoring puts you back in the same session rather than a new one.

## feature-terminal-side

**Terminal — docked below or to the side** · 7.4s · `build/demo/clips/feature-terminal-side.mp4`

The same terminal moved from the bottom strip to a right-hand column. Placement is a preference, not a mode: the running session is unaffected.

## feature-new-tabs

**Terminal — a new shell, and a new agent** · 6.2s · `build/demo/clips/feature-new-tabs.mp4`

The plus in the dock opens another shell tab, and the same menu starts an agent tab. Both run inside the workspace, so they see the same files you do.

## browser-layout-flow

**The workspace rearranging around one task** · 19.3s · `build/demo/clips/browser-layout-flow.mp4`

One continuous take. Starts on the browser with the Assistant panel open on the right. A terminal is opened at the bottom (Command-J). The Assistant is collapsed to give the page its width back. The terminal moves from the bottom strip to a right-hand column. Finally the whole surface fills the window — rail and tab strip out of the way, with an "Exit full window · esc" control left visible. NOTE: filling the window currently also hides the terminal, so the dock placed a moment earlier disappears at the end. Worth deciding whether that is right before this clip is used.

## terminal-drag-file

**Dragging a file into the terminal** · 7.2s · `build/demo/clips/terminal-drag-file.mp4`

A file is dragged from the tree onto the terminal. The dock highlights as a drop target, and on release the file's full path is typed into the shell — quoted, ready to use as an argument. The same gesture works into an agent tab.

## mail-rich

**Mail — the rich composer and a live number** · 10.6s · `build/demo/clips/mail-rich.mp4`

Switching the composer to Rich: design themes restyle the message, and Insert → Live metric drops in a figure that stays linked to the workspace value behind it rather than being retyped.
