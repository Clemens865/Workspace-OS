import { describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { convertTo, resolveSoffice } from './libreoffice'

// Runs a real headless conversion where LibreOffice is installed (Linux dev
// machines, the Windows CI job). On Windows a malformed -env:UserInstallation
// URL made soffice stop with "bootstrap.ini is corrupt" in a dialog.
describe.runIf(!!resolveSoffice())('convertTo with the installed LibreOffice', () => {
  it('converts a text file to PDF with a private profile', { timeout: 90_000 }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-convert-'))
    const src = path.join(dir, 'note.txt')
    fs.writeFileSync(src, 'Converted by the Workspace OS test.\n')
    const out = await convertTo(src, 'pdf')
    expect(fs.readFileSync(out).subarray(0, 5).toString()).toBe('%PDF-')
    fs.rmSync(dir, { recursive: true, force: true })
    fs.rmSync(path.dirname(out), { recursive: true, force: true })
  })
})
