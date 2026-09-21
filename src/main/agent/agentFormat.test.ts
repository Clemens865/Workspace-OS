import { describe, expect, it } from 'vitest'
import { parseAgentMd, serializeAgentMd } from './agentFormat'

describe('agentFormat — wos_model', () => {
  it('round-trips Codex picks alongside every existing Claude alias and persona field', () => {
    for (const model of ['codex:', 'codex:gpt-6-astra', 'haiku', 'sonnet', 'opus', 'fable']) {
      const input = { name: 'Agent', model, persona: 'Keep this persona.', skills: ['office-docgen'], capabilities: ['documents'], mode: 'safe' as const }
      expect(parseAgentMd(serializeAgentMd(input), 'fallback')).toMatchObject(input)
    }
  })
  it('reads a model alias from the frontmatter', () => {
    const a = parseAgentMd('---\nname: Felix\nwos_mode: full\nwos_model: haiku\n---\nBe brief.', 'x')
    expect(a.model).toBe('haiku')
    expect(a.persona).toBe('Be brief.')
  })

  it('drops a model value that is not an alias or id', () => {
    const a = parseAgentMd('---\nname: Felix\nwos_model: "; rm -rf /"\n---\n', 'x')
    expect(a.model).toBeUndefined()
  })

  it('serializes the model and round-trips it', () => {
    const md = serializeAgentMd({ name: 'Nadia', persona: 'Research.', model: 'opus' })
    expect(md).toMatch(/^wos_model: opus$/m)
    expect(parseAgentMd(md, 'x').model).toBe('opus')
    expect(serializeAgentMd({ name: 'Nadia', persona: 'Research.' })).not.toMatch(/wos_model/)
  })
})
