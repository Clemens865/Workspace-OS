import type { SheetExtract } from './sheet-extract'
import { sheetsToPromptText } from './sheet-extract'
import { brandBriefLines, type BrandBriefSource } from './brand-brief'

/**
 * Turns an extracted spreadsheet + an intent into a prompt that returns BLOCKS.
 *
 * Blocks, not MJML. `email-drafter.ts` asks for MJML because a person's one-line
 * brief has no structure to preserve; here the model is reading real data, and
 * a JSON block list can be validated cell by cell before anything renders.
 * `coerce-blocks.ts` already does that validation, and MJML from a model would
 * have to be trusted or re-parsed.
 *
 * The central rule is the one that separates this from a newsletter generator:
 * every figure must come from the grid. A model asked to "summarise a
 * spreadsheet" will otherwise produce plausible totals it computed loosely, and
 * a plausible wrong number in a mail to a client is worse than no mail.
 */

export type FromFileIntent = 'summary' | 'executive' | 'visualize' | 'digest'

interface IntentSpec {
  label: string
  guidance: string
}

export const INTENTS: Record<FromFileIntent, IntentSpec> = {
  summary: {
    label: 'Summarize',
    guidance:
      'Explain what this data shows, in prose a colleague can read in thirty seconds. Lead with the single most important movement or total. Use a `metric` block for at most three headline figures, then `text` for what they mean. Include a `table` ONLY if the reader needs the detail to act.',
  },
  executive: {
    label: 'Executive summary',
    guidance:
      'Write for someone who will not open the attachment. Open with the decision or the status in one sentence. Then at most three `metric` blocks for the figures that would change their mind, and a short `text` on what you recommend or what needs their attention. No table unless a decision literally depends on the rows.',
  },
  visualize: {
    label: 'Visualize',
    guidance:
      'Lead with a `chart` block comparing the most meaningful series in the data — pick the column that carries the comparison, and label each bar with the row it comes from. Follow with one short `text` naming what the chart shows. Add a second `chart` only if a genuinely different comparison matters.',
  },
  digest: {
    label: 'Table digest',
    guidance:
      'Present the data itself, cleaned up. One `table` block with a header row, the columns that matter, and rows ordered so the most important is first. Precede it with one short `text` line of context. Drop columns that carry no information for a reader.',
  },
}

export interface FromFilePromptInput {
  intent: FromFileIntent
  fileName: string
  sheets: SheetExtract[]
  /** Optional steer from the user ("focus on Q3", "for the board"). */
  instruction?: string
  brandKit?: BrandBriefSource
}

/** The block shapes the model is allowed to emit. Mirrors EmailBlock exactly. */
const BLOCK_SCHEMA = `
  { "kind": "text",   "text": "a paragraph; \\n for line breaks" }
  { "kind": "metric", "label": "Berth capacity", "value": "5,150" }
  { "kind": "table",  "rows": [["Header A","Header B"],["a","b"]] }
  { "kind": "chart",  "title": "Throughput by berth",
    "bars": [{ "label": "Berth 4", "value": 5150, "display": "5,150" }] }
  { "kind": "cta",    "label": "Open the model", "href": "https://…" }
`.trim()

export function buildFromFilePrompt(input: FromFilePromptInput): string {
  const spec = INTENTS[input.intent] ?? INTENTS.summary
  const brand = brandBriefLines(input.brandKit).join('\n')
  const truncated = input.sheets.some((s) => s.truncated)

  return [
    'You are drafting the BODY of a 1:1 work email from a spreadsheet the sender is looking at.',
    '',
    `INTENT — ${spec.label}: ${spec.guidance}`,
    '',
    'RULES, in order of importance:',
    '1. Every number you write MUST appear in the data below, or be a sum/difference/percentage you can compute from it exactly. Never estimate, never round beyond what the data supports, never invent a figure to make a point. If the data does not support a claim, do not make the claim.',
    '2. Do not describe the file, the sheet names, or the fact that you are an assistant. Write the email a person would write.',
    '3. No greeting and no sign-off — the sender adds those. Start with the substance.',
    truncated
      ? '4. The data is TRUNCATED. Do not present a total or a "the whole year" claim you cannot see. Say what the visible rows show.'
      : '4. Use only what is in the data; there is nothing else.',
    '',
    brand || '',
    input.instruction?.trim() ? `THE SENDER ALSO ASKS: ${input.instruction.trim()}\n` : '',
    `DATA — from ${input.fileName}, tab-delimited, first row is usually the header:`,
    '',
    sheetsToPromptText(input.sheets),
    '',
    'OUTPUT — a JSON array of blocks and NOTHING else. No prose before or after, no markdown fence.',
    'Allowed block shapes:',
    BLOCK_SCHEMA,
    '',
    'Aim for three to six blocks. `value` on a chart bar must be a plain number; put any formatting in `display`.',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * Pulls the block array out of the model's reply.
 *
 * Models wrap JSON in a fence or a sentence no matter how firmly the prompt says
 * not to, so the first bracket-to-last-bracket slice is the reliable read.
 * Returns [] rather than throwing: a bad reply should surface as "nothing came
 * back", which the caller can retry, not as a crash mid-compose.
 */
export function parseBlocksReply(reply: string): unknown[] {
  const text = String(reply ?? '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
