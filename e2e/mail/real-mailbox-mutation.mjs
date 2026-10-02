// e2e — the MUTATING mail path against a real mailbox.
//
// The read harness (real-mailbox.mjs) proves listing, opening, syncing and
// searching. Nothing proved that a flag, a move or an undo actually works
// against a real server — and "it passes against a fake IMAP" is exactly the
// evidence that let a broken message-open ship.
//
// ── SAFETY ──────────────────────────────────────────────────────────────────
// This test changes your real mailbox, so it is built to be safe to run:
//
//   * Every operation is a ROUND TRIP. It flags then unflags, moves then moves
//     back, and asserts the mailbox ends in the state it started in.
//   * It only touches a message that is ALREADY READ and NOT FLAGGED, so it
//     cannot disturb anything you have marked for yourself.
//   * The MOVE test is opt-in (WOS_MAIL_MUTATION_MOVE=1). By default this runs
//     flag round-trips only, which cannot lose a message even if it crashes
//     halfway. A test people are afraid to run is a test nobody runs.
//   * It never deletes, never expunges, never sends.
//
// ── PRIVACY ─────────────────────────────────────────────────────────────────
// No subjects, senders or bodies are printed. Assertions report shapes.
//
//   npm run e2e:mail-mutation
//   WOS_MAIL_MUTATION_MOVE=1 npm run e2e:mail-mutation   # also test move+undo
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const TEST_MOVE = process.env.WOS_MAIL_MUTATION_MOVE === '1'

let passed = 0
let failed = 0
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

const killAll = () => {
  for (const p of ['Software-Projects/Workspace-OS/node_modules/electron', 'Workspace OS.app']) {
    try { execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' }) } catch { /* none */ }
  }
}

killAll()
await new Promise((r) => setTimeout(r, 600))

// The packaged app, because safeStorage keys credentials to the app identity.
const APP = [
  path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS'),
  '/Applications/Workspace OS.app/Contents/MacOS/Workspace OS',
].find((p) => fs.existsSync(p))
if (!APP) {
  console.log('\nSKIP: no packaged app found. Build one:  npm run ship -- --no-release\n')
  process.exit(0)
}

const app = await electron.launch({ executablePath: APP, args: [] })
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 20000 })

