/** "Attach from workspace" in compose, kept out of the component so it can be tested. */
import type { MailDraftAttachment, MailResult } from '../../types/workspace-api'
import { rankFiles } from '../../lib/fuzzy'
import { joinPath, relPath } from '../../lib/paths'
import { ipcReason } from '../../lib/ipcError'

const SHOWN = 50

/** The decoded size of the draft's attachments (their content travels as base64). */
export function attachedBytes(attachments: MailDraftAttachment[]): number {
  return attachments.reduce((sum, a) => sum + Math.floor((a.content.replace(/=+$/, '').length * 3) / 4), 0)
}

/** The workspace files matching `query`, best first. Matching sees only the path inside the workspace. */
export function pickableFiles(files: string[], root: string, query: string): { path: string; rel: string }[] {
  const byRel = new Map(files.map((p) => [relPath(p, root), p]))
  return rankFiles(query, [...byRel.keys()])
    .slice(0, SHOWN)
    .map(({ path: rel }) => ({ path: byRel.get(rel) ?? joinPath(root, rel), rel }))
}

/** Asks main for one file. Main decides whether it may be attached. */
export async function attachFromWorkspace(
  read: (path: string, usedBytes: number, count: number) => Promise<MailResult<MailDraftAttachment>>,
  path: string,
  current: MailDraftAttachment[],
): Promise<{ attachment: MailDraftAttachment } | { error: string }> {
  try {
    const res = await read(path, attachedBytes(current), current.length)
    return res.ok ? { attachment: res.value } : { error: res.error.message }
  } catch (e) {
    return { error: ipcReason(e) }
  }
}
