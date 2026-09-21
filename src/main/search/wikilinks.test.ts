import { describe, it, expect } from 'vitest'
import { parseWikilinks, lineAt, lineText } from './wikilinks'

describe('parseWikilinks', () => {
  it('extracts a plain link', () => {
    const [l, ...rest] = parseWikilinks('see [[Roadmap]] for details')
    expect(rest).toHaveLength(0)
    expect(l.target).toBe('Roadmap')
    expect(l.heading).toBeUndefined()
    expect(l.alias).toBeUndefined()
    expect(l.index).toBe(4)
  })

  it('extracts an aliased link', () => {
    const [l] = parseWikilinks('[[Target|the alias]]')
    expect(l.target).toBe('Target')
    expect(l.alias).toBe('the alias')
    expect(l.heading).toBeUndefined()
  })

  it('extracts a heading link', () => {
    const [l] = parseWikilinks('[[Target#Section Two]]')
    expect(l.target).toBe('Target')
    expect(l.heading).toBe('Section Two')
    expect(l.alias).toBeUndefined()
  })

  it('extracts a heading+alias link', () => {
    const [l] = parseWikilinks('[[Target#Heading|shown text]]')
    expect(l.target).toBe('Target')
    expect(l.heading).toBe('Heading')
    expect(l.alias).toBe('shown text')
  })

  it('trims whitespace around parts', () => {
    const [l] = parseWikilinks('[[  Spaced Note  #  Head  |  Alias  ]]')
    expect(l.target).toBe('Spaced Note')
    expect(l.heading).toBe('Head')
    expect(l.alias).toBe('Alias')
  })

  it('finds multiple links on one line', () => {
    const links = parseWikilinks('[[A]] and [[B|b]] and [[C#h]]')
    expect(links.map((l) => l.target)).toEqual(['A', 'B', 'C'])
    expect(links[1].alias).toBe('b')
    expect(links[2].heading).toBe('h')
  })

  it('finds links across multiple lines with correct indices', () => {
    const text = 'first [[One]]\nsecond [[Two]]'
    const links = parseWikilinks(text)
    expect(links.map((l) => l.target)).toEqual(['One', 'Two'])
    expect(lineAt(text, links[0].index)).toBe(1)
    expect(lineAt(text, links[1].index)).toBe(2)
  })

  it('supports unicode targets', () => {
    const [l] = parseWikilinks('[[Café Résumé — 日本語]]')
    expect(l.target).toBe('Café Résumé — 日本語')
  })

  it('ignores single-bracket [text]', () => {
    expect(parseWikilinks('a [markdown](x) and [single] here')).toHaveLength(0)
  })

  it('ignores empty [[ ]] and [[]]', () => {
    expect(parseWikilinks('[[]] [[   ]] [[#only-heading]]')).toHaveLength(0)
  })

  it('ignores a link inside a fenced code block (```)', () => {
    const text = ['before [[Real]]', '```', 'code [[NotALink]] here', '```', 'after [[AlsoReal]]'].join('\n')
    const targets = parseWikilinks(text).map((l) => l.target)
    expect(targets).toEqual(['Real', 'AlsoReal'])
  })

  it('ignores a link inside a ~~~ fenced block', () => {
    const text = ['~~~', '[[Hidden]]', '~~~', '[[Visible]]'].join('\n')
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Visible'])
  })

  it('ignores a link inside inline code', () => {
    const text = 'use `[[Fake]]` but keep [[Real]]'
    expect(parseWikilinks(text).map((l) => l.target)).toEqual(['Real'])
  })

  it('handles a language-tagged fence and preserves outside indices', () => {
    const text = 'x [[Top]]\n```ts\nconst y = "[[Nope]]"\n```\n[[Bottom]]'
    const links = parseWikilinks(text)
    expect(links.map((l) => l.target)).toEqual(['Top', 'Bottom'])
    // Index of the last link still points at its real offset in the original.
    expect(text.slice(links[1].index, links[1].index + 8)).toBe('[[Bottom')
  })

  it('does not treat brackets across newlines as a link', () => {
    expect(parseWikilinks('[[Broken\nLink]]')).toHaveLength(0)
  })

  it('lineText returns the source line for a snippet', () => {
    const text = 'one\ntwo [[Note]] end\nthree'
    const [l] = parseWikilinks(text)
    expect(lineText(text, l.index)).toBe('two [[Note]] end')
  })
})
