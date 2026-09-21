import { describe, it, expect } from 'vitest'
import {
  openSignals,
  signalKey,
  resolveWhen,
  resolveDay,
  parseCase,
  serializeCase,
  readNote,
  nextStatus,
  statusesFor,
  slugify,
  TERMINAL,
  type WorkCase,
  type CaseNote,
} from './cases'

/**
 * The case file is the contract between the person and the agents: both read
 * and write it. Round-tripping is therefore not a nicety — a field lost on save
 * is context the next agent run will not have, and nobody will notice until the
 * answer is quietly worse.
 */

const CASE: WorkCase = {
  id: 'enterprise-ai-architect-alpla',
  type: 'application',
  title: 'Enterprise AI Architect — ALPLA',
  description: 'Speculative application; they run a large plastics operation and are building an AI team.',
  acted: [],
  subject: 'https://www.linkedin.com/jobs/view/123',
  status: 'applied',
  artifacts: ['Reports/CV — ALPLA.pdf', 'Reports/Cover Letter — ALPLA.docx'],
  notes: [
    { at: '2026-08-17T10:05:00.000Z', author: 'you', text: 'Applied through the portal.' },
    { at: '2026-08-19T09:00:00.000Z', author: 'agent', text: 'Screening call booked.' },
  ],
  created: '2026-08-17T10:00:00.000Z',
  updated: '2026-08-19T09:00:00.000Z',
}

describe('case file round-trip', () => {
  it('survives serialize → parse unchanged', () => {
    expect(parseCase(CASE.id, serializeCase(CASE))).toEqual(CASE)
  })

  it('keeps every artifact, including ones with spaces and dashes', () => {
    const back = parseCase(CASE.id, serializeCase(CASE))
    expect(back.artifacts).toEqual(CASE.artifacts)
  })

  it('keeps notes in order, with author and timestamp', () => {
    const back = parseCase(CASE.id, serializeCase(CASE))
    expect(back.notes.map((n) => n.author)).toEqual(['you', 'agent'])
    expect(back.notes[1].text).toBe('Screening call booked.')
  })

  it('writes a body a person can read without the app', () => {
    const md = serializeCase(CASE)
    expect(md).toContain('# Enterprise AI Architect — ALPLA')
    expect(md).toContain('Source: https://www.linkedin.com/jobs/view/123')
    expect(md).toContain('## Notes')
  })

  /** These files get hand-edited. A typo must not make one unreadable. */
  it('reads a hand-written file with fields missing', () => {
    const c = parseCase('scrappy', '---\ntitle: Something\n---\n\nfree text\n')
    expect(c.title).toBe('Something')
    expect(c.status).toBe('drafted')
    expect(c.type).toBe('task')
    expect(c.artifacts).toEqual([])
    expect(c.notes).toEqual([])
  })

  it('falls back to the id when there is no frontmatter at all', () => {
    expect(parseCase('bare', 'just some notes').title).toBe('bare')
  })

  it('flattens a newline out of a note so the line format holds', () => {
    const md = serializeCase({ ...CASE, notes: [{ at: 'T', author: 'you', text: 'a\nb' }] })
    expect(parseCase('x', md).notes[0].text).toBe('a b')
  })
})

describe('status flow', () => {
  it('advances along the path', () => {
    expect(nextStatus('application', 'drafted')).toBe('applied')
    expect(nextStatus('application', 'applied')).toBe('interview')
  })

  it('stops at the end rather than wrapping', () => {
    expect(nextStatus('application', 'offer')).toBeNull()
  })

  it('offers a terminal for preparing something and never sending it', () => {
    // The case the user named explicitly: a CV written, then no application.
    expect(statusesFor('application')).toContain('not-applied')
    expect(TERMINAL.has('not-applied')).toBe(true)
  })

  /**
   * A case is not a job-application feature. Anything else — a tender, a
   * customer, a house purchase — gets the plain flow until a second real
   * instance shows what its own stages should be.
   */
  it('gives an unknown type the generic flow rather than nothing', () => {
    expect(statusesFor('tender')).toEqual(['open', 'in-progress', 'waiting', 'done', 'dropped'])
    expect(statusesFor('task')).toEqual(statusesFor('anything-else'))
  })
})

describe('slugify', () => {
  it('makes a readable, safe filename', () => {
    expect(slugify('Enterprise AI Architect — ALPLA')).toBe('enterprise-ai-architect-alpla')
  })
  it('never returns empty', () => {
    expect(slugify('—')).toBe('case')
  })
})

