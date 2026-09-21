/** Does the mock data actually populate Mail, Calendar and Knowledge? */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { seedKnowledge, startIcsServer } from './mock-data.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WS = '/tmp/wos-demo'
const DEMO_HOME = '/tmp/wos-demo-home'
const LOG = '/tmp/diag-mockdata.log'
fs.writeFileSync(LOG, '')
const say = (...p) => {
  const line = p.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  fs.appendFileSync(LOG, line + '\n')
}

fs.mkdirSync(WS, { recursive: true })
say('knowledge notes seeded:', seedKnowledge(WS))
const ics = await startIcsServer()
say('ics served at', ics.url)

const timer = setTimeout(() => {
  say('TIMEOUT')
  process.exit(2)
}, 150_000)

const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js')],
  cwd: ROOT,
  env: { ...process.env, WORKSPACE_TEST_ROOT: WS, HOME: DEMO_HOME },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })

// ── Mail: the app's own built-in demo mailbox
const demoAcct = await win
  .evaluate(() => window.workspace.mail.accounts.addDemo())
  .catch((e) => ({ err: String(e) }))
say('mail addDemo:', demoAcct)

if (demoAcct && demoAcct.id) {
  const folders = await win
    .evaluate((id) => window.workspace.mail.folders(id), demoAcct.id)
    .catch((e) => String(e))
  say('mail folders:', folders)
  const msgs = await win
    .evaluate((id) => window.workspace.mail.messages(id, 'INBOX', {}), demoAcct.id)
    .catch((e) => String(e))
  say('inbox messages:', Array.isArray(msgs) ? msgs.length : msgs)
  if (Array.isArray(msgs) && msgs[0]) say('  first subject:', msgs[0].subject ?? '(none)')
}

// ── Calendar: a real ics source
const src = await win
  .evaluate((url) => window.workspace.calendar.add({ kind: 'ics', url, displayName: 'Harbour Terminal' }), ics.url)
  .catch((e) => ({ err: String(e) }))
say('calendar add:', src)

const from = Date.now() - 7 * 86400000
const to = Date.now() + 21 * 86400000
const events = await win
  .evaluate(([f, t]) => window.workspace.calendar.events(f, t), [from, to])
  .catch((e) => String(e))
say('calendar events:', Array.isArray(events) ? events.length : events)
if (Array.isArray(events) && events[0]) say('  first event:', events[0].title ?? events[0].summary ?? '(untitled)')

// ── Knowledge: the backlink graph
const stubs = await win.evaluate(() => window.workspace.links.stubs()).catch((e) => String(e))
say('knowledge stubs:', Array.isArray(stubs) ? stubs.length : stubs)

// The graph is built by the workspace indexer, which the app kicks off after a
// folder is opened — nothing had triggered it, which is why this was empty.
await win.evaluate(() => window.workspace.search.start()).catch((e) => say('search.start:', String(e)))
for (let i = 0; i < 12; i++) {
  const st = await win.evaluate(() => window.workspace.search.indexStatus()).catch((e) => String(e))
  say(`  index +${i}s`, st)
  if (st && st.done > 0 && !st.running) break
  await win.waitForTimeout(1000)
}
say('workspace root the app sees:', await win.evaluate(() => window.workspace.fs.readDir('/tmp/wos-demo/Notes')).then(r => Array.isArray(r) ? r.length + ' notes readable' : r).catch(e => String(e)))

// Stubs are BROKEN links; all the seeded notes resolve, so 0 is correct. What
// the Knowledge panel actually shows is the backlink graph for the open file.
const note = path.join(WS, 'Notes', 'Quarterly Review.md')
say('backlinks:', await win.evaluate((f) => window.workspace.links.backlinks(f), note).catch((e) => String(e)))
say('outgoing:', await win.evaluate((f) => window.workspace.links.outgoing(f), note).catch((e) => String(e)))

await app.close().catch(() => {})
await ics.close()
clearTimeout(timer)
say('done')
