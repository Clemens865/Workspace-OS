/**
 * A compact "brand brief" injected into the drafting/assist prompts so the agent
 * writes on-brand in one shot. This is the language-facing half of the Brand kit
 * (the theme is the visual half). It is deliberately SMALL — a few labelled lines
 * the model can actually follow — and is only emitted when a brand is provided,
 * so with no brand the prompts are byte-for-byte unchanged.
 */

/** The brand fields that steer WORDS (not visuals). All optional but name. */
export interface BrandBriefSource {
  name: string
  tagline?: string
  voice?: string
  palette?: { primary?: string; accent?: string }
}

const NAME_MAX = 120
const TAGLINE_MAX = 200
const VOICE_MAX = 1200

/**
 * Render the brand brief as prompt lines, or an empty array when there is no
 * meaningful brand to describe. The caller splices these into its prompt.
 */
export function brandBriefLines(brand: BrandBriefSource | undefined): string[] {
  if (!brand) return []
  const name = (brand.name || '').trim().slice(0, NAME_MAX)
  const tagline = (brand.tagline || '').trim().slice(0, TAGLINE_MAX)
  const voice = (brand.voice || '').trim().slice(0, VOICE_MAX)
  // Nothing worth saying (e.g. the untouched default with no voice) → no lines.
  if (!name && !tagline && !voice) return []

  const lines: string[] = ['', '--- Brand ---']
  if (name) lines.push(`Brand name: ${name}`)
  if (tagline) lines.push(`Tagline: ${tagline}`)
  if (voice) lines.push(`Voice & tone: ${voice}`)
  const colours = [brand.palette?.primary, brand.palette?.accent].filter(Boolean).join(', ')
  if (colours) lines.push(`Brand colours (for accents only, if you add any): ${colours}`)
  lines.push('Write in this brand voice — it is who is sending. Do not name the brand unless it reads naturally.')
  return lines
}
