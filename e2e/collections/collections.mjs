// e2e:collections — Collections (records→layout) proven against REAL files,
// engine-free (exceljs + jszip; NO electron, NO LibreOffice).
//
// It bundles the ACTUAL collection modules (collections.ts, collectionLinks.ts,
// and the closed-file writers) with esbuild (electron external + dead here),
// then runs the full flow: create-from-a-real-.xlsx → bind a docx table + an
// xlsx block via a field mapping → sync → UNZIP the docx + read back the xlsx
// and assert every field header + record cell landed in the mapped order → then
// change the source, refresh, re-sync, and assert the fresh record propagated.
import { build } from 'esbuild'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')

const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-collections-e2e-'))
const bundle = path.join(SB, 'harness.cjs')

async function main() {
  await build({
    entryPoints: [path.join(__dirname, 'harness.mts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron'], // dead code here (harness builds its own stores)
    logLevel: 'silent',
  })

  // electron is external + dead here (the harness builds its own stores), but
  // the `require('electron')` call must still resolve — point NODE_PATH at the
  // project's node_modules so plain node can load the (never-dereferenced) stub.
  const out = execFileSync('node', [bundle], {
    env: { ...process.env, WOS_E2E_DIR: SB, NODE_PATH: path.join(ROOT, 'node_modules') },
    encoding: 'utf8',
  })

  let results
  try {
    results = JSON.parse(out)
  } catch {
    console.error('FAIL: harness produced non-JSON output:\n', out)
    process.exit(1)
  }

  let passed = 0
  let failed = 0
  for (const r of results) {
    if (r.ok) {
      passed++
      console.log(`  PASS  ${r.name}`)
    } else {
      failed++
      console.log(`  FAIL  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch {}
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL (threw):', e.stack || e.message)
  try { fs.rmSync(SB, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
