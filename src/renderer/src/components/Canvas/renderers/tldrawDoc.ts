/**
 * Pure, DOM-free persistence core for the tldraw canvas (.wcanvas files).
 *
 * The interactive editor is untestable without a browser, but the
 * serialize → parse round-trip that keeps a canvas file lossless on disk is
 * plain data. It lives here, decoupled from React and from tldraw's editor, so
 * it can be unit-proven.
 *
 * tldraw exposes `editor.getSnapshot()` → a `TLEditorSnapshot` (a plain
 * JSON-serialisable object) and `editor.loadSnapshot(snapshot)`. We store that
 * snapshot verbatim inside a small envelope so the on-disk format is versioned
 * and self-describing.
 */

/** A tldraw editor snapshot — an opaque, JSON-serialisable plain object. */
export type CanvasSnapshot = Record<string, unknown>

/** On-disk envelope. Versioned so the format can evolve without silent breakage. */
export interface CanvasDoc {
  /** Marker so we can recognise (and reject) foreign JSON. */
  kind: 'workspace-os/canvas'
  /** Envelope schema version (not tldraw's internal store version). */
  version: 1
  /** The verbatim tldraw editor snapshot. */
  snapshot: CanvasSnapshot
}

const KIND = 'workspace-os/canvas'
const VERSION = 1 as const

/** An empty document: a valid envelope carrying an empty snapshot. */
export function emptyDoc(): CanvasDoc {
  return { kind: KIND, version: VERSION, snapshot: {} }
}

/**
 * Serialise a tldraw snapshot to the JSON string written to a `.wcanvas` file.
 * Pretty-printed so the files diff cleanly in git.
 */
export function serializeDoc(snapshot: CanvasSnapshot): string {
  const doc: CanvasDoc = { kind: KIND, version: VERSION, snapshot: snapshot ?? {} }
  return JSON.stringify(doc, null, 2)
}

/**
 * Parse a `.wcanvas` file's text into a snapshot ready for
 * `editor.loadSnapshot`. NEVER throws: empty / whitespace-only / malformed /
 * foreign JSON all degrade to an empty snapshot so a broken file opens as a
 * blank canvas rather than crashing the renderer.
 */
export function parseDoc(text: string | null | undefined): CanvasSnapshot {
  if (text == null || text.trim() === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return {}
  }
  if (!isCanvasDoc(parsed)) return {}
  return parsed.snapshot
}

/** True when `value` is a well-formed canvas envelope of a known version. */
function isCanvasDoc(value: unknown): value is CanvasDoc {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (v.kind !== KIND) return false
  if (v.version !== VERSION) return false
  if (typeof v.snapshot !== 'object' || v.snapshot === null) return false
  return true
}

/**
 * Dirty-detection helper: has the live snapshot diverged from the last saved
 * one? Compares the serialised envelopes so the comparison matches exactly what
 * would be written to disk.
 */
export function isDirty(saved: CanvasSnapshot, current: CanvasSnapshot): boolean {
  return serializeDoc(saved) !== serializeDoc(current)
}
