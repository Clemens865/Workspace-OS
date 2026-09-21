import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isIgnoredRelative, withinDepth, watchTree, type TreeEvent } from './treeWatcher'

const isMac = process.platform === 'darwin'
const openFds = (): number => (isMac || process.platform === 'linux' ? fs.readdirSync('/dev/fd').length : 0)

function makeTree(files: number, sub = 'deep'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-tw-'))
  fs.mkdirSync(path.join(root, sub, 'a', 'b', 'c'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true })
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(root, sub, `f${i}.txt`), String(i))
  return root
}

/** Wait until `pred` sees the events it wants, or give up after `ms`. */
function waitFor(pred: () => boolean, ms = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const tick = (): void => {
      if (pred()) return resolve(true)
      if (Date.now() - started > ms) return resolve(false)
      setTimeout(tick, 40)
    }
    tick()
  })
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

describe('treeWatcher filters', () => {
  it('ignores dot-entries and dependency trees anywhere in the path', () => {
    expect(isIgnoredRelative('node_modules/x/y.js')).toBe(true)
    expect(isIgnoredRelative('src/.cache/y')).toBe(true)
    expect(isIgnoredRelative('docs/build/out.html')).toBe(true)
    expect(isIgnoredRelative('docs/builder/out.html')).toBe(false)
    expect(isIgnoredRelative('Notes/plan.md')).toBe(false)
  })

  it('applies chokidar depth semantics', () => {
    expect(withinDepth('a.md', 0)).toBe(true)
    expect(withinDepth('x/a.md', 0)).toBe(false)
    expect(withinDepth('x/y/z/a.md', 3)).toBe(true)
    expect(withinDepth('x/y/z/w/a.md', 3)).toBe(false)
  })
})

describe('watchTree', () => {
  it('reports add, change and unlink for a file inside depth', async () => {
    const root = makeTree(2)
    const seen: [TreeEvent, string][] = []
    const w = watchTree(root, { depth: 3, onEvent: (e, p) => seen.push([e, p]) })
    cleanups.push(() => { w.close(); fs.rmSync(root, { recursive: true, force: true }) })
    // FSEvents needs a beat before it reports on a fresh stream.
    await new Promise((r) => setTimeout(r, 300))

    const target = path.join(root, 'deep', 'new.md')
    fs.writeFileSync(target, 'hello')
    expect(await waitFor(() => seen.some(([e, p]) => e === 'add' && p === target))).toBe(true)

    fs.appendFileSync(target, ' world')
    expect(await waitFor(() => seen.some(([e, p]) => (e === 'change' || e === 'add') && p === target && seen.length >= 2))).toBe(true)

    fs.unlinkSync(target)
    expect(await waitFor(() => seen.some(([e, p]) => e === 'unlink' && p === target))).toBe(true)
  })

  it('stays silent for ignored trees and beyond the depth', async () => {
    const root = makeTree(1)
    const seen: string[] = []
    const w = watchTree(root, { depth: 2, onEvent: (_e, p) => seen.push(p) })
    cleanups.push(() => { w.close(); fs.rmSync(root, { recursive: true, force: true }) })
    await new Promise((r) => setTimeout(r, 300))

    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), '1')
    fs.writeFileSync(path.join(root, 'deep', 'a', 'b', 'c', 'toodeep.md'), '1')
    const visible = path.join(root, 'deep', 'ok.md')
    fs.writeFileSync(visible, '1')
    expect(await waitFor(() => seen.includes(visible))).toBe(true)
    // Give the noisy events every chance to arrive before asserting they did not.
    await new Promise((r) => setTimeout(r, 400))
    expect(seen.filter((p) => p.includes('node_modules') || p.includes('toodeep'))).toEqual([])
  })

  it.skipIf(!isMac)('costs a flat number of descriptors regardless of tree size', async () => {
    // The regression: one descriptor per watched entry. 1500 files must not
    // move the count by more than a handful (FSEvents is one stream).
    const root = makeTree(1500)
    const before = openFds()
    const w = watchTree(root, { depth: 3, onEvent: () => {} })
    cleanups.push(() => { w.close(); fs.rmSync(root, { recursive: true, force: true }) })
    await new Promise((r) => setTimeout(r, 300))
    const delta = openFds() - before
    expect(delta).toBeLessThan(10)
  })
})
