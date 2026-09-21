/**
 * Lightweight structural-symbol extraction for the search index — a fast
 * "repo map" without an AST. Adapted from the regex symbol-indexing pattern in
 * lazy-fetch (Agentic-Coding-Framework/src/context.ts): per-language regexes run
 * over already-extracted file *content* (no extra disk IO), so a file's headings
 * and named code entities become jump-to-symbol targets.
 *
 * Deliberately cheap and bounded: it works on the in-memory content the indexer
 * already holds, is capped in the number of symbols per file, and returns line
 * numbers for go-to-symbol navigation.
 */

export type SymbolKind =
  | 'heading'
  | 'function'
  | 'class'
  | 'interface'
  | 'type'
  | 'const'
  | 'method'
  | 'enum'
  | 'struct'
  | 'trait'
  | 'module'

export interface SymbolEntry {
  name: string
  kind: SymbolKind
  line: number
}

// Hard cap per file — a generated/minified file shouldn't flood the symbol table.
const MAX_SYMBOLS_PER_FILE = 800

// Code-symbol regexes keyed by extension (no leading dot). Each capture group 1
// is the symbol name. Anchored to line starts (multiline) to avoid matching
// nested/inline occurrences. Ported from the lazy-fetch SYMBOL_PATTERNS.
const CODE_PATTERNS: Record<string, RegExp[]> = {
  ts: [
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+(?:abstract\s+)?class\s+(\w+)/gm,
    /^export\s+interface\s+(\w+)/gm,
    /^export\s+type\s+(\w+)/gm,
    /^export\s+enum\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^(?:async\s+)?function\s+(\w+)/gm,
    /^(?:abstract\s+)?class\s+(\w+)/gm,
    /^interface\s+(\w+)/gm,
    /^type\s+(\w+)\s*=/gm,
  ],
  js: [
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^(?:async\s+)?function\s+(\w+)/gm,
    /^class\s+(\w+)/gm,
  ],
  py: [/^def\s+(\w+)/gm, /^class\s+(\w+)/gm, /^async\s+def\s+(\w+)/gm],
  rs: [
    /^pub\s+(?:async\s+)?fn\s+(\w+)/gm,
    /^(?:async\s+)?fn\s+(\w+)/gm,
    /^pub\s+struct\s+(\w+)/gm,
    /^pub\s+enum\s+(\w+)/gm,
    /^pub\s+trait\s+(\w+)/gm,
  ],
  go: [
    /^func\s+(\w+)/gm,
    /^func\s+\([^)]+\)\s+(\w+)/gm,
    /^type\s+(\w+)\s+struct/gm,
    /^type\s+(\w+)\s+interface/gm,
  ],
  java: [
    /^\s*(?:public|private|protected)\s+(?:abstract\s+|final\s+)?class\s+(\w+)/gm,
    /^\s*(?:public|private|protected)\s+interface\s+(\w+)/gm,
  ],
  c: [/^[A-Za-z_][\w\s*]+\b(\w+)\s*\([^;]*\)\s*\{/gm],
  cpp: [/^[A-Za-z_][\w\s*:<>]+\b(\w+)\s*\([^;]*\)\s*\{/gm],
  h: [/^[A-Za-z_][\w\s*]+\b(\w+)\s*\([^;]*\)\s*;/gm],
}

// tsx/jsx reuse their base-language patterns.
CODE_PATTERNS.tsx = CODE_PATTERNS.ts
CODE_PATTERNS.jsx = CODE_PATTERNS.js

// Extensions whose outline is a markdown-style heading tree.
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx'])

/** Extensions we can pull structural symbols from (used by the indexer to skip). */
export function hasSymbolSupport(ext: string): boolean {
  const e = ext.toLowerCase()
  return MARKDOWN_EXTS.has(e) || e in CODE_PATTERNS
}

function inferKind(matchStr: string): SymbolKind {
  if (/\bstruct\b/.test(matchStr)) return 'struct'
  if (/\btrait\b/.test(matchStr)) return 'trait'
  if (/\benum\b/.test(matchStr)) return 'enum'
  if (/\bclass\b/.test(matchStr)) return 'class'
  if (/\binterface\b/.test(matchStr)) return 'interface'
  if (/\b(function|fn|def)\b/.test(matchStr)) return 'function'
  if (/\btype\b/.test(matchStr)) return 'type'
  if (/\bconst\b/.test(matchStr)) return 'const'
  return 'function'
}

/** 1-based line number of a character offset within `content`. */
function lineAt(content: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++
  }
  return line
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm

/**
 * Extract structural symbols from a file's already-loaded text content. Markdown
 * files yield their heading outline; code files yield named entities per the
 * per-language regexes. Returns [] for unsupported types or empty content.
 */
export function extractSymbols(ext: string, content: string): SymbolEntry[] {
  if (!content) return []
  const e = ext.toLowerCase()

  if (MARKDOWN_EXTS.has(e)) return extractHeadings(content)

  const patterns = CODE_PATTERNS[e]
  if (!patterns) return []

  const symbols: SymbolEntry[] = []
  const seen = new Set<string>()
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pattern.exec(content)) !== null) {
      const name = m[1]
      if (!name) continue
      const line = lineAt(content, m.index)
      // Dedup on name+line so overlapping patterns don't double-count.
      const key = `${name}:${line}`
      if (seen.has(key)) continue
      seen.add(key)
      symbols.push({ name, kind: inferKind(m[0]), line })
      if (symbols.length >= MAX_SYMBOLS_PER_FILE) return symbols
      // Guard against a zero-width match looping forever.
      if (m.index === pattern.lastIndex) pattern.lastIndex++
    }
  }
  symbols.sort((a, b) => a.line - b.line)
  return symbols
}

function extractHeadings(content: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  HEADING_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEADING_RE.exec(content)) !== null) {
    const text = m[2].trim()
    if (!text) continue
    symbols.push({ name: text, kind: 'heading', line: lineAt(content, m.index) })
    if (symbols.length >= MAX_SYMBOLS_PER_FILE) break
  }
  return symbols
}
