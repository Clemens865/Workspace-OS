import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getProviderModel, getCodexEffort, loadProviderSettings, setProviderModel, setCodexEffort } from './providerSettings'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
describe('provider settings are available before the renderer starts', () => {
  it('restores Codex model and effort from main-owned persistence', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-model-')); dirs.push(dir)
    loadProviderSettings(dir); setProviderModel('codex:test-model'); setCodexEffort('high')
    loadProviderSettings(dir)
    expect(getProviderModel()).toBe('codex:test-model'); expect(getCodexEffort()).toBe('high')
    expect(fs.statSync(path.join(dir, 'agent-provider.json')).mode & 0o777).toBe(0o600)
  })
  it('keeps the legacy Claude default on first launch and rejects corrupt effort', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-model-')); dirs.push(dir)
    loadProviderSettings(dir)
    expect(getProviderModel()).toBe(''); expect(getCodexEffort()).toBe('')
    fs.writeFileSync(path.join(dir, 'agent-provider.json'), JSON.stringify({ model: 'haiku', effort: '--unsafe' }))
    loadProviderSettings(dir)
    expect(getProviderModel()).toBe('haiku'); expect(getCodexEffort()).toBe('')
  })
})
