import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../agent/providerText', () => ({ runProviderJson: run.fn }))

import { parsePlan, parseStep, readPlan, writeTests } from './app-tests'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-tests-'))
  fs.mkdirSync(path.join(root, 'Apps', 'notes'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Apps/notes/index.html'), '<button id="add">Add</button>')
  run.fn.mockReset()
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const PLAN = {
  scenarios: [
    { name: 'Adds a note', check: 'Notes survive a reload', steps: [{ do: 'click', text: 'Add' }, { do: 'type', target: '#title', value: 'Milk' }, { do: 'reload' }, { do: 'expect', target: '.note', count: 1 }] },
    { name: 'Draws with AI', ai: { svg: '<svg/>' }, store: { seen: true }, steps: [{ do: 'expectJs', js: 'true' }] },
  ],
}

describe('a test plan', () => {
  it('reads the steps the driver knows, with sane limits', () => {
    expect(parseStep({ do: 'key', key: 'z', mods: ['meta', 'hyper'] })).toEqual({ do: 'key', key: 'z', mods: ['meta'] })
    expect(parseStep({ do: 'wait', ms: 99_999 })).toEqual({ do: 'wait', ms: 5000 })
    expect(parseStep({ do: 'drag', target: '.n', by: [10, 'x'] })).toEqual({ do: 'drag', target: '.n', by: [10, 0] })
    expect(parseStep({ do: 'type', target: '#t', value: 'a', clear: false })).toMatchObject({ clear: false })
    expect(parseStep({ do: 'expect', text: 'Saved', timeout: 1e9 })).toEqual({ do: 'expect', text: 'Saved', timeout: 15000 })
    for (const bad of [{ do: 'click' }, { do: 'eval', js: 'x' }, { do: 'type', target: '#t' }, { do: 'expectJs', js: ' ' }, null]) expect(parseStep(bad)).toBeNull()
  })

  it('keeps a scenario’s AI answer and starting data, and drops scenarios with no steps', () => {
    const p = parsePlan('Here:\n```json\n' + JSON.stringify({ scenarios: [...PLAN.scenarios, { name: 'Empty', steps: [{ do: 'fly' }] }] }) + '\n```')
    expect(p?.scenarios.map((s) => s.name)).toEqual(['Adds a note', 'Draws with AI'])
    expect(p?.scenarios[1]).toMatchObject({ ai: { svg: '<svg/>' }, store: { seen: true } })
    expect('ai' in p!.scenarios[0]).toBe(false) // no answer: AI is off in that scenario
    expect(parsePlan('Done.')).toBeNull()
    expect(parsePlan('{"scenarios": []}')).toBeNull()
  })
})

describe('writing the tests', () => {
  it('writes TESTS.json from the brief, the files and the last ask, and updates the old ones', async () => {
    fs.writeFileSync(path.join(root, 'Apps/notes/BRIEF.md'), '# Notes\n## Acceptance checks\n- [ ] Notes survive a reload')
    fs.writeFileSync(path.join(root, 'Apps/notes/TESTS.json'), JSON.stringify(PLAN))
    run.fn.mockResolvedValue({ text: JSON.stringify(PLAN), code: 0, timedOut: false })
    expect(await writeTests(root, 'notes', 'add tags')).toEqual({ scenarios: 2 })
    const o = run.fn.mock.calls[0][0]
    expect(o.prompt).toContain('Notes survive a reload')
    expect(o.prompt).toContain('add tags')
    expect(o.prompt).toContain('Its current tests (update them')
    expect(o.prompt).toContain('<button id="add">Add</button>')
    expect(o.prompt.match(/"Adds a note"/g)).toHaveLength(1) // the old tests once, not again among the files
    expect(o.isolated).toBe(true)
    expect(o.allowedTools).toEqual([])
    expect(readPlan(root, 'notes')?.scenarios).toHaveLength(2)
  })

  it('keeps the old tests when no usable ones came back', async () => {
    fs.writeFileSync(path.join(root, 'Apps/notes/TESTS.json'), JSON.stringify(PLAN))
    run.fn.mockResolvedValue({ text: 'I could not.', code: 0, timedOut: false })
    await expect(writeTests(root, 'notes', '')).rejects.toThrow('No usable tests')
    expect(readPlan(root, 'notes')?.scenarios).toHaveLength(2)
  })
})

describe('keys the driver presses', () => {
  it('maps named keys, letters and shortcuts, and refuses what it does not know', async () => {
    const { keyEvent } = await import('./app-driver')
    expect(keyEvent('Enter', [])).toEqual({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r', modifiers: 0 })
    expect(keyEvent('Esc', [])).toMatchObject({ key: 'Escape', text: '' })
    expect(keyEvent('z', ['meta', 'shift'])).toEqual({ key: 'Z', code: 'KeyZ', windowsVirtualKeyCode: 90, text: '', modifiers: 12 }) // a shortcut types nothing
    expect(keyEvent('a', ['shift'])).toMatchObject({ key: 'A', text: 'A', modifiers: 8 })
    expect(keyEvent('7', [])).toMatchObject({ code: 'Digit7', text: '7' })
    expect(keyEvent('F13', [])).toBeNull()
  })
})
