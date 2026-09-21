import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { RoutineStore, RoutineValidationError, TEMPLATES } from './store'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-routines-'))
  file = path.join(dir, 'routines.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('RoutineStore', () => {
  it('seeds the three templates once, all OFF, and does not re-seed after a delete', () => {
    const s = new RoutineStore(file)
    expect(s.list().map((r) => r.name)).toEqual(TEMPLATES.map((t) => t.name))
    expect(s.list().every((r) => !r.enabled)).toBe(true)
    expect(s.list()[0].capabilities).toEqual(['mail'])
    s.delete(s.list()[0].id)
    const again = new RoutineStore(file)
    expect(again.list()).toHaveLength(2)
  })

  it('upsert validates at the boundary', () => {
    const s = new RoutineStore(file)
    expect(() => s.upsert({ name: '', prompt: 'x', schedule: 'daily@07:00' })).toThrow(RoutineValidationError)
    expect(() => s.upsert({ name: 'x', prompt: '', schedule: 'daily@07:00' })).toThrow(RoutineValidationError)
    expect(() => s.upsert({ name: 'x', prompt: 'y', schedule: '0 7 * * *' })).toThrow(RoutineValidationError)
    const r = s.upsert({ name: ' Nightly ', prompt: 'do it', schedule: 'Daily@22:00', capabilities: ['cases', 'bogus'], agentName: ' Nadia ' })
    expect(r).toMatchObject({ name: 'Nightly', schedule: 'daily@22:00', capabilities: ['cases'], agentName: 'Nadia', enabled: false, nextRunAt: null })
    expect(r.id).toMatch(/^rt-/)
  })

  it('updating keeps bookkeeping unless the schedule changed', () => {
    const s = new RoutineStore(file, () => 1000)
    const r = s.upsert({ name: 'a', prompt: 'p', schedule: 'daily@07:00' })
    s.mark(r.id, { lastRunAt: 500, nextRunAt: 900, lastJobId: 'bg-1' })
    const same = s.upsert({ id: r.id, name: 'a2', prompt: 'p', schedule: 'daily@07:00', enabled: true })
    expect(same).toMatchObject({ name: 'a2', enabled: true, lastRunAt: 500, nextRunAt: 900, lastJobId: 'bg-1' })
    const changed = s.upsert({ id: r.id, name: 'a2', prompt: 'p', schedule: 'daily@08:00' })
    expect(changed.nextRunAt).toBeNull()
    expect(changed.lastRunAt).toBe(500)
  })

  it('persists across instances and drops rows whose schedule no longer parses', () => {
    const s = new RoutineStore(file)
    s.upsert({ name: 'keep', prompt: 'p', schedule: 'every:6h', enabled: true })
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'))
    raw.routines.push({ id: 'rt-bad', name: 'bad', prompt: 'p', schedule: 'garbage' })
    fs.writeFileSync(file, JSON.stringify(raw))
    const again = new RoutineStore(file)
    expect(again.list().map((r) => r.name)).toContain('keep')
    expect(again.list().map((r) => r.name)).not.toContain('bad')
    expect(again.list().find((r) => r.name === 'keep')?.enabled).toBe(true)
  })
})
