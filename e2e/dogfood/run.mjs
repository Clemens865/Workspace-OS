// Bundles the dogfood harness (electron external + dead) and runs it under node.
import { build } from 'esbuild'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SB = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-dogfood-'))
const bundle = path.join(SB, 'harness.cjs')

await build({
  entryPoints: [path.join(__dirname, 'harness.mts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['electron', 'better-sqlite3', 'node-pty'],
  logLevel: 'error',
})

const r = spawnSync(process.execPath, [bundle], { stdio: 'inherit', env: process.env })
process.exit(r.status ?? 1)
