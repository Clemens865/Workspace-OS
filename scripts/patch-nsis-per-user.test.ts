import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs build script without type declarations
import { hasUpstreamFix, patchTemplate } from './patch-nsis-per-user.mjs'

// The block as electron-builder 25.1.8 ships it (templates/nsis/multiUser.nsh).
const BLOCK = `      System::Store S
      # Win7 has a per-user programfiles known folder and this can be a non-default location
      System::Call 'SHELL32::SHGetKnownFolderPath(g "\${FOLDERID_UserProgramFiles}", i \${KF_FLAG_CREATE}, p 0, *p .r2)i.r1'
      \${If} $1 == 0
        System::Call '*$2(&w\${NSIS_MAX_STRLEN} .s)'
        StrCpy $0 $1
        System::Call 'OLE32::CoTaskMemFree(p r2)'
      \${endif}
      System::Store L
`

describe('NSIS per-user install patch', () => {
  it('replaces the fixed-length copy with lstrcpynW, once', () => {
    const out = patchTemplate(BLOCK)
    expect(out).not.toContain("System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'")
    expect(out).toContain("System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'")
    expect(out).toContain("OLE32::CoTaskMemFree(p r2)")
    expect(patchTemplate(out)).toBe(out)
  })
  it('keeps CRLF templates intact', () => {
    const out = patchTemplate(BLOCK.replace(/\n/g, '\r\n'))
    expect(out).toContain('lstrcpynW')
    expect(out).not.toMatch(/[^\r]\n/)
  })
  it('refuses a template it does not recognise', () => {
    expect(() => patchTemplate('!macro other\n!macroend\n')).toThrow(/expected per-user block/)
  })
  it('skips electron-builder versions with the upstream fix', () => {
    expect(hasUpstreamFix('25.1.8')).toBe(false)
    expect(hasUpstreamFix('26.11.9')).toBe(false)
    expect(hasUpstreamFix('26.12.0')).toBe(true)
    expect(hasUpstreamFix('27.0.0')).toBe(true)
  })
})
