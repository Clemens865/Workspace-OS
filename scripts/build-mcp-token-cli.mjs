// Builds the standalone `wos-mcp-token` CLI into a single self-contained CJS
// file shipped OUTSIDE the asar (via extraResources), mirroring metric-cli /
// collection-cli. A single file (no shared chunks) + CJS output means plain
// `node` can run it directly from disk in the packaged app.
//
// This is the `headersHelper` for remote OAuth MCP connectors: the `claude` CLI
// runs it at connect time to mint a fresh Bearer from the vault.
//
// electron is marked external: the CLI resolves `require('electron').safeStorage`
// at runtime to decrypt the vault. In the packaged Electron app `require`
// dereferences the real electron module; under plain node it returns the binary
// path (a string), which the CLI detects and fails-safe (`{}`) on.
import { build } from 'esbuild'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const outDir = path.join(ROOT, 'resources', 'wos-mcp-token')
fs.mkdirSync(outDir, { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'src', 'main', 'mcp-token-cli.ts')],
  outfile: path.join(outDir, 'mcp-token-cli.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['electron'],
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

console.log('[build-mcp-token-cli] wrote', path.join(outDir, 'mcp-token-cli.cjs'))
