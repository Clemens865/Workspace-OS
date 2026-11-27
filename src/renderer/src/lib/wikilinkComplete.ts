/**
 * `[[wikilink]]` autocomplete for the markdown editor. The names come from the
 * workspace's note index (the knowledge graph); everything here is pure, and
 * Monaco is passed in, so it is testable without a DOM.
 */
import type { GraphNode } from '../types/workspace-api'
import { relPath } from './paths'

export interface LinkContext {
  /** 1-based column of the first character of the link target (right after `[[`). */
  startColumn: number
  /** 1-based column the replacement ends at. */
  endColumn: number
  /** The closing brackets still missing after the replacement. */
  suffix: '' | ']' | ']]'
}

/** True when the last line of `lines` sits inside a ``` or ~~~ fence. */
function inFence(lines: string[]): boolean {
  let open: { ch: string; len: number } | null = null
  for (let i = 0; i < lines.length - 1; i++) {
    const m = /^(`{3,}|~{3,})/.exec(lines[i])
    if (!m) continue
    const [ch, len] = [m[1][0], m[1].length]
    if (!open) open = { ch, len }
    else if (ch === open.ch && len >= open.len) open = null
  }
  return open !== null
}

/**
 * Where a link target is being typed, or null when the cursor is not in one.
 * `lines` are the document's lines up to and including the cursor's line.
 */
export function wikilinkContext(lines: string[], column: number): LinkContext | null {
  const line = lines[lines.length - 1] ?? ''
  const before = line.slice(0, column - 1)
  const typed = /\[\[([^\][|#]*)$/.exec(before)
  if (!typed) return null
  // An odd number of backticks means an inline code span is open: a literal.
  if ((before.slice(0, typed.index).split('`').length - 1) % 2 === 1) return null
  if (inFence(lines)) return null

  const after = line.slice(column - 1)
  // The rest of an existing target is replaced only when the link really ends there.
  const rest = /^([^\][|#]*)(?=[\]|#])/.exec(after)?.[1] ?? ''
  const tail = after.slice(rest.length)
  const suffix = /^(\]\]|[|#])/.test(tail) ? '' : tail.startsWith(']') ? ']' : ']]'
  return { startColumn: typed.index + 3, endColumn: column + rest.length, suffix }
}

export interface NoteSuggestion {
  /** What goes between the brackets: the file name without its extension. */
  name: string
  detail: string
  /** Referenced somewhere, but no file has this name yet. */
  stub: boolean
}

function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(0, dot) : name
}

/** One suggestion per linkable name in the index. */
export function noteSuggestions(nodes: GraphNode[], root: string): NoteSuggestion[] {
  const byKey = new Map<string, NoteSuggestion & { count: number }>()
  for (const n of nodes) {
    const stub = n.kind === 'stub'
    const name = stub ? n.name : withoutExtension(n.name)
    // A name holding link syntax cannot be written as a link.
    if (!name.trim() || /[\][|#\n]/.test(name)) continue
    const key = name.toLowerCase()
    const seen = byKey.get(key)
    if (seen) {
      seen.count++
      seen.detail = `${seen.count} notes`
      continue
    }
    byKey.set(key, { name, detail: stub ? 'not written yet' : relPath(n.id, root), stub, count: 1 })
  }
  return [...byKey.values()].map(({ name, detail, stub }) => ({ name, detail, stub }))
}

interface Position { lineNumber: number; column: number }
interface Model { getLinesContent(): string[] }
interface Completion {
  label: string
  detail: string
  kind: number
  insertText: string
  filterText: string
  sortText: string
  range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }
}
interface Provider {
  triggerCharacters: string[]
  provideCompletionItems(model: Model, position: Position): Promise<{ suggestions: Completion[] }>
}

/** The corner of the Monaco API this needs. */
export interface CompletionMonaco {
  languages: {
    registerCompletionItemProvider(language: string, provider: Provider): { dispose(): void }
    CompletionItemKind: { File: number; Reference: number }
  }
}

export type LoadSuggestions = () => Promise<NoteSuggestion[]>

let shared: { users: number; dispose: () => void } | null = null

/**
 * Registers the provider for the first editor that asks and disposes it when the
 * last one lets go: Monaco keeps providers globally, so one per editor would
 * list every note once per open file. Returns this editor's release.
 */
export function acquireWikilinkCompletion(monaco: CompletionMonaco, load: LoadSuggestions): () => void {
  if (!shared) {
    const { File, Reference } = monaco.languages.CompletionItemKind
    const registration = monaco.languages.registerCompletionItemProvider('markdown', {
      triggerCharacters: ['['],
      async provideCompletionItems(model, position) {
        const lines = model.getLinesContent().slice(0, position.lineNumber)
        const ctx = wikilinkContext(lines, position.column)
        if (!ctx) return { suggestions: [] }
        const notes = await load().catch(() => [])
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: ctx.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: ctx.endColumn,
        }
        return {
          suggestions: notes.map((n) => ({
            label: n.name,
            detail: n.detail,
            kind: n.stub ? Reference : File,
            insertText: n.name + ctx.suffix,
            filterText: n.name,
            // Written notes before names that are still only referenced.
            sortText: `${n.stub ? 1 : 0}${n.name.toLowerCase()}`,
            range,
          })),
        }
      },
    })
    shared = { users: 0, dispose: () => registration.dispose() }
  }
  const mine = shared
  mine.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--mine.users > 0) return
    mine.dispose()
    if (shared === mine) shared = null
  }
}
