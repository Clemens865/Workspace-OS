import { ipcReason } from '../../lib/ipcError'

/** What the reporter says after an export: where it went, or why it did not. */
export async function exportOutcome(
  save: () => Promise<{ path: string | null }>,
): Promise<{ saved: string | null; error: string | null }> {
  try {
    const { path } = await save()
    return { saved: path ? `Saved to ${path}. Nothing was sent.` : null, error: null }
  } catch (e) {
    return { saved: null, error: ipcReason(e) }
  }
}
