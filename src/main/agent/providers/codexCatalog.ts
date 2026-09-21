import { CodexRpc } from './codexRpc'
import { listCodexModels, type CodexModel } from './codex'

export async function codexCatalog(cwd?: string): Promise<{ models: CodexModel[]; account: string; available: boolean; error?: string }> {
  let rpc: CodexRpc | undefined
  try {
    rpc = new CodexRpc({ cwd })
    await rpc.initialize()
    const models: CodexModel[] = [listCodexModels()[0]]
    let cursor: string | null = null
    do {
      const page: any = await rpc.request('model/list', { limit: 100, includeHidden: false, cursor })
      for (const m of page.data ?? []) if (!m.hidden && typeof m.model === 'string') models.push({ id: `codex:${m.model}`, label: `Codex · ${m.displayName}`, hint: m.description ?? '', efforts: (m.supportedReasoningEfforts ?? []).map((e: any) => e.reasoningEffort) })
      cursor = page.nextCursor ?? null
    } while (cursor)
    const { config } = await rpc.request('config/read', { cwd: cwd ?? null, includeLayers: false })
    models[0].efforts = models.find((m) => m.id === `codex:${config?.model}`)?.efforts
    const account = await rpc.request('account/read', { refreshToken: false })
    return { models, available: true, account: account.account ? account.account.type : 'Not signed in' }
  } catch (err) { return { models: listCodexModels(), available: false, account: 'Unavailable', error: (err as Error).message } }
  finally { rpc?.close() }
}

/** Skills are advisory: the run proceeds without the ones Codex does not have. */
export function matchCodexSkills(wanted: readonly string[], available: readonly { name: string; path: string }[]): { skills: { name: string; path: string }[]; missing: string[] } {
  const skills: { name: string; path: string }[] = [], missing: string[] = []
  for (const name of new Set(wanted)) {
    const skill = available.find((s) => s.name === name)
    if (skill) skills.push({ name: skill.name, path: skill.path })
    else missing.push(name)
  }
  return { skills, missing }
}

export async function codexSkills(cwd: string): Promise<{ name: string; description: string; path: string; scope: 'global' | 'project' }[]> {
  let rpc: CodexRpc | undefined
  try {
    rpc = new CodexRpc({ cwd })
    await rpc.initialize()
    const result = await rpc.request('skills/list', { cwds: [cwd], forceReload: true })
    return (result.data ?? []).flatMap((entry: any) => (entry.skills ?? []).filter((s: any) => s.enabled).map((s: any) => ({ name: s.name, description: s.description, path: s.path, scope: s.scope === 'repo' ? 'project' : 'global' })))
  } finally { rpc?.close() }
}
