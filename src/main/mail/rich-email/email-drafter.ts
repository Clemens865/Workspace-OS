import { compileMjml, type MjmlError } from './mjml-compile'
import { resolveLiveTokens, type MetricLookup, type UnresolvedToken } from './email-tokens'
import { brandBriefLines, type BrandBriefSource } from './brand-brief'

/**
 * Agent-emits-MJML orchestration: a natural-language brief (+ optional design
 * hints) → a designed, responsive 1:1 HTML email.
 *
 * This is the "draft the whole message from a one-line brief" path — used by the
 * rich-compose "Draft from my notes" assist. It is a normal 1:1 email, not a
 * broadcast: no subscribers, no campaign.
 *
 * Two cleanly separated jobs (same shape as draft-service):
 *   (a) GENERATION — an INJECTED `draftFn` returns MJML SOURCE. In the app it is
 *       wired to the same `claude -p` pipeline mail-drafter uses (subscription,
 *       no API key); in tests it is a deterministic fake. The agent is given a
 *       tight system instruction to output MJML ONLY, plus a skeleton example.
 *   (b) RESOLUTION + COMPILE — before compiling we resolve `{{metric:<id>}}`
 *       liveness tokens against the metric store (fail-safe placeholders for
 *       unknowns), then compile MJML → email-safe HTML via the thin wrapper.
 *
 * On MJML errors we RETURN them (never throw) so the caller can bounce the brief
 * back to the agent for a retry. This module NEVER sends — sending is the
 * user-approved SMTP path (MAIL_SEND), reused verbatim.
 */

/** Produces MJML source from a brief. Injected: app = agent, tests = fake. */
export type EmailDraftFn = (input: EmailDraftFnInput) => Promise<string>

export interface EmailDraftFnInput {
  /** The user's natural-language brief for the email. */
  brief: string
  /** Optional design hints (tone, primary colour…) passed through. */
  brand?: string
  /** The user's saved Brand kit (name/voice/palette) — injected as a brand brief. */
  brandKit?: BrandBriefSource
}

export interface DraftRichEmailOptions {
  brand?: string
  /** The user's saved Brand kit — when set, the prompt carries a brand brief. */
  brandKit?: BrandBriefSource
}

export interface DraftedRichEmail {
  /** The (token-resolved) MJML source the agent produced. */
  mjml: string
  /** The compiled, responsive, email-client-safe HTML. */
  html: string
  /** A suggested subject line, derived from the brief/MJML. */
  subject: string
  /** MJML compile/validation problems (empty = clean). */
  errors: MjmlError[]
  /** Liveness tokens left as visible placeholders (unknown/unreadable). */
  unresolvedTokens: UnresolvedToken[]
}

const MAX_BRIEF_CHARS = 6000
const MAX_SUBJECT_CHARS = 200

/** A minimal MJML skeleton we show the agent so it emits VALID structure. */
const MJML_SKELETON = [
  '<mjml>',
  '  <mj-body>',
  '    <mj-section>',
  '      <mj-column>',
  '        <mj-text font-size="20px" font-weight="bold">Headline</mj-text>',
  '        <mj-text>Body copy…</mj-text>',
  '        <mj-button href="https://example.com">Call to action</mj-button>',
  '      </mj-column>',
  '    </mj-section>',
  '  </mj-body>',
  '</mjml>',
].join('\n')

/** Builds the system+brief prompt handed to the agent. MJML ONLY, no prose. */
export function buildEmailDraftPrompt(input: EmailDraftFnInput): string {
  const brief = (input.brief || '').slice(0, MAX_BRIEF_CHARS)
  const lines = [
    'You are helping the account owner write a single, personal 1:1 email (a normal',
    'message or reply to one colleague). Produce it as responsive MJML source.',
    '',
    'HARD RULES:',
    '- Output MJML ONLY. No markdown fences, no explanation, no commentary.',
    '- The output MUST start with <mjml> and end with </mjml>.',
    '- Use only standard MJML tags (mj-body, mj-section, mj-column, mj-text,',
    '  mj-button, mj-image, mj-divider, mj-spacer). Never invent tags.',
    '- Write like a real person to one recipient — warm, concise, direct. This is',
    '  NOT a marketing blast, so no "unsubscribe", no salesy hero banners.',
    '- Keep it self-contained: inline styles via MJML attributes, no <script>,',
    '  no remote CSS/JS. Images may use mj-image with an https src.',
    '- If the brief contains a token like {{metric:some-id}}, KEEP it verbatim in',
    '  the copy — it is resolved to a live number after you finish.',
    '',
    'MJML skeleton to follow (structure, not content):',
    MJML_SKELETON,
    '',
    '--- What the email should say ---',
    brief,
  ]
  if (input.brand && input.brand.trim()) {
    lines.push('', '--- Design/tone hints ---', input.brand.trim().slice(0, 1000))
  }
  lines.push(...brandBriefLines(input.brandKit))
  lines.push('--- end ---')
  return lines.join('\n')
}

/**
 * Draft a rich 1:1 email from a brief. Pure orchestration: calls the injected
 * `draftFn` for MJML, resolves liveness tokens, compiles to HTML, derives a
 * subject. Returns everything (incl. errors/unresolved) — DOES NOT SEND.
 */
export async function draftRichEmail(
  draftFn: EmailDraftFn,
  brief: string,
  metrics: MetricLookup,
  opts: DraftRichEmailOptions = {},
): Promise<DraftedRichEmail> {
  const rawMjml = await draftFn({ brief, brand: opts.brand, brandKit: opts.brandKit })
  const mjmlSource = stripFences(typeof rawMjml === 'string' ? rawMjml : '')

  // Resolve liveness tokens in the MJML BEFORE compile, so the numbers are live
  // in the shipped HTML. Also resolve the brief so a subject drawn from it is live.
  const resolvedMjml = resolveLiveTokens(mjmlSource, metrics)
  const compiled = await compileMjml(resolvedMjml.text)

  const subject = deriveSubject(brief, resolvedMjml.text, metrics)

  return {
    mjml: resolvedMjml.text,
    html: compiled.html,
    subject,
    errors: compiled.errors,
    unresolvedTokens: resolvedMjml.unresolved,
  }
}

/**
 * Removes a leading/trailing markdown code fence if a model wrapped the MJML in
 * ```…``` despite the instruction. Defensive — keeps the compile robust.
 */
export function stripFences(s: string): string {
  const t = s.trim()
  const fenced = t.match(/^```(?:mjml|xml|html)?\s*\n([\s\S]*?)\n```$/i)
  return (fenced ? fenced[1] : t).trim()
}

/**
 * A subject line: the brief's first sentence/line (token-resolved), else the
 * first mj-text content, capped. Never empty — falls back to a sane default.
 */
function deriveSubject(brief: string, mjml: string, metrics: MetricLookup): string {
  const fromBrief = resolveLiveTokens(firstMeaningfulLine(brief), metrics).text.trim()
  if (fromBrief) return fromBrief.slice(0, MAX_SUBJECT_CHARS)
  const firstText = mjml.match(/<mj-text[^>]*>([\s\S]*?)<\/mj-text>/i)
  const stripped = firstText ? stripTags(firstText[1]).trim() : ''
  return (stripped || 'Message').slice(0, MAX_SUBJECT_CHARS)
}

function firstMeaningfulLine(s: string): string {
  for (const raw of (s || '').split('\n')) {
    const line = raw.trim()
    if (line) return line
  }
  return ''
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
}