/**
 * Reading a note.
 *
 * The rule is the browser panel's rule: a wrong offer costs more than a missing
 * one, because it teaches people the suggestions are noise. So these tests care
 * as much about what is NOT suggested.
 */
describe('readNote', () => {
  it('spots a person to look up', () => {
    const s = readNote('I have an invite with Maria Schmidt next week')
    expect(s.find((x) => x.kind === 'research-person')?.value).toBe('Maria Schmidt')
  })

  /**
   * "meeting" was missing from this list until the feature's own example
   * sentence was run through it. A prep offer that does not recognise the
   * commonest word for a conversation is a prep offer that is usually absent.
   */
  it('offers preparation for any word people use for a conversation', () => {
    for (const word of ['Screening interview booked', 'first meeting with her', 'Termin am Montag', 'Gespräch nächste Woche', 'intro call']) {
      expect(readNote(word).some((s) => s.kind === 'prepare-interview'), word).toBe(true)
    }
  })

  it('labels the time properly when a date is in the way', () => {
    // "25.08" is offered to the time parser first and correctly rejected as an
    // hour; it must keep looking rather than settling for "at 14".
    const s = readNote('meeting on Tuesday 25.08.2026 at 14:00').find((x) => x.kind === 'schedule')
    expect(s?.label).toBe('Put 25.08.2026 14:00 in the calendar')
  })

  it('offers to schedule a day it can actually resolve', () => {
    const s = readNote('Call on Thursday').find((x) => x.kind === 'schedule')
    expect(s?.label).toBe('Put Thursday in the calendar')
    expect(Number(s?.value)).toBeGreaterThan(0)
  })

  /**
   * "Next week" is a real phrase and an unschedulable one. Offering it would
   * create an event on a day nobody chose — worse than not offering.
   */
  it('says nothing when the day cannot be pinned down', () => {
    expect(readNote('Invite with Maria Schmidt next week').some((s) => s.kind === 'schedule')).toBe(false)
    expect(readNote('Interview soon').some((s) => s.kind === 'schedule')).toBe(false)
  })

  it('reads German phrasing too', () => {
    const s = readNote('Gespräch mit Anna Weber am Donnerstag')
    expect(s.find((x) => x.kind === 'research-person')?.value).toBe('Anna Weber')
  })

  it('does not treat a single capitalised word as a person', () => {
    // "with ALPLA" is a company; "with Thursday" is a weekday.
    expect(readNote('Applied with ALPLA today').some((s) => s.kind === 'research-person')).toBe(false)
    expect(readNote('Spoke with Thursday deadline in mind').some((s) => s.kind === 'research-person')).toBe(false)
  })

  it('says nothing about an ordinary note', () => {
    expect(readNote('Tidied up the cover letter wording.')).toEqual([])
  })

  it('does not repeat the same person twice', () => {
    const s = readNote('Call with Maria Schmidt, then another call with Maria Schmidt')
    expect(s.filter((x) => x.kind === 'research-person')).toHaveLength(1)
  })
})

/**
 * Turning a named day into a date.
 *
 * `now` is injected throughout: a "next Thursday" test that passes on a
 * Wednesday and fails on a Friday is worse than no test at all.
 */
describe('resolveDay', () => {
  // A Tuesday.
  const TUE = new Date(2026, 7, 18, 14, 0, 0)

  it('resolves a weekday forward, never backward', () => {
    // Thursday is 2 days ahead of this Tuesday.
    const d = resolveDay('interview on Thursday', TUE)
    expect(new Date(d!.at).getDate()).toBe(20)
  })

  it('reads today\'s own weekday as NEXT week, not this morning', () => {
    // Written on Tuesday, "Tuesday" means the one coming — an event in the past
    // is never what someone meant.
    const d = resolveDay('call on Tuesday', TUE)
    expect(new Date(d!.at).getDate()).toBe(25)
  })

  it('handles a weekday earlier in the week by rolling forward', () => {
    const d = resolveDay('call on Monday', TUE)
    expect(new Date(d!.at).getDate()).toBe(24)
  })

  it('understands tomorrow', () => {
    expect(new Date(resolveDay('tomorrow', TUE)!.at).getDate()).toBe(19)
  })

  it('understands German weekdays', () => {
    expect(new Date(resolveDay('Gespräch am Donnerstag', TUE)!.at).getDate()).toBe(20)
  })

  it('takes an explicit date as given', () => {
    const d = resolveDay('interview 2026-09-03', TUE)
    expect(new Date(d!.at).toISOString().slice(0, 10)).toBe('2026-09-03')
  })

  it('returns nothing for a vague phrase', () => {
    expect(resolveDay('next week', TUE)).toBeNull()
    expect(resolveDay('at some point', TUE)).toBeNull()
  })

  it('puts the event at a working hour rather than midnight', () => {
    expect(new Date(resolveDay('Thursday', TUE)!.at).getHours()).toBe(9)
  })
})

