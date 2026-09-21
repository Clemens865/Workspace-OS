/**
 * Renderer-side copy of the signature placement rule.
 *
 * The main-process module (`src/main/mail/signature.ts`) owns storage and is the
 * tested source of truth for the algorithm; this mirrors only the pure
 * placement so compose can apply a signature without an IPC round-trip on every
 * keystroke. Keep the two in step — the behaviour they encode is identical and
 * the main-process one carries the test suite.
 */

/** RFC 3676 delimiter. The trailing space is significant. */
export const SIG_DELIMITER = '-- \n'

function findQuoteStart(body: string): number {
  const lines = body.split('\n')
  let offset = 0
  for (const line of lines) {
    const t = line.trimStart()
    if (t.startsWith('>')) return offset
    if (/^(on|am)\b.{0,200}\b(wrote|schrieb)\b.{0,160}:\s*$/i.test(t)) return offset
    offset += line.length + 1
  }
  return -1
}

/** Appends a signature above any quoted original. Idempotent. */
export function applySignature(body: string, signature: string): string {
  const sig = signature.trim()
  if (!sig || body.includes(sig)) return body
  const block = `\n\n${SIG_DELIMITER}${sig}\n`
  const quoteStart = findQuoteStart(body)
  if (quoteStart < 0) return `${body}${block}`
  return body.slice(0, quoteStart).replace(/\s+$/, '') + block + '\n' + body.slice(quoteStart)
}
