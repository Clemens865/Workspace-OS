/**
 * Agent Foundry — the CAPABILITY CATALOG.
 *
 * Single source of truth for what a forged specialist can be granted. Each
 * capability maps a plain-language ability to a home `surface` (rail) and the
 * concrete `wos-action`/CLI commands the agent uses to exercise it. The catalog
 * is machine-readable so three consumers stay in lockstep:
 *
 *  1. the meta-agent BUILDER (validates the model's proposed capability ids),
 *  2. `readAgentForRun` (injects each granted capability's guidance into the
 *     run system prompt, so a forged agent actually KNOWS its tools), and
 *  3. the renderer UI (previews the palette a specialist can be given — reached
 *     via the `AGENTS_CAPABILITIES` getter IPC).
 *
 * Pure data module (no electron imports) so it is trivially unit-testable and
 * usable from either process. `toolMode` is the LEAST privilege a capability
 * needs — the per-agent global gate (safe/full) still governs the run; this is
 * advisory metadata for the builder + UI, not an enforcement point.
 */

export type Surface = 'browser' | 'files' | 'mail' | 'knowledge' | 'cockpit' | 'calendar'
export type ToolMode = 'safe' | 'full'

export interface Capability {
  /** Stable id — persisted in agent frontmatter, referenced everywhere. */
  id: string
  /** Short human label for the UI palette. */
  label: string
  /** One calm line describing what the specialist can do. */
  description: string
  /** The home rail this capability lives on. */
  surface: Surface
  /** The concrete surface-action ids / CLI verbs the capability exposes. */
  actions: string[]
  /**
   * Verbatim run-prompt guidance: the exact commands the agent runs. Injected
   * into the system prompt for every granted capability so the agent knows HOW
   * to use it, not just THAT it has it.
   */
  guidance: string
  /** Least privilege the capability needs. Advisory (see module note). */
  toolMode: ToolMode
}

