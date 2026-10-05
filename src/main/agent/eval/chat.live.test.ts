import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

// The action guide comes from the running app; a chat brief without it is still the brief.
vi.mock('../../context/workspaceContext', () => ({ agentActionGuide: () => '' }))
const { buildChatSystemPrompt, ARTIFACTS_DIR } = await import('../chatProfile')

/**
 * Does a real model follow the chat brief? Opt-in (it spends model calls):
 * WOS_LIVE=1 [WOS_LIVE_MODEL=sonnet] npx vitest run src/main/agent/eval/chat.live
 *
 * A page is made as a file in Artifacts/, in the Workspace OS look, and the
 * reply only says what it made; a plain question gets a plain answer and no file.
 */
const live = process.env.WOS_LIVE === '1'
const model = process.env.WOS_LIVE_MODEL ?? 'sonnet'
let ws: string

function chat(ask: string): string {
  const r = spawnSync(
    process.env.CLAUDE_BIN ?? 'claude',
    ['-p', '--output-format', 'text', '--model', model, '--append-system-prompt', buildChatSystemPrompt(ws), '--allowedTools', 'Read', 'Write', 'Edit', 'Glob'],
    { input: ask, cwd: ws, encoding: 'utf8', timeout: 300_000 },
  )
  return r.stdout ?? ''
}
const made = (): string[] => {
  try {
    return fs.readdirSync(path.join(ws, ARTIFACTS_DIR))
  } catch {
    return []
  }
}

beforeAll(() => {
  ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wos-chat-live-')))
})
afterAll(() => fs.rmSync(ws, { recursive: true, force: true }))

describe.skipIf(!live)('chat with the real model', () => {
  it('a plain question gets a plain answer and no file', { timeout: 320_000 }, () => {
    const reply = chat('What is 15% of 80? One line.')
    expect(reply).toMatch(/\b12\b/)
    expect(made()).toEqual([])
  })

  it('a page is made as an artifact in the Workspace OS look, and the reply only says so', { timeout: 320_000 }, () => {
    const reply = chat('Make me a small one-page landing page for a bakery called "Brot & Butter": a headline, three products with prices, opening hours.')
    const pages = made().filter((f) => /\.html?$/i.test(f))
    console.log(reply, pages)
    expect(pages).toHaveLength(1)
    const html = fs.readFileSync(path.join(ws, ARTIFACTS_DIR, pages[0]), 'utf8')
    expect(html).toMatch(/#fbfcfd|#1b2730/i)
    expect(html).toMatch(/Newsreader|Inter/)
    expect(html).not.toMatch(/<(script|link)[^>]+(src|href)=["']https?:/i) // self-contained
    expect(reply).not.toMatch(/<html|<body|<style/i) // not pasted into the chat
    expect(reply.length).toBeLessThan(900)
  })
})
