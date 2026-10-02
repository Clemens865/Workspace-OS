import { describe, expect, it } from 'vitest'
import { browserDriver } from './browserDriver'

describe('browserDriver', () => {
  it('remembers the tab each run drives, and the latest drive of all', () => {
    browserDriver.record('run-a', 'browser.navigate', 'tab-1')
    browserDriver.record('run-b', 'browser.navigate')
    expect(browserDriver.forRun('run-a')).toMatchObject({ runId: 'run-a', tab: 'tab-1' })
    expect(browserDriver.forRun('run-b')).toMatchObject({ runId: 'run-b', tab: null })
    expect(browserDriver.get()?.runId).toBe('run-b')
  })

  it('ignores actions that are not browser actions, and calls without a run', () => {
    browserDriver.record('run-c', 'files.open', 'tab-9')
    browserDriver.record(undefined, 'browser.navigate', 'tab-9')
    expect(browserDriver.forRun('run-c')).toBeNull()
  })
})
