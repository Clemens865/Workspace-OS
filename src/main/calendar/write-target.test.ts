import { describe, it, expect } from 'vitest'
import { chooseWriteTarget, targetsForSource, LOCAL_TARGET, type WriteTarget } from './write-target'

/**
 * The question is only worth asking when there is a real choice.
 *
 * One calendar means being asked is noise; several means guessing puts a
 * meeting in the wrong account, where nobody looks for it.
 */

const SOURCE = { id: 'src1', displayName: 'iCloud' }
const cal = (name: string, readOnly?: boolean): { url: string; displayName: string; readOnly?: boolean } => ({
  url: `https://caldav.icloud.com/1/calendars/${name}/`,
  displayName: name,
  ...(readOnly ? { readOnly: true } : {}),
})

describe('targetsForSource', () => {
  it('offers the calendars that can be written to', () => {
    const t = targetsForSource(SOURCE, [cal('Home'), cal('Work')])
    expect(t.map((x) => x.label)).toEqual(['Home · iCloud', 'Work · iCloud'])
    expect(t.every((x) => x.canInvite)).toBe(true)
  })

  /** Offering one means saying "scheduled" and then failing with a 403. */
  it('never offers a calendar the server refuses writes to', () => {
    const t = targetsForSource(SOURCE, [cal('Home'), cal('Holidays', true)])
    expect(t.map((x) => x.label)).toEqual(['Home · iCloud'])
  })

  it('names the account too, because two calendars can share a name', () => {
    const a = targetsForSource({ id: 'a', displayName: 'iCloud' }, [cal('Home')])
    const b = targetsForSource({ id: 'b', displayName: 'Fastmail' }, [cal('Home')])
    expect(a[0].label).not.toBe(b[0].label)
    expect(a[0].id).not.toBe(b[0].id)
  })
})

describe('chooseWriteTarget', () => {
  const home = targetsForSource(SOURCE, [cal('Home')])[0]
  const work = targetsForSource(SOURCE, [cal('Work')])[0]

  /** The user's stated case: one iCloud calendar — do not ask. */
  it('uses the only real calendar without asking', () => {
    const c = chooseWriteTarget([LOCAL_TARGET, home])
    expect(c.target).toEqual(home)
    expect(c.implied).toBe(true)
  })

  it('asks when there is more than one', () => {
    const c = chooseWriteTarget([LOCAL_TARGET, home, work])
    expect(c.target).toBeNull()
    expect(c.options).toContain(home)
    expect(c.options).toContain(work)
  })

  it('stops asking once the answer is known', () => {
    const c = chooseWriteTarget([LOCAL_TARGET, home, work], work.id)
    expect(c.target).toEqual(work)
    expect(c.implied).toBe(false)
  })

  /**
   * A remembered calendar that no longer exists — renamed, disconnected, made
   * read-only. Quietly writing to a different one puts the meeting where
   * nobody will look for it.
   */
  it('asks again when the remembered calendar is gone', () => {
    const c = chooseWriteTarget([LOCAL_TARGET, home, work], 'src1:https://gone/')
    expect(c.target).toBeNull()
  })

  it('falls back to this Mac when nothing is connected', () => {
    const c = chooseWriteTarget([LOCAL_TARGET])
    expect(c.target).toEqual(LOCAL_TARGET)
    expect(c.implied).toBe(true)
  })

  it('never returns an empty set of options', () => {
    const c = chooseWriteTarget([] as WriteTarget[])
    expect(c.options).toEqual([LOCAL_TARGET])
    expect(c.target).toEqual(LOCAL_TARGET)
  })
})
