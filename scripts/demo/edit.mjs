/**
 * The edit — the single source of truth for what the film contains.
 *
 * `bars` is how long each clip runs, `from` where inside the clip it starts.
 * The four feature-* clips are deliberately absent: browser-layout-flow tells
 * the same story in one continuous take, and four toggle demos spent a third of
 * the film on window management.
 *
 * `caption` is what appears over the footage. It says what is HAPPENING, since
 * the card immediately before already said what the section is — repeating the
 * card would waste the only line the viewer gets.
 *
 * Both assemble.mjs and check-captions.mjs read this. It lived inside assemble
 * and the check hard-coded its own probe times, which meant the check went on
 * passing while pointing at seconds the edit no longer contained.
 */
export const EDIT = [
  // The generated logo reveal, graded by grade-intro.mjs. It replaces rather
  // than precedes the old 00-intro card: the reveal ends on the wordmark, so a
  // card straight after it saying WORKSPACE OS in text says it twice — and the
  // two together ran 129s against a 126.2s track.
  { card: '00-logo' },
  { clip: 'overview-rail', from: 0.4, bars: 3, caption: 'Every surface, one window' },

  { card: '01-files' },
  { clip: 'files-sort-filter', from: 0.5, bars: 3, caption: 'Sort on real file data — size, kind, date' },
  { clip: 'files-views', from: 1.0, bars: 4, caption: 'List, icons, gallery, columns' },

  { card: '02-day' },
  { clip: 'mail-inbox', from: 0.8, bars: 3, caption: 'A real inbox, read in place' },
  { clip: 'mail-compose', from: 0.6, bars: 2.5, caption: 'Write and send without leaving' },
  // The live metric is the differentiator, so it earns its two bars: the figure
  // it drops in stays attached to the workspace value behind it.
  // from 5.1, not the head: the first seconds are the sandboxed preview iframe
  // still building, which reads on screen as a black box. The window has to land
  // on theme-applied → picker → metric inserted, or the caption promises a
  // number being dropped in over a frame where nothing is.
  { clip: 'mail-rich', from: 5.1, bars: 2, caption: 'Design it — and drop in a number that stays linked' },
  { clip: 'calendar-week', from: 0.4, bars: 1, caption: 'Your week, synced and local' },

  { card: '03-web' },
  { clip: 'browser-page', from: 0.3, bars: 1, caption: 'A full browser — logins, history, tabs' },
  { clip: 'browser-assistant', from: 0.8, bars: 2.5, caption: 'The assistant reads the page you are on' },

  { card: '04-agents' },
  { clip: 'agents-roster', from: 0.4, bars: 1, caption: 'Specialists, with the access they were given' },
  { clip: 'agents-new', from: 1.6, bars: 3, caption: 'Describe the job in plain language' },

  { card: '05-documents' },
  { clip: 'office-editing', from: 0.4, bars: 1.5, caption: 'A real .docx, edited in place' },

  { card: '06-room' },
  { clip: 'browser-layout-flow', from: 1.0, bars: 6, caption: 'Terminal in, panel out, side, full screen' },
  { clip: 'terminal-drag-file', from: 1.4, bars: 2.5, caption: 'Drop a file in — the path is already typed' },

  { card: '07-outro' },
]