/**
 * A note written the way a person actually writes one.
 *
 * "I have my first meeting with Anna Weber on Tuesday 25.08.2026 at 14:00" has
 * to become that exact slot — the whole promise is that saying it puts it in
 * the calendar, and a meeting an hour off is worse than none.
 */
describe('resolveWhen', () => {
  const TUE = new Date(2026, 7, 18, 10, 0, 0) // a Tuesday

  it('reads the full sentence from the example', () => {
    const w = resolveWhen('I have my first meeting with Anna Weber on Tuesday 25.08.2026 at 14:00', TUE)
    const d = new Date(w!.at)
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()])
      .toEqual([2026, 8, 25, 14, 0])
    expect(w!.hasTime).toBe(true)
  })

  it('reads day-first dates, which is how they are written here', () => {
    const d = new Date(resolveWhen('meeting 03.09.2026', TUE)!.at)
    // 3 September, NOT 9 March.
    expect([d.getMonth() + 1, d.getDate()]).toEqual([9, 3])
  })

  it('still reads ISO dates', () => {
    const d = new Date(resolveWhen('interview 2026-09-03 at 11:30', TUE)!.at)
    expect([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([9, 3, 11, 30])
  })

  it('reads German time phrasing', () => {
    const d = new Date(resolveWhen('Gespräch am Donnerstag um 9 Uhr', TUE)!.at)
    expect([d.getDate(), d.getHours()]).toEqual([20, 9])
  })

  it('reads am/pm', () => {
    expect(new Date(resolveWhen('call Thursday at 2pm', TUE)!.at).getHours()).toBe(14)
    expect(new Date(resolveWhen('call Thursday at 9am', TUE)!.at).getHours()).toBe(9)
  })

  it('assumes a working hour when only a day is given, and says so', () => {
    const w = resolveWhen('interview on Thursday', TUE)!
    expect(new Date(w.at).getHours()).toBe(9)
    expect(w.hasTime).toBe(false)
  })

  it('does not mistake a date for a time', () => {
    // 25.08 must not parse as 25:08 or 8 minutes past 25.
    const w = resolveWhen('meeting on 25.08.2026', TUE)!
    expect(new Date(w.at).getHours()).toBe(9)
    expect(w.hasTime).toBe(false)
  })

  it('rolls a weekday forward, never backward', () => {
    expect(new Date(resolveWhen('call on Monday', TUE)!.at).getDate()).toBe(24)
    expect(new Date(resolveWhen('call on Tuesday', TUE)!.at).getDate()).toBe(25)
  })

  it('returns nothing for a phrase that names no day', () => {
    expect(resolveWhen('next week', TUE)).toBeNull()
    expect(resolveWhen('at some point soon', TUE)).toBeNull()
  })
})

/**
 * Offers belong to the case, not to the session that typed the note.
 *
 * They were React state, so an agent's note produced nothing and a restart
 * dropped them — a case would sit there asking for three things, silently.
 */
