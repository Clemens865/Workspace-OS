// Builds the standalone `wos-case` CLI into a single self-contained CJS file
// shipped OUTSIDE the asar (via extraResources), mirroring metric-cli /
// collection-cli. A single CJS file means plain `node` runs it directly from
// disk in the packaged app. It bundles the app's engine-free cases.ts so a
// CLI-written case is byte-identical to what the app writes.
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const outDir = path.join(ROOT, 'resources', 'wos-case')
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'src', 'main', 'case-cli.ts')],
  outfile: path.join(outDir, 'case-cli.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['electron'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

console.log('[build-case-cli] wrote', path.join(outDir, 'case-cli.cjs'))
