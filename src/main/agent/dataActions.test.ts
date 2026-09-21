import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../ipc-registry', () => ({ WORKSPACE_DATA_OPERATIONS: ['metric:list', 'metric:create', 'metric:update', 'metric:refreshFromSource', 'transclusion:syncAll'], invokeWorkspaceData: f.invoke }))
vi.mock('../workspace-root', () => ({ getWorkspaceRoot: () => '/workspace' }))
import { dataAction } from './dataActions'
beforeEach(() => { f.invoke.mockReset(); f.invoke.mockImplementation(async (op) => op === 'metric:list' ? [] : { ok: true }) })
describe('grant-backed data operations', () => {
  it('refuses arbitrary IPC, deletion, and out-of-workspace input before dispatch', async () => {
    for (const input of [{ operation: 'shell:spawn', args: [] }, { operation: 'metric:delete', args: ['metric-1'] }, { operation: 'metric:create', args: [{ filePath: '/private/report.xlsx' }] }]) expect((await dataAction(input)).ok).toBe(false)
    expect(f.invoke).not.toHaveBeenCalled()
  })
  it('rejects sync when a stored target belongs to another workspace', async () => {
    f.invoke.mockImplementation(async (op) => op === 'metric:list' ? [{ id: 'metric-1' }] : [{ filePath: '/other/workspace/target.docx' }])
    expect((await dataAction({ operation: 'transclusion:syncAll', args: ['metric-1'] })).ok).toBe(false)
    expect(f.invoke).not.toHaveBeenCalledWith('transclusion:syncAll', expect.anything())
  })
  it('reuses the validated operation and exact arguments', async () => {
    expect((await dataAction({ operation: 'metric:create', args: ['Revenue', 100] })).ok).toBe(true)
    expect(f.invoke).toHaveBeenCalledWith('metric:create', ['Revenue', 100])
  })

  it('a record made in another workspace can still be renamed and listed; only refresh/sync stay scoped', async () => {
    const foreign = { id: 'metric-1', source: { filePath: '/other/workspace/Budget.xlsx' } }
    f.invoke.mockImplementation(async (op) => op === 'metric:list' ? [foreign] : op === 'transclusion:forMetric' ? [] : { ok: true })
    expect((await dataAction({ operation: 'metric:update', args: ['metric-1', { name: 'Revenue' }] })).ok).toBe(true)
    expect(f.invoke).toHaveBeenCalledWith('metric:update', ['metric-1', { name: 'Revenue' }])
    const listed = await dataAction({ operation: 'metric:list', args: [] })
    expect(listed).toEqual({ ok: true, result: [foreign] })
    expect((await dataAction({ operation: 'metric:refreshFromSource', args: ['metric-1'] })).ok).toBe(false)
    expect(f.invoke).not.toHaveBeenCalledWith('metric:refreshFromSource', expect.anything())
  })
})
