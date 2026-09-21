/**
 * WORKSPACE SCOPE — which workspace the renderer's per-workspace stores belong to.
 *
 * Agent tabs, their transcripts and the review feed used to be one global
 * blob: open a different folder and the other workspace's tabs and cards stood
 * there. Cases already belong to their root; now these do too. A scope is a
 * short key derived from the root path; a store's storage key is the base key
 * plus the scope. No root (nothing open) is the "everywhere" scope.
 *
 * The one migration: the first time a scoped key is empty and the legacy
 * global blob exists, the blob is adopted by the scope that is open — that is
 * where the person made those tabs — and the legacy key is removed so it
 * cannot be adopted twice.
 */

export type StringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export const EVERYWHERE = 'everywhere'

/** djb2, hex — short, stable, collision-safe enough for a handful of roots. */
export function scopeKey(root: string | null | undefined): string {
  const r = (root ?? '').replace(/\/+$/, '')
  if (!r) return EVERYWHERE
  let h = 5381
  for (let i = 0; i < r.length; i++) h = ((h << 5) + h + r.charCodeAt(i)) | 0
  return `ws-${(h >>> 0).toString(16)}`
}

export function scopedKey(base: string, scope: string): string {
  return scope === EVERYWHERE ? `${base}:everywhere` : `${base}:${scope}`
}

/**
 * Reads the blob for a scope, adopting the legacy global blob once. Returns
 * the raw string (or null) so each store keeps its own parsing.
 */
export function readScoped(storage: StringStorage, base: string, scope: string): string | null {
  const key = scopedKey(base, scope)
  const own = storage.getItem(key)
  if (own !== null) return own
  const legacy = storage.getItem(base)
  if (legacy === null) return null
  // The stores construct before the App knows the root, at "everywhere". That
  // read must not claim the blob — the workspace the person actually has open
  // is the one that made those tabs and runs, and it adopts the blob when its
  // scope first reads. Until then "everywhere" only borrows it.
  if (scope === EVERYWHERE) return legacy
  try {
    storage.setItem(key, legacy)
    storage.removeItem(base)
  } catch {
    /* best-effort — the legacy blob is still readable next time */
  }
  return legacy
}

/** The live scope: a tiny external store the App sets and stores follow. */
type Listener = (scope: string, root: string | null) => void
let current = EVERYWHERE
let currentRoot: string | null = null
const listeners = new Set<Listener>()

export const workspaceScope = {
  get(): string {
    return current
  },
  root(): string | null {
    return currentRoot
  },
  set(root: string | null): void {
    const next = scopeKey(root)
    currentRoot = root && root.trim() ? root : null
    if (next === current) return
    current = next
    for (const l of listeners) l(current, currentRoot)
  },
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}
