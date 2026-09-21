/**
 * Compile-safety guard for the seeded StarBasic module (lokMacros.ts).
 *
 * The Wos* macro library is a single StarBasic module seeded into LibreOffice at
 * runtime. A SINGLE module-level compile error — a reserved keyword used as a
 * variable name (`Dim alias`), a duplicate Sub/Function name, or an unescaped
 * `< > &` that breaks the wrapping .xba XML — silently aborts the ENTIRE module:
 * every macro becomes a no-op while runMacro still returns ok:true. That failure
 * mode already caused a multi-commit outage. This validator scans the seeded
 * source (statically, no engine needed) and returns a list of problems so the
 * seed path can fail loud instead of proceeding into a silent all-macros-dead
 * state. Pure and unit-testable; imported by the seed path, the CI script, and
 * the regression test.
 */

/**
 * StarBasic reserved words that must never appear as a `Dim <word>` variable
 * name — using one compiles to a module-level error. Case-insensitive.
 */
export const RESERVED_BASIC_WORDS: readonly string[] = [
  'alias', 'name', 'type', 'line', 'error', 'stop', 'cell', 'row', 'column',
  'table', 'page', 'sheet', 'chart', 'find', 'replace', 'search', 'select',
  'mod', 'class', 'private', 'public', 'static', 'declare', 'string', 'date',
  'variant', 'boolean', 'array', 'form', 'next', 'loop', 'step', 'to', 'then',
  'each', 'on', 'in', 'is', 'as', 'new', 'set', 'let', 'get', 'not', 'and', 'or',
  'xor', 'if', 'end', 'for', 'do', 'while', 'with', 'exit', 'goto', 'call', 'sub',
  'function', 'dim', 'redim', 'const', 'option', 'print', 'open', 'close', 'input',
  'output', 'put', 'seek', 'write', 'read', 'byval', 'optional', 'me', 'like',
]

const RESERVED_SET = new Set(RESERVED_BASIC_WORDS.map((w) => w.toLowerCase()))

/**
 * Extracts the StarBasic source body from the seeded module string. The seeded
 * value is a .xba document: XML header + DOCTYPE + `<script:module …>` wrapper
 * around the Basic source, closed by `</script:module>`. We validate the XML
 * heuristics against the WHOLE string (so a stray `<`/`>`/`&` anywhere in the
 * payload is caught), but scan Basic keywords only against the body between the
 * module tags (so the XML tags themselves don't false-positive).
 */
function extractBasicBody(module: string): string {
  const open = module.indexOf('>', module.indexOf('<script:module'))
  const close = module.lastIndexOf('</script:module>')
  if (open < 0 || close < 0 || close <= open) return module
  return module.slice(open + 1, close)
}

/**
 * Scans the seeded StarBasic module and returns a list of human-readable
 * problems (empty = clean). Checks:
 *   1. Reserved StarBasic word used as a `Dim <word>` variable name.
 *   2. Duplicate `Sub`/`Function` name.
 *   3. Heuristic unescaped `<` / `>` / bare `&` in the module body (the .xba
 *      requires &lt; / &gt; / &amp;).
 */
