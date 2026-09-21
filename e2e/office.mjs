// Verifies Docker-free office viewing for docx/xlsx/pptx via LibreOffice→PDF.js.
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
win.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`))
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 10000 })
await win.waitForTimeout(700)

let pass = 0, fail = 0
async function checkOpens(fileName) {
  await win.getByText(fileName).first().click()
  // The office view converts via LibreOffice then renders PDF canvases.
  let rendered = false
  for (let i = 0; i < 30; i++) {
    rendered = await win.evaluate(() => {
      const cv = document.querySelectorAll('canvas')
      // a rendered page canvas has real dimensions
      return Array.from(cv).some((c) => c.width > 100 && c.height > 100)
    })
    const errored = await win.getByText('Cannot render', { exact: false }).isVisible().catch(() => false)
    if (rendered || errored) break
    await win.waitForTimeout(700)
  }
  if (rendered) { pass++; console.log(`  ✓ ${fileName} renders Docker-free`) }
  else { fail++; console.log(`  ✗ ${fileName} did NOT render`) }
}

await checkOpens('test-document.docx')
await checkOpens('test-sheet.xlsx')
await checkOpens('test-deck.pptx')

// Note: without the bundled engine env this exercises the read-only PDF
// fallback. Native editing is covered by e2e/lok*.mjs.

await win.screenshot({ path: path.join(root, 'e2e/office.png') })
console.log(`\nOFFICE VIEW: ${pass} passed, ${fail} failed`)
await app.close()
process.exit(fail === 0 ? 0 : 1)