export const CAPABILITY_CATALOG: readonly Capability[] = [
  {
    id: 'research',
    label: 'Web Research',
    description: 'Deep-read and extract facts from the live web via the in-app browser.',
    surface: 'browser',
    actions: [
      'browser.deepRead', 'browser.navigate', 'browser.extract', 'browser.map', 'browser.click',
      'browser.newTab', 'browser.tabs', 'browser.closeTab', 'browser.activateTab',
    ],
    guidance:
      'Web research: the IN-APP browser is your ONLY web access — WebFetch and WebSearch are switched off for you. This is deliberate: the user WATCHES these pages load, tabs fan out in parallel, you can screenshot a page as evidence, and the session carries their Connected-Accounts logins that a bare fetch cannot reach.\n' +
      'Drive the in-app Browser surface with the `wos-action` CLI (JSON args are ONE positional arg). Use `wos-action run browser.navigate \'{"url":"<https url>"}\'` to open a page, `wos-action run browser.deepRead \'{"url":"<url>"}\'` for a bounded multi-page profile of a site/company, `wos-action run browser.extract \'{"mode":"text"}\'` to pull readable text/links, and `wos-action run browser.map` to perceive links/headings/interactives. http(s) only.\n' +
      'TABS (parallel research): open ONE tab per item with `wos-action run browser.newTab \'{"url":"<url>"}\'` — it returns {tabId} once the tab is ready — then drive each tab by id, e.g. `wos-action run browser.deepRead \'{"url":"<url>","tab":"<tabId>"}\'` or `browser.extract \'{"mode":"text","tab":"<tabId>"}\'`. Omit "tab" to act on the active tab. `browser.tabs` lists {id,url,title,active}; `browser.closeTab`/`browser.activateTab` take {"tab":"<id>"}.\n' +
      'PARALLEL FAN-OUT RECIPE (full-mode LEAD only — opt in for a multi-item research task; skip it for a trivial one-page ask, since each subagent is a real Claude run with its own token cost). To research K items CONCURRENTLY:\n' +
      '  1. As the LEAD, spawn K subagents in a SINGLE message (one Task per item) so they run at the same time.\n' +
      '  2. Give each subagent EXACTLY ONE item and this instruction: run `wos-action run browser.newTab \'{"url":"<its item url>"}\'`, capture the returned tabId, then `wos-action run browser.deepRead \'{"url":"<url>","tab":"<tabId>"}\'` (and `browser.extract \'{"mode":"text","tab":"<tabId>"}\'` if you need more), and RETURN compact structured findings (name, homepage, key facts, emails/phones) — nothing else.\n' +
      '  3. Each subagent OWNS its tab: it only ever drives its own tabId, so the tabs load in parallel without colliding (the app runs each drive call independently per tab).\n' +
      '  4. You (the LEAD) collect all K returns and synthesize ONE merged result. If asked for a file, hand the merged rows to `wos-gen xlsx`.\n' +
      'Subagents inherit your environment, so `wos-action` and the tab bridge work inside each one automatically.',
    toolMode: 'safe',
  },
  {
    id: 'documents',
    label: 'Document Generation',
    description: 'Author real PowerPoint, Excel and Word files from a spec.',
    surface: 'files',
    actions: ['office.docgen', 'files.reveal'],
    guidance:
      'Document generation: produce a REAL office file with the office-docgen skill — write a JSON spec then run `wos-gen <pptx|xlsx|docx> --spec <spec.json> --out "<workspace>/<Name>.<ext>"` (on your PATH). Never paste document contents into chat; a generated file opens automatically in the canvas.\n' +
      'STUNNING pptx: pick a per-slide `layout` (`cover`, `section`, `bullets`, `table`, `chart`, `closing`) and set a `theme` (`{"palette":{"bg","ink","primary","accent","muted"},"font":"Inter"}`). Bullets accept `{"text":"...","level":1}` for indent; tables accept `"numericCols":[2,3]` to right-align.\n' +
      'SCREENSHOTS in a deck: capture a page with `wos-action run browser.screenshot \'{"destPath":"<workspace>/shot-1.png","tab":"<tabId>"}\'` (it returns the absolute path), then add an `image` slide: `{"layout":"image","title":"<source>","imagePath":"<abs .png>","sourceUrl":"<url>"}` — the shot is embedded and the `sourceUrl` becomes a clickable caption. (An image slide is image-only — put the data on a separate `table` slide.)\n' +
      'CLICKABLE LINKS (open in the in-app browser when clicked): in xlsx give a sheet `"linkCols":[3]` to turn a column of URLs into hyperlinks; in a pptx `bullets` slide use `{"text":"Source","href":"<url>"}`.\n' +
      'LIVE Excel→PPT DECK (deck numbers stay bound to the spreadsheet). Ordered recipe:\n' +
      '  1. Generate the .xlsx (`wos-gen xlsx ...`) — the model that owns each figure.\n' +
      '  2. `wos-metric create "<Name>" --source "<file.xlsx>!Sheet1!B2"` for EACH live figure (reads the cell now, tracks it live).\n' +
      '  3. Generate the .pptx with those figures as ANCHORED shapes: give a slide a `"metrics"` array, e.g. `"metrics":[{"tag":"revenue","text":"1200","label":"Revenue"}]` — `tag` becomes the shape name `wos-metric-<tag>`.\n' +
      '  4. `wos-metric link "<Name>" --file "<deck.pptx>" --target "<tag>"` to bind each metric to its anchor (writes the same link store the app uses).\n' +
      '  5. `wos-metric sync-all` to stamp the current values into the deck.\n' +
      '  Afterwards, whenever the xlsx changes, `wos-metric refresh-all && wos-metric sync-all` re-flows every figure into the deck. To only MIRROR values once (no live link), skip steps 2/4/5 and just put the numbers in the spec.',
    toolMode: 'safe',
  },
  {
    id: 'webpage',
    label: 'Interactive Web Page',
    description: 'Build a single self-contained, clickable HTML page that opens in the canvas.',
    surface: 'files',
    actions: ['files.create', 'files.reveal'],
    guidance:
      'Interactive web page: write ONE self-contained .html file into the workspace with the Write tool, then `wos-action run files.reveal --path "<absolute path>"`. It opens in the canvas with a live Preview / Code toggle — the right deliverable when findings are better explored than read linearly (itineraries, comparisons, dashboards, anything with sections to click through).\n' +
      'HARD CONSTRAINT — the preview renders in a sandboxed iframe via srcDoc, so NOTHING external or relative resolves: no CDN scripts, no external stylesheets, no web fonts, no <img src="./shot.png">. Inline ALL css in a <style> block and ALL js in a <script> block, or the page renders blank/broken.\n' +
      'IMAGES (e.g. browser screenshots) MUST be embedded as data URIs. Capture with `wos-action run browser.screenshot \'{"destPath":"<workspace>/shot-1.png","tab":"<tabId>"}\'`, then inline it: `base64 -i shot-1.png` and write `<img src="data:image/png;base64,<the base64>">`. Keep shots few and reasonably sized — every byte lives in the html.\n' +
      'INTERACTION: scripts DO run (sandbox allows them), so build real in-page navigation — tab bars, accordions, filters, day-by-day switchers — with plain inline JS and `document.querySelector`. What does NOT work is navigating AWAY: the sandbox has no popup/top-navigation permission, so `<a href="https://…">` cannot open anything. Show every source URL as visible, selectable TEXT next to its claim (and optionally a copy button) instead of relying on a clickable link.\n' +
      'Style it properly — a readable measure, generous spacing, one accent colour, system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`), and a `@media (prefers-color-scheme: dark)` block so it is legible in both themes. Make it responsive with flex/grid; never let the page scroll sideways.',
    toolMode: 'full',
  },
  {
    id: 'mail',
    label: 'Mail (read + draft)',
    description: 'Read the inbox and DRAFT replies — never sends on its own.',
    surface: 'mail',
    actions: ['mail.triage', 'mail.draftReply', 'mail.read'],
    guidance:
      'Mail: you may READ the inbox and DRAFT replies for a human to review. Use `wos-action run mail.triage` to surface messages that plausibly need a reply and `wos-action run mail.draftReply --id "<messageId>"` to compose a draft. You NEVER send mail — sending is always a deliberate human action in the UI. Do not attempt to send, and do not claim a message was sent.',
    toolMode: 'safe',
  },
  {
    /**
     * Mailbox FILING — a separate capability from reading, on purpose.
     *
     * Granting it is a deliberate act, not a side effect of granting mail
     * access: it is the first time the agent can change a mailbox. It is
     * survivable only because every action it takes is journalled with an
     * inverse, "undo everything the agent did since X" is a single call, and
     * there is still no destructive verb anywhere — filing to Trash is a move,
     * and expunge does not exist.
     *
     * Sending remains absent. That is the line: an agent that files your mail
     * wrongly costs you a minute of undo; an agent that sends wrongly cannot be
     * taken back by anyone.
     */
    id: 'mail-organize',
    label: 'Mail filing (move + flag)',
    description: 'File, archive and flag mail. Every action is undoable; still never sends.',
    surface: 'mail',
    actions: ['mail.move', 'mail.flag', 'mail.markRead'],
    guidance:
      'Mail filing: you may MOVE messages between folders (including to Trash, which is recoverable), FLAG them, and mark them read or unread. ' +
      'Every one of these is recorded with its inverse, so the human can undo any of it — and undo everything you did in one action. ' +
      'You still NEVER send, and you can never permanently delete: there is no delete verb, only a move to Trash. ' +
      'File conservatively. Moving a message the human has not seen means they may never see it, so prefer flagging or leaving it where it is when you are unsure.',
    toolMode: 'full',
  },
  {
    id: 'files',
    label: 'File Organization',
    description: 'Create, move, reveal and organize workspace files.',
    surface: 'files',
    actions: ['files.create', 'files.move', 'files.reveal'],
    guidance:
      'File organization: create and arrange files inside the open workspace folder with the Write/Edit tools and the Bash tool for moves (`mv`), and surface them with `wos-action run files.reveal --path "<absolute path>"`. Stay within the workspace folder; never touch files outside it.',
    toolMode: 'full',
  },
  {
    id: 'cases',
    label: 'Cases',
    description: 'The thread of work a document belongs to — subject, status, artifacts, notes.',
    surface: 'cockpit',
    actions: ['cases.list', 'cases.get', 'cases.create', 'cases.note', 'cases.status', 'cases.attach'],
    guidance:
      'CASES — every run of yours belongs to a case: open one or continue one, EVERY time. A case is a markdown file in `<workspace>/Cases/` holding the subject (a job posting, a customer, a tender), the documents produced for it, a status, and a running note stream that both you and the person write. A run that leaves files but no case is invisible to the cockpit, and the person\'s notes on it ("I applied for this one") have nowhere to land.\n' +
      'BEFORE producing anything for an ongoing pursuit: `wos-action run cases.list` to see what is already open, then `wos-action run cases.get --id "<id>"` — it returns the whole case as markdown, which is the full picture: what was sent, what the person decided, what happened last time. Do NOT start from a cold prompt when a case exists.\n' +
      'WHEN YOU CREATE A DOCUMENT for a case: `wos-action run cases.attach --id "<id>" --path "<workspace-relative path>"`, so the file is part of the thread rather than loose in a folder.\n' +
      'WHEN YOU LEARN SOMETHING the person will want later — who the interviewer is, what the posting asks for, why an approach was rejected — write it: `wos-action run cases.note --id "<id>" --text "<one line>"`. A note is how the NEXT run (yours or another agent\'s) knows what you knew.\n' +
      'WHEN A RUN PRODUCES A LIST (postings, leads, options), put the shortlist INTO the case as notes — one line per item with its link — not only into the file. The person answers about a specific item ("applied for this one") and the next run must see which items that was.\n' +
      'Opening one: `wos-action run cases.create --title "<short name>" --description "<one line: what this is and why it matters>" --subject "<url>" --type "<application|task>"`. It is idempotent on the title, so re-running reopens the same thread rather than forking it. ALWAYS write the description — a title says what something is CALLED and a status says where it stands; neither tells the person in six weeks what it actually was.\n' +
      'Cases are not only for job applications. A tender, a customer, a piece of research — anything with a subject and a life ahead of it is a case; use `--type task` when it is not an application.\n' +
      'Statuses come from the case type (application: drafted, applied, interview, offer, accepted, rejected, not-applied). Advance one only when the real event happened — `cases.status` records fact, not intent. Never invent a status change to look productive; a case that says "applied" when nothing was sent is worse than an empty one.',
    toolMode: 'full',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: "Put something in the user's own calendar.",
    surface: 'calendar',
    actions: ['calendar.createEvent'],
    guidance:
      "CALENDAR — `wos-action run calendar.createEvent --summary \"<title>\" --start <epoch-ms> --end <epoch-ms>` puts an event in whichever calendar the person chose — a connected account when there is one, otherwise a local file. You do not pick: if the choice has never been made the call fails and the PERSON answers it, because a meeting in the wrong calendar is one nobody finds.\n" +
      'Only create an event when a real time is known. If the person said "next week" or "soon", ask rather than guessing — an event on a day nobody chose is worse than no event, because they will trust it and miss the real one.',
    toolMode: 'full',
  },
  {
    id: 'knowledge',
    label: 'Knowledge Base',
    description: 'Search notes, follow [[wikilinks]], and capture findings.',
    surface: 'knowledge',
    actions: ['knowledge.search', 'knowledge.note', 'knowledge.links'],
    guidance:
      'Knowledge base: search the workspace notes and their [[wikilink]] graph with `wos-action run knowledge.search --query "<terms>"`, follow related/backlinks with `wos-action run knowledge.links --note "<note>"`, and capture a finding as a note with `wos-action run knowledge.note`. Prefer linking new notes into the existing graph.',
    toolMode: 'safe',
  },
] as const

