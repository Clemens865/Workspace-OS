import { describe, it, expect } from 'vitest'
import {
  detectPermissionPrompt,
  decisionToKeys,
  describePrompt,
  stripAnsi,
} from './hitlGate'

// A realistic (ANSI-dressed) render of claude's edit-permission menu.
const EDIT_PROMPT =
  '\x1b[2m…\x1b[0m\r\n' +
  '\x1b[1mDo you want to make this edit to report.md?\x1b[0m\r\n' +
  '\x1b[36m❯ 1. Yes\x1b[0m\r\n' +
  '  2. Yes, allow all edits during this session\r\n' +
  '  3. No, and tell Claude what to do differently\r\n'

const PROCEED_PROMPT =
  'Do you want to proceed?\n' +
  '❯ 1. Yes\n' +
  "  2. Yes, and don't ask again for `ls`\n" +
  '  3. No, and tell Claude what to do differently\n'

describe('stripAnsi', () => {
  it('removes CSI escape sequences but keeps text', () => {
    expect(stripAnsi('\x1b[1mYes\x1b[0m')).toBe('Yes')
    expect(stripAnsi('\x1b[36m❯ 1. Yes\x1b[0m')).toBe('❯ 1. Yes')
  })
})

describe('detectPermissionPrompt', () => {
  it('detects an edit prompt and classifies it', () => {
    const p = detectPermissionPrompt(EDIT_PROMPT)
    expect(p).not.toBeNull()
    expect(p!.kind).toBe('edit')
    expect(p!.question).toContain('Do you want to make this edit')
  })

  it('detects the generic "proceed?" prompt', () => {
    const p = detectPermissionPrompt(PROCEED_PROMPT)
    expect(p).not.toBeNull()
    expect(p!.kind).toBe('generic')
    expect(p!.question).toBe('Do you want to proceed?')
  })

  it('classifies fetch and connection prompts', () => {
    const fetchP =
      'Do you want to allow Claude to fetch this content?\n  3. No, and tell Claude what to do differently\n'
    const connP =
      'Do you want to allow this connection?\n  3. No, and tell Claude what to do differently\n'
    expect(detectPermissionPrompt(fetchP)!.kind).toBe('fetch')
    expect(detectPermissionPrompt(connP)!.kind).toBe('connection')
  })

  it('does NOT fire until the deny option is drawn (partial redraw)', () => {
    const partial = '\x1b[1mDo you want to proceed?\x1b[0m\r\n❯ 1. Yes\r\n'
    expect(detectPermissionPrompt(partial)).toBeNull()
  })

  it('does NOT fire on ordinary assistant output', () => {
    expect(detectPermissionPrompt('Here is the summary of the file. Done.')).toBeNull()
  })
})

describe('decisionToKeys', () => {
  it('allow-once accepts the default-highlighted first option (Enter)', () => {
    expect(decisionToKeys('allow-once')).toBe('\r')
  })
  it('allow-session moves down one then accepts', () => {
    expect(decisionToKeys('allow-session')).toBe('\x1b[B\r')
  })
  it('deny sends Escape', () => {
    expect(decisionToKeys('deny')).toBe('\x1b')
  })
})

describe('describePrompt', () => {
  it('produces a human label per kind', () => {
    expect(describePrompt({ kind: 'edit', question: '' })).toMatch(/edit a file/i)
    expect(describePrompt({ kind: 'command', question: '' })).toMatch(/run a command/i)
    expect(describePrompt({ kind: 'generic', question: '' })).toMatch(/permission/i)
  })
})
