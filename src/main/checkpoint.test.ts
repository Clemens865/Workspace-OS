import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { CheckpointStore } from './checkpoint'

describe('CheckpointStore', () => {
  let root: string
  let store: CheckpointStore

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-cp-'))
    store = new CheckpointStore(() => root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const file = (n: string) => path.join(root, n)
  const write = (n: string, c: string) => fs.writeFileSync(file(n), c)
  const read = (n: string) => fs.readFileSync(file(n), 'utf-8')
  const exists = (n: string) => fs.existsSync(file(n))

  it('git is available in this environment', async () => {
    expect(await store.isGitAvailable()).toBe(true)
  })

  it('creates a checkpoint and lists it', async () => {
    write('a.txt', 'one')
    const cp = await store.createCheckpoint('first')
    expect(cp.id).toMatch(/^[a-f0-9]{40}$/)
    const list = await store.list()
    expect(list[0].label).toBe('first')
  })

  it('restores a modified file on rollback', async () => {
    write('doc.txt', 'original')
    const cp = await store.createCheckpoint('before')
    write('doc.txt', 'agent changed this')

    await store.rollbackTo(cp.id)

    expect(read('doc.txt')).toBe('original')
  })

  it('removes agent-created files on rollback', async () => {
    write('doc.txt', 'original')
    const cp = await store.createCheckpoint('before')
    // Agent both modifies an existing file and creates a new one.
    write('doc.txt', 'changed')
    write('agent-new.txt', 'created by agent')

    await store.rollbackTo(cp.id)

    expect(read('doc.txt')).toBe('original')
    expect(exists('agent-new.txt')).toBe(false)
  })

  it('keeps rollback itself undoable via the safety checkpoint', async () => {
    write('doc.txt', 'v1')
    const cp = await store.createCheckpoint('before')
    write('doc.txt', 'v2-from-agent')

    const safety = await store.rollbackTo(cp.id)
    expect(read('doc.txt')).toBe('v1')

    // The pre-rollback state was captured and can be restored.
    await store.rollbackTo(safety.id)
    expect(read('doc.txt')).toBe('v2-from-agent')
  })

  it('returns a unified diff of changes since a checkpoint', async () => {
    write('doc.txt', 'original line\n')
    const cp = await store.createCheckpoint('before')
    write('doc.txt', 'changed line\n')
    write('new.txt', 'brand new\n')

    const diff = await store.diffSince(cp.id)

    expect(diff).toContain('--- a/doc.txt')
    expect(diff).toContain('+++ b/doc.txt')
    expect(diff).toContain('-original line')
    expect(diff).toContain('+changed line')
    // Newly created files appear as additions, not silently missing.
    expect(diff).toContain('+++ b/new.txt')
    expect(diff).toContain('+brand new')
  })

  it('never snapshots the .workspace-os store itself', async () => {
    write('doc.txt', 'x')
    await store.createCheckpoint('cp')
    const diff = await store.diffSince((await store.list())[0].id)
    expect(diff).not.toContain('.workspace-os')
  })

  it('never snapshots secret-bearing files (.env, keys) into the shadow repo', async () => {
    write('doc.txt', 'public')
    write('.env', 'API_KEY=super-secret')
    write('.env.local', 'TOKEN=also-secret')
    write('cert.pem', 'PRIVATE KEY MATERIAL')
    const cp = await store.createCheckpoint('with secrets present')

    write('doc.txt', 'public v2')
    write('.env', 'API_KEY=rotated-secret')
    const diff = await store.diffSince(cp.id)

    expect(diff).toContain('doc.txt') // normal files still tracked
    expect(diff).not.toContain('super-secret')
    expect(diff).not.toContain('rotated-secret')
    expect(diff).not.toContain('.env')
    expect(diff).not.toContain('cert.pem')
  })

  it('refuses to checkpoint when no workspace root is set', async () => {
    const rootless = new CheckpointStore(() => null)
    await expect(rootless.createCheckpoint('x')).rejects.toThrow('No workspace folder is open')
  })
})
