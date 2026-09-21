/**
 * Quote a path for insertion at a shell prompt — the visual equivalent of a
 * macOS-Terminal file-drop. If the path is "plain" (no whitespace or shell
 * metacharacters) it is returned raw; otherwise it is wrapped in single quotes
 * with any embedded `'` escaped as `'\''` (close-quote, literal quote, reopen).
 */
export function shellQuote(p: string): string {
  if (p === '') return "''"
  // Safe, unquoted POSIX-path characters. Anything outside this set (spaces,
  // quotes, $, *, (), etc.) forces single-quoting.
  if (/^[A-Za-z0-9_./@%+:,=-]+$/.test(p)) return p
  return `'${p.replace(/'/g, "'\\''")}'`
}
