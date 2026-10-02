/**
 * Every case gets a folder for the files made for it (docs/landscape/PLAN.md
 * §5a): `Work/<case-id>/sources`, `drafts` and `outputs`, next to `Cases/`.
 * Agents write into `drafts`; accepting a result moves it to `outputs`, so the
 * folder alone tells what was approved. Pure path logic, tested; the IPC lives
 * in handlers/cases.ts.
 */
import path from 'path'

export const WORK_DIR = 'Work'
export const WORK_PARTS = ['sources', 'drafts', 'outputs'] as const

/** The case's work folder under a base (the workspace root, or the global home). */
export function workFolderFor(base: string, caseId: string): string {
  const safe = caseId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  if (!safe) throw new Error('Invalid case id')
  return path.join(base, WORK_DIR, safe)
}

/**
 * Where an accepted draft goes: the same relative place under `outputs`.
 * Null when the file is not inside this case's `drafts` (nothing to promote).
 */
export function promotedPath(folder: string, file: string): string | null {
  const drafts = path.join(folder, 'drafts')
  const abs = path.resolve(file)
  if (!abs.startsWith(drafts + path.sep)) return null
  return path.join(folder, 'outputs', path.relative(drafts, abs))
}

/** Guidance for a case run's prompt: where to put what it makes. */
export function workFolderGuidance(folder: string, root: string | null): string {
  const shown = root && folder.startsWith(root + path.sep) ? path.relative(root, folder) : folder
  return [
    `This case has its own folder: ${shown}/`,
    `Save documents you produce under ${shown}/drafts/ and material you collect (pages, exports, notes on sources) under ${shown}/sources/.`,
    `Do not write to ${shown}/outputs/ — that is where the person moves what they accept.`,
  ].join('\n')
}
