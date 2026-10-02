import { useSyncExternalStore } from 'react'

/** Small app preferences, persisted to localStorage (workspace-os:* convention). */
export interface Settings {
  /** Default mode for new agent sessions. */
  agentMode: 'full' | 'safe'
  /** Default format for the New-file menu / ⌘N. */
  newFileFormat: 'md' | 'csv' | 'docx' | 'xlsx' | 'pptx'
  /**
   * Fleet: auto-approve REVERSIBLE-tier requests (read-only / checkpointed).
   * Default OFF — safety first, opt-in. Irreversible/outbound requests always
   * require explicit approval regardless. Auto-approvals are logged as resolved
   * cards in the Review feed, never silent.
   */
  autoApproveReversible: boolean
  /**
   * Where the app opens: the Screen Landscape (the team, the Inbox, the
   * Cases) or straight on the flat stage with the surfaces. The landscape is
   * the only shell (docs/landscape/PLAN.md, phase 7); the two shells that came
   * before it are kept in git as `backup/shells-before-landscape`.
   */
  startOn: 'landscape' | 'stage'
  /**
   * Landscape graphics (docs/landscape/PLAN.md §3a). 'auto' = Full on mains
   * power, Light on battery or with reduced motion; 'off' = flat CSS, no WebGL.
   */
  landscapeQuality: 'auto' | 'full' | 'light' | 'off'
  /**
   * Integrated Terminal Dock. Where it sits when open: a bottom strip under
   * the stage, a right-hand column, or a floating window that can be moved and
   * resized anywhere, over the landscape too. Default 'bottom'.
   */
  terminalPlacement: 'bottom' | 'right' | 'float'
  /** The floating terminal's window, in CSS px (null until it first floats). */
  terminalFloat: { x: number; y: number; w: number; h: number } | null
  /** Whether the Terminal Dock is currently open (toggled with ⌘J). Default off. */
  terminalOpen: boolean
  /**
   * Model ALIAS for cheap, high-volume classification (the mail sift).
   * An alias like 'haiku' floats to the current light model — never a dated
   * model id, so it doesn't rot. Empty string = use the CLI's default model
   * (your full-strength one) for everything. If the alias is ever rejected as
   * obsolete, runs silently fall back to the default model.
   */
  lightModel: string
  /**
   * Model ALIAS for agent runs (dock, Home assistant, cases, routines, the
   * interactive session). '' = the CLI's default. Per-agent `wos_model` and a
   * per-run pick in the dock override it. Pushed to the main process so every
   * run path (including routines, which start in main) sees the same default.
   */
  agentModel: string
  codexEffort: string
  /**
   * Minimised: present but collapsed to its title bar (⌥⌘J), as distinct from
   * hidden. The dock stays MOUNTED while minimised, which is the whole point —
   * the shell session and its scrollback survive, so restoring puts you back in
   * the same terminal rather than a new one. Only meaningful when terminalOpen.
   *
   * Modelled as a second flag rather than replacing `terminalOpen` with a
   * three-state field, so an existing user's persisted `terminalOpen: true`
   * keeps working and ⌘J keeps meaning show/hide.
   */
  terminalMinimized: boolean
  /**
   * When a working session becomes a case (the workspace's memory):
   * 'always' on its first ask; 'suggest' (default) once it produced a file or
   * ran a few turns, as a one-click offer; 'manual' only when you keep it.
   */
  sessionCases: 'always' | 'suggest' | 'manual'
}

const KEY = 'workspace-os:settings'
const DEFAULTS: Settings = {
  agentMode: 'full',
  newFileFormat: 'md',
  autoApproveReversible: false,
  startOn: 'landscape',
  landscapeQuality: 'auto',
  terminalPlacement: 'bottom',
  terminalFloat: null,
  terminalOpen: false,
  terminalMinimized: false,
  lightModel: 'haiku',
  agentModel: '',
  codexEffort: '',
  sessionCases: 'suggest',
}

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) } // merge so new keys get defaults
  } catch {
    /* corrupt — use defaults */
  }
  return DEFAULTS
}

// Single shared store so every consumer (Settings panel, FilePanel ⌘N, agent
// sessions) sees the same value and updates live.
let current: Settings = read()
const listeners = new Set<() => void>()

export function loadSettings(): Settings {
  return current
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  current = { ...current, [key]: value }
  try { localStorage.setItem(KEY, JSON.stringify(current)) } catch { /* best-effort */ }
  listeners.forEach((l) => l())
  if (key === 'codexEffort') void window.workspace?.codex?.setEffort?.(String(value ?? ''))
  if (key === 'agentModel') void window.workspace?.agent?.setDefaultModel?.(String(value ?? ''))
}

export interface SettingsStore extends Settings {
  set: typeof setSetting
}

export function useSettings(): SettingsStore {
  const s = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => current,
  )
  return { ...s, set: setSetting }
}

// The main process starts runs of its own (routines) and the interactive
// session; hand it the default model once per app start.
if (typeof window !== 'undefined') queueMicrotask(() => { try { void window.workspace?.agent?.setDefaultModel?.(read().agentModel) } catch { /* no bridge (tests, previews) */ } })
