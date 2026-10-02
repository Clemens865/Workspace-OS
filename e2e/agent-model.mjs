// e2e: the agent model picker reaches the real CLI. Three runs, each a
// one-line prompt on the cheapest tier: Settings default → haiku; a per-run
// pick → sonnet (beats the default); a fresh load with the setting persisted →
// haiku again (the default is pushed to main at startup). The stream-json result
// names the model that answered, and the run trailer carries it.
import { launch, poll, makeReporter } from './office/_harness.mjs'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const R = makeReporter('agent model pick')
const { app, win } = await launch()
const runWith = (model, prompt = 'Reply with exactly the single word: PONG', mode = 'safe') => win.evaluate(async ([model, prompt, mode]) => {
  let buf = ''
  const off = window.workspace.agent.onOutput((_r, c) => { buf += c })
  const done = new Promise((res) => window.workspace.agent.onDone(() => res()))
  await window.workspace.agent.run(`e2e-model-${Date.now()}`, prompt, [], null, mode, null, undefined, model)
  await Promise.race([done, new Promise((r) => setTimeout(r, 90000))])
  off?.()
  return buf
}, [model, prompt, mode])
const used = (out) => (out.match(/claude-[a-z0-9-]+/g) ?? []).filter((m, i, a) => a.indexOf(m) === i).join(',')

try {
  await win.evaluate(() => window.workspace.agent.setDefaultModel('haiku'))
  const a = await runWith(null)
  R.ok(/PONG/i.test(a), 'a run answers')
  R.ok(/claude-haiku/.test(a), `Settings default (haiku) is the model that answered (${used(a)})`)
  const b = await runWith('sonnet')
  R.ok(/claude-sonnet/.test(b), `a per-run pick (sonnet) beats the default (${used(b)})`)
  // Persisted setting → pushed to main on load.
  await win.evaluate(() => { const K = 'workspace-os:settings'; let cur = {}; try { cur = JSON.parse(localStorage.getItem(K) || '{}') } catch {}; localStorage.setItem(K, JSON.stringify({ ...cur, agentModel: 'haiku' })) })
  await win.reload(); await win.waitForSelector('#root', { timeout: 20000 }); await win.waitForTimeout(1500)
  for (let i = 0; i < 20 && await win.locator('[class*=splash]').first().isVisible().catch(() => false); i++) { await win.keyboard.press('Enter'); await win.waitForTimeout(300) }
  const c = await runWith(null)
  R.ok(/claude-haiku/.test(c), `after a reload the persisted setting still applies (${used(c)})`)
  // ── Codex through the same door ──
  const d = await runWith('codex:')
  R.ok(/PONG/i.test(d) && /codex[^\n]*· [\d,]+ in \/ [\d,]+ out/.test(d), `Codex (default model) answers and the trailer names it (${(d.match(/codex[^\n]*· [^\n]*/) ?? [''])[0].trim()})`)
  // Resume: two runs in one conversation keep the thread.
  const convo = `e2e-codex-convo-${Date.now()}`
  const e1 = await win.evaluate(async ([convo]) => {
    let buf = ''; const off = window.workspace.agent.onOutput((_r, c) => { buf += c }); const done = new Promise((res) => window.workspace.agent.onDone(() => res()))
    await window.workspace.agent.run(`e2e-codex-a-${Date.now()}`, 'Remember the codeword WALRUS. Reply with exactly OK.', [], null, 'safe', null, convo, 'codex:')
    await Promise.race([done, new Promise((r) => setTimeout(r, 90000))]); off?.(); return buf
  }, [convo])
  const e2 = await win.evaluate(async ([convo]) => {
    let buf = ''; const off = window.workspace.agent.onOutput((_r, c) => { buf += c }); const done = new Promise((res) => window.workspace.agent.onDone(() => res()))
    await window.workspace.agent.run(`e2e-codex-b-${Date.now()}`, 'What was the codeword? Reply with just the word.', [], null, 'safe', null, convo, 'codex:')
    await Promise.race([done, new Promise((r) => setTimeout(r, 90000))]); off?.(); return buf
  }, [convo])
  R.ok(/OK/.test(e1) && /WALRUS/.test(e2), `Codex resumes the conversation thread (${(e2.match(/[A-Z]{4,}/) ?? ['?'])[0]})`)
  // Full mode: the wos bridge is reachable from inside Codex's sandbox.
  const f = await runWith('codex:', 'Run the shell command `wos-action list` and reply with exactly the word REACHED if it printed anything, or FAILED with the error otherwise.', 'full')
  R.ok(/REACHED/.test(f), `Codex in full mode reaches the app bridge via wos-action (${(f.match(/REACHED|FAILED[^\n]*/) ?? ['?'])[0].slice(0, 80)})`)
  // Safe mode = Codex's read-only sandbox. The bridge is the app's own socket;
  // if the sandbox blocks it, safe-mode Codex agents can read but not act.
  const g = await runWith('codex:', 'Run the shell command `wos-action list` and reply with exactly the word REACHED if it printed anything, or FAILED with the error otherwise.', 'safe')
  R.ok(/REACHED/.test(g), `Codex in safe mode reaches the app bridge via wos-action (${(g.match(/REACHED|FAILED[^\n]*/) ?? ['?'])[0].slice(0, 80)})`)
  // Connectors: the enabled MCP servers reach Codex through the per-run profile.
  // The filesystem connector needs no secret; the answer can only come through
  // one of its tools.
  const fsmod = await import('node:fs')
  fsmod.writeFileSync('/tmp/wos-test/codex-mcp-fixture.txt', 'The codeword is PELICAN.\n')
  const wasOn = await win.evaluate(async () => { const l = JSON.stringify(await window.workspace.mcp.listConnectors()); return /"id":"filesystem"[^}]*"enabled":true/.test(l) })
  await win.evaluate(() => window.workspace.mcp.enable('filesystem'))
  const h = await win.evaluate(async () => {
    let buf = ''; const acts = []
    const off = window.workspace.agent.onOutput((_r, c) => { buf += c })
    const offA = window.workspace.agent.onActivity((_r, a) => { acts.push(a.tool) })
    const done = new Promise((res) => window.workspace.agent.onDone(() => res()))
    await window.workspace.agent.run(`e2e-codex-mcp-${Date.now()}`, 'Use the filesystem MCP server\'s read_text_file tool to read the file "codex-mcp-fixture.txt" in the workspace folder and reply with only the codeword it contains.', [], null, 'full', null, undefined, 'codex:')
    await Promise.race([done, new Promise((r) => setTimeout(r, 120000))]); off?.(); offA?.()
    return { out: buf, acts }
  })
  if (!wasOn) await win.evaluate(() => window.workspace.mcp.disable('filesystem'))
  R.ok(/PELICAN/.test(h.out) && h.acts.some((t) => /^filesystem\./.test(t)), `Codex reaches an enabled connector through the per-run profile (tools: ${h.acts.filter((t) => t.includes('.')).join(',') || 'none'}; ${/PELICAN/.test(h.out) ? 'codeword found' : 'no codeword'})`)
} catch (e) {
  R.ok(false, `unexpected: ${e.message}`)
} finally {
  await app.close().catch(() => {})
}
process.exit(R.done() ? 0 : 1)
