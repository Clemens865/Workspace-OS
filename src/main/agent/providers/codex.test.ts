import { describe, expect, it } from 'vitest'
import { codexArgs, parseCodexLine, tomlString } from './codex'

describe('codex provider — arguments', () => {
  it('places profiles before resume and reapplies the requested sandbox', () => {
    const a = codexArgs({ cwd: '/ws', safeMode: true, systemPrompt: null, resumeId: '00000000-0000-0000-0000-000000000001', profile: 'wos-run-test' })
    expect(a.slice(0, 4)).toEqual(['-p', 'wos-run-test', 'exec', 'resume'])
    expect(a).toContain('sandbox_mode="read-only"')
    expect(a).toContain('sandbox_workspace_write.network_access=false')
    expect(() => codexArgs({ cwd: '/ws', safeMode: true, systemPrompt: null, model: '--bad' })).toThrow()
  })
  it('runs exec with the prompt on stdin, approvals off, and the sandbox for the mode', () => {
    const a = codexArgs({ cwd: '/ws', safeMode: true, systemPrompt: 'Be brief.' })
    expect(a[0]).toBe('exec')
    expect(a.at(-1)).toBe('-')
    expect(a).toContain('--json')
    expect(a.slice(a.indexOf('-s'), a.indexOf('-s') + 2)).toEqual(['-s', 'read-only'])
    expect(a).toContain('approval_policy="never"')
    expect(a).toContain('developer_instructions="Be brief."')
    expect(a).not.toContain('sandbox_workspace_write.network_access=true')
  })

  it('full mode gets a writable sandbox with network, and a model when picked', () => {
    const a = codexArgs({ cwd: '/ws', safeMode: false, systemPrompt: null, model: 'gpt-5-codex' })
    expect(a.slice(a.indexOf('-s'), a.indexOf('-s') + 2)).toEqual(['-s', 'workspace-write'])
    expect(a).toContain('sandbox_workspace_write.network_access=true')
    expect(a.slice(a.indexOf('-m'), a.indexOf('-m') + 2)).toEqual(['-m', 'gpt-5-codex'])
    expect(a.some((x) => x.startsWith('developer_instructions='))).toBe(false)
  })

  it('resumes a thread without re-sending instructions or the cwd', () => {
    const a = codexArgs({ cwd: '/ws', safeMode: false, systemPrompt: 'x', resumeId: '01a073f8-ded7-7a43-b01f-2e1660d9b937' })
    expect(a.slice(0, 3)).toEqual(['exec', 'resume', '01a073f8-ded7-7a43-b01f-2e1660d9b937'])
    expect(a.some((x) => x.startsWith('developer_instructions='))).toBe(false)
    expect(a).not.toContain('-C')
  })

  it('escapes TOML strings', () => {
    expect(tomlString('a "b"\nc\\d')).toBe('"a \\"b\\"\\nc\\\\d"')
  })
})

describe('codex provider — event stream', () => {
  it('reads the thread id, messages, tool activity and the usage trailer', () => {
    expect(parseCodexLine('{"type":"thread.started","thread_id":"01a073f6-3645-7a62-8948-0950f897b3ab"}')).toEqual({ sessionId: '01a073f6-3645-7a62-8948-0950f897b3ab' })
    expect(parseCodexLine('{"type":"turn.started"}')).toBeNull()
    expect(parseCodexLine('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"PONG"}}')).toEqual({ output: 'PONG\n' })
    const act = parseCodexLine('{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"/bin/zsh -lc ls","aggregated_output":"","exit_code":null,"status":"in_progress"}}')
    expect(act?.activity?.tool).toBe('Bash')
    expect(act?.activity?.chip ?? act?.activity?.label).toMatch(/ls/)
    const done = parseCodexLine('{"type":"turn.completed","usage":{"input_tokens":19097,"cached_input_tokens":12928,"output_tokens":6}}', 'codex gpt-5')
    expect(done?.meta).toMatchObject({ turns: 1, model: 'codex gpt-5' })
    expect(done?.output).toMatch(/codex gpt-5 · 19,097 in \/ 6 out/)
  })

  it('surfaces errors and passes plain text through', () => {
    expect(parseCodexLine('{"type":"error","message":"rate limited"}')?.output).toMatch(/\[error\] rate limited/)
    expect(parseCodexLine('Reading additional input from stdin...')).toEqual({ output: 'Reading additional input from stdin...\n' })
    expect(parseCodexLine('')).toBeNull()
  })
})

// ── connectors via a per-run profile, live model list, stderr noise ─────────
import fs from 'fs'
import os from 'os'
import path from 'path'
import { codexMcpProfileToml, isCodexNoise, listCodexModels, writeCodexMcpProfile } from './codex'

