/** Why an IPC call failed, without Electron's "Error invoking remote method" wrapping. */
export function ipcReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return message.replace(/^Error invoking remote method '[^']+':\s*(?:\w*Error:\s*)?/, '')
}
