import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { convertTo, discardConverted, resolveSoffice } from './libreoffice'

const outputDirs = (): string[] => fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('wos-lo-') && !n.startsWith('wos-lo-profile-'))

// Runs a real headless conversion where LibreOffice is installed (Linux dev
// machines, the Windows CI job). On Windows a malformed -env:UserInstallation
// URL made soffice stop with "bootstrap.ini is corrupt" in a dialog. Not on
// macOS: a system LibreOffice there can sit for many minutes under load, and
// this suite gates every ship.
describe.runIf(!!resolveSoffice() && process.platform !== 'darwin')('convertTo with the installed LibreOffice', () => {
  it('converts a text file to PDF, and discardConverted removes its temp folder', { timeout: 90_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-convert-'))
    const src = path.join(dir, 'note.txt')
    fs.writeFileSync(src, 'Converted by the Workspace OS test.\n')
    const out = await convertTo(src, 'pdf')
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-')
    await discardConverted(out)
    expect(fs.existsSync(path.dirname(out))).toBe(false)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('leaves no temp folder behind when the conversion fails', { timeout: 90_000 }, async () => {
    const before = outputDirs()
    await expect(convertTo(path.join(os.tmpdir(), 'wos-no-such-file.txt'), 'pdf')).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 200)) // the cleanup is not awaited
    expect(outputDirs().filter((n) => !before.includes(n))).toEqual([])
  })
})

describe('discardConverted', () => {
  it('only removes convertTo output folders', async () => {
    const keep = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-keep-'))
    fs.writeFileSync(path.join(keep, 'a.pdf'), '')
    await discardConverted(path.join(keep, 'a.pdf'))
    expect(fs.existsSync(keep)).toBe(true)
    fs.rmSync(keep, { recursive: true, force: true })
  })
})
