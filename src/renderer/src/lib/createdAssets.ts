/**
 * Things that just appeared in the workspace.
 *
 * The ask: when an agent writes a CV and a cover letter, they should show up in
 * the cockpit with a link, immediately — not only when the agent that made them
 * happens to report them.
 *
 * WHY A WATCHER AND NOT A POST HOOK. A hook (a Claude Code Stop hook, say) only
 * fires for the tool that was configured with it. The workspace has many
 * producers: the in-app agent, a plain `claude` in the terminal dock, a python
 * script, a browser download, a drag-and-drop, an office export. Every one of
 * them ends the same way — a file appears on disk. Watching the filesystem
 * catches all of them without any of them cooperating, and cannot fall out of
 * date when a config file drifts or a new producer is added.
 *
 * The workspace watcher already exists and already streams add/change/unlink to
 * the renderer, so this is a listener and a filter, not new plumbing.
 *
 * The filter is the whole difficulty. A workspace generates far more file
 * activity than a person wants reported, and a "just created" list full of lock
 * files teaches people to ignore it — the same way a suggestion list full of
 * noise does.
 */

export interface CreatedAsset {
  path: string
  /** Epoch ms it appeared. */
  at: number
}

/** How many to keep. The cockpit shows a glance, not a log. */
export const MAX_ASSETS = 8

/**
 * Extensions worth announcing — things a person would open.
 *
 * An allow-list rather than a deny-list, deliberately. New junk appears in
 * workspaces constantly (lock files, caches, editor droppings) and a deny-list
 * would need updating every time one does; the set of things a human opens
 * changes far more slowly.
 */
const ASSET_EXT =
  /\.(docx?|xlsx?|pptx?|pdf|md|markdown|csv|tsv|txt|rtf|odt|ods|odp|png|jpe?g|gif|svg|webp|html?|pages|numbers|key)$/i

/**
 * Files that exist only while something else is being written.
 *
 * Word and LibreOffice leave `~$name.docx` and `.~lock.name#`; browsers write
 * `.crdownload`/`.part`; editors leave `.swp`. Every one of these appears,
 * lives for a moment, and is deleted — announcing them would mean the cockpit
 * mostly lists files that no longer exist.
 */
const TEMPORARY = /(^~\$|^\.~lock\.|\.(crdownload|part|partial|tmp|temp|swp|swo|bak)$|~$)/i

/** The basename of a path, without depending on node's path module. */
export function baseOf(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath
}

/**
 * True when a created file is worth telling the user about.
 *
 * Hidden files and anything inside a dot-directory are excluded: `.workspace-os`
 * is where this app leaves its own working files (agent-context.json,
 * current-page.md), and announcing our own bookkeeping as the user's new asset
 * would be both wrong and constant.
 */
export function isAsset(filePath: string): boolean {
  if (!filePath) return false
  const parts = filePath.split(/[/\\]/)
  if (parts.some((p) => p.startsWith('.') && p.length > 1)) return false
  const name = baseOf(filePath)
  if (TEMPORARY.test(name)) return false
  return ASSET_EXT.test(name)
}

/**
 * Folds a watcher event into the list.
 *
 * Only `add` counts as creation. A `change` is a file that already existed —
 * editing a document you have had for a year does not make it new, and treating
 * it as new would fill the list with whatever you happen to be working on.
 *
 * `unlink` removes it, so a file that appears and is deleted a second later
 * (which is exactly what a save-via-temp-file looks like) does not linger as a
 * link to nothing.
 */
export function applyEvent(
  list: CreatedAsset[],
  event: string,
  filePath: string,
  at: number,
): CreatedAsset[] {
  if (event === 'unlink' || event === 'unlinkDir') {
    return list.some((a) => a.path === filePath) ? list.filter((a) => a.path !== filePath) : list
  }
  if (event !== 'add') return list
  if (!isAsset(filePath)) return list

  // Re-created at the same path: move it to the front rather than listing it
  // twice. Several tools write a file by replacing it.
  const without = list.filter((a) => a.path !== filePath)
  return [{ path: filePath, at }, ...without].slice(0, MAX_ASSETS)
}

/**
 * A short label: the filename, prefixed by its folder when there is one.
 *
 * Derived from the path's tail rather than from the workspace root, so this
 * needs nothing plumbed in. It also solves the case that actually matters —
 * `applications/revolut/cv.docx` and `applications/acme/cv.docx` are both
 * "cv.docx", and a list of identical labels is a list you cannot use.
 */
export function labelFor(filePath: string): string {
  const parts = filePath.split(/[/\\]/).filter(Boolean)
  if (parts.length <= 1) return baseOf(filePath)
  return parts.slice(-2).join('/')
}
