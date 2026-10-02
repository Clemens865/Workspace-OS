import { useState, useEffect, useCallback, useRef } from 'react'
import { Mail, Plus, RefreshCw, Inbox, Send, FileText, Trash2, AlertCircle, ChevronLeft, Circle, PenSquare, Sparkles, Search, Archive, Star, Undo2, ChevronUp, ChevronDown, MailOpen, ChevronRight, FolderPlus, Coffee } from 'lucide-react'
// NewsletterCompose retired: the advanced-email capability now lives inside the
// normal MailCompose (a "Rich" mode toggle), not a standalone broadcast surface.
import { mailReviewStore } from '../Review/mailReviewStore'
import type {
  MailAccount,
  MailFolder,
  MessageSummary,
  FullMessage,
  MailDraft,
  MailComposeContext,
  IndexedMailRow,
  UndoEntry,
  MailFilingPlan,
  NewsletterSweep,
} from '../../types/workspace-api'
import { MailAccountDialog } from './MailAccountDialog'
import { MailReader } from './MailReader'
import { MailCompose } from './MailCompose'
import { buildFolderTree, flattenTree, sortFolders } from './folderTreeClient'
import { SiftView } from './SiftView'
import { mergeVerdicts, parseSiftCache, siftCacheKey, type SiftRow, type Zone } from './siftViewModel'
import { loadSettings } from '../../hooks/useSettings'
import styles from './MailPanel.module.css'

/** Builds a prefilled draft + threading context for reply / reply-all / forward. */
function buildInitial(
  mode: 'new' | 'reply' | 'replyAll' | 'forward',
  src: FullMessage | null,
): { draft: Partial<MailDraft>; context: MailComposeContext } {
  if (!src || mode === 'new') return { draft: {}, context: { kind: 'new' } }
  if (mode === 'forward') {
    return { draft: { subject: src.subject }, context: { kind: 'forward', source: src } }
  }
  // reply / reply-all: primary recipient is the original sender.
  const to = src.from.map((a) => (a.name ? { name: a.name, address: a.address } : { address: a.address }))
  return {
    draft: { to, subject: src.subject },
    context: { kind: 'reply', source: src, replyAll: mode === 'replyAll' },
  }
}

interface MailPanelProps {
  /** True while Mail is the visible sidebar tab — triggers the initial load. */
  active: boolean
}

const PAGE_SIZE = 30

/**
 * Can a message be dropped into this folder?
 *
 * Sent, Drafts and Outbox are OUTBOUND: they hold mail you wrote, and the
 * server treats them as such. Dropping a received message into Sent does not
 * make it sent — it just hides it somewhere nonsensical where no client will
 * look for it, and where its \Seen and reply state now mean the opposite of
 * what they say. Junk IS a valid target (that is how you mark spam), and so is
 * Trash (that is how you delete).
 */
export function isDropTarget(folder: { specialUse?: string; name: string; path: string }): boolean {
  const su = (folder.specialUse || '').toLowerCase()
  if (su === '\\sent' || su === '\\drafts') return false
  return !/^(sent|gesendet|drafts?|entw[uü]rfe|outbox|postausgang)/i.test(folder.name)
}

