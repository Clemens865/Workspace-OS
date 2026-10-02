/**
 * Focused diagnostic: open a real .docx and observe whether OnlyOffice reaches
 * the editor (success) or the error state. Run against a warm container.
 */
import { _electron as electron } from 'playwright'
import path from 'path'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const WORKSPACE = '/tmp/wos-test'

async function main() {
  const app = await electron.launch({
    args: [path.join(root, 'out/main/index.js')],
    cwd: root,
    env: { ...process.env, WORKSPACE_TEST_ROOT: WORKSPACE },
  })
  // Capture main-process stdout/stderr (where the bridge logs).
  app.process().stdout?.on('data', (d) => process.stdout.write(`  [main] ${d}`))
  app.process().stderr?.on('data', (d) => process.stdout.write(`  [main] ${d}`))
  const win = await app.firstWindow()
  win.on('console', (m) => console.log(`  [renderer:${m.type()}] ${m.text()}`))
  win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
  await win.waitForLoadState('domcontentloaded')
  await win.waitForSelector('#root', { timeout: 10000 })
  await win.waitForTimeout(500)

  console.log('Opening test-document.docx…')
  await win.getByText('test-document.docx').first().click()

  // Poll for up to 40s: editor iframe (success) vs error text (failure).
  let outcome = 'timeout'
  for (let i = 0; i < 40; i++) {
    const hasError = await win.getByText('Cannot open document').isVisible().catch(() => false)
    if (hasError) { outcome = 'error'; break }
    const hasEditor = await win.evaluate(() => {
      const host = document.getElementById('onlyoffice-editor')
      return !!host && host.querySelector('iframe') !== null
    }).catch(() => false)
    if (hasEditor) { outcome = 'editor-loaded'; break }
    await win.waitForTimeout(1000)
  }

  // Capture the visible status text for context.
  const statusText = await win.evaluate(() => {
    const host = document.querySelector('[class*="status"]')
    return host ? host.textContent : '(no status element)'
  }).catch(() => '(eval failed)')

  console.log(`\nOUTCOME: ${outcome}`)
  console.log(`STATUS TEXT: ${statusText}`)
  await win.screenshot({ path: path.join(root, 'e2e/onlyoffice.png') })
  console.log('screenshot: e2e/onlyoffice.png')

  // Dump the container's recent logs (download errors show here) before closing.
  try {
    const { execSync } = await import('child_process')
    // The document conversion service logs download attempts here.
    const logs = execSync('docker exec workspace-os-onlyoffice sh -c "cat /var/log/onlyoffice/documentserver/converter/out.log 2>/dev/null | tail -30" 2>&1', { encoding: 'utf-8' })
    console.log('\n--- converter log (tail) ---\n' + (logs || '(empty)'))
  } catch (e) {
    console.log('(could not read converter log: ' + e.message + ')')
  }

  await app.close()
  process.exit(outcome === 'editor-loaded' ? 0 : 1)
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
