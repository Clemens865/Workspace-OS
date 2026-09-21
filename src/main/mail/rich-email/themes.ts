/**
 * Design themes for the everyday rich email. "Beautiful by default."
 *
 * A theme is a small, tasteful set of typography + spacing + accent choices —
 * NOT a marketing template. It is applied to an assembled message via MJML's
 * `<mj-attributes>` head block (so every mj-text / mj-button inherits it) plus a
 * body background. The output is ordinary responsive HTML any client renders.
 *
 * Deliberately conservative: system font stacks (no web-font fetches), generous
 * line-height, comfortable padding. The only thing that visibly changes between
 * themes is the accent colour, the type scale and the corner rounding — the sort
 * of restraint that reads as "designed", not "salesy".
 */

/** A theme id the renderer picks from. `clean` is the default. `brand` is derived
 *  from the user's saved Brand kit (palette + fonts) at build time. */
export type ThemeId = 'clean' | 'editorial' | 'compact' | 'brand'

export interface EmailTheme {
  id: ThemeId
  /** Human label for the theme picker. */
  label: string
  /** One-line description for the picker tooltip. */
  hint: string
  /** Accent used for links + the CTA button. */
  accent: string
  /** Body text colour. */
  text: string
  /** Page background behind the content column. */
  background: string
  /** Font stack applied to all text (system fonts only — no remote fetch). */
  fontFamily: string
  /** Base body font size, e.g. "16px". */
  fontSize: string
  /** Body line-height, e.g. "1.6". */
  lineHeight: string
  /** Corner radius for the CTA button, e.g. "8px". */
  buttonRadius: string
}

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
const SERIF = "Georgia, Cambria, 'Times New Roman', Times, serif"

/** The built-in themes. Order = display order; first is the default. */
export const THEMES: readonly EmailTheme[] = [
  {
    id: 'clean',
    label: 'Clean',
    hint: 'Modern system typography, roomy spacing, blue accent',
    accent: '#2a6df4',
    text: '#1f2733',
    background: '#f4f6fb',
    fontFamily: SANS,
    fontSize: '16px',
    lineHeight: '1.6',
    buttonRadius: '8px',
  },
  {
    id: 'editorial',
    label: 'Editorial',
    hint: 'Serif headings feel, warm ink, generous leading',
    accent: '#9a6b3f',
    text: '#2b2622',
    background: '#faf7f2',
    fontFamily: SERIF,
    fontSize: '17px',
    lineHeight: '1.7',
    buttonRadius: '4px',
  },
  {
    id: 'compact',
    label: 'Compact',
    hint: 'Tight, dense, neutral — for quick operational notes',
    accent: '#3a3f4b',
    text: '#23262d',
    background: '#ffffff',
    fontFamily: SANS,
    fontSize: '15px',
    lineHeight: '1.5',
    buttonRadius: '6px',
  },
] as const

export const DEFAULT_THEME_ID: ThemeId = 'clean'

/** Resolve a theme id (unknown → the default). Never throws. */
export function resolveTheme(id: unknown): EmailTheme {
  const found = THEMES.find((t) => t.id === id)
  return found ?? THEMES[0]
}

/**
 * The MJML `<mj-attributes>` + body-background block for a theme. Placed inside
 * `<mj-head>`; every mj-text/mj-button inherits it, so a single theme choice
 * styles the whole message. Pure string — trivially unit-testable via markers.
 */
export function themeHead(theme: EmailTheme): string {
  return [
    '  <mj-head>',
    `    <mj-attributes>`,
    `      <mj-all font-family="${theme.fontFamily}" />`,
    `      <mj-text font-size="${theme.fontSize}" line-height="${theme.lineHeight}" color="${theme.text}" />`,
    `      <mj-button background-color="${theme.accent}" border-radius="${theme.buttonRadius}" font-size="${theme.fontSize}" />`,
    `    </mj-attributes>`,
    `    <mj-style>a { color: ${theme.accent}; }</mj-style>`,
    '  </mj-head>',
  ].join('\n')
}

/** The theme's body-background attribute value (used on `<mj-body>`). */
export function themeBodyBackground(theme: EmailTheme): string {
  return theme.background
}

/** The subset of a Brand kit the email theme derives from (palette + fonts). */
export interface BrandThemeSource {
  palette: { accent: string; background: string; text: string }
  fonts: { heading: string; body: string }
}

/**
 * Derive an EmailTheme from the user's Brand kit, so a message on the "Brand"
 * theme carries their accent (links + CTA), body colour, background and font
 * stack. Deliberately maps the SAME token roles the built-in themes use, so it
 * flows through `themeHead` / `themeBodyBackground` unchanged — the only thing
 * that differs is where the tokens come from. Pure; trivially unit-testable.
 *
 * Note: the heading font is NOT a distinct token in the MJML head (mj-all sets
 * one family). We use the BODY font for the base so ordinary copy matches the
 * brand; block renderers may still opt into the heading font for headline text.
 */
export function brandTheme(brand: BrandThemeSource): EmailTheme {
  return {
    id: 'brand',
    label: 'Brand',
    hint: 'Your saved brand — palette + fonts',
    accent: brand.palette.accent,
    text: brand.palette.text,
    background: brand.palette.background,
    fontFamily: brand.fonts.body || SANS,
    fontSize: '16px',
    lineHeight: '1.6',
    buttonRadius: '8px',
  }
}
