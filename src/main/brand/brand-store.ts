import fs from 'fs'
import path from 'path'

/**
 * The Brand kit — the user codifies their brand ONCE (colours, fonts, logo,
 * voice/tone) and it flows into agent-generated output so every advanced email /
 * draft comes out on-brand in one shot.
 *
 * This is NOT secret data — it's plain application data (like metrics.json /
 * snapshots). It persists as one JSON file (`brand.json`) plus a `brand/` folder
 * holding a copied logo. The store takes its userData directory by injection so
 * it is pure-testable against a temp dir — no Electron import here.
 *
 * Everything is validated/coerced on the way IN (colour strings, sane lengths)
 * so a corrupt or hostile file/patch can never produce a broken brand — `get()`
 * always returns a sensible, complete brand (falling back to the default).
 */

/** The brand palette — five roles, each a validated CSS colour string. */
export interface BrandPalette {
  primary: string
  accent: string
  background: string
  text: string
  muted: string
}

/** Heading + body font stacks (used for both email theme and prompt hints). */
export interface BrandFonts {
  heading: string
  body: string
}

/** The full brand kit. This is EXACTLY the shape persisted to brand.json. */
export interface Brand {
  name: string
  tagline?: string
  palette: BrandPalette
  fonts: BrandFonts
  /** Absolute path to the copied logo inside userData/brand/ (if a logo is set). */
  logoPath?: string
  /** Voice/tone guidance handed to the drafting agent (freeform). */
  voice?: string
  /** Optional list of approved image paths the user blesses for reuse. */
  approvedImages?: string[]
}

/** A partial update. Nested palette/fonts merge field-by-field. */
export interface BrandPatch {
  name?: string
  tagline?: string
  palette?: Partial<BrandPalette>
  fonts?: Partial<BrandFonts>
  voice?: string
  approvedImages?: string[]
  /** Clearing the logo: pass null. Omitting leaves it as-is. */
  logoPath?: string | null
}

const NAME_MAX = 120
const TAGLINE_MAX = 200
const VOICE_MAX = 4000
const APPROVED_MAX = 50
const APPROVED_PATH_MAX = 1024
const FONT_MAX = 300
const COLOR_MAX = 64
const MAX_LOGO_BYTES = 4 * 1024 * 1024

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** The sensible default brand when the user hasn't set one — a neutral, tasteful kit. */
export const DEFAULT_BRAND: Brand = {
  name: 'Workspace',
  palette: {
    primary: '#2a6df4',
    accent: '#2a6df4',
    background: '#f4f6fb',
    text: '#1f2733',
    muted: '#6b7280',
  },
  fonts: { heading: SANS, body: SANS },
}

/**
 * A permissive-but-safe CSS colour validator. Accepts #rgb / #rrggbb / #rrggbbaa
 * hex, rgb()/rgba()/hsl()/hsla() functional notation, and the small set of plain
 * named colours a user might type. Rejects anything else (e.g. `url(...)`,
 * `expression(...)`, angle-bracket injection) so a colour can never smuggle
 * markup into an MJML attribute. Returns the trimmed value, or undefined.
 */
export function coerceColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().slice(0, COLOR_MAX)
  if (!s) return undefined
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return s
  if (/^(?:rgb|hsl)a?\(\s*[\d.,%\s/]+\)$/i.test(s)) return s
  if (/^[a-z]{3,20}$/i.test(s)) return s // a plain named colour (transparent, white, …)
  return undefined
}

/** Coerce a colour, falling back to a default when the input is invalid. */
function color(raw: unknown, fallback: string): string {
  return coerceColor(raw) ?? fallback
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().slice(0, max)
  return s || undefined
}

function font(raw: unknown, fallback: string): string {
  // A font stack is a comma list of family names — strip anything that could
  // break an MJML attribute (quotes are fine; angle brackets / braces are not).
  if (typeof raw !== 'string') return fallback
  const s = raw.replace(/[<>{}]/g, '').trim().slice(0, FONT_MAX)
  return s || fallback
}

function approvedImages(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: string[] = []
  for (const item of raw.slice(0, APPROVED_MAX)) {
    if (typeof item === 'string') {
      const s = item.trim().slice(0, APPROVED_PATH_MAX)
      if (s) out.push(s)
    }
  }
  return out.length ? out : undefined
}

/**
 * Normalize an untrusted object (persisted file OR a full brand) into a complete,
 * valid Brand — every field validated, missing fields defaulted. Never throws.
 */
