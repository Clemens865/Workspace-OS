// The Drive surface, without a Google account.
//
// Nothing here can prove a real fetch works — that needs a client id and a
// consent click. What it CAN prove is that every channel is registered, that
// the unconnected state is reported honestly, and that each operation refuses
// with a sentence a person can act on rather than crashing the surface. Those
// are the paths a user hits first, and the ones a mock would never exercise.
import { _electron as electron } from 'playwright'
import path from 'path'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'
const ROOT = process.cwd()
const app = await electron.launch({
  args: [path.join(ROOT, 'out/main/index.js'), '--user-data-dir=/tmp/wos-drive'],
  cwd: ROOT, env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-demo' },
})
const win = await app.firstWindow({ timeout: 30000 })
await win.waitForSelector('#root', { timeout: 30000 })
await win.waitForTimeout(2500)
console.log(JSON.stringify(await win.evaluate(async () => {
  const out = {}
  out.connection = await window.workspace.drive.connection()
  const call = async (name, fn) => {
    try { out[name] = await fn() } catch (e) { out[name] = `THREW ${e.message}` }
  }
  await call('list', () => window.workspace.drive.list())
  await call('search', () => window.workspace.drive.search('report'))
  await call('open', () => window.workspace.drive.open('abc123'))
  await call('save', () => window.workspace.drive.save('abc123', 'Drive/x.docx'))
  return out
}), null, 1))
await app.close()
