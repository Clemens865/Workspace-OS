/**
 * Which run a typed prompt steers instead of starting a new one. A Codex run
 * is claimed at SUBMIT time (from the pick the renderer knows), not when the
 * IPC resolves seconds later, so a second prompt typed during startup steers
 * the same thread rather than starting a parallel one on the conversation.
 * Main's reply then settles the claim from the provider that really ran.
 */
export const isCodexPick = (model: string | null | undefined): boolean => (model ?? '').startsWith('codex:')

export function claimRun(owned: Set<string>, runId: string, effectiveModel: string | null | undefined): void {
  if (isCodexPick(effectiveModel)) owned.add(runId)
}

export function settleRun(owned: Set<string>, runId: string, provider: string | undefined): void {
  if (provider === 'codex') owned.add(runId)
  else owned.delete(runId)
}

/** The live Codex run to steer, if any. The current dropdown value is irrelevant: a running Codex turn is steered, never raced. */
export function steerTarget(owned: ReadonlySet<string>, running: readonly string[]): string | undefined {
  return running.find((id) => owned.has(id))
}
