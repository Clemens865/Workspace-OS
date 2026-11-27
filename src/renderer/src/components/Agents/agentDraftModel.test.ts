import { describe, expect, it, vi } from 'vitest'
import { foundryRequest, loadDraft, saveDraft, type AgentsApi } from './agentDraftModel'

const elias = { name: 'Elias', description: 'Writes applications', scope: 'project' as const, mode: 'safe' as const, persona: 'You write.', skills: ['docx'], capabilities: ['documents'], surface: 'Documents', model: 'opus' }

function api(files: Record<string, typeof elias | Record<string, unknown>> = { Elias: elias }) {
  return {
    list: vi.fn(async () => Object.values(files).map((a) => ({ name: a.name as string, description: '', scope: 'project' as const }))),
    read: vi.fn(async (name: string) => {
      if (!files[name]) throw new Error('ENOENT')
      return { ...files[name] } as typeof elias
    }),
    write: vi.fn(async (p: { name: string }) => ({ name: p.name, path: '', scope: 'project' as const })),
  } satisfies AgentsApi
}

describe('what the Foundry was asked for', () => {
  it('tells new, edit and duplicate apart', () => {
    expect(foundryRequest(undefined)).toEqual({ kind: 'new' })
    expect(foundryRequest({})).toEqual({ kind: 'new' })
    expect(foundryRequest({ edit: 'Elias', scope: 'project' })).toEqual({ kind: 'edit', name: 'Elias', scope: 'project' })
    expect(foundryRequest({ duplicate: 'Elias', scope: 'global' })).toEqual({ kind: 'duplicate', name: 'Elias', scope: 'global' })
  })
})

describe('Edit', () => {
  const request = { kind: 'edit', name: 'Elias', scope: 'project' } as const

  it('opens the existing agent', async () => {
    const a = api()
    const { draft } = await loadDraft(request, a)
    expect(a.read).toHaveBeenCalledWith('Elias', 'project')
    expect(draft).toEqual({ name: 'Elias', description: 'Writes applications', persona: 'You write.', mode: 'safe', model: 'opus', capabilities: ['documents'], skills: ['docx'], surface: 'Documents' })
  })

  it('saves back to that agent and scope, keeping everything it had', async () => {
    const a = api()
    const { draft, origin } = await loadDraft(request, a)
    await saveDraft({ ...draft, persona: 'You write well.', name: 'Someone else' }, origin, a)
    expect(a.write).toHaveBeenCalledWith({ name: 'Elias', scope: 'project', description: 'Writes applications', persona: 'You write well.', mode: 'safe', model: 'opus', capabilities: ['documents'], skills: ['docx'], surface: 'Documents' })
  })

  it('does not save over a file that changed since it was opened', async () => {
    const files = { Elias: { ...elias } }
    const a = api(files)
    const { draft, origin } = await loadDraft(request, a)
    files.Elias.persona = 'Edited elsewhere.'
    await expect(saveDraft(draft, origin, a)).rejects.toThrow('changed')
    delete (files as Record<string, unknown>).Elias
    await expect(saveDraft(draft, origin, a)).rejects.toThrow('no longer there')
    expect(a.write).not.toHaveBeenCalled()
  })

  it('will not open a file that holds a different agent', async () => {
    const a = api({ Elias: { ...elias, name: 'Felix' } })
    await expect(loadDraft(request, a)).rejects.toThrow('Felix')
  })
})

describe('Duplicate', () => {
  const request = { kind: 'duplicate', name: 'Elias', scope: 'project' } as const

  it('prefills a copy under a free name', async () => {
    expect((await loadDraft(request, api())).draft).toMatchObject({ name: 'Elias copy', persona: 'You write.', skills: ['docx'] })
    const taken = api({ Elias: elias, 'Elias copy': { ...elias, name: 'Elias copy' } })
    expect((await loadDraft(request, taken)).draft.name).toBe('Elias copy 2')
  })

  it('saves a new file in the same scope, never over one', async () => {
    const a = api()
    const { draft, origin } = await loadDraft(request, a)
    await saveDraft(draft, origin, a)
    expect(a.write).toHaveBeenCalledWith(expect.objectContaining({ name: 'Elias copy', scope: 'project', createOnly: true, copyFrom: { name: 'Elias', scope: 'project' } }))
  })

  it('refuses a name another agent already has, however it is spelled', async () => {
    const a = api()
    const { draft, origin } = await loadDraft(request, a)
    for (const name of ['Elias', ' elias ', 'ELIAS!']) await expect(saveDraft({ ...draft, name }, origin, a)).rejects.toThrow('already')
    expect(a.write).not.toHaveBeenCalled()
  })
})

describe('a new specialist', () => {
  const draft = { name: 'Elias', description: '', persona: '', mode: 'safe' as const, model: '', capabilities: [], skills: [], surface: '' }

  it('never overwrites an existing agent', async () => {
    const a = api()
    await expect(saveDraft(draft, { kind: 'new' }, a)).rejects.toThrow('already')
    expect(a.write).not.toHaveBeenCalled()
    await saveDraft({ ...draft, name: 'Nina' }, { kind: 'new' }, a)
    expect(a.write).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nina', scope: 'global', createOnly: true, model: undefined, surface: undefined }))
  })
})
