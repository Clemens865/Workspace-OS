/**
 * Pure model for the unified prompt bar — the composer every "ask an agent"
 * surface shares (dock, case Ask, calendar Ask).
 *
 * `@` anywhere mentions a workspace file; `/` at the start invokes a command
 * (a discovered skill). The rules live here, React-free, so the token
 * grammar is unit-tested in the node environment like every other model.
 */

export interface TokenQuery {
  kind: '@' | '/' | '#'
  /** What has been typed after the trigger, lowercased for filtering. */
  query: string
  /** The trigger's index in the text (inclusive). */
  start: number
  /** The caret position (exclusive end of the token). */
  end: number
}

/**
 * The active trigger token at the caret, or null.
 *
 * `@` counts only when it starts a word (start of text or after whitespace) —
 * an email address mid-sentence must not open the file picker. `/` counts only
 * at position 0, matching every terminal the user has ever used.
 */
export function tokenAt(text: string, caret: number): TokenQuery | null {
  const upto = text.slice(0, caret)
  for (let i = caret - 1; i >= 0; i--) {
    const ch = upto[i]
    if (ch === '\n' || ch === ' ' || ch === '\t') return null
    if (ch === '@') {
      if (i === 0 || /\s/.test(upto[i - 1])) {
        return { kind: '@', query: upto.slice(i + 1, caret).toLowerCase(), start: i, end: caret }
      }
      return null
    }
    if (ch === '#') {
      // `#` mentions a CASE — counts only when it starts a word, so a "#3" mid
      // sentence or a markdown heading never opens the case picker.
      if (i === 0 || /\s/.test(upto[i - 1])) {
        return { kind: '#', query: upto.slice(i + 1, caret).toLowerCase(), start: i, end: caret }
      }
      return null
    }
    if (ch === '/' && i === 0) {
      return { kind: '/', query: upto.slice(1, caret).toLowerCase(), start: 0, end: caret }
    }
  }
  return null
}

/** Basename of a workspace path. */
export function fileName(p: string): string {
  const parts = p.split('/')
  return parts[parts.length - 1] || p
}

/** Do the query's characters appear in order (not necessarily adjacent)?
 * `cvfon` ⊑ `CV_fonio` — the quick-open matching people's fingers expect. */
export function isSubsequence(query: string, target: string): boolean {
  let qi = 0
  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (target[i] === query[qi]) qi++
  }
  return qi === query.length
}

/**
 * Filter workspace files for an `@` query, in four tiers: basename prefix
 * (what completion feels like), basename substring, basename SUBSEQUENCE
 * (`cvfon` finds `CV_fonio` — a space would end the token, so a loose match
 * has to do what a second word cannot), then substring anywhere in the path.
 * Each tier alphabetical. The default window is large and the popover
 * scrolls — with twenty CVs in one folder, a top-8 cut simply hides the one
 * being looked for.
 */
export function filterFiles(files: readonly string[], query: string, limit = 40): string[] {
  const q = query.toLowerCase()
  if (!q) return files.slice(0, limit)
  const prefix: string[] = []
  const inName: string[] = []
  const subseq: string[] = []
  const inPath: string[] = []
  for (const f of files) {
    const name = fileName(f).toLowerCase()
    if (name.startsWith(q)) prefix.push(f)
    else if (name.includes(q)) inName.push(f)
    else if (isSubsequence(q, name)) subseq.push(f)
    else if (f.toLowerCase().includes(q)) inPath.push(f)
  }
  return [...prefix.sort(), ...inName.sort(), ...subseq.sort(), ...inPath.sort()].slice(0, limit)
}

export interface Command {
  name: string
  hint?: string
}

/** A case, as the `#` picker needs it. */
export interface CaseRef {
  id: string
  title: string
  status?: string
}

/** Filter cases for a `#` query — match title or id, prefix→substring→subsequence. */
export function filterCases(cases: readonly CaseRef[], query: string, limit = 40): CaseRef[] {
  const q = query.toLowerCase()
  if (!q) return cases.slice(0, limit)
  const prefix: CaseRef[] = []
  const inText: CaseRef[] = []
  const subseq: CaseRef[] = []
  for (const c of cases) {
    const t = (c.title || '').toLowerCase()
    const id = c.id.toLowerCase()
    if (t.startsWith(q) || id.startsWith(q)) prefix.push(c)
    else if (t.includes(q) || id.includes(q)) inText.push(c)
    else if (isSubsequence(q, t) || isSubsequence(q, id)) subseq.push(c)
  }
  return [...prefix, ...inText, ...subseq].slice(0, limit)
}

/** Filter commands for a leading `/` query — prefix first, then substring. */
export function filterCommands(commands: readonly Command[], query: string, limit = 8): Command[] {
  const q = query.toLowerCase()
  if (!q) return commands.slice(0, limit)
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  return [...prefix, ...rest].slice(0, limit)
}

/** Replace the active token with `replacement`, returning text + new caret. */
export function replaceToken(
  text: string,
  tok: TokenQuery,
  replacement: string,
): { text: string; caret: number } {
  const next = text.slice(0, tok.start) + replacement + text.slice(tok.end)
  return { text: next, caret: tok.start + replacement.length }
}

/**
 * The mention block appended to a prompt for surfaces that pass context as
 * TEXT (the case and calendar Asks). The dock passes mentions as real context
 * files instead and never calls this.
 */
export function mentionBlock(paths: readonly string[]): string {
  if (paths.length === 0) return ''
  return ['', 'Files to consider:', ...paths.map((p) => `- ${p}`)].join('\n')
}
