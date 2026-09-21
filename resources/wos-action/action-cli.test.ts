import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

/**
 * Black-box test of the `wos-action` CLI: run the real script against a stub
 * unix socket and assert its arg parsing, request shaping, JSON output + exit
 * codes. No app, no Electron — the CLI is pure Node.
 */

const CLI = path.join(__dirname, 'action-cli.cjs')

interface Run { stdout: string; code: number }

function runCli(args: string[], sock: string | undefined): Promise<Run> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (sock) env.WOS_AGENT_SOCK = sock
    else delete env.WOS_AGENT_SOCK
    const child = spawn(process.execPath, [CLI, ...args], { env })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.on('close', (code) => resolve({ stdout, code: code ?? -1 }))
  })
}

describe('wos-action CLI', () => {
  let sockPath: string
  let server: net.Server
  let lastReq: unknown

  beforeEach(() => {
    sockPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cli-')), 's.sock')
    server = net.createServer((sock) => {
      let buf = ''
      sock.setEncoding('utf-8')
      sock.on('data', (c: string) => {
        buf += c
        const nl = buf.indexOf('\n')
        if (nl === -1) return
        lastReq = JSON.parse(buf.slice(0, nl))
        // Reply ok for a known id, error otherwise (mirrors the real bridge).
        const req = lastReq as { cmd: string; actionId?: string }
        const reply =
          req.cmd === 'run' && req.actionId === 'files.new-folder'
            ? { ok: true, result: { created: true } }
            : req.cmd === 'run'
              ? { ok: false, error: 'unknown action' }
              : { ok: true, result: { echoed: req.cmd } }
        sock.write(JSON.stringify(reply) + '\n')
        sock.end()
      })
    })
    server.listen(sockPath)
  })
  afterEach(() => server.close())

  it('sends {cmd:"list"} and prints the reply, exit 0', async () => {
    const { stdout, code } = await runCli(['list'], sockPath)
    expect(lastReq).toEqual({ cmd: 'list' })
    expect(JSON.parse(stdout).ok).toBe(true)
    expect(code).toBe(0)
  })

  it('shapes `run <id> <jsonArgs>` into {cmd,actionId,args}', async () => {
    const { code } = await runCli(['run', 'files.new-folder', '{"name":"X"}'], sockPath)
    expect(lastReq).toEqual({ cmd: 'run', actionId: 'files.new-folder', args: { name: 'X' } })
    expect(code).toBe(0)
  })

  it('exits non-zero when the bridge replies not-ok', async () => {
    const { stdout, code } = await runCli(['run', 'nope'], sockPath)
    expect(JSON.parse(stdout).ok).toBe(false)
    expect(code).toBe(1)
  })

  it('errors (exit 1) on an unknown command without connecting', async () => {
    const { stdout, code } = await runCli(['frobnicate'], sockPath)
    expect(JSON.parse(stdout)).toMatchObject({ ok: false })
    expect(code).toBe(1)
  })

  it('errors on `run` with no id', async () => {
    const { stdout, code } = await runCli(['run'], sockPath)
    expect(JSON.parse(stdout).error).toMatch(/requires an action id/)
    expect(code).toBe(1)
  })

  it('errors on invalid jsonArgs', async () => {
    const { stdout, code } = await runCli(['run', 'files.new-folder', 'not-json'], sockPath)
    expect(JSON.parse(stdout).error).toMatch(/valid JSON/)
    expect(code).toBe(1)
  })

  it('errors when WOS_AGENT_SOCK is absent', async () => {
    const { stdout, code } = await runCli(['list'], undefined)
    expect(JSON.parse(stdout).error).toMatch(/WOS_AGENT_SOCK/)
    expect(code).toBe(1)
  })
})