describe('codexMcpProfileToml', () => {
  it('rewrites a stdio server with forwarded secret env vars and pre-approved tools', () => {
    const toml = codexMcpProfileToml({ mcpServers: { github: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: '${GITHUB_PERSONAL_ACCESS_TOKEN}' } } } })
    expect(toml).toContain('[mcp_servers.github]')
    expect(toml).toContain('command = "npx"')
    expect(toml).toContain('args = ["-y", "@modelcontextprotocol/server-github"]')
    expect(toml).toContain('env_vars = ["GITHUB_PERSONAL_ACCESS_TOKEN"]')
    expect(toml).toContain('default_tools_approval_mode = "approve"')
    expect(toml).not.toContain('${') // a reference, never a value, and no Claude-isms
  })
  it('carries the run-wide settings a layered profile would otherwise reset', () => {
    const safe = codexMcpProfileToml({ mcpServers: { a: { command: 'x' } } }, {}, { safeMode: true })
    expect(safe).toContain('approval_policy = "never"')
    expect(safe).toMatch(/\[shell_environment_policy\]\ninherit = "all"/)
    expect(safe).not.toContain('network_access')
    const full = codexMcpProfileToml({ mcpServers: { a: { command: 'x' } } }, {}, { safeMode: false })
    expect(full).toMatch(/\[sandbox_workspace_write\]\nnetwork_access = true/)
  })
  it('rewrites a remote server as url + bearer env var, and drops one without a minted bearer', () => {
    const cfg = { mcpServers: { linear: { type: 'http', url: 'https://mcp.linear.app/mcp', headersHelper: '/x/wos-mcp-token linear' }, asana: { type: 'http', url: 'https://mcp.asana.com/sse', headersHelper: '/x/wos-mcp-token asana' } } }
    const toml = codexMcpProfileToml(cfg, { linear: 'WOS_MCP_BEARER_LINEAR' })
    expect(toml).toContain('[mcp_servers.linear]')
    expect(toml).toContain('url = "https://mcp.linear.app/mcp"')
    expect(toml).toContain('bearer_token_env_var = "WOS_MCP_BEARER_LINEAR"')
    expect(toml).not.toContain('headersHelper')
    expect(toml).not.toContain('[mcp_servers.asana]')
  })
  it('skips ids that are not TOML-safe and escapes strings', () => {
    const toml = codexMcpProfileToml({ mcpServers: { 'bad id': { command: 'x' }, fs: { command: 'node', args: ['/tmp/a "b"/srv.mjs'] } } })
    expect(toml).not.toContain('bad id')
    expect(toml).toContain('args = ["/tmp/a \\"b\\"/srv.mjs"]')
  })
})

describe('writeCodexMcpProfile', () => {
  it('writes a 0600 profile under the Codex home, names it by run, and cleans up', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    const prof = writeCodexMcpProfile({ mcpServers: { filesystem: { command: 'npx', args: ['-y', 'srv', '/ws'] } } }, 'e2e run/1', {}, { safeMode: true }, home)
    expect(prof).not.toBeNull()
    expect(prof!.name).toBe('wos-run-e2e-run-1')
    expect(prof!.path).toBe(path.join(home, 'wos-run-e2e-run-1.config.toml'))
    expect(fs.statSync(prof!.path).mode & 0o777).toBe(0o600)
    expect(fs.readFileSync(prof!.path, 'utf-8')).toContain('[mcp_servers.filesystem]')
    prof!.cleanup()
    expect(fs.existsSync(prof!.path)).toBe(false)
  })
  it('returns null when nothing is wireable (no profile arg, no empty file)', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    expect(writeCodexMcpProfile({ mcpServers: {} }, 'r', {}, { safeMode: true }, home)).toBeNull()
    expect(fs.readdirSync(home)).toEqual([])
  })
  it('sweeps stale profiles left by a crash', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    const stale = path.join(home, 'wos-run-old.config.toml')
    fs.writeFileSync(stale, '')
    const old = new Date(Date.now() - 7 * 60 * 60 * 1000)
    fs.utimesSync(stale, old, old)
    const prof = writeCodexMcpProfile({ mcpServers: { a: { command: 'x' } } }, 'new', {}, { safeMode: true }, home)!
    expect(fs.existsSync(stale)).toBe(false)
    prof.cleanup()
  })
  it('a profile rides argv as -p <name>', () => {
    const args = codexArgs({ cwd: '/w', safeMode: true, systemPrompt: null, profile: 'wos-run-x' })
    expect(args).toContain('-p'); expect(args[args.indexOf('-p') + 1]).toBe('wos-run-x')
    const resumed = codexArgs({ cwd: '/w', safeMode: true, systemPrompt: null, resumeId: '9f2a1c1e-1111-4222-8333-444455556666', profile: 'wos-run-x' })
    expect(resumed).toContain('-p')
  })
})

describe('listCodexModels', () => {
  it('reads the install\'s own cache: listed models in priority order, hidden ones dropped, default first', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    fs.writeFileSync(path.join(home, 'config.toml'), 'model = "gpt-6-astra"\nmodel_reasoning_effort = "medium"\n')
    fs.writeFileSync(path.join(home, 'models_cache.json'), JSON.stringify({ models: [
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol', description: 'Reliable', visibility: 'list', priority: 6 },
      { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', description: 'Most capable', visibility: 'list', priority: 1 },
      { slug: 'codex-auto-review', display_name: 'Auto Review', description: 'internal', visibility: 'hide', priority: 43 },
      { slug: 'bad slug!', display_name: 'x', visibility: 'list', priority: 0 },
    ] }))
    const list = listCodexModels(home)
    expect(list.map((m) => m.id)).toEqual(['codex:', 'codex:gpt-6-astra', 'codex:gpt-5.6-sol'])
    expect(list[0].hint).toContain('gpt-6-astra')
    expect(list[1].label).toBe('Codex · GPT-6-Astra')
  })
  it('without a cache offers the default only', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'))
    expect(listCodexModels(home).map((m) => m.id)).toEqual(['codex:'])
  })
})

describe('isCodexNoise', () => {
  it('drops the CLI\'s own tracing but keeps real stderr', () => {
    expect(isCodexNoise('2026-09-06T08:00:00.000Z  WARN codex_models_manager::manager: failed to refresh available models: timeout waiting for child process')).toBe(true)
    expect(isCodexNoise('2026-09-06T08:00:00.000Z  INFO codex_core::config: loaded profile')).toBe(true)
    expect(isCodexNoise('Error: not logged in. Run `codex login`.')).toBe(false)
    expect(parseCodexLine('2026-09-06T08:00:00Z WARN codex_models_manager::manager: failed to refresh available models: timeout')).toBeNull()
    expect(parseCodexLine('plain text from the run')).toEqual({ output: 'plain text from the run\n' })
  })
})