/** Picks an icon for a folder from its special-use flag or name. */
function folderIcon(f: MailFolder): typeof Inbox {
  const key = (f.specialUse || f.name).toLowerCase()
  if (key.includes('sent')) return Send
  if (key.includes('draft')) return FileText
  if (key.includes('trash') || key.includes('deleted')) return Trash2
  return Inbox
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function senderLabel(m: MessageSummary): string {
  const f = m.from[0]
  return f ? f.name || f.address : '(unknown)'
}

/**
 * A deterministic avatar from the sender's address.
 *
 * Initials plus a hue derived from the address — no Gravatar, no network. A
 * mail client that fetches avatars leaks who you correspond with to a third
 * party on every render, which is the same objection as remote images and this
 * one has no upside worth it.
 */
function avatarFor(from: string, address: string): { initials: string; hue: number } {
  const source = (from || address || '?').trim()
  const words = source.replace(/[<>"]/g, '').split(/[\s._-]+/).filter(Boolean)
  const initials = words.length >= 2
    ? (words[0][0] + words[1][0]).toUpperCase()
    : source.slice(0, 2).toUpperCase()
  let hash = 0
  const key = (address || source).toLowerCase()
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0
  return { initials, hue: hash % 360 }
}

/**
 * One row in the message list, from EITHER source: the live IMAP page or a hit
 * from the local index. Unifying them here keeps the list rendering identical
 * whether you are browsing a folder or searching the whole mailbox — and it
 * carries `folder`, because a search hit can live outside the folder on screen.
 */
interface ListRow {
  uid: number
  folder: string
  /** Sender address — the avatar's colour seed, and shown in dense mode. */
  fromAddress?: string
  /** >1 when this row stands for a conversation rather than a single message. */
  threadCount?: number
  seen: boolean
  from: string
  when: string
  subject: string
  /** Durable identity. Empty when the index has not deepened this row yet —
      actions are disabled in that case rather than recorded un-undoably. */
  messageId: string
}

function rowFromSummary(m: MessageSummary, folder: string): ListRow {
  return {
    uid: m.uid,
    folder,
    seen: m.seen,
    from: senderLabel(m),
    fromAddress: m.from[0]?.address ?? '',
    when: fmtWhen(m.date),
    subject: m.subject || '',
    // The IMAP summary carries no Message-ID; it arrives with the deep fetch.
    messageId: '',
  }
}

function rowFromIndex(r: IndexedMailRow & { threadCount?: number }): ListRow {
  return {
    threadCount: r.threadCount,
    uid: r.uid,
    folder: r.folder,
    seen: r.seen,
    from: r.fromName || r.fromAddress || '(unknown)',
    fromAddress: r.fromAddress,
    // The index stores epoch ms; fmtWhen speaks ISO.
    when: r.date ? fmtWhen(new Date(r.date).toISOString()) : '',
    subject: r.subject || '',
    messageId: '',
  }
}

/**
 * Sidebar Mail view — a native, provider-agnostic IMAP inbox (read-only, Phase 1).
 * Folder list → message list (paged) → sandboxed reader. Accounts are added via
 * a secure dialog; the password never lives here beyond that dialog's lifetime.
 */
export function MailPanel({ active }: MailPanelProps): JSX.Element {
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [accountId, setAccountId] = useState<string | null>(null)
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [messages, setMessages] = useState<MessageSummary[]>([])
  const [selected, setSelected] = useState<FullMessage | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [compose, setCompose] = useState<{ draft: Partial<MailDraft>; context: MailComposeContext } | null>(null)
  const [loading, setLoading] = useState<'folders' | 'messages' | 'message' | 'more' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  // Search results from the LOCAL index; null means "not searching" (show the folder).
  const [searchHits, setSearchHits] = useState<IndexedMailRow[] | null>(null)
  // Honest background-indexing progress, or null when there is nothing to say.
  const [indexNote, setIndexNote] = useState<string | null>(null)
  // The undo stack for this account, newest first.
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [actionNote, setActionNote] = useState<string | null>(null)
  // Unread badges. Absent means "unknown" — we show nothing rather than a zero
  // we are not sure about.
  const [counts, setCounts] = useState<Record<string, { total: number; unseen: number }>>({})
  const [sort, setSort] = useState<string>('date')
  // Rail state, persisted per account so the tree looks the same next launch.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [favourites, setFavourites] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  // A filing PROPOSAL awaiting approval. Nothing has moved while this is set.
  const [plan, setPlan] = useState<MailFilingPlan | null>(null)
  const [planBusy, setPlanBusy] = useState(false)
  // New mail seen since you last looked. A banner rather than an auto-refresh:
  // silently reordering the list under someone mid-read is hostile.
  const [newMail, setNewMail] = useState(0)
  // Presentation preferences, remembered globally rather than per account —
  // density is about the person, not the mailbox.
  const [dense, setDense] = useState(() => localStorage.getItem('wos.mail.dense') === '1')
  const [railWidth, setRailWidth] = useState(() => Number(localStorage.getItem('wos.mail.railWidth')) || 150)

  useEffect(() => {
    if (!accountId) return
    try {
      const raw = localStorage.getItem(`wos.mail.rail.${accountId}`)
      if (!raw) { setCollapsed(new Set()); setFavourites(new Set()); return }
      const v = JSON.parse(raw) as { collapsed?: string[]; favourites?: string[] }
      setCollapsed(new Set(v.collapsed ?? []))
      setFavourites(new Set(v.favourites ?? []))
    } catch { /* corrupt state is not worth a crash — start fresh */ }
  }, [accountId])

  const persistRail = useCallback((c: Set<string>, f: Set<string>) => {
    if (!accountId) return
    try {
      localStorage.setItem(`wos.mail.rail.${accountId}`, JSON.stringify({
        collapsed: [...c], favourites: [...f],
      }))
    } catch { /* quota or private mode — the rail simply resets next time */ }
  }, [accountId])
  // A send inside its undo window. Cleared when it expires, is cancelled, or is
  // pushed through with "Send now".
  const [held, setHeld] = useState<{ id: string; until: number } | null>(null)
  // Multi-select. Keyed `folder:uid` so a selection spanning a search result
  // set (which can cross folders) stays unambiguous.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Rows the local index already knows. Painted immediately on folder open, then
  // replaced by the live IMAP read. null = nothing cached yet.
  const [cachedRows, setCachedRows] = useState<(IndexedMailRow & { threadCount: number })[] | null>(null)
  const [busy, setBusy] = useState(false)
  const loadedRef = useRef(false)
  const filterRef = useRef<HTMLInputElement>(null)

  const loadAccounts = useCallback(async () => {
    const list = await window.workspace.mail.accounts.list()
    setAccounts(list)
    setAccountId((prev) => prev ?? (list[0]?.id ?? null))
  }, [])

  useEffect(() => {
    if (active && !loadedRef.current) {
      loadedRef.current = true
      void loadAccounts()
    }
  }, [active, loadAccounts])

  // Load folders when the active account changes.
  const loadFolders = useCallback(async (id: string) => {
    setLoading('folders')
    setError(null)
    setSelected(null)
    setMessages([])
    const res = await window.workspace.mail.folders(id)
    setLoading(null)
    if (!res.ok) {
      setError(res.error.message)
      setFolders([])
      return
    }
    const selectable = res.value.filter((f) => f.selectable)
    setFolders(selectable)
    // Default to INBOX (or the first selectable folder).
    const inbox = selectable.find((f) => f.path.toUpperCase() === 'INBOX' || f.specialUse === '\\Inbox')
    setFolder(inbox?.path ?? selectable[0]?.path ?? null)
  }, [])

  useEffect(() => {
    if (accountId) void loadFolders(accountId)
  }, [accountId, loadFolders])

  const loadMessages = useCallback(async (id: string, f: string, opts?: { offset?: number; append?: boolean }) => {
    setLoading(opts?.append ? 'more' : 'messages')
    setError(null)
    const res = await window.workspace.mail.messages(id, f, { limit: PAGE_SIZE, offset: opts?.offset })
    setLoading(null)
    if (!res.ok) {
      setError(res.error.message)
      if (!opts?.append) setMessages([])
      return
    }
    setMessages((prev) => (opts?.append ? [...prev, ...res.value] : res.value))
  }, [])

  useEffect(() => {
    if (!accountId || !folder) return
    setSelected(null)
    setPicked(new Set())

    // Paint from the index FIRST. It answers in microseconds because it touches
    // no network, so the list appears immediately instead of after an IMAP
    // round-trip — the difference between "the app is loading" and "the app is
    // open". The live read below then replaces it.
    let live = true
    setCachedRows(null)
    void window.workspace.mail.cached(accountId, folder, PAGE_SIZE).then((res) => {
      if (live && res.ok && res.value.length > 0) setCachedRows(res.value)
    })

    void loadMessages(accountId, folder)
    return () => { live = false }
  }, [accountId, folder, loadMessages])

  // Refresh the local index in the background whenever a folder is opened. The
  // list above already painted from IMAP, so this is never in the user's way;
  // it is what makes search work and what deepens bodies for the next visit.
  useEffect(() => {
    if (!accountId || !folder) return
    let live = true
    void window.workspace.mail.sync(accountId, folder).then((res) => {
      if (!live || !res.ok) return
      setIndexNote(res.value.remaining > 0 ? `Indexing… ${res.value.remaining} left` : null)
    })
    return () => {
      live = false
    }
  }, [accountId, folder])

  /**
   * Real full-text search over the local index, replacing the old filter box —
   * which only filtered the page already loaded and so silently missed anything
   * further back than the last 50 messages.
   *
   * Debounced, and every response is checked against the query that is current
   * when it lands, so a slow reply for "bud" cannot overwrite the results for
   * "budget".
   */
  useEffect(() => {
    const q = filter.trim()
    if (!q) {
      setSearchHits(null)
      return
    }
    let live = true
    const t = setTimeout(() => {
      void window.workspace.mail
        .search(q, { accountId: accountId ?? undefined, folder: folder ?? undefined, limit: 100, sort })
        .then((res) => {
          if (!live) return
          setSearchHits(res.ok ? res.value : [])
        })
    }, 180)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [filter, accountId, folder, sort])

  const openMessage = useCallback(async (uid: number, inFolder?: string) => {
    // A search hit can live in a different folder than the one on screen, so the
    // row passes its own — falling back to the selected folder for normal browsing.
    const f = inFolder || folder
    if (!accountId || !f) return
    setLoading('message')
    setError(null)
    const res = await window.workspace.mail.message(accountId, f, uid)
    setLoading(null)
    if (!res.ok) {
      setError(res.error.message)
      return
    }
    setSelected(res.value)
    // Optimistically mark the row seen in the list…
    setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)))

    // …and tell the SERVER, which we previously never did. The unread state was
    // therefore a lie that survived only until the next reload: everything you
    // had read came back bold, and the count never went down. Journalled like
    // any other mutation, so it is undoable and shows in the history.
    if (!res.value.seen && res.value.messageId) {
      void window.workspace.mail.setRead(accountId, f, uid, res.value.messageId, true, res.value.subject)
    }
  }, [accountId, folder])

  // Resolve the real Trash/Archive paths from the server's special-use flags
  // rather than guessing names — they are localised ("Deleted", "Archiv").
  const special = (flag: string, ...names: string[]): string => {
    const byFlag = folders.find((f) => (f.specialUse || '').toLowerCase() === flag)
    if (byFlag) return byFlag.path
    const byName = folders.find((f) => names.some((n) => f.name.toLowerCase().startsWith(n)))
    return byName?.path ?? names[0]
  }
  const trashFolder = special('\\trash', 'trash', 'deleted', 'gelöscht')
  const archiveFolder = special('\\archive', 'archive', 'archiv')

  // Search results when searching, otherwise the live folder page.
  // Precedence: an explicit search wins; then the live IMAP page once it lands;
  // then the cached view. The cache is only ever a stand-in for a page that has
  // not arrived — it never overrides fresher truth from the server.
  const rows: ListRow[] =
    searchHits ? searchHits.map(rowFromIndex)
    : messages.length > 0 ? messages.map((m) => rowFromSummary(m, folder ?? ''))
    : cachedRows ? cachedRows.map(rowFromIndex)
    : []

  const refreshCounts = useCallback(async (id: string, paths: string[]) => {
    if (paths.length === 0) return
    const res = await window.workspace.mail.folderCounts(id, paths)
    if (res.ok) setCounts(res.value)
  }, [])

  useEffect(() => {
    if (accountId && folders.length > 0) void refreshCounts(accountId, folders.map((f) => f.path))
  }, [accountId, folders, refreshCounts])


  /**
   * Watch the open folder for new mail, and refresh when it arrives.
   *
   * Torn down on every change of account or folder — and on unmount — because a
   * watcher that outlives its reason keeps polling with credentials the user
   * may believe they revoked.
   */
  useEffect(() => {
    if (!accountId || !folder) return
    void window.workspace.mail.watchStart(accountId, folder)
    const off = window.workspace.mail.onNewMail((e) => {
      if (e.accountId !== accountId) return
      setNewMail(e.count)
      void refreshCounts(accountId, folders.map((f) => f.path))
    })
    return () => {
      off()
      void window.workspace.mail.watchStop(accountId)
    }
  }, [accountId, folder, folders, refreshCounts])

  const refreshUndo = useCallback(async (id: string) => {
    const res = await window.workspace.mail.undoable(id)
    setUndoStack(res.ok ? res.value : [])
  }, [])

  useEffect(() => {
    if (accountId) void refreshUndo(accountId)
  }, [accountId, refreshUndo])

  /**
   * Runs a mutating action, then removes the row optimistically.
   *
   * `messageId` is required by the main process — without it the action could
   * not be undone, so it refuses rather than making an irreversible change. A
   * row only has one once the indexer has deep-fetched it, so the message is
   * fetched on demand here rather than disabling the button and leaving the
   * user to wonder why.
   */
  const runAction = useCallback(
    async (row: ListRow, kind: 'archive' | 'trash' | 'flag' | 'moveTo', destination?: string) => {
      if (!accountId) return
      setActionNote(null)

      let messageId = row.messageId
      if (!messageId) {
        const full = await window.workspace.mail.message(accountId, row.folder, row.uid)
        if (!full.ok) {
          setActionNote(full.error.message)
          return
        }
        messageId = full.value.messageId ?? ''
      }
      if (!messageId) {
        setActionNote('This message has no Message-ID, so the change could not be undone. Not doing it.')
        return
      }

      const target =
        kind === 'moveTo' ? (destination ?? '')
        : kind === 'trash' ? trashFolder
        : archiveFolder
      const res =
        kind === 'flag'
          ? await window.workspace.mail.setFlagged(accountId, row.folder, row.uid, messageId, true, row.subject)
          : await window.workspace.mail.move(accountId, row.folder, row.uid, messageId, target, row.subject)

      if (!res.ok) {
        setActionNote(res.error.message)
        return
      }
      if (kind !== 'flag') {
        setMessages((prev) => prev.filter((m) => m.uid !== row.uid))
        if (selected?.uid === row.uid) setSelected(null)
      }
      void refreshUndo(accountId)
    },
    [accountId, selected, refreshUndo],
  )

  // Drop the undo offer the moment the hold expires. Showing "Undo" for a
  // message already delivered would be a lie the user discovers from the reply.
  useEffect(() => {
    if (!held) return
    const ms = Math.max(0, held.until - Date.now())
    const t = setTimeout(() => setHeld(null), ms)
    return () => clearTimeout(t)
  }, [held])

  /**
   * Move to the neighbouring message in the CURRENT row order.
   *
   * Current order matters: while a search is active the neighbour is the next
   * search hit, not the next message in the folder. Navigating by folder order
   * inside a search result set jumps somewhere the user cannot see.
   */
  const step = useCallback(
    (delta: 1 | -1) => {
      const list = rowsRef.current
      if (list.length === 0) return
      const idx = list.findIndex((r) => r.uid === selected?.uid)
      const next = list[idx < 0 ? 0 : Math.min(list.length - 1, Math.max(0, idx + delta))]
      if (next && next.uid !== selected?.uid) void openMessage(next.uid, next.folder)
    },
    [selected, openMessage],
  )

  /** Marks the open message unread again and closes it — the "deal with it later" gesture. */
  const markUnread = useCallback(async () => {
    if (!accountId || !selected || !folder || !selected.messageId) return
    const res = await window.workspace.mail.setRead(
      accountId, folder, selected.uid, selected.messageId, false, selected.subject,
    )
    if (!res.ok) { setActionNote(res.error.message); return }
    setMessages((prev) => prev.map((m) => (m.uid === selected.uid ? { ...m, seen: false } : m)))
    setSelected(null)
    void refreshUndo(accountId)
  }, [accountId, selected, folder, refreshUndo])

  /** Applies a row action to the OPEN message, then advances to the next one. */
  const paneAction = useCallback(
    async (kind: 'archive' | 'trash' | 'flag') => {
      if (!selected || !folder) return
      const row = rowsRef.current.find((r) => r.uid === selected.uid)
      await runAction(row ?? {
        uid: selected.uid, folder, seen: true, from: '', when: '',
        subject: selected.subject, messageId: selected.messageId ?? '',
      }, kind)
      if (kind !== 'flag') step(1)
    },
    [selected, folder, runAction, step],
  )

  const rowsRef = useRef<ListRow[]>([])
  const actionErrorRef = useRef<string | null>(null)
  const rowKey = (r: ListRow): string => `${r.folder}:${r.uid}`

  const togglePick = useCallback((r: ListRow) => {
    setPicked((prev) => {
      const next = new Set(prev)
      const k = `${r.folder}:${r.uid}`
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })
  }, [])

  /**
   * Applies one action to every selected row, sequentially.
   *
   * Sequential rather than parallel on purpose: each action is an IMAP
   * operation, and firing thirty at once is the connection storm that
   * throttled Outlook and broke message opening earlier. Slower and correct
   * beats fast and rate-limited.
   *
   * Failures are counted, not thrown — one message that has moved elsewhere
   * must not abandon the other twenty-nine.
   */
  const runBulk = useCallback(
    async (kind: 'archive' | 'trash' | 'flag') => {
      if (!accountId || picked.size === 0) return
      setBusy(true)
      setActionNote(null)
      const targets = rowsRef.current.filter((r) => picked.has(`${r.folder}:${r.uid}`))
      let failed = 0
      for (const r of targets) {
        const before = actionErrorRef.current
        await runAction(r, kind)
        if (actionErrorRef.current !== before) failed++
      }
      setPicked(new Set())
      setBusy(false)
      if (failed > 0) setActionNote(`${targets.length - failed} of ${targets.length} done — ${failed} could not be changed.`)
    },
    [accountId, picked, runAction],
  )

  const undoLast = useCallback(async () => {
    if (!accountId || undoStack.length === 0) return
    const res = await window.workspace.mail.undo(accountId, undoStack[0].id)
    setActionNote(res.ok ? null : res.error.message)
    void refreshUndo(accountId)
    if (folder) void loadMessages(accountId, folder)
  }, [accountId, undoStack, folder, refreshUndo])

  useEffect(() => { rowsRef.current = rows }, [rows])
  useEffect(() => { actionErrorRef.current = actionNote }, [actionNote])

  /**
   * Keyboard shortcuts, the set every mail client shares: j/k to move, Enter to
   * open, e to archive, Backspace to delete, s to flag, / to search, Escape to
   * close. Bound on the panel rather than the window so typing in the search
   * box or the composer is never hijacked.
   */
  const onPanelKey = useCallback(
    (e: React.KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur()
        return
      }
      const list = rowsRef.current
      const idx = list.findIndex((r) => r.uid === selected?.uid)

      if (e.key === 'j' || e.key === 'ArrowDown') {
        const next = list[Math.min(list.length - 1, idx + 1)]
        if (next) { e.preventDefault(); void openMessage(next.uid, next.folder) }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        const prev = list[Math.max(0, idx - 1)]
        if (prev) { e.preventDefault(); void openMessage(prev.uid, prev.folder) }
      } else if (e.key === 'n' || e.key === ']') {
        e.preventDefault(); step(1)
      } else if (e.key === 'p' || e.key === '[') {
        e.preventDefault(); step(-1)
      } else if (e.key === 'u' && selected) {
        e.preventDefault(); void markUnread()
      } else if (e.key === '/') {
        e.preventDefault(); filterRef.current?.focus()
      } else if (e.key === 'Escape') {
        setSelected(null); setPicked(new Set())
      } else if (idx >= 0 && (e.key === 'e' || e.key === 'Backspace' || e.key === 's')) {
        e.preventDefault()
        const row = list[idx]
        void runAction(row, e.key === 'e' ? 'archive' : e.key === 'Backspace' ? 'trash' : 'flag')
      }
    },
    [selected, openMessage, runAction, step, markUnread],
  )

  const loadMore = useCallback(() => {
    if (!accountId || !folder || messages.length === 0) return
    // Page by COUNT, not by uid: sequence numbers are contiguous, so the next
    // page costs one page-sized fetch instead of a scan back through the folder.
    void loadMessages(accountId, folder, { offset: messages.length, append: true })
  }, [accountId, folder, messages, loadMessages])

  const removeAccount = useCallback(async (id: string) => {
    await window.workspace.mail.accounts.remove(id)
    setAccountId(null)
    setFolders([])
    setFolder(null)
    setMessages([])
    setSelected(null)
    await loadAccounts()
  }, [loadAccounts])

  const openReply = useCallback((mode: 'reply' | 'replyAll' | 'forward') => {
    if (!selected) return
    setCompose(buildInitial(mode, selected))
  }, [selected])

  // Surface-action harness (Terminal dock) → renderer CustomEvents. Each only
  // OPENS a draft or reloads the mailbox; none ever sends (send stays in the
  // composer's own send button). Same event pattern as wos:reveal-path — no IPC.
  useEffect(() => {
    if (!active) return
    const compose = (): void => setCompose(buildInitial('new', null))
    const reply = (): void => { if (selected) setCompose(buildInitial('reply', selected)) }
    const refresh = (): void => {
      if (accountId && folder) void loadMessages(accountId, folder)
      else if (accountId) void loadFolders(accountId)
      else void loadAccounts()
    }
    const search = (): void => filterRef.current?.focus()
    window.addEventListener('wos:mail-compose', compose)
    window.addEventListener('wos:mail-reply', reply)
    window.addEventListener('wos:mail-refresh', refresh)
    window.addEventListener('wos:mail-search', search)
    return () => {
      window.removeEventListener('wos:mail-compose', compose)
      window.removeEventListener('wos:mail-reply', reply)
      window.removeEventListener('wos:mail-refresh', refresh)
      window.removeEventListener('wos:mail-search', search)
    }
  }, [active, selected, accountId, folder, loadMessages, loadFolders, loadAccounts])

  // Scan the current folder for messages needing a reply and land them in the
  // Agent Review / Living Feed as draft-gated ACTION cards (the fusion). The
  // triage + drafting run there; here we only kick it off and report count.
  const [triaging, setTriaging] = useState(false)
  const [triageNote, setTriageNote] = useState<string | null>(null)
  /** A batch of newsletters the app is OFFERING to file. Nothing has moved. */
  const [sweep, setSweep] = useState<NewsletterSweep | null>(null)
  const [sweepBusy, setSweepBusy] = useState(false)
  // Senders the person unchecked — their messages stay put when filing.
  const [sweepExcluded, setSweepExcluded] = useState<Set<string>>(new Set())
  /**
   * The Morning Sift as a VIEW of the message column, not a one-shot spell.
   * The List ↔ Sift choice persists; verdicts are cached per account+folder,
   * so flipping to Sift is instant, and each refresh is INCREMENTAL — only
   * uids without a verdict go to the model (nothing new = no model call at
   * all), and the fresh unread list prunes mails read elsewhere.
   */
  const [mailView, setMailView] = useState<'list' | 'sift'>(() =>
    localStorage.getItem('wos.mail.view') === 'sift' ? 'sift' : 'list',
  )
  const [sift, setSift] = useState<{ rows: SiftRow[]; briefing: string | null; degraded: boolean } | null>(null)
  const [siftBusy, setSiftBusy] = useState(false)
  const siftBusyRef = useRef(false)
  const switchView = useCallback((v: 'list' | 'sift') => {
    setMailView(v)
    try { localStorage.setItem('wos.mail.view', v) } catch { /* best-effort */ }
  }, [])
  const refreshSift = useCallback(async () => {
    if (!accountId || !folder || siftBusyRef.current) return
    siftBusyRef.current = true
    setSiftBusy(true)
    try {
      const cached = parseSiftCache(localStorage.getItem(siftCacheKey(accountId, folder)))
      // Open-case titles ground the 'case' zone; the parser only accepts these.
      const cases = await window.workspace.cases.list().catch(() => [])
      const res = await window.workspace.mail.sift(accountId, folder, {
        model: loadSettings().lightModel.trim() || undefined,
        caseTitles: cases.map((c) => c.title).slice(0, 30),
        excludeUids: cached.rows.map((r) => r.uid),
      })
      const rows = mergeVerdicts(cached.rows, res.verdicts, res.unreadUids)
      // A quiet refresh (nothing new) keeps the last briefing — the assistant
      // doesn't re-narrate a morning it has already narrated.
      const briefing = res.briefing ?? cached.briefing
      try { localStorage.setItem(siftCacheKey(accountId, folder), JSON.stringify({ rows, briefing })) } catch { /* best-effort */ }
      setSift({ rows, briefing, degraded: res.degraded })
    } catch (e) {
      setTriageNote(e instanceof Error ? e.message : 'The sift failed.')
    } finally {
      siftBusyRef.current = false
      setSiftBusy(false)
    }
  }, [accountId, folder])

  // Entering the sift view (or landing in a folder while it's the chosen
  // view) shows the cache immediately and refreshes what's new behind it.
  useEffect(() => {
    if (!accountId || !folder) return
    const cached = parseSiftCache(localStorage.getItem(siftCacheKey(accountId, folder)))
    setSift(cached.rows.length ? { rows: cached.rows, briefing: cached.briefing, degraded: false } : null)
    if (mailView === 'sift') void refreshSift()
  }, [accountId, folder, mailView, refreshSift])

  /*
   * The sift is a STREAM, not a morning ritual: while it's the chosen view,
   * new mail refreshes it by itself (debounced — a burst of arrivals becomes
   * one incremental pass). The list view keeps its banner instead: silently
   * reordering a list under someone mid-read is hostile, but the sift only
   * ever gains rows at the bottom of its zones.
   */
  useEffect(() => {
    if (mailView !== 'sift' || newMail === 0) return
    const t = setTimeout(() => {
      setNewMail(0)
      void refreshSift()
    }, 1500)
    return () => clearTimeout(t)
  }, [newMail, mailView, refreshSift])

  /** Uids acted on this session — struck through until a refresh retires them. */
  const [siftHandled, setSiftHandled] = useState<Set<number>>(new Set())
  useEffect(() => { setSiftHandled(new Set()) }, [accountId, folder])

  const updateSiftCache = useCallback((mut: (rows: SiftRow[]) => SiftRow[]) => {
    if (!accountId || !folder) return
    setSift((prev) => {
      if (!prev) return prev
      const rows = mut(prev.rows)
      try { localStorage.setItem(siftCacheKey(accountId, folder), JSON.stringify({ rows, briefing: prev.briefing })) } catch { /* best-effort */ }
      return { ...prev, rows }
    })
  }, [accountId, folder])

  /** Done = mark read; the strike shows now, the next refresh retires the row. */
  const siftDone = useCallback(async (row: SiftRow) => {
    if (!accountId) return
    setSiftHandled((p) => new Set(p).add(row.uid))
    if (!row.messageId) return // fast-tier row: struck locally, retired on read elsewhere
    const res = await window.workspace.mail.setRead(accountId, row.folder, row.uid, row.messageId, true, row.subject)
    if (!res.ok) setActionNote(res.error.message)
    else void refreshUndo(accountId)
  }, [accountId, refreshUndo])

  const siftDraft = useCallback(async (row: SiftRow) => {
    if (!accountId) return
    setActionNote('Drafting a reply…')
    const full = await window.workspace.mail.message(accountId, row.folder, row.uid)
    if (!full.ok) { setActionNote(full.error.message); return }
    const res = await window.workspace.mail.draftReply(accountId, { folder: row.folder, uid: row.uid })
    if (!res.ok) { setActionNote(res.error.message); return }
    setActionNote(null)
    // Compose opens PREFILLED — the person reads and sends; nothing sends itself.
    const init = buildInitial('reply', full.value)
    setCompose({ draft: { ...init.draft, text: res.value.suggestedBody }, context: init.context })
  }, [accountId])

  const siftAddToCase = useCallback(async (row: SiftRow) => {
    if (!row.caseTitle) return
    const cases = await window.workspace.cases.list().catch(() => [])
    const target = cases.find((c) => c.title === row.caseTitle)
    if (!target) { setActionNote('Could not find that case any more.'); return }
    try {
      await window.workspace.cases.addNote(
        target.id,
        `Mail from ${row.fromName || row.fromAddress} — “${row.subject}”: ${row.summary}`,
        'you',
      )
      setActionNote(`Noted in “${target.title}”.`)
      setSiftHandled((p) => new Set(p).add(row.uid))
    } catch (e) {
      setActionNote(e instanceof Error ? e.message : 'Could not write the case note.')
    }
  }, [])

  const siftAddToCalendar = useCallback(async (row: SiftRow) => {
    if (!row.due) return
    const [date, time] = row.due.split('T')
    const start = new Date(`${date}T${time ?? '09:00'}:00`).getTime()
    try {
      await window.workspace.calendar.createEvent({
        summary: row.todo || row.summary,
        start,
        ...(time ? { end: start + 60 * 60 * 1000 } : { allDay: true }),
        description: `From ${row.fromName || row.fromAddress}: ${row.subject}`,
      })
      setActionNote(`Added to calendar — ${date}${time ? ` ${time}` : ''}.`)
    } catch (e) {
      setActionNote(e instanceof Error ? e.message : 'Could not create the event.')
    }
  }, [])

  const siftMarkZoneRead = useCallback(async (rowsToClear: SiftRow[]) => {
    if (!accountId) return
    setSiftHandled((p) => { const n = new Set(p); for (const r of rowsToClear) n.add(r.uid); return n })
    for (const r of rowsToClear.slice(0, 30)) {
      if (!r.messageId) continue
      const res = await window.workspace.mail.setRead(accountId, r.folder, r.uid, r.messageId, true, r.subject)
      if (!res.ok) { setActionNote(res.error.message); break }
    }
    void refreshUndo(accountId)
  }, [accountId, refreshUndo])

  /** A correction applies NOW; "always" also writes a rule — the harness learns. */
  const siftReassign = useCallback(async (row: SiftRow, zone: Zone, always: boolean) => {
    updateSiftCache((rows) => rows.map((r) => (r.uid === row.uid ? { ...r, zone, caseTitle: null } : r)))
    if (!always) return
    const category = zone === 'noise' ? 'newsletter' : zone === 'glance' ? 'notification' : 'personal'
    try {
      await window.workspace.mail.rules.add({ from: row.fromAddress || row.fromName, category })
      setActionNote(`Rule saved — mail from ${row.fromAddress || row.fromName} is always ${category}.`)
    } catch (e) {
      setActionNote(e instanceof Error ? e.message : 'Could not save the rule.')
    }
  }, [updateSiftCache])

  /** Propose filing the newsletters. Shared by the toolbar and the sift's noise zone. */
  const proposeSweep = useCallback(async () => {
    if (!accountId || !folder) return
    setSweepBusy(true)
    const res = await window.workspace.mail.newsletters.propose(accountId, folder, 30)
    setSweepBusy(false)
    if (!res.ok) return
    // Progress, not a failure — the red error bar would say the app had done
    // something wrong when it is simply still reading.
    if (res.value.messages.length === 0) { setTriageNote(res.value.summary); return }
    setTriageNote(null)
    setSweep(res.value)
  }, [accountId, folder])

  const runTriage = useCallback(async () => {
    if (!accountId || !folder) return
    setTriaging(true)
    setTriageNote(null)
    const res = await window.workspace.mail.triage(accountId, folder)
    setTriaging(false)
    if (!res.ok) {
      setTriageNote(res.error.message)
      return
    }
    mailReviewStore.ingestTriage(accountId, folder, res.value)
    setTriageNote(
      res.value.length === 0
        ? 'Nothing needs a reply right now.'
        : `${res.value.length} message${res.value.length === 1 ? '' : 's'} sent to the Living Feed.`,
    )
  }, [accountId, folder])

  const activeAccount = accounts.find((a) => a.id === accountId) ?? null

  // One-click: add the built-in demo mailbox (no credentials, no network) and
  // select it, so the whole client can be exercised on seeded data.
  const addDemo = useCallback(async () => {
    const account = await window.workspace.mail.accounts.addDemo()
    setDialogOpen(false)
    setAccounts((p) => (p.some((a) => a.id === account.id) ? p : [account, ...p]))
    setAccountId(account.id)
  }, [])

  // ── Empty state: no accounts yet ──────────────────────────────────────────
  if (accounts.length === 0) {
    return (
      <div className={styles.root}>
        <PanelHeader onAdd={() => setDialogOpen(true)} onRefresh={() => void loadAccounts()} loading={loading !== null} />
        <div className={styles.empty}>
          <Mail size={28} strokeWidth={1.25} className={styles.emptyIcon} />
          <p className={styles.emptyTitle}>No mail account</p>
          <p className={styles.emptyHint}>Connect an IMAP account to read your inbox in-app.</p>
          <button className={styles.addBtn} onClick={() => setDialogOpen(true)}><Plus size={14} /> Add account</button>
          <button className={styles.demoBtn} onClick={() => void addDemo()} title="Explore the whole mail client on a seeded, offline mailbox — no credentials needed">
            <Sparkles size={14} /> Try a demo mailbox
          </button>
        </div>
        {dialogOpen && (
          <MailAccountDialog
            onClose={() => setDialogOpen(false)}
            onSaved={(a) => { setDialogOpen(false); setAccounts((p) => [a, ...p]); setAccountId(a.id) }}
            onTryDemo={() => void addDemo()}
          />
        )}
      </div>
    )
  }

  return (
    <div className={styles.root}>
      <PanelHeader onAdd={() => setDialogOpen(true)} onRefresh={() => accountId && void loadFolders(accountId)} loading={loading !== null} />

      {accounts.length > 0 && (
        <div className={styles.accountBar}>
          <select className={styles.accountSelect} value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}
          </select>
          {accountId && (
            <button className={styles.removeAccount} title="Remove account" onClick={() => void removeAccount(accountId)}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}

      {error && <div className={styles.errorBar}><AlertCircle size={13} /> {error}</div>}

      {/* One toolbar row rather than two stacked full-width buttons, which ate
          the top of the surface and pushed the message list below the fold. */}
      {activeAccount?.smtp && (
        <div className={styles.toolbar}>
          <button className={styles.composeBtn} onClick={() => setCompose(buildInitial('new', null))} title="Compose — switch to Rich for design, live data and writing assist">
            <PenSquare size={13} /> New message
          </button>
          {folder && (
            <button
              className={`${styles.toolBtn} ${mailView === 'sift' ? styles.toolBtnOn : ''}`}
              onClick={() => switchView(mailView === 'sift' ? 'list' : 'sift')}
              title="Switch the message list between the plain list and the sift — unread mail sorted by need, one summary line each. The sift stays; only new mail is read again."
            >
              <Coffee size={13} /> {mailView === 'sift' ? 'List' : 'Sift'}
            </button>
          )}
          {folder && (
            <button className={styles.toolBtn} onClick={() => void runTriage()} disabled={triaging} title="Find messages needing a reply and draft replies in the Living Feed">
              <Sparkles size={13} /> {triaging ? 'Scanning…' : 'Triage'}
            </button>
          )}
          {folder && (
            <button
              className={styles.toolBtn}
              disabled={sweepBusy}
              title="Find the newsletters and offer to file them — nothing moves until you say so"
              onClick={() => void proposeSweep()}
            >
              <Archive size={13} /> {sweepBusy ? 'Looking…' : 'Newsletters'}
            </button>
          )}
          {folder && (
            <select
              className={styles.sortSelect}
              value=""
              onChange={async (e) => {
                const days = Number(e.target.value) as 7 | 30 | 90
                e.target.value = ''
                if (!accountId || !folder || !days) return
                setPlanBusy(true)
                const res = await window.workspace.mail.proposeFiling(accountId, folder, days)
                setPlanBusy(false)
                if (!res.ok) { setActionNote(res.error.message); return }
                if (res.value.folders.length === 0) {
                  setActionNote(`Nothing worth filing in the last ${days} days.`)
                  return
                }
                setPlan(res.value)
              }}
              disabled={planBusy}
              title="Analyse recent mail and PROPOSE a folder structure — nothing moves until you approve"
            >
              <option value="">Suggest filing…</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          )}
        </div>
      )}
      {triageNote && <div className={styles.status}>{triageNote}</div>}
      {actionNote && <div className={styles.errorBar}><AlertCircle size={13} /> {actionNote}</div>}

      {/* The undo affordance. It exists because every mutation is journalled
          with its inverse — the button is the mechanism surfacing, not a
          promise about one. */}
      {/* The PROPOSAL. Nothing has moved yet — this is the review step, and it
          is what separates "the agent filed your mail" from "your mail went
          missing". Every group says how many and why. */}
      {/* The newsletter offer. Same review step as the filing plan, and for
          the same reason: mail that moves without being approved is
          indistinguishable from mail that went missing. */}
      {sweep && (
        <div className={styles.planPanel}>
          <div className={styles.planHead}>
            <strong>{sweep.summary}</strong>
            <span className={styles.planSub}>
              into “{sweep.folder}” · nothing has moved yet
            </span>
          </div>
          {/* Per-row approve: every sender group is a checkbox, checked by
              default. Unchecking keeps THAT sender's mail where it is — the
              plan files exactly what is still ticked, and the button says the
              real number so approval is never of a vague whole. */}
          <div className={styles.planList}>
            {sweep.senders.slice(0, 8).map((x) => {
              const off = sweepExcluded.has(x.address)
              return (
                <label key={x.address} className={`${styles.planRow} ${off ? styles.planRowOff : ''}`}>
                  <input
                    type="checkbox"
                    checked={!off}
                    onChange={() =>
                      setSweepExcluded((prev) => {
                        const next = new Set(prev)
                        if (next.has(x.address)) next.delete(x.address)
                        else next.add(x.address)
                        return next
                      })
                    }
                  />
                  <span className={styles.planFolder}>{x.label}</span>
                  <span className={styles.planReason}>
                    {x.count} message{x.count === 1 ? '' : 's'}
                  </span>
                </label>
              )
            })}
          </div>
          <div className={styles.planActions}>
            <button className={styles.toolBtn} onClick={() => { setSweep(null); setSweepExcluded(new Set()) }}>Not now</button>
            {(() => {
              const keep = sweep.messages.filter((m) => !sweepExcluded.has(m.fromAddress))
              return (
                <button
                  className={styles.composeBtn}
                  disabled={sweepBusy || keep.length === 0}
                  onClick={async () => {
                    if (!accountId) return
                    setSweepBusy(true)
                    const res = await window.workspace.mail.newsletters.file(accountId, { ...sweep, messages: keep })
                    setSweepBusy(false)
                    setSweep(null)
                    setSweepExcluded(new Set())
                    if (!res.ok) { setActionNote(res.error.message); return }
                    setActionNote(
                      `Filed ${res.value.moved} newsletter${res.value.moved === 1 ? '' : 's'}` +
                        (res.value.failed > 0 ? ` — ${res.value.failed} could not be moved.` : '.') +
                        ' Use “Undo agent” to put them all back.',
                    )
                    void loadFolders(accountId)
                    if (folder) void loadMessages(accountId, folder)
                    void refreshUndo(accountId)
                  }}
                >
                  File {keep.length === sweep.messages.length ? 'them' : keep.length}
                </button>
              )
            })()}
          </div>
        </div>
      )}

      {plan && (
        <div className={styles.planPanel}>
          <div className={styles.planHead}>
            <strong>Proposed filing — last {plan.windowDays} days</strong>
            <span className={styles.planSub}>
              {plan.folders.reduce((n, f) => n + f.messages.length, 0)} messages into{' '}
              {plan.folders.length} folder{plan.folders.length === 1 ? '' : 's'} ·{' '}
              {plan.skipped.count} left where they are
            </span>
          </div>
          <div className={styles.planList}>
            {plan.folders.map((f) => (
              <div key={f.name} className={styles.planRow}>
                <span className={styles.planFolder}>{f.name}</span>
                <span className={styles.planReason}>{f.reason}</span>
              </div>
            ))}
          </div>
          <div className={styles.planActions}>
            <button className={styles.toolBtn} onClick={() => setPlan(null)}>Cancel</button>
            <button
              className={styles.composeBtn}
              disabled={planBusy}
              onClick={async () => {
                if (!accountId) return
                setPlanBusy(true)
                const res = await window.workspace.mail.applyFiling(accountId, plan)
                setPlanBusy(false)
                setPlan(null)
                if (!res.ok) { setActionNote(res.error.message); return }
                setActionNote(
                  `Filed ${res.value.moved} message${res.value.moved === 1 ? '' : 's'} into ` +
                  `${res.value.created} new folder${res.value.created === 1 ? '' : 's'}` +
                  (res.value.failed > 0 ? ` — ${res.value.failed} could not be moved.` : '.') +
                  ' Use “Undo agent” to put it all back.',
                )
                void loadFolders(accountId)
                if (folder) void loadMessages(accountId, folder)
                void refreshUndo(accountId)
              }}
            >
              {planBusy ? 'Filing…' : 'Approve and file'}
            </button>
          </div>
        </div>
      )}

      {newMail > 0 && (
        <button
          className={styles.newMailBar}
          onClick={() => {
            setNewMail(0)
            if (accountId && folder) void loadMessages(accountId, folder)
          }}
        >
          <Mail size={13} /> {newMail} new message{newMail === 1 ? '' : 's'} — show
        </button>
      )}

      {picked.size > 0 && (
        <div className={styles.bulkBar}>
          <span className={styles.bulkCount}>{picked.size} selected</span>
          <button className={styles.toolBtn} disabled={busy} onClick={() => void runBulk('flag')}>
            <Star size={13} /> Flag
          </button>
          <button className={styles.toolBtn} disabled={busy} onClick={() => void runBulk('archive')}>
            <Archive size={13} /> Archive
          </button>
          <button className={styles.toolBtn} disabled={busy} onClick={() => void runBulk('trash')}>
            <Trash2 size={13} /> Delete
          </button>
          <button className={styles.toolBtn} onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}

      {held && (
        <div className={styles.undoBar}>
          <Send size={13} />
          <span className={styles.undoText}>Sending…</span>
          <button
            className={styles.undoBtn}
            onClick={() => { void window.workspace.mail.sendNow(held.id); setHeld(null) }}
          >
            Send now
          </button>
          <button
            className={styles.undoBtn}
            onClick={async () => {
              const res = await window.workspace.mail.cancelSend(held.id)
              setHeld(null)
              setActionNote(res.ok && res.value.cancelled ? 'Send cancelled — the message was not sent.' : 'Too late — that message has already been sent.')
            }}
          >
            Undo
          </button>
        </div>
      )}

      {/* The counterweight to the agent's filing rights: one action that puts
          the mailbox back, rather than reviewing forty individual moves. */}
      {undoStack.length > 0 && (
        <div className={styles.undoBar}>
          <Undo2 size={13} />
          <span className={styles.undoText}>Undo everything the agent filed in the last hour</span>
          <button
            className={styles.undoBtn}
            onClick={async () => {
              if (!accountId) return
              const res = await window.workspace.mail.undoAgentSince(accountId, Date.now() - 3_600_000)
              if (!res.ok) { setActionNote(res.error.message); return }
              setActionNote(
                res.value.undone === 0
                  ? 'The agent has not filed anything in the last hour.'
                  : `Put back ${res.value.undone} message${res.value.undone === 1 ? '' : 's'}` +
                    (res.value.failed > 0 ? ` — ${res.value.failed} could not be moved back.` : '.'),
              )
              void refreshUndo(accountId)
              if (folder) void loadMessages(accountId, folder)
            }}
          >
            Undo agent
          </button>
        </div>
      )}

      {undoStack.length > 0 && (
        <div className={styles.undoBar}>
          <Undo2 size={13} />
          <span className={styles.undoText}>{undoStack[0].description}</span>
          <button className={styles.undoBtn} onClick={() => void undoLast()}>Undo</button>
        </div>
      )}

      {(
        <div className={styles.split} onKeyDown={onPanelKey} tabIndex={-1}>
          <div className={styles.folders} style={{ width: railWidth, minWidth: railWidth, maxWidth: railWidth }}>
            {/* Nested, collapsible, sortable, droppable. IMAP hands back flat
                paths joined by a server-chosen delimiter; the tree shaping is a
                pure module so it is verifiable without a mailbox. */}
            {flattenTree(sortFolders(buildFolderTree(folders), favourites), collapsed).map((node) => {
              const Icon = folderIcon({ path: node.path, name: node.label, specialUse: node.specialUse } as MailFolder)
              const hasKids = node.children.length > 0
              const isOpen = !collapsed.has(node.path)
              return (
                <div
                  key={node.path}
                  className={`${styles.folderRow} ${dragOver === node.path ? styles.folderDrop : ''}`}
                  onDragOver={(e) => {
                    if (!isDropTarget(node)) return
                    e.preventDefault()
                    setDragOver(node.path)
                  }}
                  onDragLeave={() => setDragOver((p) => (p === node.path ? null : p))}
                  onDrop={(e) => {
                    e.preventDefault()
                    setDragOver(null)
                    if (!isDropTarget(node)) {
                      setActionNote(`“${node.label}” holds mail you sent — a received message cannot be filed there.`)
                      return
                    }
                    const payload = e.dataTransfer.getData('application/x-wos-mail')
                    if (!payload) return
                    const row = rowsRef.current.find((r) => `${r.folder}:${r.uid}` === payload)
                    if (row && row.folder !== node.path) void runAction(row, 'moveTo', node.path)
                  }}
                >
                  <button
                    className={styles.folderTwisty}
                    style={{ marginLeft: node.depth * 10 }}
                    onClick={() => {
                      if (!hasKids) return
                      setCollapsed((prev) => {
                        const next = new Set(prev)
                        if (next.has(node.path)) next.delete(node.path)
                        else next.add(node.path)
                        persistRail(next, favourites)
                        return next
                      })
                    }}
                    aria-label={hasKids ? (isOpen ? 'Collapse' : 'Expand') : undefined}
                  >
                    {hasKids ? (isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : null}
                  </button>
                  <button
                    className={`${styles.folder} ${folder === node.path ? styles.folderActive : ''}`}
                    onClick={() => !node.synthetic && setFolder(node.path)}
                    // A synthesised node is a path segment the server never
                    // listed — it can hold children but cannot be opened.
                    disabled={node.synthetic}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setFavourites((prev) => {
                        const next = new Set(prev)
                        if (next.has(node.path)) next.delete(node.path)
                        else next.add(node.path)
                        persistRail(collapsed, next)
                        return next
                      })
                    }}
                    title={node.synthetic ? `${node.path} (not a real folder)` : `${node.path} — right-click to pin`}
                  >
                    <Icon size={13} />
                    <span className={styles.folderName}>{node.label}</span>
                    {favourites.has(node.path) && <Star size={9} className={styles.favStar} />}
                    {counts[node.path]?.unseen ? (
                      <span className={styles.folderCount}>{counts[node.path].unseen}</span>
                    ) : null}
                  </button>
                </div>
              )
            })}
            {/* An inline input, NOT window.prompt: Electron does not implement
                prompt() — it returns null and logs a warning, so the button
                silently did nothing. */}
            {newFolderOpen ? (
              <form
                className={styles.newFolderForm}
                onSubmit={async (e) => {
                  e.preventDefault()
                  const name = newFolderName.trim()
                  if (!accountId || !name) { setNewFolderOpen(false); return }
                  const res = await window.workspace.mail.createFolder(accountId, name)
                  setNewFolderOpen(false)
                  setNewFolderName('')
                  if (!res.ok) { setActionNote(res.error.message); return }
                  setActionNote(`Created “${name}”.`)
                  void loadFolders(accountId)
                }}
              >
                <input
                  autoFocus
                  className={styles.newFolderInput}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName('') } }}
                  onBlur={() => { if (!newFolderName.trim()) setNewFolderOpen(false) }}
                  placeholder="Folder name"
                  aria-label="New folder name"
                />
              </form>
            ) : (
              <button className={styles.newFolder} onClick={() => setNewFolderOpen(true)}>
                <FolderPlus size={12} /> New folder
              </button>
            )}
          </div>

          {/* Drag to resize the rail. A fixed-width rail cannot show a nested
              tree — the deeper folders simply clip. */}
          <div
            className={styles.railGrip}
            onMouseDown={(e) => {
              e.preventDefault()
              const startX = e.clientX
              const startW = railWidth
              const move = (ev: MouseEvent): void => {
                const w = Math.max(120, Math.min(360, startW + ev.clientX - startX))
                setRailWidth(w)
              }
              const up = (): void => {
                window.removeEventListener('mousemove', move)
                window.removeEventListener('mouseup', up)
                localStorage.setItem('wos.mail.railWidth', String(railWidth))
              }
              window.addEventListener('mousemove', move)
              window.addEventListener('mouseup', up)
            }}
          />

          <div className={styles.messages}>
            {mailView === 'sift' ? (
              /* The sift IS the message list here — same column, beside the
                 folder rail, with the reader opening next to it as usual. */
              <SiftView
                rows={sift?.rows ?? []}
                briefing={sift?.briefing ?? null}
                degraded={sift?.degraded ?? false}
                busy={siftBusy}
                handled={siftHandled}
                onOpen={(r) => void openMessage(r.uid, r.folder)}
                onDraft={(r) => void siftDraft(r)}
                onDone={(r) => void siftDone(r)}
                onAddToCase={(r) => void siftAddToCase(r)}
                onAddToCalendar={(r) => void siftAddToCalendar(r)}
                onMarkZoneRead={(rs) => void siftMarkZoneRead(rs)}
                onFileNoise={() => void proposeSweep()}
                onReassign={(r, z, always) => void siftReassign(r, z, always)}
                onClose={() => switchView('list')}
              />
            ) : (
              <>
            <div className={styles.filterBar}>
              <Search size={12} className={styles.filterIcon} />
              <input
                ref={filterRef}
                className={styles.filterInput}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search all mail…"
                aria-label="Search mail"
              />
            </div>
            {/* Filter chips write real operators into the search box, so what
                they do is visible and editable rather than hidden state. */}
            <div className={styles.chips}>
              {[
                { label: 'Unread', op: 'is:unread' },
                { label: 'Flagged', op: 'is:flagged' },
                { label: 'Attachments', op: 'has:attachment' },
              ].map((c) => {
                const on = filter.includes(c.op)
                return (
                  <button
                    key={c.op}
                    className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                    onClick={() =>
                      setFilter((f) =>
                        on ? f.replace(c.op, '').replace(/\s+/g, ' ').trim() : `${f} ${c.op}`.trim(),
                      )
                    }
                  >
                    {c.label}
                  </button>
                )
              })}
              <button
                className={styles.chip}
                onClick={() =>
                  setPicked((prev) =>
                    prev.size === rowsRef.current.length && prev.size > 0
                      ? new Set()
                      : new Set(rowsRef.current.map((r) => `${r.folder}:${r.uid}`)),
                  )
                }
                title="Select every row currently listed — including all search results"
              >
                {picked.size > 0 && picked.size === rows.length ? 'Select none' : 'Select all'}
              </button>
              <div className={styles.chipSpacer} />
              <button
                className={styles.chip}
                onClick={() => { const v = !dense; setDense(v); localStorage.setItem('wos.mail.dense', v ? '1' : '0') }}
                title="Compact rows"
              >
                {dense ? 'Comfortable' : 'Compact'}
              </button>
              <select
                className={styles.sortSelect}
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort"
                title="Sorting applies to the whole folder, not just the loaded page"
              >
                <option value="date">Newest</option>
                <option value="date-asc">Oldest</option>
                <option value="sender">Sender</option>
                <option value="subject">Subject</option>
                <option value="unread">Unread first</option>
              </select>
            </div>
            {indexNote && <div className={styles.status}>{indexNote}</div>}
            {loading === 'messages' && !searchHits && rows.length === 0 ? (
              <div className={styles.status}>Loading messages…</div>
            ) : rows.length === 0 && !error ? (
              <div className={styles.status}>
                {searchHits ? `No matches for “${filter.trim()}”.` : 'No messages.'}
              </div>
            ) : (
              <>
                {rows.map((m) => (
                  <div
                    key={`${m.folder}:${m.uid}`}
                    className={`${styles.msgRow} ${picked.has(rowKey(m)) ? styles.msgPicked : ''}`}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('application/x-wos-mail', rowKey(m))}
                  >
                    <input
                      type="checkbox"
                      className={styles.pick}
                      checked={picked.has(rowKey(m))}
                      onChange={() => togglePick(m)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Select ${m.subject || 'message'}`}
                    />
                    <button
                      className={`${styles.msg} ${m.seen ? '' : styles.msgUnread} ${dense ? styles.msgDense : ''}`}
                      onClick={() => void openMessage(m.uid, m.folder)}
                    >
                      {!dense && (() => {
                        const a = avatarFor(m.from, m.fromAddress ?? '')
                        return (
                          <span
                            className={styles.avatar}
                            style={{ background: `hsl(${a.hue} 55% 42%)` }}
                            aria-hidden="true"
                          >
                            {a.initials}
                          </span>
                        )
                      })()}
                      <span className={styles.msgBody}>
                      <div className={styles.msgTop}>
                        {!m.seen && <Circle size={7} className={styles.unreadDot} fill="currentColor" />}
                        <span className={styles.msgFrom}>{m.from}</span>
                        <span className={styles.msgWhen}>{m.when}</span>
                      </div>
                      <div className={styles.msgSubject}>
                        {m.subject || '(no subject)'}
                        {m.threadCount && m.threadCount > 1 ? (
                          <span className={styles.threadCount}>{m.threadCount}</span>
                        ) : null}
                      </div>
                      </span>
                    </button>
                    {/* Hover actions. Every one is journalled and undoable, and
                        "Delete" is a move to Trash — nothing here destroys a
                        message. */}
                    <div className={styles.rowActions}>
                      <button
                        className={styles.rowAction}
                        title="Flag"
                        onClick={(e) => { e.stopPropagation(); void runAction(m, 'flag') }}
                      >
                        <Star size={13} />
                      </button>
                      <button
                        className={styles.rowAction}
                        title={`Archive (move to ${archiveFolder})`}
                        onClick={(e) => { e.stopPropagation(); void runAction(m, 'archive') }}
                      >
                        <Archive size={13} />
                      </button>
                      <button
                        className={styles.rowAction}
                        title={`Delete (move to ${trashFolder} — recoverable)`}
                        onClick={(e) => { e.stopPropagation(); void runAction(m, 'trash') }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
                {!searchHits && messages.length >= PAGE_SIZE && (
                  <button className={styles.loadMore} onClick={loadMore} disabled={loading === 'more'}>
                    {loading === 'more' ? 'Loading…' : 'Load more'}
                  </button>
                )}
              </>
            )}
              </>
            )}
          </div>

          {/* Reading pane — beside the list, not instead of it. Replacing the
              list on click meant losing your place in the mailbox every time
              you opened anything, which is not how any mail client behaves. */}
          {selected && (
            <div className={styles.readerCol}>
              {/* Pane toolbar. Acting on the open message and advancing to the
                  next one is the core reading loop — without it every action
                  costs a trip back to the list. */}
              <div className={styles.paneBar}>
                <button className={styles.backBtn} onClick={() => setSelected(null)} title="Close (Esc)">
                  <ChevronLeft size={14} /> Close
                </button>
                <div className={styles.paneSpacer} />
                <button className={styles.rowAction} onClick={() => step(-1)} title="Previous (p)">
                  <ChevronUp size={14} />
                </button>
                <button className={styles.rowAction} onClick={() => step(1)} title="Next (n)">
                  <ChevronDown size={14} />
                </button>
                <button className={styles.rowAction} onClick={() => void markUnread()} title="Mark unread (u)">
                  <MailOpen size={14} />
                </button>
                <button className={styles.rowAction} onClick={() => void paneAction('flag')} title="Flag (s)">
                  <Star size={14} />
                </button>
                <button className={styles.rowAction} onClick={() => void paneAction('archive')} title="Archive (e)">
                  <Archive size={14} />
                </button>
                <button className={styles.rowAction} onClick={() => void paneAction('trash')} title="Delete (⌫) — moves to Trash">
                  <Trash2 size={14} />
                </button>
              </div>
              <MailReader
                message={selected}
                onReply={activeAccount?.smtp ? openReply : undefined}
                onQuickReply={activeAccount?.smtp ? (stance) => {
                  if (!accountId || !folder || !selected) return
                  setActionNote('Drafting a reply…')
                  void window.workspace.mail
                    .draftReply(accountId, { folder, uid: selected.uid, stance })
                    .then((res) => {
                      if (!res.ok) { setActionNote(res.error.message); return }
                      setActionNote(null)
                      // Opens Compose PREFILLED. The user reads and sends it —
                      // a quick reply never sends by itself.
                      const init = buildInitial('reply', selected)
                      setCompose({ draft: { ...init.draft, text: res.value.suggestedBody }, context: init.context })
                    })
                } : undefined}

                accountId={accountId ?? undefined}
                folder={folder ?? undefined}
              />
            </div>
          )}
        </div>
      )}

      {dialogOpen && (
        <MailAccountDialog
          onClose={() => setDialogOpen(false)}
          onSaved={(a) => { setDialogOpen(false); setAccounts((p) => [a, ...p]); setAccountId(a.id) }}
          onTryDemo={() => void addDemo()}
        />
      )}

      {compose && activeAccount && (
        <MailCompose
          account={activeAccount}
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => setCompose(null)}
        />
      )}
    </div>
  )
}

function PanelHeader({ onAdd, onRefresh, loading }: { onAdd: () => void; onRefresh: () => void; loading: boolean }): JSX.Element {
  return (
    <div className={styles.header}>
      <div className={styles.headerTitle}>
        <span className={styles.heading}>Mail</span>
      </div>
      <div className={styles.headerActions}>
        <button className={styles.iconBtn} onClick={onRefresh} title="Refresh" disabled={loading}>
          <RefreshCw size={13} className={loading ? styles.spin : ''} />
        </button>
        <button className={styles.iconBtn} onClick={onAdd} title="Add account"><Plus size={14} /></button>
      </div>
    </div>
  )
}
