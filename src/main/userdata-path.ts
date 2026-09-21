import os from 'os'
import path from 'path'

/**
 * Resolves the app's `userData` directory the way Electron does — WITHOUT
 * importing electron. Used by standalone CLIs (wos-metric) that run in a plain
 * `node` process (no electron runtime) but must read/write the SAME per-user
 * JSON stores the app uses (metrics.json, transclusions.json, ranges.json,
 * range-links.json). The app id is `workspace-os` (package.json `name`), which
 * is what Electron uses for the userData folder name.
 *
 * Override with WOS_USERDATA_DIR (used by e2e to point at a scratch dir).
 */
const APP_NAME = 'workspace-os'

export function userDataDir(): string {
  const override = process.env['WOS_USERDATA_DIR']
  if (override) return override
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_NAME)
  }
  if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(appData, APP_NAME)
  }
  // linux + others: XDG_CONFIG_HOME or ~/.config
  const xdg = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config')
  return path.join(xdg, APP_NAME)
}

export function userDataFile(name: string): string {
  return path.join(userDataDir(), name)
}
