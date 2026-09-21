import { describe, it, expect } from 'vitest'
import { appendStep, traceHeader, TRACE_MAX, type TraceStep } from './runTraceModel'

const ev = (label: string, chip?: string, kind = 'run') => ({ kind, label, chip })

describe('appendStep', () => {
  it('merges consecutive identical calls into one row with a count', () => {
    let steps: TraceStep[] = []
    steps = appendStep(steps, ev('Browsing the web', 'linkedin.com', 'web'), 1)
    steps = appendStep(steps, ev('Browsing the web', 'linkedin.com', 'web'), 2)
    steps = appendStep(steps, ev('Browsing the web', 'linkedin.com', 'web'), 3)
    expect(steps).toHaveLength(1)
    expect(steps[0].count).toBe(3)
    expect(steps[0].at).toBe(3) // the row carries its LATEST time
  })

  it('a different chip is a different row — reading two files is two steps', () => {
    let steps: TraceStep[] = []
    steps = appendStep(steps, ev('Reading a file', 'a.md', 'read'), 1)
    steps = appendStep(steps, ev('Reading a file', 'b.md', 'read'), 2)
    expect(steps).toHaveLength(2)
  })

  it('caps the trail so a runaway run cannot grow it unbounded', () => {
    let steps: TraceStep[] = []
    for (let i = 0; i < TRACE_MAX + 20; i++) steps = appendStep(steps, ev(`step ${i}`), i)
    expect(steps).toHaveLength(TRACE_MAX)
    expect(steps[steps.length - 1].label).toBe(`step ${TRACE_MAX + 19}`)
  })
})

describe('traceHeader', () => {
  it('counts tool calls including merged repeats, excluding thinking', () => {
    let steps: TraceStep[] = []
    steps = appendStep(steps, ev('Thinking', undefined, 'think'), 1)
    steps = appendStep(steps, ev('Reading a file', 'a.md', 'read'), 2)
    steps = appendStep(steps, ev('Reading a file', 'a.md', 'read'), 3)
    steps = appendStep(steps, ev('Running a command', 'npm test'), 4)
    expect(traceHeader(steps)).toBe('3 tool calls')
  })

  it('says Thinking while only thought has happened, and Working before anything has', () => {
    expect(traceHeader([])).toBe('Working')
    const thinking = appendStep([], ev('Thinking', undefined, 'think'), 1)
    expect(traceHeader(thinking)).toBe('Thinking')
    const one = appendStep([], ev('Reading a file', 'a.md', 'read'), 1)
    expect(traceHeader(one)).toBe('1 tool call')
  })
})
