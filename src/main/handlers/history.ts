import { ipcMain, session } from 'electron'
import path from 'path'
import { IPC } from '../ipc-channels'
import { userDataDir } from '../userdata-path'
import { HistoryIndex, type HistoryEntry, type Suggestion } from '../browser/history-index'
import { BROWSER_PARTITION } from '../security'

/**
 * Browsing history + bookmarks over one store.
 *
 * The index lives in userData, not the workspace — a workspace folder is
 * copyable, shareable and deletable, and a record of everything you have read
 * must not ride along with it. Same reasoning as the mail index.
 *
 * Opened lazily so a session that never touches the browser never creates the
 * file. Somebody who does not browse here should not find a database of their
 * reading sitting on disk.
 */
let index: HistoryIndex | null = null

function idx(): HistoryIndex {
  if (!index) index = new HistoryIndex(path.join(userDataDir(), 'browser-history.db'))
  return index
}

export function registerHistoryHandlers(): void {
  /**
   * Empties the browser's HTTP cache — and NOTHING else.
   *
   * `clearCache()` on purpose, never `clearStorageData()`. The browser runs on
   * the persistent `persist:wos-browser` partition, which is also where
   * Connected Accounts keep their sessions: the whole login-once feature, and
   * the sessions the agent inherits when it browses on your behalf, are cookies
   * in this partition. Clearing storage here would silently sign the user out
   * of every connected service to free some disk.
   *
   * Signing out belongs where it is already scoped per account
   * (handlers/accounts.ts clears by origin), not behind a menu item about cache.
   */
  ipcMain.handle(IPC.BROWSER_CLEAR_CACHE, async () => {
    await session.fromPartition(BROWSER_PARTITION).clearCache()
    return { ok: true }
  })

  /**
   * Records a visit. `text` is the readable page text when the caller has it.
   *
   * Deliberately NOT recorded here: anything from a private window. The caller
   * does not invoke this for a non-persistent partition, which is the only
   * place that decision can be made correctly — this module cannot tell which
   * session a url came from, and guessing would be worse than not trying.
   */
  ipcMain.handle(
    IPC.HISTORY_RECORD,
    (_e, arg: { url: string; title?: string; favicon?: string; text?: string }) => {
      if (!arg?.url) return { ok: false }
      idx().recordVisit({
        url: arg.url,
        title: arg.title,
        favicon: arg.favicon,
        text: arg.text,
        visitedAt: Date.now(),
      })
      return { ok: true }
    },
  )

  /** Full-text over page CONTENT — the reason this index exists. */
  ipcMain.handle(IPC.HISTORY_SEARCH, (_e, arg: { query: string; limit?: number }): HistoryEntry[] =>
    idx().search(arg?.query ?? '', arg?.limit ?? 50),
  )

  /** Omnibox suggestions — url/title match, ranked by frecency. */
  ipcMain.handle(IPC.HISTORY_SUGGEST, (_e, arg: { prefix: string; limit?: number }): Suggestion[] =>
    idx().suggest(arg?.prefix ?? '', Date.now(), arg?.limit ?? 8),
  )

  ipcMain.handle(IPC.HISTORY_RECENT, (_e, arg: { limit?: number }): HistoryEntry[] =>
    idx().recent(arg?.limit ?? 100),
  )

  ipcMain.handle(IPC.HISTORY_STAR, (_e, arg: { url: string; title?: string; favicon?: string }) => {
    idx().star(arg.url, Date.now(), arg.title ?? '', arg.favicon ?? '')
    return { ok: true }
  })

  ipcMain.handle(IPC.HISTORY_UNSTAR, (_e, arg: { url: string }) => {
    idx().unstar(arg.url)
    return { ok: true }
  })

  ipcMain.handle(IPC.HISTORY_IS_STARRED, (_e, arg: { url: string }) => idx().isStarred(arg?.url ?? ''))

  ipcMain.handle(IPC.HISTORY_BOOKMARKS, (_e, arg: { limit?: number }): HistoryEntry[] =>
    idx().bookmarks(arg?.limit ?? 500),
  )

  // Deletion is real — the index module removes the FTS rows too, so a
  // forgotten page is not merely hidden from the list while its text stays
  // searchable on disk.
  ipcMain.handle(IPC.HISTORY_FORGET, (_e, arg: { url: string }) => {
    idx().forget(arg.url)
    return { ok: true }
  })

  ipcMain.handle(IPC.HISTORY_FORGET_SINCE, (_e, arg: { since: number }) => ({
    ok: true,
    removed: idx().forgetSince(arg?.since ?? Date.now()),
  }))

  ipcMain.handle(IPC.HISTORY_CLEAR, () => {
    idx().clear()
    return { ok: true }
  })
}

export function shutdownHistory(): void {
  index?.close()
  index = null
}
