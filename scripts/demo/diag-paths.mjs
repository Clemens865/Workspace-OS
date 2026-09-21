/**
 * Prints the paths `lokAvailable()` actually resolves, from inside the running
 * main process — the three files it needs all exist on disk, so the ones it is
 * computing must differ from the ones I checked by hand.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const app = await electron.launch({ args: [path.join(ROOT, 'out/main/index.js')], cwd: ROOT })

// No fs/require/import available in this eval context — but the three strings
// it computes from are enough; existence is checked from the shell afterwards.
const info = await app.evaluate(({ app: a }) => ({
  appPath: a.getAppPath(),
  resourcesPath: process.resourcesPath,
  envInstall: process.env['WOS_LOK_INSTALL'] ?? null,
  envFund: process.env['WOS_LOK_FUND'] ?? null,
  envHost: process.env['WOS_LOK_HOST'] ?? null,
}))

console.log(JSON.stringify(info, null, 2))
await app.close().catch(() => {})
