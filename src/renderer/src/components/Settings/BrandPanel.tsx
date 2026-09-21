import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import styles from './SettingsPanel.module.css'
import brand from './BrandPanel.module.css'
import type { Brand, BrandPatch } from '../../types/workspace-api'

/**
 * "Brand kit" — the user codifies their brand ONCE (name, tagline, colours,
 * fonts, voice/tone, logo) and it flows into agent-generated output: the "Brand"
 * email theme derives from the palette + fonts, and every advanced draft/assist
 * carries the voice/name so it comes out on-brand in one shot.
 *
 * Non-secret app data — saved via `brand:set` (and `brand:set-logo` for the
 * image). Mirrors the ConnectorsPanel pattern: load on mount, edit locally,
 * persist on Save, reflect what main stored back.
 */

const COLOR_FIELDS: { key: keyof Brand['palette']; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'accent', label: 'Accent' },
  { key: 'background', label: 'Background' },
  { key: 'text', label: 'Text' },
]

const FONT_PRESETS: { label: string; stack: string }[] = [
  { label: 'System sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  { label: 'Serif', stack: "Georgia, Cambria, 'Times New Roman', Times, serif" },
  { label: 'Inter', stack: 'Inter, system-ui, sans-serif' },
  { label: 'Poppins', stack: 'Poppins, system-ui, sans-serif' },
  { label: 'Georgia display', stack: "Georgia, 'Iowan Old Style', serif" },
]

/** A #hex the native color input accepts, else a neutral fallback (it needs hex). */
function toHex(v: string): string {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim()) ? v.trim() : '#888888'
}

export function BrandPanel(): JSX.Element {
  const [value, setValue] = useState<Brand | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      setValue(await window.workspace.brand.get())
    } catch { /* leave null → shows loading */ }
  }, [])

  useEffect(() => { load().catch(() => {}) }, [load])

  const patch = (p: BrandPatch): void => {
    setSaved(false)
    setValue((v) =>
      v
        ? {
            ...v,
            ...('name' in p ? { name: p.name ?? '' } : {}),
            ...('tagline' in p ? { tagline: p.tagline } : {}),
            ...('voice' in p ? { voice: p.voice } : {}),
            palette: { ...v.palette, ...(p.palette ?? {}) },
            fonts: { ...v.fonts, ...(p.fonts ?? {}) },
          }
        : v,
    )
  }

  const save = async (): Promise<void> => {
    if (!value) return
    setSaving(true)
    setErr('')
    try {
      const next = await window.workspace.brand.set({
        name: value.name,
        tagline: value.tagline,
        voice: value.voice,
        palette: value.palette,
        fonts: value.fonts,
      })
      setValue(next) // reflect what main actually stored (post-validation)
      setSaved(true)
    } catch (e) {
      setErr((e as Error).message || 'Could not save the brand.')
    } finally {
      setSaving(false)
    }
  }

  const onLogo = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setErr('')
    try {
      const buf = await file.arrayBuffer()
      const content = btoa(String.fromCharCode(...new Uint8Array(buf)))
      const next = await window.workspace.brand.setLogo({ filename: file.name, content })
      setValue(next)
    } catch (e) {
      setErr((e as Error).message || 'Could not save the logo.')
    }
  }

  if (!value) {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Brand kit</h3>
        <p className={styles.hint}>Loading…</p>
      </section>
    )
  }

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>Brand kit</h3>
      <p className={styles.hint}>
        Set your brand once — colours, fonts, logo and voice. It powers the “Brand” email theme and steers every
        agent-drafted email so they come out on-brand in one shot.
      </p>

      <div className={brand.field}>
        <label className={brand.label}>Name</label>
        <input
          className={brand.text}
          value={value.name}
          maxLength={120}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Your brand name"
        />
      </div>

      <div className={brand.field}>
        <label className={brand.label}>Tagline</label>
        <input
          className={brand.text}
          value={value.tagline ?? ''}
          maxLength={200}
          onChange={(e) => patch({ tagline: e.target.value })}
          placeholder="A short line that captures the brand"
        />
      </div>

      <div className={brand.field}>
        <label className={brand.label}>Colours</label>
        <div className={brand.swatches}>
          {COLOR_FIELDS.map((c) => (
            <div key={c.key} className={brand.swatch}>
              <input
                type="color"
                className={brand.colorInput}
                value={toHex(value.palette[c.key])}
                onChange={(e) => patch({ palette: { [c.key]: e.target.value } })}
                title={c.label}
              />
              <span className={brand.swatchLabel}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className={brand.field}>
        <label className={brand.label}>Fonts</label>
        <div className={brand.fontRow}>
          <select
            className={styles.select}
            value={value.fonts.heading}
            onChange={(e) => patch({ fonts: { heading: e.target.value } })}
          >
            <option value={value.fonts.heading}>Heading — {presetLabel(value.fonts.heading)}</option>
            {FONT_PRESETS.map((f) => <option key={'h' + f.label} value={f.stack}>Heading — {f.label}</option>)}
          </select>
          <select
            className={styles.select}
            value={value.fonts.body}
            onChange={(e) => patch({ fonts: { body: e.target.value } })}
          >
            <option value={value.fonts.body}>Body — {presetLabel(value.fonts.body)}</option>
            {FONT_PRESETS.map((f) => <option key={'b' + f.label} value={f.stack}>Body — {f.label}</option>)}
          </select>
        </div>
      </div>

      <div className={brand.field}>
        <label className={brand.label}>Voice &amp; tone</label>
        <textarea
          className={brand.textarea}
          rows={3}
          value={value.voice ?? ''}
          maxLength={4000}
          onChange={(e) => patch({ voice: e.target.value })}
          placeholder="How the brand sounds — e.g. Warm, plain-spoken, quietly confident. No jargon, no hype."
        />
      </div>

      <div className={brand.field}>
        <label className={brand.label}>Logo</label>
        <div className={brand.logoRow}>
          {value.logoPath ? (
            <img className={brand.logoPreview} src={`file://${value.logoPath}`} alt="Brand logo" />
          ) : (
            <div className={brand.logoEmpty}>No logo</div>
          )}
          <label className={styles.btn}>
            {value.logoPath ? 'Replace…' : 'Upload…'}
            <input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => onLogo(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>

      {/* Live swatch: the brand as it will read in an email header. */}
      <div
        className={brand.preview}
        style={{ background: value.palette.background, color: value.palette.text }}
      >
        <span className={brand.previewName}>{value.name || 'Your brand'}</span>
        <span className={brand.previewCta} style={{ background: value.palette.accent }}>Call to action</span>
      </div>

      <div className={brand.actions}>
        <button className={styles.btn} onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save brand'}
        </button>
        {saved && <span className={styles.keyStored}><Check size={12} style={{ verticalAlign: 'middle' }} /> saved</span>}
        {err && <span className={styles.errText}>{err}</span>}
      </div>
    </section>
  )
}

function presetLabel(stack: string): string {
  const found = FONT_PRESETS.find((f) => f.stack === stack)
  return found ? found.label : (stack.split(',')[0] || 'Custom').replace(/["']/g, '').trim()
}
