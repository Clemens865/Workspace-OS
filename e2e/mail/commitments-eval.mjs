// Offline eval — commitment extraction against a REAL mailbox.
//
// The blueprint calls this the piece most likely to produce confident nonsense,
// so it does not reach the cockpit on the strength of unit tests over fixtures
// I wrote myself. Fixtures prove the rules I thought of; a real mailbox is the
// only thing that shows what I did not.
//
// ── WHAT IT MEASURES ────────────────────────────────────────────────────────
// The hit RATE, not correctness — nothing here can know whether a sentence is
// truly a promise. What it can show is whether the extractor is in a sane
// range, and that is the decision this gates:
//
//   * near 0%  → the rules are too narrow to be worth surfacing
//   * over ~25% of messages → almost certainly over-firing; a mailbox is not
//     one-quarter promises, and a noisy commitment list is worse than none
//   * a handful per hundred, concentrated in Sent → plausible
//
// ── SAFETY & PRIVACY ────────────────────────────────────────────────────────
// Strictly read-only: it lists and fetches, nothing else. It prints COUNTS and
// REDACTED shapes — never a subject, sender, or sentence. Real correspondence
// must not end up in a terminal transcript, which is exactly the material this
// feature is made of.
//
//   npm run e2e:commitments-eval
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import esbuild from 'esbuild'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)

// Compile the REAL extractor to CJS and load it — the shipping code, not a copy.
const OUT = fs.mkdtempSync(path.join(ROOT, 'e2e', 'mail', '.eval-'))
esbuild.buildSync({
  entryPoints: [path.join(ROOT, 'src/main/mail/commitments.ts')],
  outfile: path.join(OUT, 'commitments.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
})
const { extractCommitments } = require(path.join(OUT, 'commitments.cjs'))

const killAll = () => {
  for (const p of ['Software-Projects/Workspace-OS/node_modules/electron', 'Workspace OS.app']) {
    try { execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' }) } catch { /* none */ }
  }
}

killAll()
await new Promise((r) => setTimeout(r, 600))

const APP = [
  path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS'),
  '/Applications/Workspace OS.app/Contents/MacOS/Workspace OS',
].find((p) => fs.existsSync(p))
if (!APP) {
  console.log('\nSKIP: no packaged app found.\n')
  fs.rmSync(OUT, { recursive: true, force: true })
  process.exit(0)
}

const app = await electron.launch({ executablePath: APP, args: [] })
const win = await app.firstWindow()
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
    fs.rmSync(OUT, { recursive: true, force: true })
    process.exit(0)
  }

  const folders = await win.evaluate(async (id) => {
    const res = await window.workspace.mail.folders(id)
    if (!res.ok) return null
    const sel = res.value.filter((f) => f.selectable)
    return {
      inbox: (sel.find((f) => f.path.toUpperCase() === 'INBOX') ?? sel[0])?.path ?? null,
      sent: (sel.find((f) => (f.specialUse || '').toLowerCase() === '\\sent')
        ?? sel.find((f) => /^(sent|gesendet)/i.test(f.name)))?.path ?? null,
    }
  }, account)

  const SAMPLE = 40
  let scanned = 0
  let withCommitment = 0
  let total = 0
  let withDate = 0
  const perFolder = {}

  for (const [side, folder] of [['theirs', folders?.inbox], ['mine', folders?.sent]]) {
    if (!folder) {
      console.log(`  (no ${side === 'mine' ? 'Sent' : 'INBOX'} folder — skipped)`)
      continue
    }
    const messages = await win.evaluate(
      async ([id, f, limit]) => {
        const list = await window.workspace.mail.messages(id, f, { limit })
        if (!list.ok) return []
        const out = []
        for (const m of list.value) {
          const full = await window.workspace.mail.message(id, f, m.uid)
          if (full.ok) out.push({ uid: m.uid, subject: full.value.subject, body: full.value.text })
        }
        return out
      },
      [account, folder, SAMPLE],
    )

    let folderHits = 0
    for (const m of messages) {
      scanned++
      const found = extractCommitments({
        accountId: account, folder, uid: m.uid,
        subject: m.subject, body: m.body, fromSelf: side === 'mine',
      })
      if (found.length > 0) {
        withCommitment++
        folderHits++
        total += found.length
        withDate += found.filter((c) => c.whenText).length
      }
    }
    perFolder[side] = { scanned: messages.length, messagesWithHits: folderHits }
  }

  const rate = scanned === 0 ? 0 : (withCommitment / scanned) * 100

  console.log('\n  COMMITMENT EXTRACTION — real mailbox eval')
  console.log('  ─────────────────────────────────────────')
  console.log(`  messages scanned          ${scanned}`)
  console.log(`  messages with a hit       ${withCommitment}  (${rate.toFixed(1)}%)`)
  console.log(`  commitments found         ${total}`)
  console.log(`  …carrying a date phrase   ${withDate}`)
  for (const [side, v] of Object.entries(perFolder)) {
    console.log(`  ${side.padEnd(7)}  ${v.messagesWithHits}/${v.scanned} messages`)
  }

  console.log('')
  if (scanned === 0) {
    console.log('  INCONCLUSIVE — nothing to scan.')
  } else if (rate === 0) {
    console.log('  TOO NARROW — found nothing at all. Not worth surfacing as is.')
  } else if (rate > 25) {
    console.log('  OVER-FIRING — a mailbox is not one-quarter promises.')
    console.log('  Do NOT surface this; tighten the rules first.')
  } else {
    console.log('  PLAUSIBLE RANGE — safe to surface, with provenance shown.')
  }
  console.log('')
} finally {
  await app.close().catch(() => {})
  killAll()
  fs.rmSync(OUT, { recursive: true, force: true })
}
