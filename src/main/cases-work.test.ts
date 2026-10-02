import { describe, it, expect } from 'vitest'
import path from 'path'
import { promotedPath, workFolderFor, workFolderGuidance } from './cases-work'

describe('case work folders', () => {
  it('lives under Work/<case-id> next to Cases/', () => {
    expect(workFolderFor('/ws', 'onboarding-research')).toBe(path.join('/ws', 'Work', 'onboarding-research'))
  })

  it('refuses ids that would escape the folder', () => {
    expect(workFolderFor('/ws', '../../etc')).toBe(path.join('/ws', 'Work', 'etc'))
    expect(() => workFolderFor('/ws', '../..')).toThrow()
  })

  it('promotes a draft to the same place under outputs', () => {
    const f = '/ws/Work/c1'
    expect(promotedPath(f, '/ws/Work/c1/drafts/report.md')).toBe('/ws/Work/c1/outputs/report.md')
    expect(promotedPath(f, '/ws/Work/c1/drafts/charts/q1.png')).toBe('/ws/Work/c1/outputs/charts/q1.png')
  })

  it('does not promote what is not a draft of this case', () => {
    expect(promotedPath('/ws/Work/c1', '/ws/Work/c1/sources/page.md')).toBeNull()
    expect(promotedPath('/ws/Work/c1', '/ws/Work/c2/drafts/x.md')).toBeNull()
    expect(promotedPath('/ws/Work/c1', '/ws/Work/c1/drafts/../../c2/drafts/x.md')).toBeNull()
  })

  it('tells the agent where to write, relative to the workspace', () => {
    const g = workFolderGuidance('/ws/Work/c1', '/ws')
    expect(g).toContain('Work/c1/drafts/')
    expect(g).toContain('Do not write to Work/c1/outputs/')
  })
})
