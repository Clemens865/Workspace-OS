/**
 * WOS-010: filing an IDEA must come back with a usable analysis.
 *
 * This is the one check the unit tests cannot make. They pin the two causes —
 * a system prompt that demanded `severity`/`steps` while the user prompt
 * forbade them, and a per-attempt rather than overall deadline — but only a real
 * run answers "does an idea analysis actually return a report now".
 *
 * It calls a real model, so it is deliberately NOT part of any suite: it costs a
 * model call and can take minutes. Run it deliberately:
 *
 *   npm run e2e:idea            (after the usual rebuild:electron)
 *
 * It files into a THROWAWAY repo in /tmp, never the project's own IDEAS.md.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { killAll } from './office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const FAKE_REPO = '/tmp/wos-idearepo'
const FAKE_LOG = path.join(FAKE_REPO, 'docs', 'IDEAS.md')

let failures = 0
const check = (name, cond, detail) => {
  if (cond) console.log(`  ✓ ${name}`)
  else {
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
    failures++
  }
}

fs.rmSync(FAKE_REPO, { recursive: true, force: true })
fs.mkdirSync(path.join(FAKE_REPO, 'docs'), { recursive: true })
fs.writeFileSync(path.join(FAKE_REPO, 'package.json'), JSON.stringify({ name: 'workspace-os' }))
// Symlink the REAL source in. Without it the analyzer has a repo path but no
// code, so "what already exists" is guesswork and it can name no files — which
// is most of what makes an idea assessment worth having. Writes still land in
// /tmp, so the project's own IDEAS.md is never touched.
fs.symlinkSync(path.join(root, 'src'), path.join(FAKE_REPO, 'src'), 'dir')

await killAll()
const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' },
})
const win = await app.firstWindow({ timeout: 20000 })
await win.waitForSelector('#root', { timeout: 20000 })
await win.waitForTimeout(600)

try {
  const set = await win.evaluate(async (dir) => window.workspace.bugs.setRepo(dir), FAKE_REPO)
  check('the throwaway repo was accepted', set?.ok === true)

  const IDEA =
    'It would be useful if the mail composer could pull a number straight out of an open spreadsheet, ' +
    'so a figure quoted in an email always matches the sheet it came from.'

  console.log('\n  Running a real idea analysis — this legitimately takes a while…')
  const started = Date.now()
  const res = await win.evaluate(
    async (text) => window.workspace.bugs.analyze(text, 'mail', null, 'idea'),
    IDEA,
  )
  const elapsedMs = Date.now() - started
  console.log(`  …returned after ${Math.round(elapsedMs / 1000)}s\n`)

  // THE assertion this bug is about.
  check('an idea analysis returns instead of timing out (WOS-010)', res?.ok === true, res?.error ?? 'no error given')

  const a = res?.analysis
  if (a) {
    check('it produced a title', typeof a.title === 'string' && a.title.trim().length > 0, a.title)
    check('it said what already exists', typeof a.whatHappened === 'string' && a.whatHappened.trim().length > 0)
    check('it said what this would add', typeof a.expected === 'string' && a.expected.trim().length > 0)
    check(
      'it gave a roadmap verdict and an objection — the part worth keeping',
      typeof a.verdict === 'string' && a.verdict.trim().length > 0,
      a.verdict ? `"${a.verdict.slice(0, 100)}…"` : 'no verdict returned',
    )
    check('it assigned no repro steps — an idea is not a defect', Array.isArray(a.steps) && a.steps.length === 0,
      JSON.stringify(a.steps))
    check(
      'it located the work in real files (it actually read the repo)',
      Array.isArray(a.suspects) && a.suspects.length > 0,
      `${a.suspects?.length ?? 0} suspects`,
    )
    console.log(`\n  → "${a.title}"`)
    if (a.verdict) console.log(`  → verdict: ${a.verdict.slice(0, 200)}`)
  }

  // And it must land on disk, shaped as a proposal.
  if (res?.ok) {
    const filed = await win.evaluate(
      async ({ text, analysis }) =>
        window.workspace.bugs.file(text, analysis, await window.workspace.bugs.context('mail', null), 'idea'),
      { text: IDEA, analysis: a },
    )
    check('it filed as an IDEA- entry', typeof filed?.id === 'string' && filed.id.startsWith('IDEA-'), filed?.id)

    const log = fs.existsSync(FAKE_LOG) ? fs.readFileSync(FAKE_LOG, 'utf8') : ''
    check('the idea reached IDEAS.md', log.includes('## IDEA-001 · '))
    check('it is rendered as a proposal, with no severity', !/- \*\*Severity:\*\*/.test(log))
    check('it has no "Steps to reproduce" section', !/Steps to reproduce/.test(log))
    check('it leads with what already exists', log.includes('**What already exists**'))
    check('the user’s own words are preserved verbatim', log.includes(`> ${IDEA}`))
  }
} finally {
  try {
    await app.close()
  } catch {
    /* already gone */
  }
  await killAll()
}

console.log(failures === 0 ? '\nWOS-010 IDEA ANALYSIS PASS' : `\n${failures} check(s) FAILED`)
process.exit(failures === 0 ? 0 : 1)
