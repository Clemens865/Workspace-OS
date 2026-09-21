import { invokeWorkspaceData, WORKSPACE_DATA_OPERATIONS } from '../ipc-registry'
import { getWorkspaceRoot } from '../workspace-root'
import { validateFilePath } from '../ipc-validator'
import type { ActionReply } from './actionBridge'

function checkPaths(value: unknown, root: string, depth = 0): void {
  if (depth > 30) throw new Error('Data input is too deeply nested')
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'filePath') validateFilePath(item, root)
    else checkPaths(item, root, depth + 1)
  }
}

/** Reuses the same validated data operations as the UI, with an extra workspace scope check. */
export async function dataAction(raw: unknown): Promise<ActionReply> {
  const root = getWorkspaceRoot()
  if (!root) return { ok: false, error: 'Open a workspace first' }
  try {
    const input = raw as { operation?: string; args?: unknown[] }
    if (input?.operation === 'help') return { ok: true, result: { operations: WORKSPACE_DATA_OPERATIONS, examples: [{ operation: 'metric:create', args: ['Revenue', 1200] }, { operation: 'metric:createFromSource', args: ['Revenue', { kind: 'xlsx-cell', filePath: `${root}/Budget.xlsx`, sheet: 'Sheet1', cell: 'B2' }] }] } }
    if (!input || !(WORKSPACE_DATA_OPERATIONS as readonly unknown[]).includes(input.operation) || !Array.isArray(input.args) || input.args.length > 4) throw new Error('Invalid workspace data operation')
    const operation = input.operation!, args = input.args
    checkPaths(args, root)
    // The stores are global across workspaces. Only operations that FOLLOW a
    // stored path to a file (refresh reads the source, sync writes the targets)
    // must stay inside this workspace; renaming or listing a record made in
    // another workspace touches no file and stays allowed, as it is in the UI.
    if (/:(refresh|refreshFromSource|syncAll)$/.test(operation) && typeof args[0] === 'string') {
      const family = operation.startsWith('metric:') || operation.startsWith('transclusion:') ? 'metric' : operation.startsWith('range') ? 'range' : 'collection'
      const link = family === 'metric' ? 'transclusion:forMetric' : family === 'range' ? 'rangeLink:forRange' : 'collectionLink:forCollection'
      const records = await invokeWorkspaceData(`${family}:list`, []) as { id: string }[]
      checkPaths(records.find((r) => r.id === args[0]), root)
      checkPaths(await invokeWorkspaceData(link, [args[0]]), root)
    }
    return { ok: true, result: await invokeWorkspaceData(operation, args) }
  } catch (err) { return { ok: false, error: (err as Error).message } }
}