try {
  const account = await win.evaluate(async () => {
    const list = await window.workspace.mail.accounts.list()
    const real = list.find((a) => !/demo/i.test(a.id) && !/demo/i.test(a.displayName || ''))
    return real ? real.id : null
  })
  if (!account) {
    console.log('\nSKIP: no real mail account configured.\n')
    await app.close()
    process.exit(0)
  }

  const inbox = await win.evaluate(async (id) => {
    const res = await window.workspace.mail.folders(id)
    if (!res.ok) return null
    const sel = res.value.filter((f) => f.selectable)
    return (sel.find((f) => f.path.toUpperCase() === 'INBOX') ?? sel[0])?.path ?? null
  }, account)
  ok('found an INBOX', Boolean(inbox))

  // Choose a victim: already read, not flagged. Anything else risks disturbing
  // state the user set deliberately.
  const victim = await win.evaluate(
    async ([id, folder]) => {
      const res = await window.workspace.mail.messages(id, folder, { limit: 25 })
      if (!res.ok) return { error: res.error.message }
      const candidate = res.value.find((m) => m.seen && !m.flags.includes('\\Flagged'))
      if (!candidate) return { none: true }
      const full = await window.workspace.mail.message(id, folder, candidate.uid)
      if (!full.ok) return { error: full.error.message }
      return { uid: candidate.uid, messageId: full.value.messageId, subject: full.value.subject }
    },
    [account, inbox],
  )

  if (victim.none || victim.error) {
    console.log(`\nSKIP: no safe test message (already-read and unflagged). ${victim.error ?? ''}\n`)
    await app.close()
    process.exit(0)
  }
  ok('picked a safe test message (read, unflagged)', Boolean(victim.messageId))
  ok('it has a Message-ID (required for an undoable action)', Boolean(victim.messageId))

  // ── Flag round trip ────────────────────────────────────────────────────────
  const flagged = await win.evaluate(
    async ([id, folder, uid, mid, subject]) => {
      const res = await window.workspace.mail.setFlagged(id, folder, uid, mid, true, subject)
      if (!res.ok) return { error: `${res.error.code}: ${res.error.message}` }
      const check = await window.workspace.mail.message(id, folder, uid)
      return {
        actionId: res.value.id,
        isFlagged: check.ok ? check.value.flags.includes('\\Flagged') : null,
      }
    },
    [account, inbox, victim.uid, victim.messageId, victim.subject],
  )
  ok('FLAG applied on the real server', flagged.isFlagged === true, flagged.error)
  ok('the action was journalled with an id', Number.isFinite(flagged.actionId))

  const undone = await win.evaluate(
    async ([id, folder, uid, actionId]) => {
      const res = await window.workspace.mail.undo(id, actionId)
      if (!res.ok) return { error: `${res.error.code}: ${res.error.message}` }
      const check = await window.workspace.mail.message(id, folder, uid)
      return { stillFlagged: check.ok ? check.value.flags.includes('\\Flagged') : null }
    },
    [account, inbox, victim.uid, flagged.actionId],
  )
  ok('UNDO removed the flag — the mailbox is back as it was', undone.stillFlagged === false, undone.error)

  // The undo stack must not still offer an action already taken back.
  const stack = await win.evaluate(async (id) => {
    const res = await window.workspace.mail.undoable(id)
    return res.ok ? res.value.map((e) => e.id) : []
  }, account)
  ok('the undone action left the undo stack', !stack.includes(flagged.actionId))

  // ── Move round trip (opt-in) ───────────────────────────────────────────────
  if (!TEST_MOVE) {
    console.log('\n  (move/undo not run — set WOS_MAIL_MUTATION_MOVE=1 to include it)\n')
  } else {
    const archive = await win.evaluate(async (id) => {
      const res = await window.workspace.mail.folders(id)
      if (!res.ok) return null
      const f = res.value.find((x) => (x.specialUse || '').toLowerCase() === '\\archive')
        ?? res.value.find((x) => /^archiv/i.test(x.name))
      return f?.path ?? null
    }, account)
    ok('found an Archive folder to move into', Boolean(archive))

    if (archive) {
      const moved = await win.evaluate(
        async ([id, folder, uid, mid, subject, dest]) => {
          const res = await window.workspace.mail.move(id, folder, uid, mid, dest, subject)
          return res.ok ? { actionId: res.value.id } : { error: `${res.error.code}: ${res.error.message}` }
        },
        [account, inbox, victim.uid, victim.messageId, victim.subject, archive],
      )
      ok('MOVE to Archive succeeded', Number.isFinite(moved.actionId), moved.error)

      const back = await win.evaluate(
        async ([id, actionId, folder, mid]) => {
          const res = await window.workspace.mail.undo(id, actionId)
          if (!res.ok) return { error: `${res.error.code}: ${res.error.message}` }
          // Prove it is genuinely back in the INBOX, by Message-ID — the uid
          // changed when it moved, which is the whole reason the journal keys
          // on the Message-ID rather than the uid.
          const list = await window.workspace.mail.messages(id, folder, { limit: 50 })
          if (!list.ok) return { error: list.error.message }
          const found = []
          for (const m of list.value.slice(0, 10)) {
            const f = await window.workspace.mail.message(id, folder, m.uid)
            if (f.ok && f.value.messageId === mid) found.push(m.uid)
          }
          return { restored: found.length > 0 }
        },
        [account, moved.actionId, inbox, victim.messageId],
      )
      ok('UNDO moved it back to the INBOX (found by Message-ID, not uid)', back.restored === true, back.error)
    }
  }

  // ── The standing guarantees ────────────────────────────────────────────────
  const surface = await win.evaluate(() => Object.keys(window.workspace.mail))
  ok(
    'still no destructive verb (delete is a move to Trash)',
    surface.filter((k) => /^(delete|expunge|destroy|purge)/i.test(k)).length === 0,
  )
  ok(
    'mutation and undo still ship together',
    !surface.some((k) => /^(move|setRead|setFlagged)$/.test(k)) ||
      (surface.includes('undo') && surface.includes('undoable')),
  )
} finally {
  await app.close().catch(() => {})
  killAll()
}

console.log(`\n  MAIL mutation round-trips: ${passed} passed, ${failed} failed\n`)
process.exit(failed === 0 ? 0 : 1)
