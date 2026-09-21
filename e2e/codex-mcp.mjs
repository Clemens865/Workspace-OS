// Live App Server connector isolation/auth-env proof. No real connector credentials.
import { build } from 'esbuild'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
const root = path.resolve(import.meta.dirname, '..')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-codex-mcp-'))
const server = path.join(temp, 'server.cjs'), bundle = path.join(temp, 'session.cjs')
fs.writeFileSync(server, `const rl = require('readline').createInterface({input:process.stdin});
rl.on('line', line => { const m = JSON.parse(line); if (m.id == null) return;
let result = {};
if (m.method === 'initialize') result = {protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'wos-proof',version:'1'}};
if (m.method === 'tools/list') result = {tools:[{name:'read_codeword',description:'Read the connector test codeword',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}}]};
if (m.method === 'tools/call') result = {content:[{type:'text',text:process.env.WOS_PROOF_VALUE || 'MISSING'}]};
process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n'); });`)
await build({ entryPoints: [path.join(root, 'src/main/agent/providers/codexSession.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const { launchCodexSession } = createRequire(import.meta.url)(bundle)
let output = '', called = false, metadata
let complete
const done = new Promise((resolve) => { complete = resolve })
await launchCodexSession({ runId: 'proof-mcp', cwd: temp, prompt: 'Call the wos_proof MCP connector read_codeword tool. Return its codeword. Do not read files or environment variables with shell tools.', instructions: 'Use the provided read-only MCP tool.', safeMode: true, env: { ...process.env, WOS_PROOF_VALUE: 'OTTER_CONNECTOR_71' }, connectors: { mcpServers: { wos_proof: { command: process.execPath, args: [server], env: { WOS_PROOF_VALUE: '${WOS_PROOF_VALUE}' } } } }, idleTimeoutMs: 45000, sink: { output: t => { output += t }, meta: m => { metadata = m }, activity: a => { if (a.tool === 'wos_proof.read_codeword') called = true }, artifacts() {}, artifact() {}, done() {} }, onQuestion() { throw new Error('An unattended read-only connector should not require user input') }, onFinish: complete })
const code = await done
assert.equal(code, 0, output.slice(-800))
assert.ok(called && output.includes('OTTER_CONNECTOR_71'), output.slice(-800))
assert.ok(metadata?.inputTokens > 0)
console.log('PASS live MCP tool call, environment forwarding, unattended read policy, and usage')
