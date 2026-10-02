import { IpcMain, app } from 'electron'
import path from 'path'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { SearchIndex } from '../search/index-db'
import { Indexer } from '../search/indexer'
import { validateSearchQuery, validateFilePath, IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { forms, inRoot, scopeByPath, scopeGraph, stubsOf } from '../search/scope'

/** The open workspace as path prefixes for the index's SQL (none open: nothing matches). */
function under(): string[] {
  const root = getWorkspaceRoot()
  return root ? forms(root) : ['/nonexistent-workspace-scope']
}

let index: SearchIndex | null = null
let indexer: Indexer | null = null

function ensureIndex(): SearchIndex {
  if (!index) {
    const dbPath = path.join(app.getPath('userData'), 'search-index.db')
    index = new SearchIndex(dbPath)
    indexer = new Indexer(index)
  }
  return index
}

export function registerSearchHandlers(ipcMain: IpcMain): void {
  ipcHandle(ipcMain, IPC.SEARCH_QUERY, (_event, query: unknown) => {
    const q = validateSearchQuery(query)
    // One index serves every workspace ever opened: answer for the open one only.
    return scopeByPath(ensureIndex().query(q, 50, under()), getWorkspaceRoot(), (r) => r.path)
  })

  // Go-to-symbol: substring search over the structural-symbol index (markdown
  // headings + code entities) built alongside the content index.
  ipcHandle(ipcMain, IPC.SEARCH_SYMBOLS, (_event, query: unknown) => {
    const q = validateSearchQuery(query)
    return scopeByPath(ensureIndex().searchSymbols(q, 50, under()), getWorkspaceRoot(), (r) => r.path)
  })

  ipcHandle(ipcMain, IPC.SEARCH_INDEX_STATUS, () => {
    ensureIndex()
    return indexer?.status() ?? { running: false, indexed: 0, queued: 0, done: 0, total: 0 }
  })

  // Starts indexing the active workspace; called after a folder is opened.
  ipcHandle(ipcMain, 'search:start', async () => {
    const root = getWorkspaceRoot()
    if (!root) return
    ensureIndex()
    await indexer?.start(root)
  })

  // Index a file ahead of the queue (called when a file is opened) so its content
  // is searchable almost immediately, even mid-scan of a huge workspace. Scoped
  // to the workspace root.
  ipcHandle(ipcMain, 'search:prioritize', (_event, filePath: unknown) => {
    const root = getWorkspaceRoot()
    if (!root || typeof filePath !== 'string') return
    const resolved = path.resolve(filePath)
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return
    ensureIndex()
    indexer?.prioritize(resolved)
  })

  // ── Knowledge base ([[wikilink]] graph) ────────────────────────────────────
  // Path inputs are validated to stay within the workspace root (same guard the
  // metrics handler uses), so a compromised renderer can't probe arbitrary paths.
  ipcHandle(ipcMain, IPC.LINKS_BACKLINKS, (_event, filePath: unknown) => {
    return scopeByPath(ensureIndex().backlinksFor(requireWorkspacePath(filePath)), getWorkspaceRoot(), (b) => b.path)
  })

  ipcHandle(ipcMain, IPC.LINKS_OUTGOING, (_event, filePath: unknown) => {
    const root = getWorkspaceRoot()
    // A link that resolves into another workspace is, from here, not written yet.
    return ensureIndex()
      .outgoingLinks(requireWorkspacePath(filePath))
      .map((l) => (l.resolvedPath && !inRoot(l.resolvedPath, root) ? { ...l, resolvedPath: null } : l))
  })

  ipcHandle(ipcMain, IPC.LINKS_STUBS, () => {
    return stubsOf(scopeGraph(ensureIndex().graph(2000, 2000, under()), getWorkspaceRoot()))
  })

  // Whole-workspace [[wikilink]] graph (nodes = notes + stubs, edges = resolved
  // links). No input → nothing to validate; node ids are workspace file paths,
  // same exposure surface as the backlinks/outgoing handlers above.
  ipcHandle(ipcMain, IPC.LINKS_GRAPH, () => {
    return scopeGraph(ensureIndex().graph(2000, 2000, under()), getWorkspaceRoot())
  })

  // Related notes for the active file — link-graph proximity (direct links +
  // bibliographic coupling + co-citation). Path-validated like backlinks.
  ipcHandle(ipcMain, IPC.LINKS_RELATED, (_event, filePath: unknown) => {
    return scopeByPath(ensureIndex().relatedNotes(requireWorkspacePath(filePath)), getWorkspaceRoot(), (r) => r.path)
  })

  ipcHandle(ipcMain, IPC.LINKS_RESOLVE, (_event, name: unknown) => {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new IpcValidationError('name must be a non-empty string')
    }
    if (name.length > 500) throw new IpcValidationError('name too long (max 500 chars)')
    const hit = ensureIndex().resolveName(name)
    return hit && inRoot(hit, getWorkspaceRoot()) ? hit : null
  })
}

/** Coerces + scopes an untrusted path to the workspace root (throws otherwise). */
function requireWorkspacePath(filePath: unknown): string {
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('No workspace is open')
  return validateFilePath(filePath, root) // throws on non-string / traversal / escape
}

export async function shutdownSearch(): Promise<void> {
  await indexer?.stop()
  index?.close()
}
