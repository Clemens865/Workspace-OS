import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ one: vi.fn(), json: vi.fn(), codex: vi.fn(), model: '' }))
vi.mock('../mail/claude-oneshot', () => ({ runClaudeOneShot: f.one }))
vi.mock('./claudeRun', () => ({ runClaudeJson: f.json }))
vi.mock('./providerSettings', () => ({ getProviderModel: () => f.model }))
vi.mock('./providers/codexText', () => ({ runCodexText: f.codex }))
import { runProviderOneShot, runProviderJson } from './providerText'
beforeEach(() => { vi.clearAllMocks(); f.model = '' })
describe('internal provider dispatch preserves Claude', () => {
  it('passes the exact existing Claude options and return value through', async () => {
    const opts = { model: 'haiku', timeoutMs: 1234, label: 'draft' }
    f.one.mockResolvedValue('unchanged'); f.json.mockResolvedValue({ text: 'json', code: 0, timedOut: false })
    expect(await runProviderOneShot('prompt', opts)).toBe('unchanged')
    expect(f.one).toHaveBeenCalledWith('prompt', opts)
    const jsonOpts = { prompt: 'inspect', cwd: '/workspace', allowedTools: ['Read'] }
    await runProviderJson(jsonOpts)
    expect(f.json).toHaveBeenCalledWith(jsonOpts)
    expect(f.codex).not.toHaveBeenCalled()
  })
  it('runs all internal tasks on Codex when selected without spawning Claude', async () => {
    f.model = 'codex:test-model'; f.codex.mockResolvedValue({ text: ' answer ', code: 0, timedOut: false })
    expect(await runProviderOneShot('draft', { model: 'haiku', label: 'Draft', timeoutMs: 1000 })).toBe('answer')
    await runProviderJson({ prompt: 'foundry' })
    expect(f.codex).toHaveBeenCalledTimes(2)
    expect(f.one).not.toHaveBeenCalled(); expect(f.json).not.toHaveBeenCalled()
  })
  it('does not silently fall back to Claude after a Codex failure', async () => {
    f.model = 'codex:'; f.codex.mockResolvedValue({ text: '', code: 1, timedOut: false })
    await expect(runProviderOneShot('draft', { label: 'Draft', timeoutMs: 1000 })).rejects.toThrow('Codex')
    expect(f.one).not.toHaveBeenCalled()
  })
})
