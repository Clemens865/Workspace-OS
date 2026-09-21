/**
 * Zoom — ladder maths only. The REMEMBERING is Chromium's job, not ours.
 *
 * This module originally persisted a level per origin in localStorage and
 * re-applied it on every navigation. That was redundant and actively harmful:
 * Chromium already stores zoom per origin inside a PERSISTENT session
 * partition, which is what `persist:wos-browser` is. Two layers both claiming
 * to own the value disagree, and the e2e caught them doing exactly that — a
 * freshly launched app reported level 5 on a site whose stored level had just
 * been cleared, because Chromium's own record survived and ours did not.
 *
 * So zoom is now set once, by us, and remembered by the engine — which is also
 * why zoom already survived restarts before any of this was written.
 *
 * What remains here is the arithmetic, which is worth having in one tested
 * place: Chromium's zoom LEVEL is logarithmic (factor = 1.2 ** level), so
 * stepping the level by 1 is a 20% change. Storing levels rather than
 * percentages means the number we pass is exactly what setZoomLevel takes,
 * with no conversion to get subtly wrong.
 */

export const MIN_LEVEL = -3
export const MAX_LEVEL = 5

/**
 * The origin a zoom setting belongs to, or '' when the url has none.
 *
 * Opaque origins (about:, data:, blob: of those) yield the literal STRING
 * "null" from the URL API, not a null value — and "null" is truthy, so it
 * sails through any `if (origin)` check as though it were a real site. Mapped
 * to '' so there is one falsy answer for "no origin".
 */
export function originOf(url: string): string {
  try {
    const origin = new URL(url).origin
    return origin === 'null' ? '' : origin
  } catch {
    return ''
  }
}

/** Chromium's level → a human percentage, for the indicator. */
export function levelToPercent(level: number): number {
  return Math.round(1.2 ** level * 100)
}

/** Clamps a level into the supported ladder. */
export function clampLevel(level: number): number {
  return Math.max(MIN_LEVEL, Math.min(MAX_LEVEL, level))
}
