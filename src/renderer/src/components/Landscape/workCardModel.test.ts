import { describe, expect, it } from 'vitest'
import { caseCard, firstSentence, hostOf, sessionCard, statusLabel } from './workCardModel'

const FLOW = ['drafted', 'applied', 'interview', 'offer', 'accepted', 'rejected', 'not-applied']
const TERMINAL = new Set(['accepted', 'rejected', 'not-applied', 'closed', 'done', 'dropped'])

const c = (over = {}) => ({
  status: 'interview',
  description: 'Application to Dynatrace Principal PM seat defining strategy. €109–136k, Vienna or Linz hybrid.',
  subject: 'https://www.dynatrace.com/careers/job/123',
  notes: [
    { at: '2026-10-01T10:00:00Z', author: 'agent', text: 'Felix: German prep doc written' },
    { at: '2026-10-02T09:00:00Z', author: 'system', text: 'Status → interview' },
  ],
  artifacts: ['cv/a.docx', 'cv/b.md', 'cv/c.pdf', 'cv/d.md'],
  signals: [{ label: 'Put Friday 10:00 in the calendar' }],
  ...over,
})

describe('caseCard', () => {
  it('says the status in the case’s own words and how far along it is', () => {
    const k = caseCard(c(), FLOW, TERMINAL, [])
    expect(k.status).toBe('Interview')
    expect(k.stage).toEqual({ index: 3, count: 4 })
  })

  it('says what it is about: the first sentence, and the subject’s site', () => {
    const k = caseCard(c(), FLOW, TERMINAL, [])
    expect(k.about).toBe('Application to Dynatrace Principal PM seat defining strategy.')
    expect(k.host).toBe('dynatrace.com')
  })

  it('what happened last skips the app’s own status lines, and names the agent', () => {
    const k = caseCard(c(), FLOW, TERMINAL, [])
    expect(k.last).toMatchObject({ who: 'Felix', text: 'German prep doc written' })
  })

  it('what is next comes from the notes’ offers, and makes the card want you', () => {
    const k = caseCard(c(), FLOW, TERMINAL, [])
    expect(k.next).toBe('Put Friday 10:00 in the calendar')
    expect(k.needsYou).toBe(true)
    expect(k.tone).toBe('warm')
  })

  it('tones: won is done, a closed path is grey, moving on its own is go', () => {
    expect(caseCard(c({ status: 'accepted', signals: [] }), FLOW, TERMINAL, []).tone).toBe('done')
    expect(caseCard(c({ status: 'not-applied', signals: [] }), FLOW, TERMINAL, []).tone).toBe('grey')
    expect(caseCard(c({ status: 'applied', signals: [] }), FLOW, TERMINAL, []).tone).toBe('go')
    expect(caseCard(c({ status: 'not-applied', signals: [] }), FLOW, TERMINAL, []).stage).toBeNull()
  })

  it('says nothing about it rather than the title again or the app’s own start line', () => {
    expect(caseCard(c({ title: 'Find three grants', description: 'Find three grants for the pilot.\n\nStarted with Quill on 2.10.2026.' }), FLOW, TERMINAL, []).about).toBeNull()
    expect(caseCard(c({ description: 'Started with Quill on 2.10.2026.' }), FLOW, TERMINAL, []).about).toBeNull()
  })

  it('only the app’s own status lines: nothing was noted', () => {
    expect(caseCard(c({ notes: [{ at: '2026-10-02T09:00:00Z', author: 'system', text: 'Status → interview' }] }), FLOW, TERMINAL, []).last).toBeNull()
  })

  it('shows the newest three files, counts them all, and who worked on it', () => {
    const k = caseCard(c(), FLOW, TERMINAL, ['Felix — Funding Scout', 'Elias — Application Tailor', 'Felix — Funding Scout'])
    expect(k.files).toEqual(['cv/d.md', 'cv/c.pdf', 'cv/b.md'])
    expect(k.fileCount).toBe(4)
    expect(k.agents).toEqual(['Felix', 'Elias'])
  })
})

describe('sessionCard', () => {
  it('a loose session: its ask, the agent’s last line, and the offer to keep it', () => {
    const k = sessionCard(
      { agentName: 'Nadia — Research Analyst', files: ['/w/x.xlsx'], turns: 2, messages: [{ role: 'user', text: 'Compare two laptop offers. Quickly.', at: 1 }, { role: 'agent', text: 'Looked.\n\nThe M5 is the better buy at €1,899.', at: 2 }] },
      true,
    )
    expect(k).toMatchObject({ status: 'Session', about: 'Compare two laptop offers.', next: 'Keep it as a case', tone: 'warm', agents: ['Nadia'] })
    expect(k.last).toMatchObject({ who: 'Nadia', text: 'The M5 is the better buy at €1,899.' })
  })

  it('when the ask only repeats the title, it says what came of it instead', () => {
    const k = sessionCard(
      { title: 'Compare two laptop offers for the', agentName: null, files: [], turns: 1, messages: [{ role: 'user', text: 'Compare two laptop offers for the team', at: 1 }, { role: 'agent', text: 'The M5 wins on battery.', at: 2 }] },
      false,
    )
    expect(k.about).toBe('Assistant: The M5 wins on battery.')
  })
})

describe('helpers', () => {
  it('labels, hosts, sentences', () => {
    expect(statusLabel('not-applied')).toBe('Not applied')
    expect(hostOf('mailto:x@y')).toBeNull()
    expect(hostOf('not a url')).toBeNull()
    expect(firstSentence('One. Two.')).toBe('One.')
  })
})
