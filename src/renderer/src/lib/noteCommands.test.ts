import { describe, it, expect, vi } from 'vitest'
import { NOTE_DAILY_ACTION, matchCommands, openNote } from './noteCommands'

describe('matchCommands', () => {
  const office = [
    { id: 'office.uno:Underline', label: 'Underline', path: 'Format › Text' },
    { id: 'office.uno:Today', label: 'Insert today', path: 'Insert' },
  ]

  it('offers today’s note with or without a document open', () => {
    for (const q of ['daily', 'today', "Today's Note"]) {
      expect(matchCommands([], q).map((c) => c.id)).toContain(NOTE_DAILY_ACTION)
    }
  })

  it('searches labels and menu paths, labels that start with the query first', () => {
    expect(matchCommands(office, ' under ').map((c) => c.label)).toEqual(['Underline'])
    expect(matchCommands(office, 'format').map((c) => c.label)).toEqual(['Underline'])
    expect(matchCommands(office, 'in').map((c) => c.label)[0]).toBe('Insert today')
  })

  it('lists nothing for an empty query, and at most eight', () => {
    expect(matchCommands(office, '  ')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, label: `Command ${i}`, path: '' }))
    expect(matchCommands(many, 'command')).toHaveLength(8)
  })
})

describe('openNote', () => {
  it('opens what main created or found', async () => {
    const open = vi.fn()
    const report = vi.fn()
    await openNote(async () => ({ path: '/ws/Daily/2026-01-05.md', created: true }), open, report)
    expect(open).toHaveBeenCalledWith('/ws/Daily/2026-01-05.md')
    expect(report).not.toHaveBeenCalled()
  })

  it('says why it could not, without the IPC wrapping', async () => {
    const open = vi.fn()
    const report = vi.fn()
    await openNote(
      async () => { throw new Error("Error invoking remote method 'notes:daily': IpcValidationError: No workspace is open") },
      open,
      report,
    )
    expect(open).not.toHaveBeenCalled()
    expect(report).toHaveBeenCalledWith('No workspace is open')
  })
})
