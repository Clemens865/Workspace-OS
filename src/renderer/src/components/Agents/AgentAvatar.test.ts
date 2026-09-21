import { describe, it, expect } from 'vitest'
import { hashSeed, monogram, faceDataUri } from './AgentAvatar'

describe('AgentAvatar determinism', () => {
  it('hashSeed is stable for the same seed', () => {
    expect(hashSeed('researcher')).toBe(hashSeed('researcher'))
    expect(hashSeed('data-analyst')).toBe(hashSeed('data-analyst'))
  })

  it('different seeds generally produce different hashes', () => {
    expect(hashSeed('alpha')).not.toBe(hashSeed('beta'))
  })

  it('faceDataUri is fully deterministic (same seed → identical URI)', () => {
    const a = faceDataUri('Security Auditor', 44)
    const b = faceDataUri('Security Auditor', 44)
    expect(a).toBe(b)
    expect(a).toMatch(/^data:image\/svg\+xml/)
  })

  it('different seeds produce different faces', () => {
    expect(faceDataUri('alpha')).not.toBe(faceDataUri('omega'))
  })

  it('produces a valid, non-empty local (offline) face for any seed', () => {
    for (const seed of ['a', 'coder', 'x-y-z', 'The Long Agent Name', '数据']) {
      const uri = faceDataUri(seed, 52)
      expect(uri).toMatch(/^data:image\/svg\+xml/)
      // Decoded payload is a real SVG document — rendered offline, no HTTP API.
      const decoded = decodeURIComponent(uri.replace(/^data:image\/svg\+xml;utf8,/, ''))
      expect(decoded).toContain('<svg')
    }
  })

  it('monogram derives initials correctly', () => {
    expect(monogram('researcher')).toBe('RE')
    expect(monogram('Data Analyst')).toBe('DA')
    expect(monogram('security-auditor')).toBe('SA')
    expect(monogram('code_reviewer')).toBe('CR')
    expect(monogram('')).toBe('?')
  })
})
