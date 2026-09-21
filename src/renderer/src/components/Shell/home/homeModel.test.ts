import { describe, it, expect } from 'vitest'
import {
  parseLayout, serializeLayout, moveWidget, cycleSize, greeting,
  buildActivity, agoLabel,
  DEFAULT_LAYOUT, WIDGET_IDS,
} from './homeModel'

describe('parseLayout', () => {
  it('round-trips a serialized layout', () => {
    const layout = moveWidget(DEFAULT_LAYOUT, 'files', 0)
    expect(parseLayout(serializeLayout(layout))).toEqual(layout)
  })

  it('degrades to defaults on garbage instead of a blank Home', () => {
    expect(parseLayout('not json')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{"a":1}')).toEqual(DEFAULT_LAYOUT)
  })

  it('drops unknown widgets and appends NEW ones for existing users', () => {
    // A user saved a layout before the knowledge widget existed, plus a
    // widget that no longer exists — the parse heals both directions.
    const old = JSON.stringify([
      { id: 'files', visible: true, size: 'l', accent: 'teal' },
      { id: 'ghost-widget', visible: true, size: 'm', accent: 'indigo' },
    ])
    const parsed = parseLayout(old)
    // A blob saved before the `view` field existed gains it, healed to default.
    expect(parsed[0]).toEqual({ id: 'files', visible: true, size: 'l', accent: 'teal', view: 'slider' })
    expect(parsed.some((w) => (w.id as string) === 'ghost-widget')).toBe(false)
    for (const id of WIDGET_IDS) expect(parsed.some((w) => w.id === id)).toBe(true)
  })

  it('heals malformed fields per widget rather than rejecting the blob', () => {
    const bad = JSON.stringify([{ id: 'cases', visible: 'yes', size: 'xxl', accent: 'neon' }])
    const parsed = parseLayout(bad)
    expect(parsed[0]).toEqual(DEFAULT_LAYOUT.find((w) => w.id === 'cases'))
  })

  it('a duplicated id keeps only the first occurrence', () => {
    const dup = JSON.stringify([
      { id: 'mail', visible: false, size: 's', accent: 'rose' },
      { id: 'mail', visible: true, size: 'l', accent: 'green' },
    ])
    const parsed = parseLayout(dup)
    expect(parsed.filter((w) => w.id === 'mail')).toHaveLength(1)
    expect(parsed[0].visible).toBe(false)
  })
})

describe('moveWidget / cycleSize / greeting', () => {
  it('reorders and clamps', () => {
    const moved = moveWidget(DEFAULT_LAYOUT, 'browser', 0)
    expect(moved[0].id).toBe('browser')
    expect(moveWidget(DEFAULT_LAYOUT, 'browser', 99).at(-1)?.id).toBe('browser')
    expect(moveWidget(DEFAULT_LAYOUT, 'nope' as never, 0)).toEqual(DEFAULT_LAYOUT)
  })

  it('cycles s → m → l → s', () => {
    expect(cycleSize('s')).toBe('m')
    expect(cycleSize('m')).toBe('l')
    expect(cycleSize('l')).toBe('s')
  })

  it('greets by the hour', () => {
    expect(greeting(8)).toBe('Good morning')
    expect(greeting(14)).toBe('Good afternoon')
    expect(greeting(21)).toBe('Good evening')
  })
})

describe('buildActivity — while you were away', () => {
  const NOW = 1_700_000_000_000
  it('merges sources newest-first and pins the upcoming event on top', () => {
    const items = buildActivity({
      cases: [{ title: 'Roche', lastNote: 'Status → applied', lastNoteAt: NOW - 3600_000, lastNoteAuthor: 'system' }],
      runs: [{ agentName: 'Mira', sessionName: 's', status: 'kept', prompt: 'scan recruiters', at: NOW - 600_000 }],
      files: [{ path: '/w/cv/CV_Philips.pdf', at: NOW - 60_000 }],
      nextEvent: { summary: 'Interview Philips', start: NOW + 7200_000 },
      now: NOW,
    })
    expect(items[0].kind).toBe('calendar')
    expect(items[0].text).toContain('Coming up: Interview Philips')
    expect(items[1].text).toContain('CV_Philips.pdf') // newest real event next
    expect(items[2].text).toBe('Mira finished: scan recruiters')
    expect(items[3].text).toBe('Roche — now applied')
  })
  it('a past event is not pinned; empty inputs give an empty feed', () => {
    expect(buildActivity({ cases: [], runs: [], files: [], nextEvent: { summary: 'x', start: 1 }, now: NOW })).toEqual([])
  })
})

describe('agoLabel', () => {
  const NOW = 1_700_000_000_000
  it('speaks human time', () => {
    expect(agoLabel(NOW - 30_000, NOW)).toBe('just now')
    expect(agoLabel(NOW - 12 * 60_000, NOW)).toBe('12 min ago')
    expect(agoLabel(NOW - 3 * 3600_000, NOW)).toBe('3 h ago')
    expect(agoLabel(NOW - 2 * 86_400_000, NOW)).toBe('2 d ago')
  })
})
