import fs from 'fs'
import path from 'path'

/**
 * Signatures — per account, appended at compose time.
 *
 * The interesting part is not storage, it is PLACEMENT. Getting a signature
 * into a reply wrong is the most visible way a mail client looks amateur:
 *
 *   - In a reply, the signature belongs ABOVE the quoted original, not at the
 *     very bottom under everything the other person wrote. Every client does
 *     top-posting this way, and a signature stranded below a long quote reads
 *     as a mistake.
 *   - It must be idempotent. Compose UIs re-render, drafts reload, and an
 *     "append signature" that runs twice produces the thing everyone has seen
 *     in the wild — a mail signed twice.
 *   - The delimiter is `-- ` followed by a newline (RFC 3676, trailing space
 *     significant). Clients use it to fold or grey the signature, and getting
 *     the space wrong silently disables that everywhere.
 */

/** The RFC 3676 signature delimiter. The trailing space is required. */
export const SIG_DELIMITER = '-- \n'

/** True when the body already carries this signature — the idempotence guard. */
export function hasSignature(body: string, signature: string): boolean {
  const sig = signature.trim()
  if (!sig) return false
  return body.includes(sig)
}

/**
 * Appends a signature to a draft body.
 *
 * `quotedFrom` is the index at which the quoted original begins (the first
 * line starting with "> ", or the "On … wrote:" attribution). When present the
 * signature is inserted before it, which is where a reader expects it.
 */
export function applySignature(body: string, signature: string): string {
  const sig = signature.trim()
  if (!sig) return body
  if (hasSignature(body, sig)) return body

  const block = `\n\n${SIG_DELIMITER}${sig}\n`
  const quoteStart = findQuoteStart(body)

  if (quoteStart < 0) return `${body}${block}`
  // Insert above the quoted original, preserving whatever the user has typed.
  return body.slice(0, quoteStart).replace(/\s+$/, '') + block + '\n' + body.slice(quoteStart)
}

/**
 * Finds where the quoted original starts, or -1.
 *
 * Recognises the two shapes that cover essentially all mail: a run of `>`
 * quoting, and the "On <date>, <person> wrote:" attribution line that precedes
 * it. The attribution wins when both are present, because the signature belongs
 * above the attribution too, not wedged between it and the quote.
 */
export function findQuoteStart(body: string): number {
  const lines = body.split('\n')
  let offset = 0
  for (const line of lines) {
    const t = line.trimStart()
    if (t.startsWith('>')) return offset
    // "On Tue, 5 Aug 2026 at 10:00, Ana wrote:" and the German
    // "Am 05.08.2026 um 10:00 schrieb Ana:" — note the word order differs.
    // English puts the verb last ("Ana wrote:"), German puts the NAME last
    // ("schrieb Ana:"), so the verb cannot be assumed adjacent to the colon.
    if (/^(on|am)\b.{0,200}\b(wrote|schrieb)\b.{0,160}:\s*$/i.test(t)) return offset
    offset += line.length + 1
  }
  return -1
}

// ── Storage ──────────────────────────────────────────────────────────────────

const FILE = 'mail-signatures.json'

/** Reads the per-account signature map. Absent/unreadable is an empty map. */
export function readSignatures(userDataDir: string): Record<string, string> {
  try {
    const raw = fs.readFileSync(path.join(userDataDir, FILE), 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Writes one account's signature. An empty string removes it. */
export function saveSignature(userDataDir: string, accountId: string, signature: string): void {
  const all = readSignatures(userDataDir)
  const trimmed = signature.trim()
  if (trimmed) all[accountId] = trimmed
  else delete all[accountId]
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, FILE), JSON.stringify(all, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  })
}