const BY_ID = new Map(CAPABILITY_CATALOG.map((c) => [c.id, c]))

/** All catalog ids, for validation + UI. */
export const CAPABILITY_IDS: readonly string[] = CAPABILITY_CATALOG.map((c) => c.id)

/** The valid home surfaces a forged agent can be assigned. */
export const SURFACES: readonly Surface[] = ['browser', 'files', 'mail', 'knowledge']

/** Look up one capability by id (undefined if unknown). */
export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id)
}

/** Is `id` a real catalog capability? */
export function isCapabilityId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id)
}

/** Filters an arbitrary list down to the known, de-duplicated capability ids. */
export function validCapabilities(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  const out: string[] = []
  for (const id of ids) {
    if (isCapabilityId(id) && !out.includes(id)) out.push(id)
  }
  return out
}

/** Is `s` a real home surface? */
export function isSurface(s: unknown): s is Surface {
  return typeof s === 'string' && (SURFACES as readonly string[]).includes(s)
}

/**
 * Builds the "You can use these capabilities" block for the run system prompt:
 * the verbatim command guidance for each granted capability id. Unknown ids are
 * skipped. Returns '' when the agent has no capabilities (nothing injected).
 */
export function capabilityGuidanceBlock(ids: readonly string[]): string {
  const caps = ids.map((id) => BY_ID.get(id)).filter((c): c is Capability => !!c)
  if (caps.length === 0) return ''
  const lines = ['You have been forged with these capabilities — use them:']
  for (const c of caps) lines.push(`- ${c.label}: ${c.guidance}`)
  return lines.join('\n')
}

/**
 * The mode a set of granted capabilities REQUIRES — the highest `toolMode` among
 * them ('full' wins). The Foundry derives an agent's mode from this instead of
 * trusting the builder model, which reliably answered "safe" for specialties that
 * cannot work in safe mode. Unknown ids are ignored (they were already dropped by
 * validCapabilities); an empty set needs nothing beyond safe.
 */
export function requiredMode(capabilities: readonly string[]): ToolMode {
  for (const id of capabilities) {
    if (BY_ID.get(id)?.toolMode === 'full') return 'full'
  }
  return 'safe'
}
