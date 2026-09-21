import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { OFFICE_MENU_TABLE, actionIdFor, entriesFor, menusFor, paletteCommands, stateKeyFor, type Entry } from './office-menu-table'

// Every .uno: name LibreOffice's UI configuration knows (extracted from the
// engine's officecfg *Commands.xcu on 2026-09-04). A menu item naming a
// command outside this set would dispatch silently.
const KNOWN = new Set<string>(JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__/uno-commands.json'), 'utf8')))

const leaves = (items: Entry[], out: Entry[] = []): Entry[] => {
  for (const e of items) { if (e.sub) leaves(e.sub, out); else if (!e.sep) out.push(e) }
  return out
}

describe('office menu table', () => {
  it('names only commands the engine registry knows', () => {
    const bad: string[] = []
    for (const mn of OFFICE_MENU_TABLE) for (const e of leaves(mn.items)) {
      const key = stateKeyFor(e)
      if (key && !KNOWN.has(key)) bad.push(`${mn.label} › ${e.label}: ${key}`)
    }
    expect(bad).toEqual([])
  })

  it('gives every leaf something to dispatch', () => {
    for (const mn of OFFICE_MENU_TABLE) for (const e of leaves(mn.items)) expect(actionIdFor(e), `${mn.label} › ${e.label}`).toBeTruthy()
  })

  it('shows Table only for Writer, Sheet and Data only for Calc, Slide menus only for Impress', () => {
    const labels = (code: string): string[] => menusFor(code).map((mn) => mn.label)
    expect(labels('w')).toContain('Table')
    expect(labels('w')).not.toContain('Sheet')
    expect(labels('c')).toEqual(expect.arrayContaining(['Sheet', 'Data']))
    expect(labels('c')).not.toContain('Table')
    expect(labels('p')).toEqual(expect.arrayContaining(['Slide', 'Slide Show']))
    expect(labels('p')).not.toContain('Data')
    for (const code of ['w', 'c', 'p']) expect(labels(code)).toEqual(expect.arrayContaining(['Edit', 'View', 'Insert', 'Format', 'Styles', 'Tools']))
  })

  it('collapses separators and drops submenus that empty out for an app', () => {
    const view = entriesFor(OFFICE_MENU_TABLE.find((mn) => mn.label === 'View')!.items, 'p')
    expect(view[0].sep).toBeFalsy()
    expect(view[view.length - 1].sep).toBeFalsy()
    for (let i = 1; i < view.length; i++) expect(view[i].sep && view[i - 1].sep).toBeFalsy()
    const edit = entriesFor(OFFICE_MENU_TABLE.find((mn) => mn.label === 'Edit')!.items, 'p')
    expect(edit.find((e) => e.label === 'Track Changes')).toBeUndefined()
    expect(edit.find((e) => e.label === 'Select')).toBeUndefined()
  })

  it('never binds one accelerator to two items within an app', () => {
    for (const [type, code] of [[0, 'w'], [1, 'c'], [2, 'p']] as const) {
      const seen = new Map<string, string>()
      for (const c of paletteCommands(type)) {
        if (!c.accel) continue
        expect(seen.has(c.accel), `${code}: ${c.accel} on both "${seen.get(c.accel)}" and "${c.label}"`).toBe(false)
        seen.set(c.accel, c.label)
      }
    }
  })

  it('flattens to palette commands with menu paths', () => {
    const cmds = paletteCommands(0)
    const dbl = cmds.find((c) => c.label === 'Double Underline')
    expect(dbl?.path).toBe('Format › Text')
    expect(dbl?.id).toBe('office.uno:.uno:UnderlineDouble')
    expect(cmds.some((c) => c.label === 'Sort…' && c.path === 'Table')).toBe(true)
    expect(paletteCommands(1).some((c) => c.path === 'Data › Statistics')).toBe(true)
    expect(paletteCommands(2).some((c) => c.label === 'Title Only' && c.path === 'Slide › Layout')).toBe(true)
    expect(paletteCommands(3)).toEqual([])
    // A healthy size: Writer should offer well over a hundred commands.
    expect(cmds.length).toBeGreaterThan(120)
  })
})
