import { describe, it, expect } from 'vitest'
import { LokHost, LokHostError } from './lokHost'

// These unit-test the send()/exit/dispose reject paths WITHOUT LibreOffice.
// We point the host binary at a harmless long-lived process (`cat`, which reads
// stdin forever and never answers) so the real ChildProcess plumbing runs — the
// stdin pipe, the 'exit' handler, the pending map — but no command ever resolves.
// That lets us prove the failure classification (the "kills the 20s hang" fix)
// against real streams, not mocks. The sidecar-kill e2e (S-stability) proves the
// same against the REAL engine; this covers the branch cheaply/deterministically.
function fakeHost(): LokHost {
  return new LokHost({ hostBin: '/bin/cat', installPath: '/tmp/', fundamentalrc: '/tmp/fundamentalrc' })
}

// send() is private; exercise it through the public ping() which calls it.
function sendViaPing(h: LokHost): Promise<unknown> {
  return (h as unknown as { send: (c: string) => Promise<unknown> }).send('ping')
}

function sendCmd(h: LokHost, cmd: string): Promise<unknown> {
  return (h as unknown as { send: (c: string) => Promise<unknown> }).send(cmd)
}

describe('LokHost failure classification', () => {
  it('rejects ALL in-flight calls with a classified error when the process exits', async () => {
    const h = fakeHost()
    const a = sendViaPing(h)
    const b = sendViaPing(h)
    // Kill the child — 'cat' dies, the host's 'exit' handler must fail both.
    ;(h as unknown as { proc: { kill: (s: string) => void } | null }).proc?.kill('SIGKILL')
    const [ra, rb] = await Promise.allSettled([a, b])
    expect(ra.status).toBe('rejected')
    expect(rb.status).toBe('rejected')
    for (const r of [ra, rb] as PromiseRejectedResult[]) {
      expect(r.reason).toBeInstanceOf(LokHostError)
      expect((r.reason as LokHostError).reason).toBe('exit')
    }
  })

  it('fails fast (not-running) on a send() after the host is known dead', async () => {
    const h = fakeHost()
    ;(h as unknown as { proc: { kill: (s: string) => void } | null }).proc?.kill('SIGKILL')
    // Give the 'exit' event a tick to flip the dead flag.
    await new Promise((r) => setTimeout(r, 50))
    await expect(sendViaPing(h)).rejects.toMatchObject({ reason: 'not-running' })
  })

  it('rejects in-flight calls with reason "disposed" on dispose()', async () => {
    const h = fakeHost()
    const p = sendViaPing(h)
    h.dispose()
    await expect(p).rejects.toMatchObject({ reason: 'disposed' })
  })

  it('dispose() is idempotent (a second call is a no-op, no throw)', () => {
    const h = fakeHost()
    h.dispose()
    expect(() => h.dispose()).not.toThrow()
  })

  it('rejects with reason "write" when stdin is not writable', async () => {
    const h = fakeHost()
    // Destroy stdin so the write in send() takes the throw path, then call send
    // SYNCHRONOUSLY (before the async 'error' event loops and flips the dead
    // flag) so we hit the per-call write-failure branch, not the fast dead guard.
    const proc = (h as unknown as { proc: { stdin: { destroy: () => void } } | null }).proc
    proc?.stdin.destroy()
    const p = sendViaPing(h) // no await gap — the stdin 'error' hasn't fired yet
    await expect(p).rejects.toMatchObject({ reason: 'write' })
    h.dispose()
  })
})

/*
 * The protocol is newline-framed (std::getline in the C++ host), so a command
 * carrying a newline would inject a second attacker-controlled line — the
 * arbitrary-file-write finding. send() refuses frame-breakers at the boundary,
 * while still allowing the tab that `openopts` uses as a field separator.
 */
describe('LokHost.send protocol-injection guard', () => {
  it('rejects a command containing a newline', async () => {
    const h = fakeHost()
    await expect(sendCmd(h, 'open /tmp/x\n0 new scalc /tmp/evil/f')).rejects.toMatchObject({ reason: 'bad-command' })
    h.dispose()
  })
  it('rejects a carriage return and a null byte', async () => {
    const h = fakeHost()
    await expect(sendCmd(h, 'open a\rb')).rejects.toMatchObject({ reason: 'bad-command' })
    await expect(sendCmd(h, 'open a\0b')).rejects.toMatchObject({ reason: 'bad-command' })
    h.dispose()
  })
  it('allows a tab (the openopts field separator)', async () => {
    const h = fakeHost()
    // 'cat' never answers, so this times out rather than resolving — but it must
    // NOT be rejected with bad-command. Assert it does not reject synchronously.
    const p = sendCmd(h, 'openopts 59,34,76,1,,0,false,true\t/tmp/a.csv')
    const settled = await Promise.race([p.then(() => 'resolved', (e) => (e as { reason?: string }).reason ?? 'other'), new Promise((r) => setTimeout(() => r('pending'), 150))])
    expect(settled).not.toBe('bad-command')
    h.dispose()
  })
})
