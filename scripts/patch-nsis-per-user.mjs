// Patches electron-builder's NSIS per-user template before a Windows build.
//
// electron-builder before 26.12 copies NSIS_MAX_STRLEN characters out of the
// short string SHGetKnownFolderPath returns, so a first per-user install crashes
// about one time in three with 0xC0000005 in System.dll (electron-builder
// issues #10296, fixed by #9769 in 26.12.0). This applies the same fix to the
// installed app-builder-lib: lstrcpynW stops at the terminator. Idempotent; does
// nothing on 26.12 or later. Remove once the project uses electron-builder 26.12+.
//
//   node scripts/patch-nsis-per-user.mjs
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { fileURLToPath } from 'url'

const UNSAFE = [
  "        System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'",
  '        StrCpy $0 $1',
].join('\n')
const SAFE = "        System::Call 'KERNEL32::lstrcpynW(w .r0, p r2, i ${NSIS_MAX_STRLEN})p'"

/** The patched template text; throws when the template is neither unpatched nor patched. */
export function patchTemplate(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const unsafe = UNSAFE.replace(/\n/g, eol)
  if (text.includes(unsafe)) return text.replace(unsafe, SAFE)
  if (text.includes(SAFE)) return text
  throw new Error('multiUser.nsh does not contain the expected per-user block; check the electron-builder version')
}

/** True for app-builder-lib versions that already carry the fix (26.12.0 and later). */
export function hasUpstreamFix(version) {
  const [major, minor] = version.split('.').map(Number)
  return major > 26 || (major === 26 && minor >= 12)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('app-builder-lib/package.json')
  const { version } = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  if (hasUpstreamFix(version)) {
    console.log(`app-builder-lib ${version} already has the per-user install fix`)
  } else {
    const file = path.join(path.dirname(pkgPath), 'templates', 'nsis', 'multiUser.nsh')
    const before = fs.readFileSync(file, 'utf8')
    const after = patchTemplate(before)
    if (after !== before) fs.writeFileSync(file, after)
    console.log(`app-builder-lib ${version}: per-user install fix ${after !== before ? 'applied' : 'already present'} (${file})`)
  }
}
