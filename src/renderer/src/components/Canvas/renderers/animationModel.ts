/**
 * Impress transitions and animations — the model behind the Transitions and
 * Animations ribbon tabs and the Animation pane. The engine side is two Basic
 * macros (WosTransition, WosAnim) that write one line per slide / effect; this
 * module parses those lines and builds the op strings the macros take.
 */

/** LibreOffice's SMIL transition pair for one slide (TransitionType / Subtype). */
export interface SlideTransition {
  index: number
  type: number
  subtype: number
  /** Transition length in seconds. */
  duration: number
  /** 0 = advance on click, 1 = automatically after `advance` seconds, 2 = semi-automatic. */
  change: number
  /** Seconds the slide stays before an automatic advance. */
  advance: number
}

export interface AnimEffect {
  index: number
  shape: string
  presetId: string
  /** 1 entrance · 2 exit · 3 emphasis (com.sun.star.presentation.EffectPresetClass). */
  presetClass: number
  /** 1 on click · 2 with previous · 3 after previous (EffectNodeType). */
  nodeType: number
  duration: number
  delay: number
}

export interface TransitionPreset { id: string; label: string; type: number; subtype: number }

/** The transitions PowerPoint round-trips (TransitionType / TransitionSubType constants). */
export const TRANSITIONS: TransitionPreset[] = [
  { id: 'none', label: 'None', type: 0, subtype: 0 },
  { id: 'fade', label: 'Fade', type: 37, subtype: 101 },
  { id: 'wipe', label: 'Wipe', type: 1, subtype: 1 },
  { id: 'push', label: 'Push', type: 35, subtype: 99 },
  { id: 'cover', label: 'Cover', type: 36, subtype: 99 },
  { id: 'split', label: 'Split', type: 4, subtype: 13 },
  { id: 'bars', label: 'Random bars', type: 38, subtype: 13 },
  { id: 'checker', label: 'Checkerboard', type: 39, subtype: 108 },
  { id: 'blinds', label: 'Blinds', type: 41, subtype: 13 },
  { id: 'dissolve', label: 'Dissolve', type: 40, subtype: 0 },
  { id: 'wheel', label: 'Wheel', type: 23, subtype: 39 },
  { id: 'wedge', label: 'Wedge', type: 25, subtype: 48 },
  { id: 'circle', label: 'Circle', type: 17, subtype: 27 },
  { id: 'diamond', label: 'Diamond', type: 12, subtype: 26 },
  { id: 'plus', label: 'Plus', type: 3, subtype: 12 },
  { id: 'zoom', label: 'Zoom', type: 12, subtype: 25 },
  { id: 'newsflash', label: 'Newsflash', type: 43, subtype: 114 },
  { id: 'comb', label: 'Comb', type: 35, subtype: 110 },
]

export const TRANSITION_DURATIONS = [0.5, 0.75, 1, 1.5, 2, 3]

export interface AnimationPreset { id: string; label: string; cls: 'entrance' | 'emphasis' | 'exit' }

/** A curated slice of the engine's ~210 presets — the ones PowerPoint names too. */
export const ANIMATION_PRESETS: AnimationPreset[] = [
  { id: 'ooo-entrance-appear', label: 'Appear', cls: 'entrance' },
  { id: 'ooo-entrance-fade-in', label: 'Fade in', cls: 'entrance' },
  { id: 'ooo-entrance-fly-in', label: 'Fly in', cls: 'entrance' },
  { id: 'ooo-entrance-float', label: 'Float', cls: 'entrance' },
  { id: 'ooo-entrance-wipe', label: 'Wipe', cls: 'entrance' },
  { id: 'ooo-entrance-split', label: 'Split', cls: 'entrance' },
  { id: 'ooo-entrance-zoom', label: 'Zoom', cls: 'entrance' },
  { id: 'ooo-entrance-wheel', label: 'Wheel', cls: 'entrance' },
  { id: 'ooo-entrance-random-bars', label: 'Random bars', cls: 'entrance' },
  { id: 'ooo-emphasis-grow-and-shrink', label: 'Grow & shrink', cls: 'emphasis' },
  { id: 'ooo-emphasis-spin', label: 'Spin', cls: 'emphasis' },
  { id: 'ooo-emphasis-teeter', label: 'Teeter', cls: 'emphasis' },
  { id: 'ooo-emphasis-transparency', label: 'Transparency', cls: 'emphasis' },
  { id: 'ooo-emphasis-bold-flash', label: 'Bold flash', cls: 'emphasis' },
  { id: 'ooo-emphasis-fill-color', label: 'Fill colour', cls: 'emphasis' },
  { id: 'ooo-exit-disappear', label: 'Disappear', cls: 'exit' },
  { id: 'ooo-exit-fade-out', label: 'Fade out', cls: 'exit' },
  { id: 'ooo-exit-fly-out', label: 'Fly out', cls: 'exit' },
  { id: 'ooo-exit-wipe', label: 'Wipe', cls: 'exit' },
  { id: 'ooo-exit-split', label: 'Split', cls: 'exit' },
  { id: 'ooo-exit-zoom', label: 'Zoom', cls: 'exit' },
]

