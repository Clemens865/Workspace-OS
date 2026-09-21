import { describe, it, expect } from 'vitest'
import { toolToLabel, toolToKind, toolToChip, extractActivity } from './agent-activity'

describe('toolToLabel', () => {
  it('maps Read to a file label with the basename', () => {
    expect(toolToLabel('Read', { file_path: '/ws/docs/notes.md' })).toBe('Reading a file: notes.md')
  })
  it('maps Read without a path to a generic label', () => {
    expect(toolToLabel('Read')).toBe('Reading a file')
  })
  it('maps Write to "Writing a document"', () => {
    expect(toolToLabel('Write', { file_path: '/ws/Report.docx' })).toBe('Writing a document: Report.docx')
  })
  it('maps WebSearch / WebFetch to web labels', () => {
    expect(toolToLabel('WebSearch')).toBe('Searching the web')
    expect(toolToLabel('WebFetch')).toBe('Reading a web page')
  })
  it('maps Task/Agent to delegation', () => {
    expect(toolToLabel('Task')).toBe('Delegating to a helper')
    expect(toolToLabel('Agent')).toBe('Delegating to a helper')
  })
  it('routes Bash by command shim', () => {
    expect(toolToLabel('Bash', { command: 'wos-action browser.open https://x.com' })).toBe('Browsing the web')
    expect(toolToLabel('Bash', { command: 'browser.deepRead https://x.com' })).toBe('Deep-reading a site')
    expect(toolToLabel('Bash', { command: 'wos-gen pptx --spec s.json' })).toBe('Writing a document')
    expect(toolToLabel('Bash', { command: 'ls -la' })).toBe('Running a command')
  })
  it('surfaces the MCP server name', () => {
    expect(toolToLabel('mcp__Gmail__send')).toBe('Using Gmail')
  })
  it('never throws on an unknown tool', () => {
    expect(toolToLabel('Frobnicate')).toBe('Using Frobnicate')
    expect(toolToLabel('')).toBe('Working')
  })
})

describe('extractActivity', () => {
  it('returns null for non-JSON and non-tool lines', () => {
    expect(extractActivity('warning: something')).toBeNull()
    expect(extractActivity('')).toBeNull()
    expect(
      extractActivity(
        JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
        }),
      ),
    ).toBeNull()
  })

  it('extracts a tool_use from a content_block_start stream_event', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        content_block: { type: 'tool_use', name: 'Read', input: { file_path: '/ws/a.txt' } },
      },
    })
    expect(extractActivity(line)).toEqual({ tool: 'Read', label: 'Reading a file: a.txt', kind: 'read', chip: 'a.txt' })
  })

  it('extracts a tool_use from an assistant message block', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'let me search' },
          { type: 'tool_use', name: 'WebSearch', input: { query: 'weather' } },
        ],
      },
    })
    expect(extractActivity(line)).toEqual({ tool: 'WebSearch', label: 'Searching the web', kind: 'web', chip: 'weather' })
  })
})

describe('kind + chip enrichment (the run trace)', () => {
  it('maps tools to icon families', () => {
    expect(toolToKind('Read')).toBe('read')
    expect(toolToKind('Edit')).toBe('write')
    expect(toolToKind('WebFetch')).toBe('web')
    expect(toolToKind('Grep')).toBe('search')
    expect(toolToKind('Bash', { command: 'npm test' })).toBe('run')
    expect(toolToKind('Bash', { command: 'wos-action browser.navigate --url x' })).toBe('web')
    expect(toolToKind('Bash', { command: 'wos-gen pptx --spec s.json' })).toBe('write')
    expect(toolToKind('mcp__github__create_issue')).toBe('app')
  })

  it('chips the object of the call — file, query, domain, command', () => {
    expect(toolToChip('Read', { file_path: '/ws/deep/notes.md' })).toBe('notes.md')
    expect(toolToChip('WebSearch', { query: 'market size' })).toBe('market size')
    expect(toolToChip('WebFetch', { url: 'https://example.com/a/b' })).toBe('example.com')
    expect(toolToChip('Bash', { command: '  npm   run  ship ' })).toBe('npm run ship')
    expect(toolToChip('WebSearch', {})).toBeUndefined()
  })

  it('surfaces a thinking block as its own trace row', () => {
    const line = JSON.stringify({
      type: 'stream_event',
      event: { type: 'content_block_start', content_block: { type: 'thinking' } },
    })
    expect(extractActivity(line)).toEqual({ tool: 'Thinking', label: 'Thinking', kind: 'think' })
  })
})
