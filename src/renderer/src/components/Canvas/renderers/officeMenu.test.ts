import { describe, expect, it } from 'vitest'
import { cleanLabel, curateMenu, menuFromEngine, parseEngineMenu, resolveCommand, unoQueryToJson } from './officeMenu'

// A faithful subset of the payload the real engine emitted for a right-click
// on Writer body text (e2e/office/AJ-context-menu.mjs --dump, 2026-09-04).
// boost::property_tree writes every value as a string — that is the point.
const WRITER_TEXT = JSON.stringify({
  menu: [
    { text: '~No Break', type: 'command', command: '.uno:NoBreak', enabled: 'false' },
    { type: 'separator' },
    { text: '~Cut', type: 'command', command: '.uno:Cut', enabled: 'false' },
    { text: 'Cop~y', type: 'command', command: '.uno:Copy', enabled: 'false' },
    { text: '~Paste', type: 'command', command: '.uno:Paste', enabled: 'true' },
    {
      text: 'Paste ~Special', type: 'menu', command: '.uno:PasteSpecialMenu', enabled: 'true',
      menu: [
        { text: '~Unformatted Text', type: 'command', command: '.uno:PasteUnformatted', enabled: 'true' },
        { text: '~More Options...', type: 'command', command: '.uno:PasteSpecial', enabled: 'true' },
      ],
    },
    { type: 'separator' },
    { text: 'Update ~Index', type: 'command', command: '.uno:UpdateCurIndex', enabled: 'false' },
    { text: 'Edit F~ields...', type: 'command', command: '.uno:FieldDialog', enabled: 'false' },
    { type: 'separator' },
    { text: 'Clone Formattin~g', type: 'command', command: '.uno:FormatPaintbrush', enabled: 'true', checktype: 'checkmark', checked: 'false' },
    { text: 'Clear ~Direct Formatting', type: 'command', command: '.uno:ResetAttributes', enabled: 'true' },
    {
      text: 'P~aragraph', type: 'menu', command: '.uno:ParagraphMenu', enabled: 'true',
      menu: [
        { text: 'P~aragraph...', type: 'command', command: '.uno:ParagraphDialog', enabled: 'true' },
        { type: 'separator' },
        { text: '~Body Text', type: 'command', command: '.uno:TextBodyParaStyle', enabled: 'true', checktype: 'radio', checked: 'false' },
        { text: 'Heading ~1', type: 'command', command: '.uno:Heading1ParaStyle', enabled: 'true', checktype: 'radio', checked: 'true' },
        { text: '', type: 'command', command: '.uno:QuotationsParStyle', enabled: 'false', checktype: 'radio', checked: 'false' },
      ],
    },
    {
      text: '~List', type: 'menu', command: '.uno:NumberingMenu', enabled: 'true',
      menu: [
        { text: '~Promote Outline Level', type: 'command', command: '.uno:IncrementLevel', enabled: 'false' },
        { text: '~Demote Outline Level', type: 'command', command: '.uno:DecrementLevel', enabled: 'false' },
      ],
    },
    { type: 'separator' },
    { text: 'Insert Comment', type: 'command', command: '.uno:InsertAnnotation', enabled: 'true' },
    { text: 'Accept Change', type: 'command', command: '.uno:AcceptTrackedChange', enabled: 'false' },
    { type: 'separator' },
    { text: 'Insert Hyperlin~k...', type: 'command', command: '.uno:InsertHyperlink', enabled: 'true' },
    { text: '~Open Local Copy', type: 'command', command: '.uno:OpenLocalURL', enabled: 'true' },
    { type: 'separator' },
    { text: '~Page Style...', type: 'command', command: '.uno:PageDialog', enabled: 'true' },
    { type: 'separator' },
  ],
})

const CALC_CELL = JSON.stringify({
  menu: [
    { text: '~Cut', type: 'command', command: '.uno:Cut', enabled: 'true' },
    { text: '~Paste', type: 'command', command: '.uno:Paste', enabled: 'true' },
    { type: 'separator' },
    { text: 'Data ~Validation...', type: 'command', command: '.uno:CurrentValidation', enabled: 'true' },
    { text: '~Format Cells...', type: 'command', command: '.uno:FormatCellDialog', enabled: 'true' },
    {
      text: 'St~yles', type: 'menu', command: '.uno:FormatStylesMenu', enabled: 'true',
      menu: [
        { text: '~Accent 1', type: 'command', command: '.uno:Accent1CellStyles', enabled: 'true', checktype: 'radio', checked: 'false' },
      ],
    },
    { text: '~Default Table Style', type: 'command', command: '.uno:StyleApply?Style:string=Default Style&FamilyName:string=TableStyles', enabled: 'true', checktype: 'radio', checked: 'false' },
  ],
})

describe('parseEngineMenu', () => {
  it('normalises the stringly-typed boost payload', () => {
    const items = parseEngineMenu(WRITER_TEXT)
    expect(items[0]).toEqual({ type: 'command', text: '~No Break', command: '.uno:NoBreak', enabled: false })
    const painter = items.find((i) => i.command === '.uno:FormatPaintbrush')
    expect(painter?.checked).toBe(false)
    const para = items.find((i) => i.command === '.uno:ParagraphMenu')
    expect(para?.type).toBe('menu')
    expect(para?.menu?.find((i) => i.command === '.uno:Heading1ParaStyle')?.checked).toBe(true)
  })
  it('never throws on garbage', () => {
    expect(parseEngineMenu('')).toEqual([])
    expect(parseEngineMenu('{"menu":"nope"}')).toEqual([])
    expect(parseEngineMenu('not json')).toEqual([])
  })
})