export function validateBasicModule(code: string): string[] {
  const problems: string[] = []
  const body = extractBasicBody(code)
  const lines = body.split('\n')

  // ── 1. Reserved word as a Dim variable name ──────────────────────────────
  // `Dim a As X, b, alias As Y` — inspect each comma-separated declarator's
  // leading identifier. Matches `Dim` and `Static`/`Private`/`Public Dim`.
  const dimRe = /^\s*(?:(?:private|public|static|global)\s+)*dim\s+(.+)$/i
  lines.forEach((raw, i) => {
    const line = raw.replace(/'.*$/, '') // strip a trailing Basic comment
    const m = dimRe.exec(line)
    if (!m) return
    for (const decl of m[1].split(',')) {
      const nameMatch = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(decl)
      if (!nameMatch) continue
      const word = nameMatch[1]
      if (RESERVED_SET.has(word.toLowerCase())) {
        problems.push(
          `Line ${i + 1}: reserved StarBasic word "${word}" used as a Dim variable name — rename it (a reserved-word variable silently aborts the whole module).`
        )
      }
    }
  })

  // ── 1b. Reserved word as a Sub / Function parameter name ─────────────────
  // `Sub X(oN, sName As String)` — `oN` reads as the keyword `On` (Basic is
  // case-insensitive) and aborts the module exactly like a bad Dim.
  const paramRe = /^\s*(?:(?:private|public|static)\s+)*(?:sub|function)\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/i
  lines.forEach((raw, i) => {
    const m = paramRe.exec(raw.replace(/'.*$/, ''))
    if (!m || !m[1].trim()) return
    for (const decl of m[1].split(',')) {
      const nameMatch = /^\s*(?:(?:byval|byref|optional)\s+)*([A-Za-z_][A-Za-z0-9_]*)/i.exec(decl)
      if (!nameMatch) continue
      const word = nameMatch[1]
      if (RESERVED_SET.has(word.toLowerCase())) {
        problems.push(
          `Line ${i + 1}: reserved StarBasic word "${word}" used as a parameter name — rename it (a reserved-word parameter silently aborts the whole module).`
        )
      }
    }
  })

  // ── 2. Duplicate Sub / Function name ─────────────────────────────────────
  const seen = new Map<string, number>()
  const defRe = /^\s*(?:private\s+|public\s+|static\s+)*(sub|function)\s+([A-Za-z_][A-Za-z0-9_]*)/i
  lines.forEach((raw, i) => {
    const line = raw.replace(/'.*$/, '')
    const m = defRe.exec(line)
    if (!m) return
    const name = m[2]
    const key = name.toLowerCase()
    const prior = seen.get(key)
    if (prior !== undefined) {
      problems.push(
        `Line ${i + 1}: duplicate ${m[1]} name "${name}" (first defined on line ${prior}) — a redefinition aborts the whole module.`
      )
    } else {
      seen.set(key, i + 1)
    }
  })

  // ── 2b. A literal backslash-n in the body ────────────────────────────────
  // A module assembled from TS string literals with `\\n` instead of `\n`
  // arrives as ONE line and fails to compile, taking every macro with it.
  if (body.includes('\\n')) {
    problems.push('The Basic body contains a literal "\\n" — the module was assembled without real newlines (every macro would be dead).')
  }

  // ── 3. Unescaped XML in the Basic body ───────────────────────────────────
  // Inside `<script:module>…</script:module>` every literal `<`, `>` and bare
  // `&` must be &lt; / &gt; / &amp; or the .xba is malformed and the module
  // fails to parse. Heuristic (comments included — they still live in the XML).
  lines.forEach((raw, i) => {
    if (raw.includes('<')) {
      problems.push(`Line ${i + 1}: unescaped "<" in the Basic body — use &lt; (a raw < breaks the .xba XML).`)
    }
    if (raw.includes('>')) {
      problems.push(`Line ${i + 1}: unescaped ">" in the Basic body — use &gt; (a raw > breaks the .xba XML).`)
    }
    // A bare `&` not already part of a known XML entity (&lt; &gt; &amp; &quot;
    // &apos; &#nn;). StarBasic string concatenation uses `&`, so every `&` in
    // the body MUST be encoded as &amp; in the .xba.
    const bareAmp = /&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/
    if (bareAmp.test(raw)) {
      problems.push(`Line ${i + 1}: unescaped "&" in the Basic body — use &amp; (a raw & breaks the .xba XML).`)
    }
  })

  return problems
}

/**
 * Throws a loud, descriptive error if the seeded module has any compile-safety
 * problem; otherwise returns silently. Called from the seed path so a broken
 * module can never be written into the engine profile and silently kill every
 * macro. Lists every problem so a bad edit is fixed in one pass.
 */
export function assertBasicModuleValid(code: string): void {
  const problems = validateBasicModule(code)
  if (problems.length > 0) {
    throw new Error(
      `Seeded StarBasic module is unsafe (${problems.length} problem${problems.length === 1 ? '' : 's'}) — refusing to seed a module that would silently no-op every macro:\n` +
        problems.map((p) => `  • ${p}`).join('\n')
    )
  }
}