export function coerceBrand(raw: unknown): Brand {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const p = (o.palette && typeof o.palette === 'object' ? o.palette : {}) as Record<string, unknown>
  const f = (o.fonts && typeof o.fonts === 'object' ? o.fonts : {}) as Record<string, unknown>
  const brand: Brand = {
    name: str(o.name, NAME_MAX) ?? DEFAULT_BRAND.name,
    palette: {
      primary: color(p.primary, DEFAULT_BRAND.palette.primary),
      accent: color(p.accent, DEFAULT_BRAND.palette.accent),
      background: color(p.background, DEFAULT_BRAND.palette.background),
      text: color(p.text, DEFAULT_BRAND.palette.text),
      muted: color(p.muted, DEFAULT_BRAND.palette.muted),
    },
    fonts: {
      heading: font(f.heading, DEFAULT_BRAND.fonts.heading),
      body: font(f.body, DEFAULT_BRAND.fonts.body),
    },
  }
  const tagline = str(o.tagline, TAGLINE_MAX)
  if (tagline) brand.tagline = tagline
  const voice = str(o.voice, VOICE_MAX)
  if (voice) brand.voice = voice
  const logoPath = str(o.logoPath, APPROVED_PATH_MAX)
  if (logoPath) brand.logoPath = logoPath
  const imgs = approvedImages(o.approvedImages)
  if (imgs) brand.approvedImages = imgs
  return brand
}

/** Persistent, injectable-dir store for the brand kit. Pure-testable, no Electron. */
export class BrandStore {
  private readonly file: string
  private readonly logoDir: string

  constructor(private readonly dir: string) {
    this.file = path.join(dir, 'brand.json')
    this.logoDir = path.join(dir, 'brand')
  }

  /** The current brand — always complete + valid. Unset/corrupt → the default. */
  get(): Brand {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      return coerceBrand(JSON.parse(raw))
    } catch {
      return { ...DEFAULT_BRAND, palette: { ...DEFAULT_BRAND.palette }, fonts: { ...DEFAULT_BRAND.fonts } }
    }
  }

  /**
   * Apply a partial patch over the current brand. Each patch FIELD is validated
   * BEFORE it merges, so an invalid value (a bad colour, an injection attempt)
   * is DROPPED and the prior/default value survives — a hostile patch can never
   * corrupt a good brand nor blank a field.
   */
  set(patch: BrandPatch): Brand {
    const current = this.get()
    const palette = { ...current.palette }
    for (const k of ['primary', 'accent', 'background', 'text', 'muted'] as const) {
      const c = coerceColor(patch.palette?.[k])
      if (c) palette[k] = c
    }
    const fonts = { ...current.fonts }
    for (const k of ['heading', 'body'] as const) {
      const raw = patch.fonts?.[k]
      if (typeof raw === 'string' && raw.trim()) fonts[k] = font(raw, fonts[k])
    }
    const merged: Record<string, unknown> = {
      ...current,
      ...('name' in patch ? { name: patch.name } : {}),
      ...('tagline' in patch ? { tagline: patch.tagline } : {}),
      ...('voice' in patch ? { voice: patch.voice } : {}),
      ...('approvedImages' in patch ? { approvedImages: patch.approvedImages } : {}),
      palette,
      fonts,
    }
    // Logo: null clears it; a string is validated to live inside our logo dir.
    if ('logoPath' in patch) {
      merged.logoPath = patch.logoPath == null ? undefined : this.safeLogoPath(patch.logoPath) ?? current.logoPath
    } else {
      merged.logoPath = current.logoPath
    }
    const next = coerceBrand(merged)
    this.write(next)
    return next
  }

  /**
   * Copy logo bytes (or an on-disk source file) into userData/brand/ and point
   * the brand at the copy. Returns the updated brand. Only png/jpg/svg/webp are
   * accepted; oversized input is rejected. The stored path is ALWAYS inside our
   * logo dir — a caller can never make the brand reference an arbitrary file.
   */
  setLogo(input: { bytes?: Buffer | Uint8Array; sourcePath?: string; ext?: string }): Brand {
    fs.mkdirSync(this.logoDir, { recursive: true })
    let bytes: Buffer
    if (input.bytes) {
      bytes = Buffer.from(input.bytes)
    } else if (input.sourcePath) {
      bytes = fs.readFileSync(input.sourcePath)
    } else {
      throw new Error('No logo data provided.')
    }
    if (bytes.length === 0) throw new Error('The logo file is empty.')
    if (bytes.length > MAX_LOGO_BYTES) throw new Error('The logo is too large (max 4 MB).')

    const ext = normalizeLogoExt(input.ext ?? (input.sourcePath ? path.extname(input.sourcePath) : ''))
    const dest = path.join(this.logoDir, `logo${ext}`)
    // Remove any prior logo file with a different extension so only one remains.
    for (const e of ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']) {
      const prior = path.join(this.logoDir, `logo${e}`)
      if (prior !== dest) { try { fs.rmSync(prior) } catch { /* none */ } }
    }
    fs.writeFileSync(dest, bytes)
    return this.set({ logoPath: dest })
  }

  /** Resolve an untrusted path to one INSIDE our logo dir, else undefined. */
  private safeLogoPath(raw: string): string | undefined {
    const resolved = path.resolve(raw)
    const base = path.resolve(this.logoDir)
    return resolved === base || resolved.startsWith(base + path.sep) ? resolved : undefined
  }

  private write(brand: Brand): void {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(brand, null, 2), 'utf8')
  }
}

/** Allow only image extensions; default to .png. Guards the written filename. */
function normalizeLogoExt(ext: string): string {
  const e = ext.toLowerCase().replace(/[^.a-z0-9]/g, '')
  return ['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif'].includes(e) ? e : '.png'
}