describe('openSignals', () => {
  const withNotes = (notes: string[], acted: string[] = []): typeof CASE => ({
    ...CASE,
    acted,
    notes: notes.map((text) => ({ at: '2026-08-18T09:00:00.000Z', author: 'you' as const, text })),
  })

  it('reads what the case is asking for from its notes', () => {
    const open = openSignals(withNotes(['Meeting with Anna Weber on 25.08.2026 at 14:00']))
    expect(open.map((s) => s.kind).sort()).toEqual(['prepare-interview', 'research-person', 'schedule'])
  })

  it('does not care who wrote the note', () => {
    const byAgent = { ...CASE, notes: [{ at: 'x', author: 'agent' as const, text: 'Interview with Maria Schmidt confirmed' }] }
    expect(openSignals(byAgent).length).toBeGreaterThan(0)
  })

  it('drops an offer once it has been taken up', () => {
    const notes = ['Meeting with Anna Weber on 25.08.2026 at 14:00']
    const all = openSignals(withNotes(notes))
    const one = all.find((s) => s.kind === 'research-person')!
    const rest = openSignals(withNotes(notes, [signalKey(one)]))
    expect(rest.some((s) => s.kind === 'research-person')).toBe(false)
    // ...and leaves the others alone.
    expect(rest.length).toBe(all.length - 1)
  })

  it('does not offer the same thing twice for two notes about it', () => {
    const open = openSignals(withNotes([
      'call with Anna Weber next month',
      'still waiting to hear from Anna Weber',
    ]))
    expect(open.filter((s) => s.kind === 'research-person')).toHaveLength(1)
  })

  it('puts the newest note first, because that is what just happened', () => {
    const open = openSignals(withNotes(['applied', 'interview with Maria Schmidt on Thursday']))
    expect(open[0].kind).toBe('research-person')
  })

  it('says nothing for a case whose notes ask for nothing', () => {
    expect(openSignals(withNotes(['sent it off', 'no reply yet']))).toEqual([])
  })

  /*
   * The prepare offer's label is the same fixed sentence whatever note produced
   * it, but its key embeds the note text — so two notes about meetings survived
   * dedup and rendered as twin identical "Prepare me" buttons on a real case.
   */
  it('offers to prepare only once, for the newest conversation mentioned', () => {
    const open = openSignals(withNotes([
      'screening call went fine',
      'interview with the hiring manager on Thursday',
    ]))
    const prepare = open.filter((s) => s.kind === 'prepare-interview')
    expect(prepare).toHaveLength(1)
    // Notes are newest-last in the file; the offer comes from the newest.
    expect(prepare[0].value).toContain('hiring manager')
  })

  it('retires older conversation mentions once the newest prep was taken up', () => {
    const notes = ['screening call went fine', 'interview with the hiring manager on Thursday']
    const newest = openSignals(withNotes(notes)).find((s) => s.kind === 'prepare-interview')!
    const after = openSignals(withNotes(notes, [signalKey(newest)]))
    expect(after.some((s) => s.kind === 'prepare-interview')).toBe(false)
  })
})

/**
 * An empty field must not eat the next one.
 *
 * `field()` used `\s*`, which matches a newline — so a case with no subject
 * stored "status: drafted" as its subject and wrote that back to disk. The
 * file still looked plausible, which is why it survived until a case was read
 * closely rather than looked at.
 */
describe('empty frontmatter fields', () => {
  const withEmpty = [
    '---',
    'type: application',
    'title: ALPLA',
    'description:',
    'subject:',
    'status: interview',
    'created: 2026-08-18T11:00:00.000Z',
    'updated: 2026-08-18T11:00:00.000Z',
    'artifacts:',
    'acted:',
    '---',
    '',
    '# ALPLA',
  ].join('\n')

  it('reads an empty field as empty, not as the next line', () => {
    const c = parseCase('alpla', withEmpty)
    expect(c.subject).toBe('')
    expect(c.description).toBe('')
    expect(c.status).toBe('interview')
  })

  it('survives the round trip without inventing a subject', () => {
    const once = parseCase('alpla', withEmpty)
    const twice = parseCase('alpla', serializeCase(once))
    expect(twice.subject).toBe('')
    expect(twice.status).toBe('interview')
    expect(twice.title).toBe('ALPLA')
  })
})

/**
 * The app's own bookkeeping is not somebody asking for something.
 */
describe('system notes', () => {
  const note = (author: 'you' | 'system', text: string): CaseNote => ({
    at: '2026-08-18T09:00:00.000Z',
    author,
    text,
  })

  it('does not read a status change as a request', () => {
    const c = { ...CASE, notes: [note('system', 'Status → interview')] }
    expect(openSignals(c)).toEqual([])
  })

  it('still reads the same words from a person', () => {
    const c = { ...CASE, notes: [note('you', 'moved to interview')] }
    expect(openSignals(c).some((s) => s.kind === 'prepare-interview')).toBe(true)
  })

  it('keeps a system note in the file', () => {
    const c = { ...CASE, notes: [note('system', 'Status → applied')] }
    expect(parseCase('x', serializeCase(c)).notes[0].author).toBe('system')
  })
})
