import { describe, it, expect, vi } from 'vitest'
import { wikilinkContext, noteSuggestions, acquireWikilinkCompletion, type CompletionMonaco } from './wikilinkComplete'

describe('wikilinkContext', () => {
  const at = (marked: string, previous: string[] = []) => {
    const col = marked.indexOf('|')
    const line = marked.slice(0, col) + marked.slice(col + 1)
    return wikilinkContext([...previous, line], col + 1)
  }

  it('opens right after [[ and adds the closing brackets', () => {
    expect(at('see [[|')).toEqual({ startColumn: 7, endColumn: 7, suffix: ']]' })
    expect(at('see [[Pro|')).toEqual({ startColumn: 7, endColumn: 10, suffix: ']]' })
  })

  it('adds only the brackets the editor has not auto-closed', () => {
    expect(at('[[|]]')?.suffix).toBe('')
    expect(at('[[Pr|]')?.suffix).toBe(']')
  })

  it('replaces the rest of a link being edited in place', () => {
    expect(at('[[Pro|ject]] after')).toEqual({ startColumn: 3, endColumn: 10, suffix: '' })
    expect(at('[[Pro|ject|alias]]')).toEqual({ startColumn: 3, endColumn: 10, suffix: '' })
  })

  it('leaves following prose alone when the link is not closed', () => {
    expect(at('[[Pro| and more')).toEqual({ startColumn: 3, endColumn: 6, suffix: ']]' })
  })

  it('stays quiet outside a link target', () => {
    expect(at('plain text|')).toBeNull()
    expect(at('[one|')).toBeNull()
    expect(at('[[Done]] then|')).toBeNull()
    expect(at('[[Note#head|')).toBeNull()
    expect(wikilinkContext(['[[Note|ali'], 11)).toBeNull() // typing an alias
  })

  it('ignores inline code and fenced blocks, like the link parser', () => {
    expect(at('`[[|')).toBeNull()
    expect(at('`code` [[|')).not.toBeNull()
    expect(at('[[|', ['```', 'x'])).toBeNull()
    expect(at('[[|', ['```', 'x', '```'])).not.toBeNull()
    expect(at('[[|', ['~~~~', '```'])).toBeNull()
  })
})

describe('noteSuggestions', () => {
  const node = (id: string, name: string, kind: 'note' | 'stub' = 'note', degree = 0) => ({ id, name, kind, degree })

  it('offers each note by its name without extension, with where it lives', () => {
    expect(noteSuggestions([node('/ws/a/Plan.md', 'Plan.md')], '/ws')).toEqual([
      { name: 'Plan', detail: 'a/Plan.md', stub: false },
    ])
  })

  it('lists one entry per name, since a link is resolved by name', () => {
    const s = noteSuggestions([node('/ws/a/Plan.md', 'Plan.md'), node('/ws/b/plan.md', 'plan.md')], '/ws')
    expect(s).toEqual([{ name: 'Plan', detail: '2 notes', stub: false }])
  })

  it('offers unwritten names, and leaves out unlinkable names', () => {
    const s = noteSuggestions([node('stub:later', 'Later', 'stub'), node('/ws/a#b.md', 'a#b.md')], '/ws')
    expect(s).toEqual([{ name: 'Later', detail: 'not written yet', stub: true }])
  })

  it('handles Windows paths', () => {
    expect(noteSuggestions([node('D:\\ws\\a\\Plan.md', 'Plan.md')], 'D:\\ws')[0].detail).toBe('a/Plan.md')
  })
})

describe('acquireWikilinkCompletion', () => {
  function fakeMonaco() {
    const dispose = vi.fn()
    const register = vi.fn((_lang: string, _provider: unknown) => ({ dispose }))
    const monaco = {
      languages: { registerCompletionItemProvider: register, CompletionItemKind: { File: 20, Reference: 21 } },
    } as unknown as CompletionMonaco
    return { monaco, register, dispose }
  }
  const model = (lines: string[]) => ({
    getLinesContent: () => lines,
  })

  it('registers once however many editors are open, and disposes with the last', () => {
    const { monaco, register, dispose } = fakeMonaco()
    const load = async () => []
    const a = acquireWikilinkCompletion(monaco, load)
    const b = acquireWikilinkCompletion(monaco, load)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register.mock.calls[0][0]).toBe('markdown')
    a()
    a() // releasing twice is one release
    expect(dispose).not.toHaveBeenCalled()
    b()
    expect(dispose).toHaveBeenCalledTimes(1)
    acquireWikilinkCompletion(monaco, load)()
    expect(register).toHaveBeenCalledTimes(2)
  })

  it('completes inside [[ from the index, replacing only the target', async () => {
    const { monaco, register } = fakeMonaco()
    const load = vi.fn(async () => [{ name: 'Plan', detail: 'Plan.md', stub: false }])
    const release = acquireWikilinkCompletion(monaco, load)
    const provider = register.mock.calls[0][1] as {
      triggerCharacters: string[]
      provideCompletionItems: (m: unknown, p: unknown) => Promise<{ suggestions: Record<string, unknown>[] }>
    }
    expect(provider.triggerCharacters).toEqual(['['])
    const out = await provider.provideCompletionItems(model(['go [[Pl']), { lineNumber: 1, column: 8 })
    expect(out.suggestions).toEqual([
      {
        label: 'Plan',
        detail: 'Plan.md',
        kind: 20,
        insertText: 'Plan]]',
        filterText: 'Plan',
        sortText: '0plan',
        range: { startLineNumber: 1, startColumn: 6, endLineNumber: 1, endColumn: 8 },
      },
    ])
    load.mockClear()
    expect((await provider.provideCompletionItems(model(['plain']), { lineNumber: 1, column: 6 })).suggestions).toEqual([])
    expect(load).not.toHaveBeenCalled()
    release()
  })

  it('returns nothing when the index cannot be read', async () => {
    const { monaco, register } = fakeMonaco()
    const release = acquireWikilinkCompletion(monaco, async () => { throw new Error('no index') })
    const provider = register.mock.calls[0][1] as {
      provideCompletionItems: (m: unknown, p: unknown) => Promise<{ suggestions: unknown[] }>
    }
    await expect(provider.provideCompletionItems(model(['[[']), { lineNumber: 1, column: 3 })).resolves.toEqual({ suggestions: [] })
    release()
  })
})
