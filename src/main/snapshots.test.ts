import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { SnapshotStore, sanitizeState, SNAPSHOTS_MAX } from './snapshots'

describe('SnapshotStore', () => {
  let dir: string
  let store: SnapshotStore
  const file = (): string => path.join(dir, 'snapshots.json')

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-snap-'))
    store = new SnapshotStore(file)
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const state = (files: string[] = ['/w/a.md']): unknown => ({
    files,
    activeFile: files[0] ?? null,
    sidebarView: 'files',
    sidebarOpen: true,
    terminalOpen: false,
    panel: { filePanel: 260, terminal: 220 },
  })

  it('saves and lists a snapshot for its root', () => {
    const snap = store.create('/w', 'Monday desk', state())
    expect(snap.id).toMatch(/^snap-/)
    const list = store.list('/w')
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Monday desk')
    expect(list[0].state.files).toEqual(['/w/a.md'])
    // Other roots see nothing.
    expect(store.list('/elsewhere')).toHaveLength(0)
  })

  it('re-saving the same name in the same root replaces it', () => {
    store.create('/w', 'desk', state(['/w/a.md']))
    store.create('/w', 'desk', state(['/w/b.md']))
    const list = store.list('/w')
    expect(list).toHaveLength(1)
    expect(list[0].state.files).toEqual(['/w/b.md'])
    // Same name in a different root is a different snapshot.
    store.create('/other', 'desk', state())
    expect(store.list(null)).toHaveLength(2)
  })

  it('caps the list, dropping the oldest', () => {
    for (let i = 0; i < SNAPSHOTS_MAX + 5; i++) store.create('/w', `snap ${i}`, state())
    const list = store.list('/w')
    expect(list).toHaveLength(SNAPSHOTS_MAX)
    expect(list.some((s) => s.name === 'snap 0')).toBe(false)
    expect(list.some((s) => s.name === `snap ${SNAPSHOTS_MAX + 4}`)).toBe(true)
  })

  it('removes by id and survives a corrupt file', () => {
    const snap = store.create('/w', 'gone soon', state())
    store.remove(snap.id)
    expect(store.list('/w')).toHaveLength(0)

    fs.writeFileSync(file(), '{not json', 'utf-8')
    expect(store.list(null)).toEqual([])
    // The store recovers: a save after corruption works.
    store.create('/w', 'fresh', state())
    expect(store.list('/w')).toHaveLength(1)
  })

  it('sanitizes untrusted state', () => {
    const s = sanitizeState({
      files: ['/ok', 42, null],
      activeFile: 7,
      sidebarView: 'bogus',
      panel: { filePanel: 'wide', terminal: 200 },
    })
    expect(s).toEqual({
      files: ['/ok'],
      activeFile: null,
      sidebarView: 'files',
      sidebarOpen: true,
      terminalOpen: true,
      panel: null,
    })
  })
})
