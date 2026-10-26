import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-hostset-'))
vi.mock('./userdata-path', () => ({ userDataDir: () => dir }))

import { hostSettings, hostSettingsPath, resetHostSettingsCache, setHostSettings, windowStyle } from './host-profile'

describe('window style setting', () => {
  beforeEach(() => {
    fs.rmSync(hostSettingsPath(), { force: true })
    resetHostSettingsCache()
    delete process.env['WOS_WINDOW_STYLE']
  })
  afterEach(() => { delete process.env['WOS_WINDOW_STYLE'] })

  it('is standard until set, then what was set', () => {
    expect(windowStyle()).toBe('standard')
    setHostSettings({ windowStyle: 'clean' })
    expect(windowStyle()).toBe('clean')
  })

  it('keeps the other keys of a hand-edited file', () => {
    fs.writeFileSync(hostSettingsPath(), JSON.stringify({ gpu: 'off', workspaces: { '/ws': { agentHooks: 'project' } } }))
    setHostSettings({ windowStyle: 'clean' })
    expect(JSON.parse(fs.readFileSync(hostSettingsPath(), 'utf-8'))).toEqual({ gpu: 'off', workspaces: { '/ws': { agentHooks: 'project' } }, windowStyle: 'clean' })
    expect(hostSettings().gpu).toBe('off')
  })

  it('an environment variable wins; an unknown value reads as standard', () => {
    setHostSettings({ windowStyle: 'clean' })
    process.env['WOS_WINDOW_STYLE'] = 'standard'
    expect(windowStyle()).toBe('standard')
    delete process.env['WOS_WINDOW_STYLE']
    fs.writeFileSync(hostSettingsPath(), JSON.stringify({ windowStyle: 'fancy' }))
    resetHostSettingsCache()
    expect(windowStyle()).toBe('standard')
  })
})
