import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { lokProfileDir, lokXchg, lokXchgDir, macroModuleForPlatform } from './lokTemp'

const module = '  Open "/tmp/wos-macro-doc.txt" For Input As #f\n  Open "/tmp/wos-asset-out.txt" For Output As #g\n'

describe.runIf(process.platform !== 'win32')('macOS and Linux keep /tmp', () => {
  it('uses the historical locations', () => {
    expect(lokProfileDir()).toBe('/tmp/wos-lok-host-profile')
    expect(lokXchgDir()).toBe('/tmp')
    expect(lokXchg('wos-asset-out.txt')).toBe('/tmp/wos-asset-out.txt')
  })
  it('leaves the macro text unchanged', () => {
    expect(macroModuleForPlatform(module)).toBe(module)
  })
})

describe.runIf(process.platform === 'win32')('Windows uses the temp directory', () => {
  it('puts the profile and the exchange files under os.tmpdir()', () => {
    expect(lokProfileDir()).toBe(path.join(os.tmpdir(), 'wos-lok-host-profile'))
    expect(lokXchg('wos-asset-out.txt')).toBe(path.join(os.tmpdir(), 'wos-lok', 'wos-asset-out.txt'))
  })
  it('points the macros at the exchange directory', () => {
    const out = macroModuleForPlatform(module)
    expect(out).not.toContain('/tmp/')
    expect(out).toContain(`Open "${path.join(os.tmpdir(), 'wos-lok')}\\wos-macro-doc.txt" For Input`)
  })
})