export const NODE_TYPES: [number, string][] = [[1, 'On click'], [2, 'With previous'], [3, 'After previous']]

const num = (s: string | undefined): number => { const n = Number(s); return Number.isFinite(n) ? n : 0 }

/** One 'idx|type|subtype|dur|change|advance' line per slide. */
export function parseTransitions(raw: string): SlideTransition[] {
  return raw.split('\n').map((l) => l.trim()).filter((l) => /^\d+\|/.test(l)).map((l) => {
    const p = l.split('|')
    return { index: num(p[0]), type: num(p[1]), subtype: num(p[2]), duration: num(p[3]), change: num(p[4]), advance: num(p[5]) }
  }).filter((t, i) => t.index === i)
}

/** One 'idx|shape|presetId|presetClass|nodeType|dur|delay' line per effect. */
export function parseEffects(raw: string): AnimEffect[] {
  return raw.split('\n').map((l) => l.trim()).filter((l) => /^\d+\|/.test(l)).map((l) => {
    const p = l.split('|')
    return { index: num(p[0]), shape: p[1] ?? '', presetId: p[2] ?? '', presetClass: num(p[3]), nodeType: num(p[4]) || 1, duration: num(p[5]), delay: num(p[6]) }
  }).filter((e) => e.presetId)
}

/** The preset a slide's transition pair corresponds to (undefined = something else). */
export function transitionOf(t: SlideTransition | null | undefined): TransitionPreset | undefined {
  if (!t) return undefined
  if (t.type === 0) return TRANSITIONS[0]
  return TRANSITIONS.find((p) => p.type === t.type && p.subtype === t.subtype)
}

/** The macro's set line for one slide (or every slide when `all`). */
export function transitionSetArgs(index: number, t: { type: number; subtype: number; duration: number; change: number; advance: number }, all = false): string {
  const dur = Math.max(0, Math.min(10, t.duration))
  const adv = Math.max(0, Math.min(3600, Math.round(t.advance * 10) / 10))
  return `set|${index}|${t.type}|${t.subtype}|${dur}|${t.change}|${adv}|${all ? 1 : 0}`
}

/** Seconds each slide waits before advancing on its own (0 = manual), for the slideshow. */
export function advanceSeconds(slides: SlideTransition[]): number[] {
  return slides.map((s) => (s.change === 1 && s.advance > 0 ? s.advance : 0))
}

/** The 'order' op after moving effect `from` to position `to` (node types kept). */
export function orderArgs(effects: AnimEffect[], from: number, to: number): string {
  const idx = effects.map((_, i) => i)
  if (from < 0 || from >= idx.length || to < 0 || to >= idx.length) return `order|${idx.map((i) => `${i}:${effects[i].nodeType}`).join(',')}`
  const [m] = idx.splice(from, 1)
  idx.splice(to, 0, m)
  return `order|${idx.map((i) => `${i}:${effects[i].nodeType}`).join(',')}`
}

/** The 'order' op that changes one effect's trigger, keeping the sequence. */
export function triggerArgs(effects: AnimEffect[], index: number, nodeType: number): string {
  return `order|${effects.map((e, i) => `${i}:${i === index ? nodeType : e.nodeType}`).join(',')}`
}

export function presetLabel(id: string): string {
  const p = ANIMATION_PRESETS.find((x) => x.id === id)
  if (p) return p.label
  return id.replace(/^(ooo|libo)-(entrance|emphasis|exit|physics|motionpath)-/, '').replace(/-/g, ' ')
}

export const CLASS_LABEL: Record<number, string> = { 1: 'Entrance', 2: 'Exit', 3: 'Emphasis', 4: 'Motion path' }
