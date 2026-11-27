import { describe, it, expect, vi } from 'vitest'
import { attachedBytes, pickableFiles, attachFromWorkspace } from './workspaceAttachModel'

const att = (text: string) => ({ filename: 'x', content: btoa(text) })

describe('attachedBytes', () => {
  it('counts the decoded size of what the draft holds', () => {
    expect(attachedBytes([])).toBe(0)
    expect(attachedBytes([att('a'), att('ab'), att('abc'), att('hello world')])).toBe(17)
  })
})

describe('pickableFiles', () => {
  const files = ['/ws/notes/plan.md', '/ws/report.docx']

  it('lists workspace files by their path inside it', () => {
    expect(pickableFiles(files, '/ws', '')).toEqual([
      { path: '/ws/notes/plan.md', rel: 'notes/plan.md' },
      { path: '/ws/report.docx', rel: 'report.docx' },
    ])
  })

  it('narrows by the query without matching the workspace’s own folder', () => {
    expect(pickableFiles(files, '/ws', 'repo').map((f) => f.rel)).toEqual(['report.docx'])
    expect(pickableFiles(files, '/ws', 'ws/')).toEqual([])
  })

  it('shows a bounded list', () => {
    const many = Array.from({ length: 200 }, (_, i) => `/ws/${i}.txt`)
    expect(pickableFiles(many, '/ws', '')).toHaveLength(50)
  })
})

describe('attachFromWorkspace', () => {
  it('tells main what the draft already holds and returns the file', async () => {
    const read = vi.fn(async () => ({ ok: true as const, value: att('new') }))
    await expect(attachFromWorkspace(read, '/ws/a.txt', [att('abc'), att('de')])).resolves.toEqual({ attachment: att('new') })
    expect(read).toHaveBeenCalledWith('/ws/a.txt', 5, 2)
  })

  it('passes on main’s refusal', async () => {
    const read = async () => ({ ok: false as const, error: { code: 'unknown' as const, message: 'Too big.' } })
    await expect(attachFromWorkspace(read, '/ws/a.txt', [])).resolves.toEqual({ error: 'Too big.' })
  })

  it('reports a rejected path plainly', async () => {
    const read = async (): Promise<never> => {
      throw new Error("Error invoking remote method 'mail:attach-workspace-file': IpcValidationError: Path escapes workspace root")
    }
    await expect(attachFromWorkspace(read, '/etc/passwd', [])).resolves.toEqual({ error: 'Path escapes workspace root' })
  })
})
