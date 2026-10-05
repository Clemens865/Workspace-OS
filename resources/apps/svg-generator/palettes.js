// wos-design-check: names colour
// The palettes of the DRAWINGS (what the app makes for the person), not of its
// interface, which uses the kit's tokens like every app. Roles: bg (the
// drawing's background, '' = transparent), surface (cards, planes), line
// (strokes, main shapes), muted (secondary lines, captions), accent (the one
// highlight). "Workspace" is read from the kit at runtime, so it follows the theme.
window.PALETTES = [
  { id: 'workspace', name: 'Workspace', fromKit: true },
  { id: 'olive', name: 'Night olive', bg: '#383c2b', surface: '#474b38', line: '#ecebe3', muted: '#a5a68f', accent: '#d4f04a' },
  { id: 'coral', name: 'Ink & coral', bg: '#15171c', surface: '#22252c', line: '#f2efe9', muted: '#8b8f99', accent: '#ff6b4a' },
  { id: 'paper', name: 'Paper & blue', bg: '#f6f3ec', surface: '#ffffff', line: '#1d2027', muted: '#8a8578', accent: '#2f6bff' },
  { id: 'midnight', name: 'Midnight', bg: '#0e1a2b', surface: '#16263d', line: '#e4ecf7', muted: '#7f93ad', accent: '#4cc9f0' },
  { id: 'forest', name: 'Forest & gold', bg: '#0f2a22', surface: '#173a30', line: '#eaf2ec', muted: '#8fb3a3', accent: '#f2b84b' },
  { id: 'mono', name: 'Mono, no background', bg: '', surface: '#f1f1ef', line: '#1d2027', muted: '#8a8f98', accent: '#1d2027' },
]
