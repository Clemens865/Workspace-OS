import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { classifyArtifact, isTrackedArtifact, snapshotArtifacts, changedArtifacts } from './artifacts'

describe('classifyArtifact', () => {
  it('classifies office documents (incl. pdf)', () => {
    for (const ext of ['docx', 'xlsx', 'pptx', 'odt', 'pdf']) {
      expect(classifyArtifact(`/w/report.${ext}`).type).toBe('office')
    }
  })

  it('classifies images', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp']) {
      expect(classifyArtifact(`/w/chart.${ext}`).type).toBe('image')
    }
  })

  it('classifies data files', () => {
    for (const ext of ['csv', 'json', 'yaml', 'xml', 'sql']) {
      expect(classifyArtifact(`/w/data.${ext}`).type).toBe('data')
    }
  })

  it('classifies code files', () => {
    for (const ext of ['ts', 'tsx', 'py', 'rs', 'go', 'sh', 'md']) {
      expect(classifyArtifact(`/w/mod.${ext}`).type).toBe('code')
    }
  })

  it('classifies diffs and patches (diff wins over other rules)', () => {
    expect(classifyArtifact('/w/change.diff').type).toBe('diff')
    expect(classifyArtifact('/w/change.patch').type).toBe('diff')
  })

  it('falls back to other for unknown extensions', () => {
    expect(classifyArtifact('/w/archive.zip').type).toBe('other')
    expect(classifyArtifact('/w/noext').type).toBe('other')
  })

  it('extracts the basename as the label and is case-insensitive on ext', () => {
    const a = classifyArtifact('/deep/path/Quarterly Report.PPTX')
    expect(a.name).toBe('Quarterly Report.PPTX')
    expect(a.type).toBe('office')
    expect(a.path).toBe('/deep/path/Quarterly Report.PPTX')
  })
})

describe('isTrackedArtifact', () => {
  it('tracks known types and ignores others', () => {
    expect(isTrackedArtifact('/w/a.docx')).toBe(true)
    expect(isTrackedArtifact('/w/a.png')).toBe(true)
    expect(isTrackedArtifact('/w/a.zip')).toBe(false)
    expect(isTrackedArtifact('/w/a.exe')).toBe(false)
  })
})

describe('snapshotArtifacts / changedArtifacts', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-artifacts-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('detects newly created and modified files, newest first', async () => {
    fs.writeFileSync(path.join(dir, 'existing.txt'), 'v1')
    const before = snapshotArtifacts(dir)

    // Wait so mtimes are distinguishable from the snapshot.
    await new Promise((r) => setTimeout(r, 10))
    fs.writeFileSync(path.join(dir, 'new.pptx'), 'x')
    await new Promise((r) => setTimeout(r, 10))
    fs.writeFileSync(path.join(dir, 'existing.txt'), 'v2') // modified

    const changed = changedArtifacts(dir, before)
    const names = changed.map((c) => c.name)
    expect(names).toContain('new.pptx')
    expect(names).toContain('existing.txt')
    // Newest first: existing.txt was rewritten last.
    expect(names[0]).toBe('existing.txt')
    expect(changed.find((c) => c.name === 'new.pptx')?.type).toBe('office')
  })

  it('skips heavy directories and dotdirs', () => {
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), 'x')
    fs.mkdirSync(path.join(dir, '.git'))
    fs.writeFileSync(path.join(dir, '.git', 'config.ini'), 'x')
    const snap = snapshotArtifacts(dir)
    expect([...snap.keys()].some((p) => p.includes('node_modules'))).toBe(false)
    expect([...snap.keys()].some((p) => p.includes('.git'))).toBe(false)
  })

  it('ignores untracked extensions', () => {
    const before = snapshotArtifacts(dir)
    fs.writeFileSync(path.join(dir, 'binary.bin'), 'x')
    expect(changedArtifacts(dir, before)).toHaveLength(0)
  })
})

describe('web pages are deliverables, not source code', () => {
  it("classifies .html/.htm as 'page' so it auto-opens in the canvas", () => {
    expect(classifyArtifact('/w/Lisbon trip.html').type).toBe('page')
    expect(classifyArtifact('/w/plan.HTM').type).toBe('page')
  })

  it("still classifies real source files as 'code'", () => {
    expect(classifyArtifact('/w/app.css').type).toBe('code')
    expect(classifyArtifact('/w/main.ts').type).toBe('code')
  })
})
