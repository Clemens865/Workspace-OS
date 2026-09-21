import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { PulseMemory, deriveProjectName } from './pulse-memory'

/**
 * Tests run against a *temporary* fixture DB we build here — never the user's
 * real `~/.claude-pulse/tracker.db`. This both keeps CI hermetic and proves the
 * read-only query layer against a faithful copy of the Pulse `insights` schema.
 */

let dir: string
let dbPath: string

/** Builds a fixture Pulse DB. `full` mirrors the real schema; when false it
 *  drops the optional `reasoning`/`created_at` columns to exercise drift. */
function makeDb(full = true): void {
  const db = new Database(dbPath)
  if (full) {
    db.exec(`
      CREATE TABLE insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        project TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('progress','decision','pattern','fix','context','blocked')),
        content TEXT NOT NULL,
        reasoning TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)
    const ins = db.prepare(
      'INSERT INTO insights (project, type, content, reasoning, created_at) VALUES (?,?,?,?,?)'
    )
    ins.run('Workspace-OS', 'decision', 'Keep the LO engine', 'proven', '2026-07-01T10:00:00Z')
    ins.run('Workspace-OS', 'progress', 'Vector thumbnails shipped', null, '2026-07-03T09:00:00Z')
    ins.run('Workspace-OS', 'blocked', 'Awaiting user pick', null, '2026-07-03T21:31:52Z')
    ins.run('Other-Project', 'decision', 'Unrelated decision', null, '2026-07-02T10:00:00Z')
  } else {
    db.exec(`
      CREATE TABLE insights (
        project TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL
      );
    `)
    const ins = db.prepare('INSERT INTO insights (project, type, content) VALUES (?,?,?)')
    ins.run('Workspace-OS', 'decision', 'Drifted-schema decision')
  }
  db.close()
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-mem-'))
  dbPath = path.join(dir, 'tracker.db')
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('deriveProjectName', () => {
  it('extracts the basename from a workspace path', () => {
    expect(deriveProjectName('/Users/x/Software-Projects/Workspace-OS')).toBe('Workspace-OS')
    expect(deriveProjectName('/Users/x/Software-Projects/Workspace-OS/')).toBe('Workspace-OS')
  })
  it('passes a bare name through', () => {
    expect(deriveProjectName('Workspace-OS')).toBe('Workspace-OS')
  })
  it('handles empty input', () => {
    expect(deriveProjectName('')).toBe('')
  })
})

describe('PulseMemory', () => {
  it('is a graceful no-op when the DB is absent', () => {
    const mem = new PulseMemory(path.join(dir, 'does-not-exist.db'))
    expect(mem.available()).toBe(false)
    expect(mem.status()).toBe('absent')
    expect(mem.query({ project: 'Workspace-OS' })).toEqual([])
    expect(mem.recent('Workspace-OS')).toEqual([])
    mem.close()
  })

  it('returns a project’s insights, most-recent-first', () => {
    makeDb()
    const mem = new PulseMemory(dbPath)
    expect(mem.available()).toBe(true)
    const rows = mem.query({ project: 'Workspace-OS' })
    expect(rows).toHaveLength(3)
    expect(rows[0].text).toBe('Awaiting user pick')
    expect(rows[0].type).toBe('blocked')
    expect(rows[2].text).toBe('Keep the LO engine')
    expect(rows[2].reasoning).toBe('proven')
    mem.close()
  })

  it('accepts a full workspace path and matches case-insensitively', () => {
    makeDb()
    const mem = new PulseMemory(dbPath)
    const rows = mem.query({ project: '/Users/x/Software-Projects/workspace-os' })
    expect(rows).toHaveLength(3)
    mem.close()
  })

  it('does not leak other projects’ insights', () => {
    makeDb()
    const mem = new PulseMemory(dbPath)
    const rows = mem.query({ project: 'Workspace-OS' })
    expect(rows.every((r) => r.project === 'Workspace-OS')).toBe(true)
    mem.close()
  })

  it('filters by type and by search text', () => {
    makeDb()
    const mem = new PulseMemory(dbPath)
    expect(mem.query({ project: 'Workspace-OS', types: ['decision'] })).toHaveLength(1)
    expect(mem.query({ project: 'Workspace-OS', search: 'thumbnails' })).toHaveLength(1)
    expect(mem.query({ project: 'Workspace-OS', search: 'nope' })).toHaveLength(0)
    mem.close()
  })

  it('respects the limit (clamped)', () => {
    makeDb()
    const mem = new PulseMemory(dbPath)
    expect(mem.query({ project: 'Workspace-OS', limit: 2 })).toHaveLength(2)
    mem.close()
  })

  it('tolerates schema drift (missing optional columns)', () => {
    makeDb(false)
    const mem = new PulseMemory(dbPath)
    expect(mem.available()).toBe(true)
    const rows = mem.query({ project: 'Workspace-OS' })
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('Drifted-schema decision')
    expect(rows[0].timestamp).toBe('')
    expect(rows[0].reasoning).toBeNull()
    mem.close()
  })

  it('reports incompatible when the insights table lacks required columns', () => {
    const db = new Database(dbPath)
    db.exec('CREATE TABLE insights (foo TEXT);')
    db.close()
    const mem = new PulseMemory(dbPath)
    expect(mem.available()).toBe(false)
    expect(mem.status()).toBe('incompatible')
    expect(mem.query({ project: 'Workspace-OS' })).toEqual([])
    mem.close()
  })

  it('never writes to the DB (no -wal/-shm created by reads)', () => {
    makeDb()
    const mtimeBefore = fs.statSync(dbPath).mtimeMs
    const mem = new PulseMemory(dbPath)
    mem.query({ project: 'Workspace-OS' })
    mem.recent('Workspace-OS')
    mem.close()
    expect(fs.statSync(dbPath).mtimeMs).toBe(mtimeBefore)
    // A readonly connection must not leave journal side-files behind.
    expect(fs.existsSync(dbPath + '-wal')).toBe(false)
  })
})
