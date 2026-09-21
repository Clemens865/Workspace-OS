import { IpcValidationError, validateFilePath } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'

/**
 * Confine a transclusion source/target file path to the workspace root.
 *
 * The metric/range/collection `createFromSource` and `*Link:add` handlers take
 * a filePath and then read from or (via syncAll) write to it. Left unvalidated,
 * an agent — or a prompt-injected instruction — could point them at any .xlsx
 * on disk: read one for exfiltration, or overwrite one via the atomic
 * rename in the range/cell writers. The sibling `refreshForFile` handlers
 * already run every incoming path through validateFilePath against the
 * workspace root for exactly this reason; this is that same guard, shared so
 * the create/add paths can't drift out of sync again.
 *
 * Returns the resolved, in-root path. Throws when the path escapes the root,
 * carries a control character, or no workspace is open.
 */
export function confineToWorkspace(filePath: unknown): string {
  if (typeof filePath !== 'string' || !filePath) throw new IpcValidationError('Invalid file path')
  const root = getWorkspaceRoot()
  if (!root) throw new IpcValidationError('No workspace folder is open')
  return validateFilePath(filePath, root)
}
