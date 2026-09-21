import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ instances: [] as any[], startFails: false, startHangs: null as null | { promise: Promise<any>; reject: (e: Error) => void } }))
vi.mock('./codexRpc', () => ({ CodexRpc: class {
  child = { pid: 42 }; options: any; respond = vi.fn(); reject = vi.fn(); close = vi.fn(); initialize = vi.fn(async () => {})
  request = vi.fn(async (method: string) => {
    if (method === 'thread/start' && mock.startFails) throw new Error('not signed in')
    if (method === 'thread/start' && mock.startHangs) return mock.startHangs.promise
    return method === 'config/read' ? { config: { mcp_servers: { ambient: {} } } } : method === 'thread/start' || method === 'thread/resume' ? { thread: { id: '00000000-0000-0000-0000-000000000001' } } : { turn: { id: 'turn-1' } }
  })
  constructor(options: any) { this.options = options; mock.instances.push(this); this.close.mockImplementation(() => mock.startHangs?.reject(new Error('Codex session closed'))) }
} }))
import { launchCodexSession, codexThreadConfig, answerCodex, steerCodex, cancelCodex } from './codexSession'
const setup = async (extra = {}) => {
  const sink = { output: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
  const onQuestion = vi.fn(), onFinish = vi.fn()
  await launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'persona', safeMode: true, env: {}, connectors: { mcpServers: {} }, sink, onQuestion, onFinish, ...extra })
  return { sink, onQuestion, onFinish, rpc: mock.instances.at(-1) }
}
beforeEach(() => { mock.instances.length = 0; mock.startFails = false; mock.startHangs = null })
afterEach(() => { cancelCodex('test-run'); vi.useRealTimers() })
describe('Codex session and isolation', () => {
  it('disables inherited connectors and uses refreshable authentication helpers', () => {
    const config = codexThreadConfig({ mcp_servers: { ambient: {} } }, { mcpServers: { remote: { url: 'https://example.test/mcp', headersHelper: '/bin/wos-token remote' }, local: { command: 'node', args: ['server'], env: { SECRET: '${SECRET}' } } } })
    expect(config.mcp_servers.ambient.enabled).toBe(false)
    expect(config.mcp_servers.remote.http_headers_helper).toBe('/bin/wos-token remote')
    expect(config.mcp_servers.local.env_vars).toEqual(['SECRET'])
    expect(JSON.stringify(config)).not.toContain('${SECRET}')
    expect(config.mcp_servers.remote.default_tools_approval_mode).toBe('writes') // reads never prompt; writes do
  })
  it('resumes with current instructions, sandbox, model, and effort', async () => {
    const s = await setup({ resumeId: '00000000-0000-0000-0000-000000000002', model: 'test', effort: 'high' })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ sandbox: 'read-only', approvalPolicy: 'on-request', developerInstructions: 'persona', model: 'test' }), 60000)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/start', expect.objectContaining({ effort: 'high' }))
  })
  it('correlates approvals and never accepts a stale or foreign request', async () => {
    const s = await setup()
    s.rpc.options.onRequest(9, 'item/commandExecution/requestApproval', { command: 'ls' })
    expect(answerCodex('another-run', '9', { allow: true })).toBe(false)
    expect(answerCodex('test-run', '9', { allow: false })).toBe(true)
    expect(s.rpc.respond).toHaveBeenCalledWith(9, { decision: 'decline' })
    expect(answerCodex('test-run', '9', { allow: true })).toBe(false)
    expect(s.onQuestion).toHaveBeenCalledWith({ runId: 'test-run', requestId: '9', resolved: true })
  })
  it('delivers user answers and connector forms without inventing values', async () => {
    const s = await setup()
    s.rpc.options.onRequest(1, 'item/tool/requestUserInput', { questions: [{ id: 'choice' }] })
    expect(() => answerCodex('test-run', '1', {})).toThrow()
    answerCodex('test-run', '1', { answers: { choice: { answers: ['A'] } } })
    expect(s.rpc.respond).toHaveBeenCalledWith(1, { answers: { choice: { answers: ['A'] } } })
    s.rpc.options.onRequest(2, 'mcpServer/elicitation/request', { mode: 'form', requestedSchema: { required: ['name'] } })
    expect(() => answerCodex('test-run', '2', { allow: true, content: {} })).toThrow()
    answerCodex('test-run', '2', { allow: true, content: { name: 'User choice' } })
    expect(s.rpc.respond).toHaveBeenCalledWith(2, { action: 'accept', content: { name: 'User choice' }, _meta: null })
  })
  it('steers the active turn and records interruptions as non-success exactly once', async () => {
    const s = await setup()
    expect(await steerCodex('test-run', 'new input')).toBe(true)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/steer', expect.objectContaining({ expectedTurnId: 'turn-1' }))
    cancelCodex('test-run')
    s.rpc.options.onClose(new Error('closed'))
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(130)
    expect(s.rpc.request).toHaveBeenCalledWith('turn/interrupt', expect.anything(), 2000)
  })
  it('streams an answer once and reports tokens separately from unknown dollar cost', async () => {
    const s = await setup()
    s.rpc.options.onNotification('item/agentMessage/delta', { itemId: 'a', delta: 'hello' })
    s.rpc.options.onNotification('item/completed', { item: { id: 'a', type: 'agentMessage', text: 'hello' } })
    s.rpc.options.onNotification('thread/tokenUsage/updated', { tokenUsage: { last: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 } } })
    s.rpc.options.onNotification('turn/completed', { turn: { status: 'completed' } })
    expect(s.sink.output.mock.calls.filter(([t]) => t === 'hello')).toHaveLength(1)
    expect(s.sink.meta).toHaveBeenCalledWith(expect.objectContaining({ provider: 'codex', costKnown: false, inputTokens: 100, outputTokens: 20, cachedInputTokens: 50 }))
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(0)
  })
  it('routes structured app actions through the supplied grant handler in unattended Safe mode', async () => {
    const onAction = vi.fn(async () => ({ ok: true, result: { path: '/workspace/report.md' } }))
    const s = await setup({ onAction, idleTimeoutMs: 1000 })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/start', expect.objectContaining({ dynamicTools: expect.arrayContaining([expect.objectContaining({ name: 'workspace_action' })]) }), 60000)
    s.rpc.options.onRequest(3, 'item/tool/call', { tool: 'workspace_action', arguments: { actionId: 'document.generate', args: { format: 'md' } } })
    await Promise.resolve()
    expect(onAction).toHaveBeenCalledWith('document.generate', { format: 'md' })
    expect(s.rpc.respond).toHaveBeenCalledWith(3, expect.objectContaining({ success: true }))
    expect(s.onQuestion).not.toHaveBeenCalled()
  })
  it('ignores child-agent completion and interrupts a turn when its startup signal is aborted', async () => {
    const controller = new AbortController()
    const s = await setup({ signal: controller.signal })
    s.rpc.options.onNotification('turn/completed', { threadId: 'child-thread', turn: { status: 'completed' } })
    expect(s.onFinish).not.toHaveBeenCalled()
    controller.abort()
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(130)
  })
  it('declines unattended approvals and ends an idle run with timeout code 124', async () => {
    vi.useFakeTimers()
    const s = await setup({ idleTimeoutMs: 1000 })
    s.rpc.options.onRequest(1, 'item/fileChange/requestApproval', {})
    expect(s.rpc.respond).toHaveBeenCalledWith(1, { decision: 'decline' })
    expect(s.onQuestion).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1001)
    expect(s.onFinish).toHaveBeenCalledExactlyOnceWith(124)
  })

  // Review fixes 2026-09-08 (each was a verified defect on the first cut).
  it('offers the workspace tool on a resumed thread, not only on the first turn', async () => {
    const s = await setup({ resumeId: '00000000-0000-0000-0000-000000000002', onAction: vi.fn(async () => ({ ok: true })) })
    expect(s.rpc.request).toHaveBeenCalledWith('thread/resume', expect.objectContaining({ threadId: '00000000-0000-0000-0000-000000000002', dynamicTools: expect.arrayContaining([expect.objectContaining({ name: 'workspace_action' })]) }), 60000)
  })
  it('keeps outbound network in Full mode and leaves web search to the user config', () => {
    const full = codexThreadConfig({}, { mcpServers: {} }, false)
    const safe = codexThreadConfig({}, { mcpServers: {} }, true)
    expect(full.sandbox_workspace_write).toEqual({ network_access: true })
    expect(safe.sandbox_workspace_write).toEqual({ network_access: false })
    expect('web_search' in full).toBe(false)
  })
  it('a failed start rejects once and reports no completion (the caller reports it)', async () => {
    mock.startFails = true
    const sink = { output: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
    const onFinish = vi.fn()
    await expect(launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'p', safeMode: true, env: {}, connectors: { mcpServers: {} }, sink, onQuestion: vi.fn(), onFinish })).rejects.toThrow('not signed in')
    expect(onFinish).not.toHaveBeenCalled()
    expect(sink.meta).not.toHaveBeenCalled()
    expect(mock.instances.at(-1).close).toHaveBeenCalled()
    expect(cancelCodex('test-run')).toBe(false) // nothing left registered
  })
  it('a cancel during startup completes the run exactly once and does not also reject', async () => {
    let reject!: (e: Error) => void
    mock.startHangs = { promise: new Promise((_, r) => { reject = r }), reject: (e) => reject(e) }
    const controller = new AbortController()
    const sink = { output: vi.fn(), meta: vi.fn(), activity: vi.fn(), artifacts: vi.fn(), artifact: vi.fn(), done: vi.fn(), sessionId: vi.fn() }
    const onFinish = vi.fn()
    const launch = launchCodexSession({ runId: 'test-run', cwd: '/workspace', prompt: 'user', instructions: 'p', safeMode: true, env: {}, connectors: { mcpServers: {} }, sink, onQuestion: vi.fn(), onFinish, signal: controller.signal })
    await Promise.resolve(); await Promise.resolve()
    controller.abort()
    await expect(launch).resolves.toBeDefined()
    expect(onFinish).toHaveBeenCalledExactlyOnceWith(130)
  })
})
