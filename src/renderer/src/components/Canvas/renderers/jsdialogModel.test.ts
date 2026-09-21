import { describe, expect, it } from 'vitest'
import { applyJsDialogMessage, cleanText, findWidget, isMessageBox, isPopup, parseJsDialogMessage, responseIds } from './jsdialogModel'

// Shape of the real Sort dialog (engine capture, 2026-09-04), trimmed.
const FULL = JSON.stringify({
  id: 2, type: 'dialog', text: 'Sort', enabled: true, title: 'Sort', dialogid: 'SortDialog', jsontype: 'dialog',
  responses: [{ id: 'ok', response: 1 }, { id: 'cancel', response: 0 }],
  init_focus_id: 'sortlb',
  children: [
    { id: 'dialog-vbox1', type: 'container', vertical: 'true', enabled: 'true', children: [
      { id: 'tabcontrol', type: 'tabcontrol', enabled: 'true', selected: '0', tabs: [{ text: 'Sort Criteria', id: 'criteria' }, { text: 'Options', id: 'options' }], children: [
        { id: '', type: 'grid', enabled: 'true', children: [
          { id: 'sortlb', type: 'listbox', enabled: 'true', entries: ['Column A', 'Column B'], selectedCount: '1', selectedEntries: ['0'] },
          { id: 'up', type: 'radiobutton', text: '~Ascending', enabled: 'true', checked: 'true', group: 'g1' },
          { id: 'down', type: 'radiobutton', text: '~Descending', enabled: 'true', checked: 'false', group: 'g1' },
        ] },
        { id: '', type: 'grid', enabled: 'true', children: [
          { id: 'case', type: 'checkbox', text: 'Case ~sensitive', enabled: 'true', checked: 'false' },
        ] },
      ] },
      { id: 'dialog-action_area1', type: 'buttonbox', enabled: 'true', children: [
        { id: 'cancel', type: 'pushbutton', text: '~Cancel', enabled: 'true' },
        { id: 'ok', type: 'pushbutton', text: '~OK', enabled: 'true', has_default: 'true' },
      ] },
    ] },
  ],
})

describe('parseJsDialogMessage', () => {
  it('reads the full tree with title, responses and focus', () => {
    const m = parseJsDialogMessage(FULL)
    expect(m.kind).toBe('full')
    if (m.kind !== 'full') return
    expect(m.state.id).toBe(2)
    expect(m.state.title).toBe('Sort')
    expect(m.state.dialogid).toBe('SortDialog')
    expect(m.state.initFocus).toBe('sortlb')
    expect([...responseIds(m.state)]).toEqual(['ok', 'cancel'])
    const up = findWidget(m.state.root, 'up')
    expect(up?.checked).toBe(true)
    expect(findWidget(m.state.root, 'down')?.checked).toBe(false)
    expect(findWidget(m.state.root, 'tabcontrol')?.enabled).toBe(true)
  })
  it('classifies update, action and close', () => {
    expect(parseJsDialogMessage('{"jsontype":"dialog","action":"close","id":2}')).toEqual({ kind: 'close', id: 2 })
    const u = parseJsDialogMessage('{"jsontype":"dialog","action":"update","id":2,"control":{"id":"case","type":"checkbox","text":"Case ~sensitive","enabled":"true","checked":"true"}}')
    expect(u.kind).toBe('update')
    const a = parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"reset","action_type":"hide"}}')
    expect(a).toMatchObject({ kind: 'action', id: 2, controlId: 'reset', actionType: 'hide' })
  })
  it('ignores sidebars, garbage and messages without an id', () => {
    expect(parseJsDialogMessage('{"jsontype":"sidebar","id":1,"action":"update"}').kind).toBe('ignore')
    expect(parseJsDialogMessage('nope').kind).toBe('ignore')
    expect(parseJsDialogMessage('{"jsontype":"dialog","action":"update"}').kind).toBe('ignore')
  })
})

describe('applyJsDialogMessage', () => {
  const full = parseJsDialogMessage(FULL)
  const state = full.kind === 'full' ? full.state : null!
  it('replaces the subtree on update without touching the rest', () => {
    const next = applyJsDialogMessage(state, parseJsDialogMessage('{"jsontype":"dialog","action":"update","id":2,"control":{"id":"case","type":"checkbox","text":"Case ~sensitive","enabled":"true","checked":"true"}}'))
    expect(findWidget(next.root, 'case')?.checked).toBe(true)
    expect(findWidget(next.root, 'up')).toBe(findWidget(state.root, 'up'))
  })
  it('applies hide / disable / select actions', () => {
    let s = applyJsDialogMessage(state, parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"cancel","action_type":"hide"}}'))
    expect(findWidget(s.root, 'cancel')?.visible).toBe(false)
    s = applyJsDialogMessage(s, parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"down","action_type":"disable"}}'))
    expect(findWidget(s.root, 'down')?.enabled).toBe(false)
    s = applyJsDialogMessage(s, parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"tabcontrol","action_type":"select","position":"1"}}'))
    expect(findWidget(s.root, 'tabcontrol')?.selected).toBe(1)
    s = applyJsDialogMessage(s, parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"sortlb","action_type":"select","position":"1"}}'))
    expect(findWidget(s.root, 'sortlb')?.selectedEntries).toEqual(['1'])
  })
  it('returns the same state for an action on an unknown control', () => {
    expect(applyJsDialogMessage(state, parseJsDialogMessage('{"jsontype":"dialog","action":"action","id":2,"data":{"control_id":"nope","action_type":"hide"}}'))).toBe(state)
  })
})

describe('message boxes and popups', () => {
  it('accepts a message box with an empty id and marks it', () => {
    const m = parseJsDialogMessage('{"id":"","type":"messagebox","text":"LibreOffice Calc","enabled":true,"title":"Confirmation","responses":[{"id":"yes","response":2},{"id":"no","response":3}],"jsontype":"dialog","children":[{"id":"","type":"container","enabled":true,"children":[{"id":"yes","type":"pushbutton","text":"~Yes","enabled":true}]}]}')
    expect(m.kind).toBe('full')
    if (m.kind !== 'full') return
    expect(m.state.id).toBe(-1)
    expect(isMessageBox(m.state)).toBe(true)
    expect(isPopup(m.state)).toBe(false)
  })
  it('recognises the AutoFilter dropdown as a popup', () => {
    const m = parseJsDialogMessage('{"id":4,"type":"modalpopup","jsontype":"dialog","posx":0,"posy":16,"cancellable":true,"children":[{"id":"container","type":"container","enabled":true,"children":[]}]}')
    expect(m.kind).toBe('full')
    if (m.kind === 'full') expect(isPopup(m.state)).toBe(true)
  })
})

describe('cleanText', () => {
  it('strips mnemonic markers', () => {
    expect(cleanText('~Ascending')).toBe('Ascending')
    expect(cleanText('Case ~sensitive')).toBe('Case sensitive')
    expect(cleanText('_Reset')).toBe('Reset')
    expect(cleanText(undefined)).toBe('')
  })
})
