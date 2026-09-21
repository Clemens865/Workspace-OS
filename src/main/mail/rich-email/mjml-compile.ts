import mjml2html from 'mjml'

/**
 * Thin, testable wrapper around MJML → responsive, email-client-safe HTML.
 *
 * Why a wrapper (not a direct call at the call-site):
 *  - MJML v5's `mjml2html` is ASYNC and returns `{ html, json, errors }`; its
 *    `formattedMessage` embeds an ABSOLUTE filesystem path (the CWD). We collapse
 *    every failure mode into one shape and surface only the SANITIZED `message`
 *    (never the path) so nothing internal leaks toward the renderer / the wire.
 *  - We compile at `validationLevel: 'soft'` so a malformed-but-recoverable
 *    template still yields HTML *and* a list of problems the agent can retry on,
 *    instead of throwing. A truly unparseable template (not even XML) DOES throw
 *    inside mjml; we catch it and report it as a single error — never a throw.
 */

/** One MJML validation/compile problem, already sanitized (no filesystem path). */
export interface MjmlError {
  /** Human-readable problem (e.g. "Element mj-foo doesn't exist"). */
  message: string
  /** 1-based source line, when MJML reports one. */
  line?: number
  /** The offending MJML tag, when known. */
  tagName?: string
}

export interface CompileMjmlResult {
  /** The compiled responsive HTML. Empty string when compilation could not run. */
  html: string
  /** Validation/compile problems. Empty = clean compile. Never throws. */
  errors: MjmlError[]
}

/**
 * Compile MJML source to email-client-safe HTML. Never throws: a parse failure
 * is reported as an error entry with empty html. Callers decide whether to send
 * (clean) or bounce back to the agent (errors present).
 */
export async function compileMjml(mjml: string): Promise<CompileMjmlResult> {
  const source = typeof mjml === 'string' ? mjml : ''
  if (!source.trim()) {
    return { html: '', errors: [{ message: 'MJML source is empty.' }] }
  }
  try {
    const out = await mjml2html(source, {
      validationLevel: 'soft',
      // Do not let MJML fetch remote `mj-include`s or resolve paths on disk.
      filePath: undefined,
    })
    return {
      html: typeof out.html === 'string' ? out.html : '',
      errors: normalizeErrors(out.errors),
    }
  } catch (e) {
    // Unparseable template (e.g. not XML). Report, don't throw.
    const message = e instanceof Error ? firstLine(e.message) : 'MJML compilation failed.'
    return { html: '', errors: [{ message: message || 'MJML compilation failed.' }] }
  }
}

/**
 * Lifts mjml's raw error objects into our sanitized shape, dropping the
 * `formattedMessage` field (it embeds an absolute path). Tolerant of unknown
 * shapes so an mjml internals change can never crash the compile.
 */
function normalizeErrors(raw: unknown): MjmlError[] {
  if (!Array.isArray(raw)) return []
  const out: MjmlError[] = []
  for (const item of raw) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const message = typeof o.message === 'string' && o.message ? o.message : 'Invalid MJML.'
    const err: MjmlError = { message }
    if (typeof o.line === 'number') err.line = o.line
    if (typeof o.tagName === 'string') err.tagName = o.tagName
    out.push(err)
  }
  return out
}

/** First line only — mjml throw messages can be multi-line and path-laden. */
function firstLine(s: string): string {
  return s.split('\n')[0].trim()
}
