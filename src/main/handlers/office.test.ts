import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { pruneCache } from './office'

/**
 * Verifies the global bound on the office PDF render cache: pruneCache evicts
 * the OLDEST renders once the file-count or byte-size cap is exceeded, and is a
 * no-op below both caps. (toPdfCached calls this after every store so a long
 * session can't balloon the cache to GBs.)
 */
describe('office PDF cache eviction (pruneCache)', () => {
  let dir: string

  async function writePdf(name: string, bytes: number, mtimeMs: number): Promise<void> {
    const p = path.join(dir, name)
    await fs.writeFile(p, Buffer.alloc(bytes))
    const t = new Date(mtimeMs)
    await fs.utimes(p, t, t)
  }

  const listPdfs = async (): Promise<string[]> =>
    (await fs.readdir(dir)).filter((f) => f.endsWith('.pdf')).sort()

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-pdfcache-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('is a no-op when under both caps', async () => {
    await writePdf('a.pdf', 100, 1000)
    await writePdf('b.pdf', 100, 2000)
    await pruneCache(dir, 200, 500 * 1024 * 1024)
    expect(await listPdfs()).toEqual(['a.pdf', 'b.pdf'])
  })

  it('evicts the oldest files when over the file-count cap', async () => {
    await writePdf('old.pdf', 10, 1000)
    await writePdf('mid.pdf', 10, 2000)
    await writePdf('new.pdf', 10, 3000)
    await pruneCache(dir, 2, 500 * 1024 * 1024) // keep at most 2
    expect(await listPdfs()).toEqual(['mid.pdf', 'new.pdf']) // oldest dropped
  })

  it('evicts the oldest files when over the byte-size cap', async () => {
    await writePdf('old.pdf', 1000, 1000)
    await writePdf('new.pdf', 1000, 2000)
    await pruneCache(dir, 200, 1500) // only room for one 1000-byte render
    expect(await listPdfs()).toEqual(['new.pdf']) // oldest evicted to fit
  })

  it('ignores non-pdf files and never throws on a missing dir', async () => {
    await fs.writeFile(path.join(dir, 'note.txt'), 'x')
    await writePdf('a.pdf', 10, 1000)
    await pruneCache(dir, 0, 0) // aggressive cap evicts all pdfs
    expect(await listPdfs()).toEqual([])
    // Non-pdf untouched.
    expect(await fs.readFile(path.join(dir, 'note.txt'), 'utf-8')).toBe('x')
    // Missing dir is a silent no-op.
    await expect(pruneCache(path.join(dir, 'nope'))).resolves.toBeUndefined()
  })
})
