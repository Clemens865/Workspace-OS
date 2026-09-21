import { describe, it, expect } from 'vitest'
import net from 'net'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'

/** The CLI forwards the run's identity token verbatim, and omits it when unset. */

const CLI = path.join(__dirname, 'action-cli.cjs')

function withStubSocket(fn: (sock: string, requests: unknown[]) => Promise<void>): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cli-'))
  const sock = path.join(dir, 's.sock')
  const requests: unknown[] = []
  const server = net.createServer((c) => {
    let buf = ''
    c.setEncoding('utf-8')
    c.on('data', (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl === -1) return
      requests.push(JSON.parse(buf.slice(0, nl)))
      c.write(JSON.stringify({ ok: true }) + '\n')
      c.end()
    })
  })
  return new Promise((resolve, reject) => {
    server.listen(sock, async () => {
      try {
        await fn(sock, requests)
        resolve()
      } catch (e) {
        reject(e)
      } finally {
        server.close()
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  })
}

function run(args: string[], env: Record<string, string | undefined>): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } })
    child.on('close', (code) => resolve(code ?? -1))
  })
}

describe('wos-action CLI — run identity', () => {
  it('forwards WOS_AGENT_TOKEN in the request', async () => {
    await withStubSocket(async (sock, requests) => {
      const code = await run(['run', 'browser.map'], { WOS_AGENT_SOCK: sock, WOS_AGENT_TOKEN: 'tok-123' })
      expect(code).toBe(0)
      expect(requests[0]).toEqual({ cmd: 'run', actionId: 'browser.map', token: 'tok-123' })
    })
  })

  it('sends no token field when the env is unset', async () => {
    await withStubSocket(async (sock, requests) => {
      await run(['list'], { WOS_AGENT_SOCK: sock, WOS_AGENT_TOKEN: undefined })
      expect(requests[0]).toEqual({ cmd: 'list' })
    })
  })
})
