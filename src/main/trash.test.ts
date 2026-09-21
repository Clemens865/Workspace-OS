import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import fsp from 'fs/promises'
import os from 'os'
import path from 'path'
import { TrashStore } from './trash'

describe('TrashStore', () => {
  let root: string
  let store: TrashStore

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-trash-'))
    store = new TrashStore(() => root)
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  const file = (name: string) => path.join(root, name)
  const write = (name: string, content: string) => fs.writeFileSync(file(name), content)
  const exists = (p: string) => fs.existsSync(p)

  it('moves a deleted file into trash and records it', async () => {
    write('doc.txt', 'hello')
    const entry = await store.moveToTrash(file('doc.txt'), 'delete', false, true)

    expect(exists(file('doc.txt'))).toBe(false)
    expect(exists(entry.storedPath)).toBe(true)
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0].originalName).toBe('doc.txt')
    expect(list[0].op).toBe('delete')
  })

  it('restores a deleted file to its original path', async () => {
    write('doc.txt', 'hello')
    const entry = await store.moveToTrash(file('doc.txt'), 'delete', false, true)

    await store.restore(entry.id)

    expect(exists(file('doc.txt'))).toBe(true)
    expect(fs.readFileSync(file('doc.txt'), 'utf-8')).toBe('hello')
    expect(await store.list()).toHaveLength(0)
  })

  it('keeps the original in place when snapshotting an overwrite', async () => {
    write('doc.txt', 'v1')
    const entry = await store.moveToTrash(file('doc.txt'), 'overwrite', false, false)

    // Original remains; a snapshot copy exists in trash.
    expect(exists(file('doc.txt'))).toBe(true)
    expect(fs.readFileSync(entry.storedPath, 'utf-8')).toBe('v1')
  })

  it('restore over an existing occupant is non-destructive both ways', async () => {
    write('doc.txt', 'original')
    const entry = await store.moveToTrash(file('doc.txt'), 'delete', false, true)

    // Something new takes the original path before we restore.
    write('doc.txt', 'newer')

    await store.restore(entry.id)

    // Original content is back...
    expect(fs.readFileSync(file('doc.txt'), 'utf-8')).toBe('original')
    // ...and the occupant we displaced was itself trashed, not lost.
    const list = await store.list()
    expect(list).toHaveLength(1)
    const snapshot = fs.readFileSync(list[0].storedPath, 'utf-8')
    expect(snapshot).toBe('newer')
  })

  it('moves a deleted directory into trash recursively', async () => {
    fs.mkdirSync(file('folder'))
    fs.writeFileSync(path.join(file('folder'), 'inner.txt'), 'deep')
    const entry = await store.moveToTrash(file('folder'), 'delete', true, true)

    expect(exists(file('folder'))).toBe(false)
    expect(exists(path.join(entry.storedPath, 'inner.txt'))).toBe(true)

    await store.restore(entry.id)
    expect(fs.readFileSync(path.join(file('folder'), 'inner.txt'), 'utf-8')).toBe('deep')
  })

  it('permanently deletes a single entry', async () => {
    write('doc.txt', 'x')
    const entry = await store.moveToTrash(file('doc.txt'), 'delete', false, true)

    await store.deleteEntry(entry.id)

    expect(exists(entry.storedPath)).toBe(false)
    expect(await store.list()).toHaveLength(0)
  })

  it('empties all entries', async () => {
    write('a.txt', 'a')
    write('b.txt', 'b')
    await store.moveToTrash(file('a.txt'), 'delete', false, true)
    await store.moveToTrash(file('b.txt'), 'delete', false, true)

    await store.empty()

    expect(await store.list()).toHaveLength(0)
    const trashDir = path.join(root, '.workspace-os', 'trash')
    const remaining = await fsp.readdir(trashDir)
    // Only the manifest should remain.
    expect(remaining.filter((n) => !n.endsWith('.json'))).toHaveLength(0)
  })

  it('throws when restoring an unknown id', async () => {
    await expect(store.restore('deadbeefdeadbeefdeadbeef')).rejects.toThrow()
  })

  it('refuses destructive ops when no workspace root is set', async () => {
    const rootless = new TrashStore(() => null)
    // Listing is harmless (empty), but anything that touches disk must refuse.
    await expect(rootless.moveToTrash('/tmp/x', 'delete', false, true)).rejects.toThrow(
      'No workspace folder is open'
    )
  })
})
