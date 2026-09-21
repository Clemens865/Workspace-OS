import { describe, it, expect } from 'vitest'
import { THEMES, resolveTheme, themeHead, themeBodyBackground, brandTheme, DEFAULT_THEME_ID } from './themes'

describe('email themes', () => {
  it('exposes 3 clean themes with the default first', () => {
    expect(THEMES.length).toBe(3)
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID)
    expect(THEMES.map((t) => t.id).sort()).toEqual(['clean', 'compact', 'editorial'])
  })

  it('resolveTheme returns the chosen theme, or the default for unknown', () => {
    expect(resolveTheme('editorial').id).toBe('editorial')
    expect(resolveTheme('does-not-exist').id).toBe(DEFAULT_THEME_ID)
    expect(resolveTheme(undefined).id).toBe(DEFAULT_THEME_ID)
  })

  it('themeHead carries the chosen theme accent + type scale as MJML attributes', () => {
    const editorial = resolveTheme('editorial')
    const head = themeHead(editorial)
    expect(head).toContain('<mj-attributes>')
    expect(head).toContain(editorial.accent) // accent drives button + links
    expect(head).toContain(editorial.fontSize)
    expect(head).toContain(editorial.fontFamily)
  })

  it('different themes produce different style markers', () => {
    expect(themeHead(resolveTheme('clean'))).not.toBe(themeHead(resolveTheme('compact')))
  })
})

describe('brandTheme (Brand kit → email theme)', () => {
  const brand = {
    palette: { accent: '#ff3366', background: '#0b0b0f', text: '#eeeeee' },
    fonts: { heading: 'Poppins, sans-serif', body: 'Inter, sans-serif' },
  }

  it('maps the brand palette + body font into the theme tokens', () => {
    const t = brandTheme(brand)
    expect(t.id).toBe('brand')
    expect(t.accent).toBe('#ff3366')
    expect(t.background).toBe('#0b0b0f')
    expect(t.text).toBe('#eeeeee')
    expect(t.fontFamily).toBe('Inter, sans-serif')
  })

  it('produces MJML head markers carrying the brand accent + font', () => {
    const head = themeHead(brandTheme(brand))
    expect(head).toContain('#ff3366') // accent on the button + link colour
    expect(head).toContain('Inter, sans-serif') // brand body font on mj-all
    expect(head).toContain('#eeeeee') // brand text colour
    expect(themeBodyBackground(brandTheme(brand))).toBe('#0b0b0f')
  })
})
