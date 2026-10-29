import { describe, it, expect } from 'vitest'
import { existingOnly, parseSession, readSession, sessionStorageKey, writeSession } from './stageSession'

const ROOT = '/ws/project'
const memory = (): Storage => {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) } as Storage
}

describe('stageSession', () => {
  it('round-trips the open documents of a workspace', () => {
    const s = memory()
    writeSession(s, ROOT, { files: [`${ROOT}/a.docx`, `${ROOT}/b.md`], activeFile: `${ROOT}/b.md`, preview: `${ROOT}/c.xlsx` })
    expect(readSession(s, ROOT)).toEqual({ files: [`${ROOT}/a.docx`, `${ROOT}/b.md`], activeFile: `${ROOT}/b.md`, preview: `${ROOT}/c.xlsx` })
  })

  it('keeps each workspace separate', () => {
    const s = memory()
    writeSession(s, ROOT, { files: [`${ROOT}/a.docx`], activeFile: null, preview: null })
    expect(readSession(s, '/ws/other')).toBeNull()
    expect(sessionStorageKey(ROOT)).not.toBe(sessionStorageKey('/ws/other'))
  })

  it('drops paths outside the workspace, duplicates, and an active tab that is not open', () => {
    const raw = JSON.stringify({ files: [`${ROOT}/a.md`, '/etc/passwd', `${ROOT}/a.md`, 42], activeFile: '/etc/passwd', preview: '/tmp/x.md' })
    expect(parseSession(raw, ROOT)).toEqual({ files: [`${ROOT}/a.md`], activeFile: null, preview: null })
  })

  it('reads nothing from garbage or an empty record', () => {
    expect(parseSession('not json', ROOT)).toBeNull()
    expect(parseSession(JSON.stringify({ files: [] }), ROOT)).toBeNull()
    expect(parseSession(null, ROOT)).toBeNull()
  })

  it('skips files that no longer exist, and forgets an active tab among them', async () => {
    const gone = `${ROOT}/gone.md`
    const s = await existingOnly(
      { files: [`${ROOT}/a.md`, gone], activeFile: gone, preview: gone },
      async (p) => p !== gone,
    )
    expect(s).toEqual({ files: [`${ROOT}/a.md`], activeFile: null, preview: null })
  })
})
