// Builds the standalone `wos-collection` CLI into a single self-contained CJS
// file shipped OUTSIDE the asar (via extraResources), mirroring how
// metric-cli.cjs / component-cli.cjs ship. A single file (no shared chunks) +
// CJS output means plain `node` can run it directly from disk in the packaged
// app — an asar-bundled ESM script with shared chunks could not.
//
// electron is only reached by the store modules' dead singleton exports (the
// CLI constructs its own stores), so it is aliased to an empty stub.
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const outDir = path.join(ROOT, 'resources', 'wos-collection')
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'src', 'main', 'collection-cli.ts')],
  outfile: path.join(outDir, 'collection-cli.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // Bundle everything (incl. exceljs) so the CLI is fully self-contained and
  // runnable by plain `node` from disk — nothing resolves from node_modules at
  // run time.
  // electron is dead code in the CLI; a stub keeps the bundle runnable when no
  // electron package is resolvable (packaged resources, ELECTRON_RUN_AS_NODE).
  alias: { electron: fileURLToPath(new URL('./cli-electron-stub.cjs', import.meta.url)) },
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

console.log('[build-collection-cli] wrote', path.join(outDir, 'collection-cli.cjs'))
