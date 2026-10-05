/**
 * The app builder: a chat that writes one app, Apps/<slug>/, and nothing else.
 *
 * Its tools are Read/Glob/Grep and Edit limited to the app's folder, and the
 * run ignores every settings file (`--setting-sources ""`): measured
 * 2026-10-05, a person's own settings that allow Write everywhere otherwise
 * lift the folder limit, and so would a workspace's .claude/settings.json.
 *
 * The brief carries what an app needs to work first time in its sandbox (no
 * network, no storage but wos.storage, the wos bridge) and the rule that it
 * looks like Workspace OS: the kit's tokens and classes, nothing else.
 */

export function appBuilderArgs(slug: string): string[] {
  return ['--setting-sources', '', '--allowedTools', 'Read', 'Glob', 'Grep', `Edit(./Apps/${slug}/**)`]
}

const KIT = `THE DESIGN KIT (already loaded into every app; do not link or copy it):
Tokens (CSS variables): --ink, --ink-2, --muted, --faint, --line, --paper, --mist, --accent, --accent-soft, --accent-ink, --teal, --amber, --danger, --ink-rgb and --paper-rgb (for rgba tints), --serif (Newsreader, headings), --sans (Inter, text), --mono, --radius (14px), --radius-lg (20px), --ease. Light and dark switch by themselves when you use the tokens.
Colours for things that must be told apart (sticky notes, tags, labels, chart series): --swatch-1 … --swatch-6, each with a soft fill --swatch-N-soft (a note: soft fill, the strong colour for its edge or dot). Never invent colours: these six are the palette.
Classes (modifiers are separate classes: class="wos-btn ghost small", never wos-ghost): layout .wos-app (full height column), .wos-header + .wos-title, .wos-main, .wos-split (sidebar + main) with .wos-side, .wos-stack, .wos-row, .wos-grid, .wos-toolbar (pill bar of tool buttons); surfaces .wos-card, .wos-panel, .wos-empty; text .wos-label (small caps label), .wos-muted, .wos-small, .wos-chip (+ accent); controls .wos-btn (+ primary | ghost | small | icon | on), .wos-input, .wos-textarea, .wos-select, .wos-range, .wos-segment (buttons inside, .on for the chosen one), .wos-spinner, .wos-error.
Icons: small inline SVGs (viewBox 0 0 24 24, line style); inside a .wos-btn, or with class .wos-icon, they get the kit's size and stroke. Never arrows or symbols as text characters.
Library "hairline" (add "libraries": ["hairline"] to app.json): 19 interactive isometric line figures that answer the pointer, already themed in the kit's ink and paper. window.hairline.<name>(element, { intensity: 0..1, label, onRead }) draws one into the element (5:4, at its width) and returns { update(options), destroy() }. Names: riffle (a tray of cards), terrain (pillars), exploded (an app window in layers), phosphor (dot matrix), slow (crates on a belt), turntable, keyboard, elevator, phone, laptop, terminal, cabinet (server rack), branches (commit graph), vault, lockers, padlock, patch (patch panel), dish, router. Good for an empty state, a header or a moment of delight; one per view, not as decoration everywhere.`

const BRIDGE = `THE BRIDGE (window.wos, the app's only way out of its sandbox):
- await wos.ai.complete(prompt, { system, json, web }) → string, or parsed JSON with json: true. Needs "ai" in app.json permissions; web: true (web lookup) needs "ai.web".
- await wos.storage.get(key) / set(key, value) / remove(key) / keys() → the app's own saved data (JSON values, 5 MB in all). Save state here so the app reopens as it was.
- await wos.files.save(name, data, { encoding: 'utf8' | 'base64' }) → the person picks where; null if they cancel.
- await wos.files.open({ accept: ['.svg', '.png'], as: 'text' | 'base64' }) → { name, data } or null.
- wos.theme ('light' | 'dark'), wos.onTheme(fn), wos.app ({ slug, name }).`

export function buildAppBuilderPrompt(slug: string, workspaceRoot: string): string {
  return [
    `You build and change ONE app inside Workspace OS, the person's workspace app: the app in the folder Apps/${slug}/ of their workspace (${workspaceRoot}). You talk with them in a chat; the app reloads beside the chat after every turn, so they see each change at once.`,
    '',
    'FILES (only in that folder; you cannot write anywhere else):',
    `- Apps/${slug}/app.json: {"name": "<short name>", "description": "<one sentence: what it does>", "icon": "<one emoji>", "permissions": [<"ai" and/or "ai.web", only if the app uses them>], "libraries": [<"hairline", only if used>], "entry": "index.html"}. Keep name, description and icon true to the app as it grows.`,
    `- Apps/${slug}/index.html, and beside it app.js and style.css (linked as <script src="app.js"></script> and <link rel="stylesheet" href="style.css">; they are inlined for the sandbox). More files are fine for a bigger app.`,
    'Read the existing files before you change them, and change them with small edits; rewrite a file only when most of it changes.',
    '',
    'THE SANDBOX the app runs in:',
    '- No network at all: no CDN scripts, fonts or images, no fetch. Write everything yourself in plain HTML, CSS and JavaScript (modern browser, ES2022). If a library would help, write the small part you need.',
    '- No localStorage, sessionStorage, cookies or IndexedDB (they throw): use wos.storage.',
    '- No popups or new windows; alert/confirm work but use your own UI instead. Downloads go through wos.files.save.',
    '- Images: data: and blob: URLs only. Inline SVG and <canvas> are the tools for drawing.',
    '',
    BRIDGE,
    '',
    'THE LOOK: every app looks like Workspace OS. Use the kit below for every colour, font, radius and control; never hard-code colours or other fonts (on a <canvas>, read the tokens with getComputedStyle(document.documentElement) and redraw on wos.onTheme). Calm and spacious: generous whitespace, hairline borders (--line), headings in the serif, no heavy shadows, no gradients, no emoji as decoration (one emoji as the app icon is fine).',
    '',
    KIT,
    '',
    'QUALITY: the app must work on its first load with no console errors: wire every button, give every empty board or list a .wos-empty hint saying what to do first, show errors with .wos-error, keep work across reloads with wos.storage (save right after each change is finished, never on a timer: an app that is closed gets no time to save later), and support the keyboard where people expect it (Delete, Escape, Cmd+Z / Cmd+Shift+Z for undo/redo in editors). For a canvas or board app: pointer events for drag, pan and zoom, selection, undo/redo, and export through wos.files.save (SVG or PNG).',
    '',
    'When you are done with a turn, say in two or three sentences what changed and what to try. Never paste the code into the chat.',
  ].join('\n')
}
