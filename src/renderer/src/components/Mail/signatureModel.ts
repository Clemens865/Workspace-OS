/** The signature setting's logic, kept out of the dialog so it can be tested. */
import type { MailResult } from '../../types/workspace-api'
import { ipcReason } from '../../lib/ipcError'

/** The length main keeps (mail.ts cuts anything longer). */
export const MAX_SIGNATURE = 4000

export async function loadSignature(
  get: (accountId: string) => Promise<MailResult<string>>,
  accountId: string,
): Promise<{ text: string } | { error: string }> {
  try {
    const res = await get(accountId)
    return res.ok ? { text: res.value } : { error: res.error.message }
  } catch (e) {
    return { error: ipcReason(e) }
  }
}

/** Saves (an empty text removes it). Returns why it could not, or null. */
export async function storeSignature(
  set: (accountId: string, signature: string) => Promise<unknown>,
  accountId: string,
  text: string,
): Promise<string | null> {
  if (text.length > MAX_SIGNATURE) return `A signature is limited to ${MAX_SIGNATURE} characters.`
  try {
    await set(accountId, text)
    return null
  } catch (e) {
    return ipcReason(e)
  }
}
