import { describe, expect, it } from 'vitest'
import { foreignFrontmatter, parseAgentMd, serializeAgentMd } from './agentFormat'

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

describe('agentFormat — frontmatter another editor wrote', () => {
  const md = `---\nname: Ada\ndescription: Reads things\ntools: Read, Grep\nwos_mode: safe\nhooks:\n  - one\n  - two\ncolor: blue\n---\n\nBe brief.\n`

  it('keeps the lines the app does not own, with their continuation lines', () => {
    expect(foreignFrontmatter(md)).toEqual(['tools: Read, Grep', 'hooks:', '  - one', '  - two', 'color: blue'])
  })

  it('a save writes them back and still reads as the same agent', () => {
    const a = parseAgentMd(md, 'ada')
    const out = serializeAgentMd({ ...a, description: 'Reads more', extra: foreignFrontmatter(md) })
    expect(out).toContain('tools: Read, Grep\nhooks:\n  - one\n  - two\ncolor: blue\n---')
    expect(parseAgentMd(out, 'ada')).toMatchObject({ name: 'Ada', description: 'Reads more', mode: 'safe', persona: 'Be brief.' })
  })
})
