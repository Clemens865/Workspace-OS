import { describe, expect, it } from 'vitest'
import { matchCodexSkills } from './codexCatalog'

describe('Codex skills are advisory', () => {
  it('a persona naming a Claude-only skill runs without it instead of never starting', () => {
    const available = [{ name: 'office-docgen', path: '/skills/office-docgen' }, { name: 'research', path: '/skills/research' }]
    const m = matchCodexSkills(['research', 'yorizon-pptx-v2', 'research'], available)
    expect(m.skills).toEqual([{ name: 'research', path: '/skills/research' }])
    expect(m.missing).toEqual(['yorizon-pptx-v2'])
    expect(matchCodexSkills(['anything'], [])).toEqual({ skills: [], missing: ['anything'] })
  })
})