describe('cleanLabel', () => {
  it('drops mnemonics and turns three dots into an ellipsis', () => {
    expect(cleanLabel('Paste ~Special')).toBe('Paste Special')
    expect(cleanLabel('Insert Hyperlin~k...')).toBe('Insert Hyperlink…')
  })
})

describe('curateMenu', () => {
  const menu = menuFromEngine(WRITER_TEXT)
  const flat = (items = menu, out: string[] = []): string[] => {
    for (const i of items) { out.push(i.separator ? '—' : i.label); if (i.children) flat(i.children, out) }
    return out
  }

  it('drops disabled items, hidden items, and the submenus that empty out', () => {
    const labels = flat()
    expect(labels).not.toContain('No Break')
    expect(labels).not.toContain('Cut')
    expect(labels).not.toContain('Update Index')
    expect(labels).not.toContain('Accept Change')
    expect(labels).not.toContain('Open Local Copy')
    // "List" only held disabled entries → gone entirely
    expect(labels).not.toContain('List')
    expect(labels).toContain('Paste')
    expect(labels).toContain('Paragraph')
    expect(labels).toContain('Heading 1')
  })

  it('never starts or ends with a separator and never doubles one', () => {
    const labels = flat()
    expect(labels[0]).not.toBe('—')
    expect(labels[labels.length - 1]).not.toBe('—')
    expect(labels.join('|')).not.toContain('—|—')
    // The separator that sat between two dropped groups collapsed into one.
    expect(menu[0].label).toBe('Paste')
  })

  it('routes rebuilt dialogs to our actions and keeps the rest as uno', () => {
    const link = flat().includes('Insert Hyperlink…')
    expect(link).toBe(true)
    const item = menu.find((i) => i.label === 'Insert Hyperlink…')
    expect(item?.action).toBe('hyperlink')
    expect(item?.uno).toBeUndefined()
    const page = menu.find((i) => i.label === 'Page Style…')
    expect(page?.uno).toBe('.uno:PageDialog')
  })

  it('keeps check state on styles, and marks the painter as a mode', () => {
    const para = menu.find((i) => i.label === 'Paragraph')
    const h1 = para?.children?.find((c) => c.label === 'Heading 1')
    expect(h1?.checked).toBe(true)
    expect(para?.children?.find((c) => c.label === 'Body Text')?.checked).toBe(false)
    const painter = menu.find((i) => i.label === 'Clone Formatting')
    expect(painter?.mode).toBe(true)
    expect(painter?.checked).toBeUndefined()
  })

  it('attaches the shortcuts people expect', () => {
    expect(menu.find((i) => i.label === 'Paste')?.shortcut).toBe('⌘V')
    const ps = menu.find((i) => i.label === 'Paste Special')
    expect(ps?.children?.[0].shortcut).toBe('⇧⌥⌘V')
  })

  it('gives every item a stable, unique id', () => {
    const ids = new Set<string>()
    const walk = (items = menu): void => { for (const i of items) { expect(ids.has(i.id)).toBe(false); ids.add(i.id); if (i.children) walk(i.children) } }
    walk()
  })

  it('keeps query-style commands (table styles), converted for dispatch', () => {
    const calc = menuFromEngine(CALC_CELL)
    const style = calc.find((i) => i.label === 'Default Table Style')
    expect(style?.uno).toContain('.uno:StyleApply {')
    expect(calc.find((i) => i.label === 'Format Cells…')?.action).toBe('formatCells')
    expect(calc.find((i) => i.label === 'Data Validation…')?.action).toBe('datavalidation')
  })

  it('curates an already-parsed tree the same way', () => {
    expect(curateMenu(parseEngineMenu(CALC_CELL)).length).toBe(menuFromEngine(CALC_CELL).length)
  })
})

describe('resolveCommand', () => {
  it('turns query-form URLs into JSON args (the host splits at the first space)', () => {
    expect(unoQueryToJson('.uno:StyleApply?Style:string=Heading 1&FamilyName:string=ParagraphStyles'))
      .toBe('.uno:StyleApply {"Style":{"type":"string","value":"Heading 1"},"FamilyName":{"type":"string","value":"ParagraphStyles"}}')
    expect(unoQueryToJson('.uno:AssignLayout?WhatLayout:long=19'))
      .toBe('.uno:AssignLayout {"WhatLayout":{"type":"long","value":19}}')
    expect(unoQueryToJson('.uno:Bold')).toBe('.uno:Bold')
  })
  it('resolves menu aliases to their dispatchable target', () => {
    expect(resolveCommand('.uno:Heading1ParaStyle'))
      .toBe('.uno:StyleApply {"Style":{"type":"string","value":"Heading 1"},"FamilyName":{"type":"string","value":"ParagraphStyles"}}')
    expect(resolveCommand('.uno:DuplicateSlide')).toBe('.uno:DuplicatePage')
    expect(resolveCommand('.uno:Accent1CellStyles')).toContain('"CellStyles"')
  })
  it('is applied to every menu item the engine hands over', () => {
    const menu = menuFromEngine(WRITER_TEXT)
    const para = menu.find((i) => i.label === 'Paragraph')
    expect(para?.children?.find((c) => c.label === 'Heading 1')?.uno).toContain('.uno:StyleApply {')
    expect(menuFromEngine(CALC_CELL).find((i) => i.label === 'Default Table Style')?.uno)
      .toBe('.uno:StyleApply {"Style":{"type":"string","value":"Default Style"},"FamilyName":{"type":"string","value":"TableStyles"}}')
  })
})
