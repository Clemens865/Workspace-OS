// Visual + behavior check of the Markdown formatting toolbar.
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const app = await electron.launch({
  args: [path.join(root, 'out/main/index.js')],
  cwd: root,
  env: { ...process.env, WORKSPACE_TEST_ROOT: '/tmp/wos-test' },
})
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 10000 })
await win.waitForTimeout(800)

// Open notes.md → markdown toolbar should appear
await win.getByText('notes.md').first().click()
await win.waitForTimeout(1800)

// Select a word in the editor and click Bold
await win.locator('.monaco-editor').first().click()
await win.keyboard.press('Control+Home')
await win.keyboard.down('Shift'); await win.keyboard.press('End'); await win.keyboard.up('Shift')
const boldVisible = await win.getByTitle('Bold').isVisible().catch(() => false)
console.log('RESULT bold button visible:', boldVisible)
if (boldVisible) { await win.getByTitle('Bold').click(); await win.waitForTimeout(400) }

await win.screenshot({ path: path.join(root, 'e2e/ui.png') })
console.log('saved e2e/ui.png')
await app.close()
process.exit(0)
