import { describe, it, expect } from 'vitest'
import { continuePausedWorkPrompt, pausedResumePrompt } from '../../shared/agentRun'

describe('pausedResumePrompt', () => {
  it('is the plain continue prompt when nothing was written', () => {
    expect(pausedResumePrompt(null)).toBe(continuePausedWorkPrompt)
    expect(pausedResumePrompt('   ')).toBe(continuePausedWorkPrompt)
  })

  it("hands back the turn's last words, since the session does not keep them", () => {
    const p = pausedResumePrompt('One\nTwo\nThree\nFourteen')
    expect(p.startsWith(continuePausedWorkPrompt)).toBe(true)
    expect(p).toContain('«One\nTwo\nThree\nFourteen»')
    expect(p).toContain('the task is NOT finished')
    expect(p).toContain('from the very next step')
  })

  it('strips terminal colour codes and keeps only the end', () => {
    const p = pausedResumePrompt('\x1b[2mdim\x1b[0m' + 'x'.repeat(2000) + 'END')
    expect(p).not.toContain('\x1b[')
    expect(p).toContain('END»')
    expect(p.length).toBeLessThan(continuePausedWorkPrompt.length + 1200)
  })
})
