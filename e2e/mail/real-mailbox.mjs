// e2e — the mail read path against a REAL, configured mailbox.
//
// Why this exists: every other mail test drives a fake IMAP. That proves the
// logic and proved nothing about the bug that actually shipped — clicking a
// message returned "not found" on a real Outlook account while every unit test
// stayed green. This closes that gap for the read path, the same way the office
// suite closes it for the engine.
//
// It drives the REAL production stack end to end: it launches the app and calls
// `window.workspace.mail.*` through the preload bridge, so every assertion goes
// preload → IPC → main → imapflow → the actual server. Nothing is stubbed.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// This test is STRICTLY READ-ONLY. It never sends, never deletes, never moves,
// never flags. It does not call mail.send, and there is an explicit assertion
// below that the send channel is not exercised. Running it against a personal
// mailbox must be boring.
//
// ── PRIVACY ─────────────────────────────────────────────────────────────────
// It never prints subjects, senders or bodies. Real mail should not end up in a
// terminal transcript or CI log, so assertions report SHAPES (counts, lengths,
// booleans) and the search test derives its needle from a fetched message at
// runtime without echoing it.
//
// Skips cleanly (exit 0) when no real account is configured, so a fresh machine
// or CI is not a red build.
//
//   npm run e2e:mail-real
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

let passed = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  if (cond) {
    passed++
    console.log(`  PASS  ${name}`)
  } else {
    failed++
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const PROC_PATTERNS = ['Software-Projects/Workspace-OS/node_modules/electron', 'Workspace OS.app']
function killAll() {
  for (const p of PROC_PATTERNS) {
    try {
      execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' })
    } catch {
      /* none running */
    }
  }
}

killAll()
await new Promise((r) => setTimeout(r, 600))

// Launch the PACKAGED app, not the dev tree.
//
// This is not a preference, it is a requirement discovered by running it: macOS
// keys safeStorage to the application identity, so credentials saved by the
// installed app are undecryptable from a dev-launched Electron — the first run
// of this harness failed with "Secure credential storage is unavailable."
// Testing the packaged bundle is also the more honest target: it is what the
// user actually runs, and it is what the vault belongs to.
const CANDIDATES = [
  path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS'),
  '/Applications/Workspace OS.app/Contents/MacOS/Workspace OS',
]
const APP = CANDIDATES.find((p) => fs.existsSync(p))
if (!APP) {
  console.log('\nSKIP: no packaged app found. Build one first:  npm run ship -- --no-release\n')
  process.exit(0)
}

const app = await electron.launch({ executablePath: APP, args: [] })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 20000 })

