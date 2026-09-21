import { describe, it, expect } from 'vitest'
import {
  RAIL_ITEMS,
  HOME_TAB,
  docLabel,
  openDocTab,
  closeDocTab,
  isDocTab,
  resolveOpenPath,
  isPlaceholder,
} from './shellModel'

describe('shellModel — rail', () => {
  it('starts with Home and ends with Settings', () => {
    expect(RAIL_ITEMS[0].id).toBe('home')
    expect(RAIL_ITEMS[RAIL_ITEMS.length - 1].id).toBe('settings')
  })

  it('marks Chats as a placeholder and real surfaces as not', () => {
    // Calendar graduated from placeholder to a real CalDAV/ICS surface; Chats
    // (communication channel #2) is the remaining one.
    expect(isPlaceholder('chats')).toBe(true)
    expect(isPlaceholder('calendar')).toBe(false)
    expect(isPlaceholder('browser')).toBe(false)
    expect(isPlaceholder('files')).toBe(false)
    expect(isPlaceholder('mail')).toBe(false)
    expect(isPlaceholder('agents')).toBe(false)
  })

  it('exposes every composed surface in the rail', () => {
    const ids = RAIL_ITEMS.map((r) => r.id)
    for (const id of ['home', 'files', 'mail', 'agents', 'knowledge', 'settings'] as const) {
      expect(ids).toContain(id)
    }
  })
})

describe('shellModel — Stage tabs', () => {
  it('derives a basename label from a path', () => {
    expect(docLabel('/a/b/report.docx')).toBe('report.docx')
    expect(docLabel('report.docx')).toBe('report.docx')
    expect(docLabel('C:\\docs\\budget.xlsx')).toBe('budget.xlsx')
  })

  it('opens a document tab and activates it', () => {
    const r = openDocTab([HOME_TAB], '/w/report.docx')
    expect(r.active).toBe('/w/report.docx')
    expect(r.tabs).toHaveLength(2)
    expect(r.tabs[1]).toEqual({ key: '/w/report.docx', label: 'report.docx', closable: true })
  })

  it('does not duplicate an already-open document', () => {
    const first = openDocTab([HOME_TAB], '/w/a.md')
    const again = openDocTab(first.tabs, '/w/a.md')
    expect(again.tabs).toHaveLength(2)
    expect(again.active).toBe('/w/a.md')
  })

  it('counts only opened documents as doc tabs — never Home or a rail id', () => {
    const { tabs } = openDocTab([HOME_TAB], '/w/roles.xlsx')
    expect(isDocTab(tabs, '/w/roles.xlsx')).toBe(true)
    expect(isDocTab(tabs, HOME_TAB.key)).toBe(false)
    // Selecting the Files rail parks activeTab on 'files'. That key passed the
    // old `activeTab !== HOME_TAB.key` check, so the Stage editor rendered
    // UNDER the Files browser and its spreadsheet headers bled over the tree.
    expect(isDocTab(tabs, 'files')).toBe(false)
    expect(isDocTab(tabs, '/w/never-opened.xlsx')).toBe(false)
  })

  it('closing a doc tab returns to Home and keeps Home pinned', () => {
    const opened = openDocTab([HOME_TAB], '/w/a.md')
    const closed = closeDocTab(opened.tabs, '/w/a.md')
    expect(closed.tabs).toEqual([HOME_TAB])
    expect(closed.active).toBe(HOME_TAB.key)
    expect(HOME_TAB.closable).toBe(false)
  })
})

describe('resolveOpenPath', () => {
  const root = '/Users/c/Workspace'

  it('resolves a workspace-relative case attachment against the root', () => {
    // The bug: agents attach workspace-relative paths, the open pipeline
    // expects absolute — "Cannot render: lok:open: File does not exist".
    expect(resolveOpenPath('Jobs/scan.xlsx', root)).toBe('/Users/c/Workspace/Jobs/scan.xlsx')
    expect(resolveOpenPath('./Jobs/scan.xlsx', root)).toBe('/Users/c/Workspace/Jobs/scan.xlsx')
    expect(resolveOpenPath('Jobs/scan.xlsx', root + '/')).toBe('/Users/c/Workspace/Jobs/scan.xlsx')
  })

  it('leaves absolute paths exactly alone', () => {
    expect(resolveOpenPath('/tmp/report.pdf', root)).toBe('/tmp/report.pdf')
    expect(resolveOpenPath('C:\\docs\\a.docx', root)).toBe('C:\\docs\\a.docx')
  })

  it('passes a relative path through when no workspace is open — the error stays honest', () => {
    expect(resolveOpenPath('Jobs/scan.xlsx', null)).toBe('Jobs/scan.xlsx')
  })
})
