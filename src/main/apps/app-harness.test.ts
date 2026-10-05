import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const run = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('../agent/providerText', () => ({ runProviderJson: run.fn }))

import { briefChecks, imageFromDataUrl, parseReview, reviewApp, runSeeing, writeBrief } from './app-harness'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-harness-'))
  fs.mkdirSync(path.join(root, 'Apps', 'notes'), { recursive: true })
  run.fn.mockReset()
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const PNG = 'data:image/png;base64,' + Buffer.from('not really a png').toString('base64')
const BRIEF = `# Quick Notes\nNotes that stay.\n## Core jobs\n- Write\n## Acceptance checks\n- [ ] An empty state says what to do first\n- [ ] Notes survive a reload\n- [x] Cmd+Z undoes\n## Later\n- Add tags`

describe('images an app shows the model', () => {
  it('takes PNG, JPEG and WebP data: URLs and nothing else', () => {
    expect(imageFromDataUrl(PNG).ext).toBe('png')
    expect(imageFromDataUrl(PNG.replace('png', 'jpeg')).ext).toBe('jpg')
    for (const bad of ['https://x.test/a.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,', 42]) expect(() => imageFromDataUrl(bad)).toThrow()
  })

  it('refuses an image over 6 MB', () => {
    expect(() => imageFromDataUrl('data:image/png;base64,' + Buffer.alloc(6 * 1024 * 1024 + 1).toString('base64'))).toThrow('6 MB')
  })

  it('puts the images in a scratch folder the run alone may read, then removes it', async () => {
    let seen: { cwd: string; files: string[]; tools: string[]; prompt: string; isolated: boolean } | null = null
    run.fn.mockImplementation(async (o: { cwd: string; allowedTools: string[]; prompt: string; isolated: boolean }) => {
      seen = { cwd: o.cwd, files: fs.readdirSync(o.cwd), tools: o.allowedTools, prompt: o.prompt, isolated: o.isolated }
      return { text: 'ok', code: 0, timedOut: false }
    })
    await runSeeing({ prompt: 'Improve it', images: [imageFromDataUrl(PNG)], timeoutMs: 1000 })
    expect(seen!.files).toEqual(['image-1.png'])
    expect(seen!.tools).toEqual(['Read(./**)'])
    expect(seen!.prompt).toContain('./image-1.png')
    expect(seen!.isolated).toBe(true)
    expect(fs.existsSync(seen!.cwd)).toBe(false)
  })

  it('gives a run without images no tool at all', async () => {
    run.fn.mockResolvedValue({ text: 'ok', code: 0, timedOut: false })
    await runSeeing({ prompt: 'Hi', timeoutMs: 1000 })
    expect(run.fn.mock.calls[0][0].allowedTools).toEqual([])
  })
})

describe('the brief', () => {
  it('reads the acceptance checks', () => {
    expect(briefChecks(BRIEF)).toEqual(['An empty state says what to do first', 'Notes survive a reload', 'Cmd+Z undoes'])
    expect(briefChecks('# X\nno checks')).toEqual([])
  })

  it('writes BRIEF.md from the idea', async () => {
    run.fn.mockResolvedValue({ text: '```markdown\n' + BRIEF + '\n```', code: 0, timedOut: false })
    expect(await writeBrief(root, 'notes', 'a notes app')).toMatchObject({ checks: 3 })
    expect(fs.readFileSync(path.join(root, 'Apps/notes/BRIEF.md'), 'utf8')).toMatch(/^# Quick Notes/)
    expect(run.fn.mock.calls[0][0].prompt).toContain('a notes app')
  })

  it('writes nothing when no usable brief came back', async () => {
    run.fn.mockResolvedValue({ text: 'Done.', code: 0, timedOut: false })
    await expect(writeBrief(root, 'notes', 'a notes app')).rejects.toThrow('No usable brief')
    expect(fs.existsSync(path.join(root, 'Apps/notes/BRIEF.md'))).toBe(false)
  })
})

describe('the review', () => {
  it('reads a review defensively', () => {
    const r = parseReview('Here:\n```json\n{"checks":[{"check":"Saves","met":true},{"check":"Empty state","met":false,"note":"never shown"},{"met":false}],"looks":["Title cut off",""],"next":["Add tags","Export","Search","Fourth"]}\n```')
    expect(r).toEqual({
      checks: [
        { check: 'Saves', met: true, note: '' },
        { check: 'Empty state', met: false, note: 'never shown' },
      ],
      looks: ['Title cut off'],
      next: ['Add tags', 'Export', 'Search'],
    })
    expect(parseReview('Done.')).toBeNull()
  })

  it('sends the brief, the files and the screenshot', async () => {
    fs.writeFileSync(path.join(root, 'Apps/notes/BRIEF.md'), BRIEF)
    fs.writeFileSync(path.join(root, 'Apps/notes/index.html'), '<h1>Notes</h1>')
    let files: string[] = []
    run.fn.mockImplementation(async (o: { cwd: string }) => {
      files = fs.readdirSync(o.cwd)
      return { text: '{"checks":[],"looks":[],"next":["Add tags"]}', code: 0, timedOut: false }
    })
    expect(await reviewApp(root, 'notes', Buffer.from('png'))).toEqual({ checks: [], looks: [], next: ['Add tags'] })
    const prompt = run.fn.mock.calls[0][0].prompt as string
    expect(prompt).toContain('Notes survive a reload')
    expect(prompt).toContain('--- index.html ---\n<h1>Notes</h1>')
    expect(files).toEqual(['image-1.png'])
  })
})
