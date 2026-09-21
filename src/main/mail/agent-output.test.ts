import { describe, it, expect } from 'vitest'
import { stripAgentTelemetry } from './agent-output'

describe('stripAgentTelemetry', () => {
  it('strips the exact PROGRESS/DECISION telemetry seen in dogfooding', () => {
    const raw = [
      'PROGRESS: Drafted a concise reply to Priya about the Q3 forecast.',
      'DECISION: Offered both the finance-model and sales-adjusted views in one file.',
      'Hi Priya,',
      '',
      'Yes — I will send the updated Q3 forecast before our call. I will include both the',
      'finance-model numbers and a sales-adjusted tab so you can compare against pipeline.',
      '',
      'Best,',
      '[Your name]',
    ].join('\n')
    const out = stripAgentTelemetry(raw)
    expect(out).not.toContain('PROGRESS:')
    expect(out).not.toContain('DECISION:')
    expect(out.startsWith('Hi Priya,')).toBe(true)
    expect(out).toContain('sales-adjusted tab')
    expect(out).toContain('[Your name]')
  })

  it('drops a single leading "Here\'s the draft:" preamble', () => {
    expect(stripAgentTelemetry("Here's the revised email:\nHello there,\nThanks!")).toBe('Hello there,\nThanks!')
  })

  it('leaves a clean body untouched', () => {
    const body = 'Hi Sam,\n\nThanks for the deck — looks great. One note on slide 7.\n\nBest,\nClemens'
    expect(stripAgentTelemetry(body)).toBe(body)
  })

  it('does NOT strip normal prose that merely starts with a capitalized word + colon', () => {
    // Title-case "Note:" / mixed-case is legitimate email content, not telemetry.
    const body = 'Hi,\n\nNote: the meeting moved to 3pm.\n\nProgress: on track for Friday.\n\nThanks'
    const out = stripAgentTelemetry(body)
    expect(out).toContain('Note: the meeting moved to 3pm.')
    expect(out).toContain('Progress: on track for Friday.')
  })

  it('is fail-safe: never returns empty when the model produced text', () => {
    // A pathological all-telemetry output — better to keep it than blank the draft.
    const allMeta = 'PROGRESS: did a thing\nDECISION: chose a thing'
    expect(stripAgentTelemetry(allMeta)).toBe(allMeta)
    expect(stripAgentTelemetry('')).toBe('')
  })
})
