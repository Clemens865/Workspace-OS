import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { BrandStore, coerceBrand, coerceColor, DEFAULT_BRAND } from './brand-store'

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-brand-'))
})
afterEach(() => {
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
})

describe('BrandStore', () => {
  it('get() returns the sensible default when unset', () => {
    const store = new BrandStore(dir)
    const b = store.get()
    expect(b.name).toBe(DEFAULT_BRAND.name)
    expect(b.palette.accent).toBe(DEFAULT_BRAND.palette.accent)
    expect(b.fonts.body).toBe(DEFAULT_BRAND.fonts.body)
    // Default must be a deep copy — mutating it must not corrupt the constant.
    b.palette.accent = '#000000'
    expect(DEFAULT_BRAND.palette.accent).not.toBe('#000000')
  })

  it('set() persists a patch and round-trips through a fresh store', () => {
    const a = new BrandStore(dir)
    a.set({ name: 'Acme', tagline: 'We ship', voice: 'Warm, direct, no jargon.', palette: { accent: '#ff3366' } })
    const b = new BrandStore(dir) // fresh instance reads the same file
    const got = b.get()
    expect(got.name).toBe('Acme')
    expect(got.tagline).toBe('We ship')
    expect(got.voice).toBe('Warm, direct, no jargon.')
    expect(got.palette.accent).toBe('#ff3366')
    // Untouched fields keep their default.
    expect(got.palette.text).toBe(DEFAULT_BRAND.palette.text)
  })

  it('set() merges nested palette/fonts field-by-field', () => {
    const s = new BrandStore(dir)
    s.set({ palette: { primary: '#111111' } })
    s.set({ palette: { accent: '#222222' } })
    const got = s.get()
    expect(got.palette.primary).toBe('#111111')
    expect(got.palette.accent).toBe('#222222')
  })

  it('rejects a bad colour, keeping the prior/default value', () => {
    const s = new BrandStore(dir)
    s.set({ palette: { accent: 'url(evil)' as string } })
    expect(s.get().palette.accent).toBe(DEFAULT_BRAND.palette.accent)
    s.set({ palette: { accent: '#abc' } })
    s.set({ palette: { accent: '<script>' as string } })
    expect(s.get().palette.accent).toBe('#abc') // bad patch left the good value intact
  })

  it('setLogo() copies bytes INTO the userData brand dir and points the brand at the copy', () => {
    const s = new BrandStore(dir)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
    const b = s.setLogo({ bytes: png, ext: '.png' })
    expect(b.logoPath).toBeTruthy()
    expect(b.logoPath!.startsWith(path.join(dir, 'brand'))).toBe(true)
    expect(fs.existsSync(b.logoPath!)).toBe(true)
    expect(Buffer.compare(fs.readFileSync(b.logoPath!), png)).toBe(0)
    // Persisted — a fresh store sees the same logo path.
    expect(new BrandStore(dir).get().logoPath).toBe(b.logoPath)
  })

  it('setLogo() rejects oversized input', () => {
    const s = new BrandStore(dir)
    const huge = Buffer.alloc(5 * 1024 * 1024, 1)
    expect(() => s.setLogo({ bytes: huge, ext: '.png' })).toThrow(/too large/i)
  })

  it('set({ logoPath: null }) clears the logo', () => {
    const s = new BrandStore(dir)
    s.setLogo({ bytes: Buffer.from([1, 2, 3]), ext: '.png' })
    expect(s.get().logoPath).toBeTruthy()
    const cleared = s.set({ logoPath: null })
    expect(cleared.logoPath).toBeUndefined()
  })

  it('set() refuses a logoPath outside the brand dir', () => {
    const s = new BrandStore(dir)
    const b = s.set({ logoPath: '/etc/passwd' })
    expect(b.logoPath).toBeUndefined()
  })
})

describe('coerceBrand', () => {
  it('normalizes a hostile/partial object into a complete valid brand', () => {
    const b = coerceBrand({ name: '  x  ', palette: { accent: 'javascript:alert(1)' }, fonts: { heading: 'Inter<img>' } })
    expect(b.name).toBe('x')
    expect(b.palette.accent).toBe(DEFAULT_BRAND.palette.accent) // bad colour dropped
    expect(b.fonts.heading).not.toMatch(/[<>]/) // angle brackets stripped (no markup can survive)
    expect(b.fonts.heading).toContain('Inter')
    expect(b.palette.text).toBe(DEFAULT_BRAND.palette.text)
  })
})

describe('coerceColor', () => {
  it('accepts hex / rgb / hsl / named, rejects injection', () => {
    expect(coerceColor('#abc')).toBe('#abc')
    expect(coerceColor('#aabbccdd')).toBe('#aabbccdd')
    expect(coerceColor('rgb(10, 20, 30)')).toBe('rgb(10, 20, 30)')
    expect(coerceColor('hsla(200, 50%, 40%, 0.5)')).toBe('hsla(200, 50%, 40%, 0.5)')
    expect(coerceColor('transparent')).toBe('transparent')
    expect(coerceColor('url(x)')).toBeUndefined()
    expect(coerceColor('#12')).toBeUndefined()
    expect(coerceColor('<b>')).toBeUndefined()
    expect(coerceColor(42)).toBeUndefined()
  })
})
