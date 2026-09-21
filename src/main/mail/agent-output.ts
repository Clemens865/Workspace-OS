/**
 * Defensive sanitizer for agent (`claude -p`) output before it becomes an email
 * body. The drafting prompts already say "no commentary", but a user's local
 * `claude` may run under an output-style / hook that emits telemetry lines
 * (e.g. `PROGRESS:` / `DECISION:`) REGARDLESS of the prompt. Trusting stdout
 * verbatim would then drop that meta-narration straight into the compose box.
 * This strips it, so the body is clean no matter how the environment is set up.
 *
 * Conservative by construction: only removes lines that are unmistakably agent
 * telemetry (an UPPERCASE keyword followed by a colon — a form that does not
 * occur in normal email prose), plus a single leading "Here's the draft:"-style
 * preamble. If stripping would empty the text, the original is returned — a
 * draft is never blanked.
 */

/** UPPERCASE-only so real prose like "Progress: on track" is never touched. */
const TELEMETRY_LINE =
  /^(PROGRESS|DECISION|BLOCKER|THINKING|REASONING|PLAN|TODO|STATUS|OBSERVATION|FOCUS|NEXT ?STEPS?|ACTION)\s*:/

/** A single leading meta preamble line ("Here's the revised email:"). */
const PREAMBLE = /^(here'?s|here is|sure|certainly|revised|updated|of course)\b.*:$/i

export function stripAgentTelemetry(input: string): string {
  const original = (input ?? '').trim()
  if (!original) return original

  // Drop telemetry lines anywhere in the output.
  let lines = original.split('\n').filter((l) => !TELEMETRY_LINE.test(l.trim()))

  // Drop a single leading preamble line if present.
  while (lines.length && lines[0].trim() === '') lines.shift()
  if (lines.length && PREAMBLE.test(lines[0].trim())) lines = lines.slice(1)

  const cleaned = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Fail-safe: never return an empty body when the model actually produced one.
  return cleaned || original
}
