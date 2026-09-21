import fs from 'fs/promises'
import { constants } from 'fs'
import path from 'path'
import os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getWorkspaceRoot } from '../workspace-root'
import { validateFilePath } from '../ipc-validator'
import { docgenBinDir } from '../docgen'
import type { ActionReply } from './actionBridge'

const exec = promisify(execFile)
/** Only declared asset paths may be read by the generator. */
export function validateDocumentSpec(value: unknown, root: string, depth = 0): void {
  if (depth > 30) throw new Error('Document spec is too deeply nested')
  if (!value || typeof value !== 'object') return
  for (const [key, item] of Object.entries(value)) {
    if (key === 'imagePath') validateFilePath(item, root)
    validateDocumentSpec(item, root, depth + 1)
  }
}

/** Safe-mode writes are performed here, after the bridge has checked the run grant. */
export async function documentAction(action: string, raw: unknown): Promise<ActionReply> {
  if (action !== 'document.generate') return { ok: false, error: 'Unknown document operation' }
  const root = getWorkspaceRoot()
  if (!root) return { ok: false, error: 'Open a workspace first' }
  const input = raw as { format?: string; name?: string; spec?: unknown; content?: string }
  let temp: string | undefined
  try {
    if (!input || !['docx', 'xlsx', 'pptx', 'html', 'md'].includes(input.format ?? '')) throw new Error('Unsupported document format')
    const format = input.format!
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 150 || /[/\\\x00-\x1f]/.test(input.name) || input.name.startsWith('.')) throw new Error('Use a plain document filename')
    const name = input.name.endsWith('.' + format) ? input.name : `${input.name}.${format}`
    const target = validateFilePath(path.join(root, name), root)
    if (format === 'html' || format === 'md') {
      if (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 2_000_000) throw new Error('Invalid document content')
      await fs.writeFile(target, input.content, { flag: 'wx', mode: 0o600 })
    } else {
      if (!input.spec || typeof input.spec !== 'object' || JSON.stringify(input.spec).length > 2_000_000) throw new Error('Invalid document spec')
      validateDocumentSpec(input.spec, root)
      temp = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-document-'))
      const spec = path.join(temp, 'spec.json')
      const output = path.join(temp, `output.${format}`)
      await fs.writeFile(spec, JSON.stringify(input.spec), { mode: 0o600 })
      await exec(path.join(docgenBinDir(), 'wos-gen'), [format, '--spec', spec, '--out', output], { cwd: root, timeout: 120000, maxBuffer: 1024 * 1024 })
      // No overwrite: the user can review the new artifact before replacing an original.
      validateFilePath(target, root)
      await fs.copyFile(output, target, constants.COPYFILE_EXCL)
    }
    return { ok: true, result: { path: target } }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  } finally {
    if (temp) await fs.rm(temp, { recursive: true, force: true })
  }
}
