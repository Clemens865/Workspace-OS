/**
 * Liveness hook — the moat. A rich email's body / MJML may embed live-data tokens
 * of the form `{{metric:<id>}}`. Before compile + send we resolve each token to
 * the metric's CURRENT value (from metrics.ts), so the numbers a normal 1:1 email
 * ships are true at send time — the same single-source-of-truth that flows into
 * the office documents, now flowing into everyday email.
 *
 * FAIL-SAFE (mirrors the transclusion discipline): an unknown / unreadable token
 * is NEVER silently blanked. It is left as a VISIBLE placeholder and reported, so
 * a broken reference is loud, not a hole in the message.
 */

/** The minimal metric read surface we need — satisfied by MetricStore. */
export interface MetricLookup {
  get(id: string): { value: number } | undefined
}

/** One token we could not resolve to a live value (reported, never silent). */
export interface UnresolvedToken {
  /** The raw token as written, e.g. "{{metric:abc}}". */
  token: string
  /** The metric id we tried to resolve. */
  id: string
  reason: 'unknown' | 'unreadable'
}

export interface ResolveTokensResult {
  /** The text with every RESOLVABLE token replaced by its live value. */
  text: string
  /** Tokens left as a visible placeholder (unknown id / unreadable value). */
  unresolved: UnresolvedToken[]
}

/** Matches `{{metric:<id>}}` with optional inner whitespace. Global. */
const TOKEN_RE = /\{\{\s*metric:\s*([^}\s]+)\s*\}\}/g

/** The visible placeholder left in place of an unresolvable token. */
function placeholder(id: string): string {
  return `[metric ${id} unavailable]`
}

/**
 * Resolve every `{{metric:<id>}}` in `input` against `metrics`.
 *   - known id, finite value → the literal number (locale-free, e.g. "1234.5")
 *   - unknown id             → visible placeholder + reported ('unknown')
 *   - value not finite       → visible placeholder + reported ('unreadable')
 * Non-string input coerces to '' (never throws at a boundary).
 */
export function resolveLiveTokens(
  input: unknown,
  metrics: MetricLookup,
): ResolveTokensResult {
  const text = typeof input === 'string' ? input : ''
  const unresolved: UnresolvedToken[] = []

  const out = text.replace(TOKEN_RE, (whole, rawId: string) => {
    const id = rawId.trim()
    const metric = metrics.get(id)
    if (!metric) {
      unresolved.push({ token: whole, id, reason: 'unknown' })
      return placeholder(id)
    }
    if (typeof metric.value !== 'number' || !Number.isFinite(metric.value)) {
      unresolved.push({ token: whole, id, reason: 'unreadable' })
      return placeholder(id)
    }
    return String(metric.value)
  })

  return { text: out, unresolved }
}