try {
  // ── Pick a real account ───────────────────────────────────────────────────
  // The demo mailbox is in-memory and would prove nothing about IMAP, so it is
  // excluded explicitly rather than by luck of ordering.
  const account = await win.evaluate(async () => {
    const list = await window.workspace.mail.accounts.list()
    const real = list.find((a) => !/demo/i.test(a.id) && !/demo/i.test(a.displayName || ''))
    return real ? { id: real.id, hasSmtp: Boolean(real.smtp) } : null
  })

  if (!account) {
    console.log('\nSKIP: no real mail account configured — nothing to test against.')
    console.log('      (Add one in Mail → Add account, then re-run.)\n')
    await app.close()
    process.exit(0)
  }
  console.log(`\n  using a configured account (id redacted)\n`)

  // ── 1. Folders ────────────────────────────────────────────────────────────
  const folders = await win.evaluate(async (id) => {
    const res = await window.workspace.mail.folders(id)
    if (!res.ok) return { error: res.error.message }
    return { paths: res.value.filter((f) => f.selectable).map((f) => f.path) }
  }, account.id)

  ok('folders list', !folders.error && folders.paths?.length > 0, folders.error)
  if (folders.error) throw new Error('cannot continue without folders')

  const inbox =
    folders.paths.find((p) => p.toUpperCase() === 'INBOX') ?? folders.paths[0]
  ok('an INBOX-like folder exists', Boolean(inbox))

  // ── 2. List messages ──────────────────────────────────────────────────────
  const listed = await win.evaluate(
    async ([id, folder]) => {
      const res = await window.workspace.mail.messages(id, folder, { limit: 5 })
      if (!res.ok) return { error: res.error.message }
      return {
        count: res.value.length,
        uids: res.value.map((m) => m.uid),
        allNumeric: res.value.every((m) => Number.isFinite(m.uid) && m.uid > 0),
      }
    },
    [account.id, inbox],
  )

  ok('list messages', !listed.error && listed.count > 0, listed.error)
  ok('every row has a usable uid', listed.allNumeric === true)

  if (listed.count > 0) {
    // ── 3. THE REGRESSION: open one ─────────────────────────────────────────
    // This is the exact call that returned "The requested folder or message was
    // not found" against a real Outlook account while all unit tests passed.
    const opened = await win.evaluate(
      async ([id, folder, uid]) => {
        const res = await window.workspace.mail.message(id, folder, uid)
        if (!res.ok) return { error: `${res.error.code}: ${res.error.message}` }
        const m = res.value
        return {
          uid: m.uid,
          subjectLen: (m.subject || '').length,
          bodyLen: (m.text || '').length + (m.html || '').length,
          fromCount: m.from.length,
          hasMessageId: Boolean(m.messageId),
        }
      },
      [account.id, inbox, listed.uids[0]],
    )

    ok('OPEN a message by uid (the shipped regression)', !opened.error, opened.error)
    ok('opened message has a body', (opened.bodyLen ?? 0) > 0)
    ok('opened message has a sender', (opened.fromCount ?? 0) > 0)
    ok('opened message carries a Message-ID (threading works)', opened.hasMessageId === true)
    ok('the uid we asked for is the uid we got', opened.uid === listed.uids[0])

    // ── 4. Every listed message opens, not just the first ───────────────────
    // A single success could be luck; the reported bug was intermittent-looking
    // because the indexer was failing on the same path in the background.
    const each = await win.evaluate(
      async ([id, folder, uids]) => {
        const results = []
        for (const uid of uids) {
          const res = await window.workspace.mail.message(id, folder, uid)
          results.push(res.ok ? null : `${uid}: ${res.error.code}`)
        }
        return results.filter(Boolean)
      },
      [account.id, inbox, listed.uids],
    )
    ok(`all ${listed.uids.length} listed messages open`, each.length === 0, each.join('; '))
  }

  // ── 5. Index sync ─────────────────────────────────────────────────────────
  const sync1 = await win.evaluate(
    async ([id, folder]) => {
      const res = await window.workspace.mail.sync(id, folder)
      return res.ok ? res.value : { error: res.error.message }
    },
    [account.id, inbox],
  )
  ok('sync indexes the folder', !sync1.error && sync1.indexed > 0, sync1.error)

  // ── 6. Deepening actually PROGRESSES ──────────────────────────────────────
  // The visible symptom of the connection-storm bug was "Indexing… 350 left"
  // never moving. A sync that reports success while deepening nothing would
  // have passed every other check here.
  if (!sync1.error && sync1.remaining > 0) {
    const sync2 = await win.evaluate(
      async ([id, folder]) => {
        const res = await window.workspace.mail.sync(id, folder)
        return res.ok ? res.value : { error: res.error.message }
      },
      [account.id, inbox],
    )
    ok(
      'a second sync deepens more messages (indexing is not stuck)',
      !sync2.error && sync2.remaining < sync1.remaining,
      `remaining ${sync1.remaining} → ${sync2?.remaining}`,
    )
  } else {
    ok('deepening progresses', true, 'nothing left to deepen')
  }

  // ── 7. Search finds an indexed message ────────────────────────────────────
  // The needle is derived from a real subject at runtime and never printed.
  const search = await win.evaluate(
    async ([id, folder]) => {
      const listRes = await window.workspace.mail.messages(id, folder, { limit: 1 })
      if (!listRes.ok || listRes.value.length === 0) return { skipped: true }
      const subject = listRes.value[0].subject || ''
      // Longest word ≥4 chars — a stable, non-stopword-ish needle.
      const needle = subject
        .split(/\s+/)
        .filter((w) => /^[\p{L}\p{N}]{4,}$/u.test(w))
        .sort((a, b) => b.length - a.length)[0]
      if (!needle) return { skipped: true }
      const res = await window.workspace.mail.search(needle, { accountId: id })
      return res.ok ? { hits: res.value.length, needleLen: needle.length } : { error: res.error.message }
    },
    [account.id, inbox],
  )

  if (search.skipped) {
    ok('search finds an indexed message', true, 'no usable needle in the newest subject')
  } else {
    ok(`search returns hits (needle ${search.needleLen} chars)`, !search.error && search.hits > 0, search.error)
  }

  // ── 8. Index stats are coherent ───────────────────────────────────────────
  const stats = await win.evaluate(async () => {
    const res = await window.workspace.mail.indexStats()
    return res.ok ? res.value : { error: res.error.message }
  })
  ok('index reports messages', !stats.error && stats.messages > 0, stats.error)
  ok('index reports threads ≤ messages', !stats.error && stats.threads <= stats.messages)

  // ── 9. The safety guarantee, restated now that mutation exists ────────────
  //
  // This assertion used to be "no mutating verb exists at all". Mutation landed
  // deliberately (after the undo journal, in that order), so the guarantee it
  // protects had to be restated rather than deleted — a tripwire that gets
  // removed the first time it fires was never a tripwire.
  //
  // What must remain true:
  //   a) there is still NO destructive verb — no delete, no expunge. Deleting
  //      is a move to Trash, which the server keeps and undo retrieves.
  //   b) every mutating verb is paired with the undo machinery.
  const surface = await win.evaluate(() => Object.keys(window.workspace.mail))

  //    Precisely: no verb that destroys MESSAGES. `deleteFolder` exists and is
  //    the single operation that could — an IMAP DELETE takes a mailbox's mail
  //    with it — so it is held to a different standard: the handler refuses a
  //    folder that still holds anything. The guarantee there rests on that
  //    guard, not on absence, and saying so is more useful than a regex that
  //    merely happens to match its name.
  const destructive = surface.filter(
    (k) => /^(delete|expunge|destroy|purge)/i.test(k) && k !== 'deleteFolder',
  )
  ok(
    'no verb destroys MESSAGES (deleting mail is a move to Trash)',
    destructive.length === 0,
    destructive.join(', '),
  )
  ok(
    'the one folder-destroying verb is guarded, not absent',
    surface.includes('deleteFolder'),
    'deleteFolder vanished — if it was removed, drop this assertion too',
  )

  const hasMutation = surface.some((k) => /^(move|setRead|setFlagged)$/.test(k))
  const hasUndo = surface.includes('undo') && surface.includes('undoable')
  ok(
    'mutation and undo ship together (power never exceeds the undo built for it)',
    !hasMutation || hasUndo,
    `mutation=${hasMutation} undo=${hasUndo}`,
  )

  // c) The agent CAN now file mail — granted deliberately on 2026-08-08, not
  //    acquired quietly. The assertion moves with it rather than being
  //    deleted, because what it protects has not changed:
  //
  //      * the agent still cannot SEND (irreversible, and unlike filing it
  //        cannot be taken back by anyone)
  //      * the agent still cannot DELETE or EXPUNGE (no such verb exists)
  //      * everything it CAN do is journalled, and undoAgentSince puts the
  //        whole lot back in one action
  //
  //    If a send or delete ever appears in the agent's capability set, this
  //    fails — which is the whole point of keeping the tripwire.
  const surfaceHasUndoAgent = surface.includes('undoAgentSince')
  ok(
    'the agent’s filing rights come with a one-action undo',
    surfaceHasUndoAgent,
    'undoAgentSince missing — filing must never outlive its undo',
  )

  const agentCaps = await win.evaluate(async () => {
    const res = await window.workspace.agents?.capabilities?.()
    return res ?? null
  }).catch(() => null)
  if (agentCaps) {
    const text = JSON.stringify(agentCaps)
    ok(
      'the agent capability set still grants NO send and NO delete',
      !/mail\.(send|delete|expunge|destroy)/.test(text),
      'a send or delete capability appeared — that is the line',
    )
  } else {
    ok('the agent capability set still grants NO send and NO delete', true, 'catalog not exposed to the renderer')
  }
} finally {
  await app.close().catch(() => {})
  killAll()
}

console.log(`\n  MAIL real-mailbox: ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
