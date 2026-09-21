// Validates the seeded StarBasic module (src/main/office/lokMacros.ts) WITHOUT
// booting LibreOffice, so a reserved-word variable / duplicate Sub / unescaped
// < > & — any of which silently aborts the whole macro module at runtime — is
// caught in CI (wired as `npm run check:macros`). Exits non-zero on problems.
//
// The validator + the BASIC_MODULE string live in TypeScript source, so we
// bundle them in-memory with esbuild (already a dep) and import the result —
// no brittle regex over the source, no separate build step.
import { build } from 'esbuild'
import { fileURLToPath, pathToFileURL } from 'url'
import path from 'path'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

async function main() {
  // Virtual entry that re-exports both the validator and the seeded module
  // string so a single bundle carries everything we need.
  const result = await build({
    stdin: {
      contents:
        "export { validateBasicModule } from './src/main/office/validateBasicModule'\n" +
        "export { BASIC_MODULE, BASIC_MODULE_2 } from './src/main/office/lokMacros'\n",
      resolveDir: root,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    // electron is only touched by dead singleton exports of sibling stores; it
    // is never reached here, so mark it external to keep the bundle node-runnable.
    external: ['electron', 'fs', 'path'],
    write: false,
  })

  const tmp = path.join(os.tmpdir(), `wos-validate-macros-${process.pid}.mjs`)
  fs.writeFileSync(tmp, result.outputFiles[0].text)
  try {
    const mod = await import(pathToFileURL(tmp).href)
    const { validateBasicModule, BASIC_MODULE, BASIC_MODULE_2 } = mod
    if (
      typeof validateBasicModule !== 'function' ||
      typeof BASIC_MODULE !== 'string' ||
      typeof BASIC_MODULE_2 !== 'string'
    ) {
      throw new Error('lokMacros.ts did not export validateBasicModule / BASIC_MODULE / BASIC_MODULE_2')
    }
    // StarBasic enforces a ~64KB per-module limit; over it macros silently no-op.
    const BYTE_LIMIT = 63000
    let failed = false
    for (const [name, src] of [
      ['Module1', BASIC_MODULE],
      ['Module2', BASIC_MODULE_2],
    ]) {
      const problems = validateBasicModule(src)
      if (problems.length > 0) {
        console.error(`✗ Seeded StarBasic ${name} has ${problems.length} problem(s):`)
        for (const p of problems) console.error(`  • ${p}`)
        failed = true
      }
      const bytes = Buffer.byteLength(src, 'utf8')
      if (bytes >= BYTE_LIMIT) {
        console.error(`✗ Seeded StarBasic ${name} is ${bytes} bytes — over the ${BYTE_LIMIT}-byte limit (macros would silently no-op).`)
        failed = true
      } else {
        console.log(`  ${name}: ${bytes} bytes (< ${BYTE_LIMIT}).`)
      }
    }
    if (failed) process.exit(1)
    console.log('✓ Seeded StarBasic modules are clean and under the per-module size limit.')
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

main().catch((err) => {
  console.error('✗ validate-macros failed:', err.message)
  process.exit(1)
})
