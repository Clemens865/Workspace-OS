// Real renderer -> preload -> print IPC -> Electron pagination. Only the final
// printer call is replaced with printToPDF, so this never sends paper to a device.
// Uses an isolated profile/workspace; does not close the user's running app.
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-document-print-'))
const workspace = path.join(dir, 'workspace')
await fs.mkdir(workspace)
await fs.mkdir(path.join(dir, 'profile'))
await fs.mkdir(path.join(dir, 'temp'))
const md = '# Printed document\n\n'
  + Array.from({ length: 60 }, (_, i) => `## Section ${i + 1}\n\nParagraph-${i + 1} begins here. ${'The complete document must be printed, including text outside the editor viewport. '.repeat(3)}`).join('\n\n')
  + '\n\n| Name | Value |\n| --- | --- |\n| Last table row | 123 |\n\nEND-OF-DOCUMENT'
await fs.writeFile(path.join(workspace, 'long.md'), md)
await fs.writeFile(path.join(workspace, 'other.md'), '# Other document\n\nOTHER-DOCUMENT-ONLY')
await fs.writeFile(path.join(workspace, 'source.txt'), 'Literal <script>source</script>\n' + 'Text content\n'.repeat(200) + 'END-OF-TEXT')
await fs.writeFile(path.join(workspace, 'page.html'), '<style>h1{color:navy}</style><h1>HTML document</h1>' + '<p>HTML paragraph</p>'.repeat(150) + '<p>END-OF-HTML</p>')

const bootstrap = path.join(dir, 'boot.cjs')
await fs.writeFile(bootstrap, `const { app } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(dir, 'profile'))});
app.setPath('temp', ${JSON.stringify(path.join(dir, 'temp'))});
import(${JSON.stringify(pathToFileURL(path.join(root, 'out/main/index.js')).href)});
`)
let app
try {
  app = await electron.launch({ args: [bootstrap], cwd: root, env: { ...process.env, WORKSPACE_TEST_ROOT: workspace } })
  const win = await app.firstWindow({ timeout: 30000 })
  win.on('pageerror', (e) => console.error('[renderer]', e.message))
  win.on('dialog', async (dialog) => { console.error('[dialog]', dialog.message()); await dialog.dismiss() })
  await win.waitForSelector('#root', { timeout: 30000 })
  await win.getByRole('button', { name: 'Enter', exact: true }).click({ timeout: 10000 })

  await app.evaluate(({ app, BrowserWindow }, outputDir) => {
    globalThis.printJobs = []
    const intercept = (contents) => {
      contents.print = async (options, callback) => {
        const job = { title: contents.getTitle(), options, path: '', error: null }
        try {
          job.path = `${outputDir}/print-${globalThis.printJobs.length + 1}.pdf`
          const pdf = await contents.printToPDF({ printBackground: options.printBackground, pageSize: 'A4', preferCSSPageSize: true })
          job.data = pdf.toString('base64')
          globalThis.printJobs.push(job)
          callback(true, '')
        } catch (e) {
          job.error = e.message
          globalThis.printJobs.push(job)
          callback(false, e.message)
        }
      }
    }
    BrowserWindow.getAllWindows().forEach((w) => intercept(w.webContents))
    app.on('web-contents-created', (_event, contents) => intercept(contents))
  }, dir)

  async function open(name) {
    await win.evaluate(() => window.dispatchEvent(new CustomEvent('wos:quick-open')))
    const input = win.getByPlaceholder('Go to file…')
    await input.fill(name)
    await win.keyboard.press('Enter')
    await win.locator('[class*=current]:visible').filter({ hasText: name }).waitFor()
    await win.locator('.monaco-editor:visible, iframe[title="HTML preview"]:visible').first().waitFor()
    console.log(`Opened ${name}`)
  }
  async function print(viaMenu = false) {
    const previous = await app.evaluate(() => globalThis.printJobs.length)
    if (viaMenu) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:')).webContents.send('menu:run-action', 'print'))
    } else {
      await win.locator('button[title="Print"]:visible').click()
    }
    let jobs
    const deadline = Date.now() + 20000
    do {
      jobs = await app.evaluate(() => globalThis.printJobs)
      if (jobs.length > previous) break
      await new Promise((r) => setTimeout(r, 100))
    } while (Date.now() < deadline)
    assert.equal(jobs.length, previous + 1, 'one print job per action')
    const job = jobs.at(-1)
    assert.equal(job.error, null)
    assert.notEqual(job.title, 'Workspace OS', 'prints a document instead of the shell')
    await fs.writeFile(job.path, Buffer.from(job.data, 'base64'))
    const loading = getDocument({ data: new Uint8Array(await fs.readFile(job.path)), useSystemFonts: true })
    const pdf = await loading.promise
    const pages = []
    for (let i = 1; i <= pdf.numPages; i++) pages.push((await (await pdf.getPage(i)).getTextContent()).items.map((item) => item.str).join(' '))
    const text = pages.join('\n')
    assert.doesNotMatch(text, /Search or run|Terminal still running|Copy path|Go to file/)
    await loading.destroy()
    // The callback must release the temporary BrowserWindow.
    await new Promise((r) => setTimeout(r, 100))
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    return { text, pages, path: job.path }
  }

  await open('long.md')
  const editor = win.locator('.monaco-editor:visible textarea').first()
  await editor.focus()
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await win.keyboard.type('\n\nUNSAVED-LAST-PARAGRAPH')
  for (const mode of ['Edit', 'Split', 'Preview']) {
    await win.getByRole('button', { name: mode, exact: true }).filter({ visible: true }).click()
    const result = await print(mode === 'Split')
    assert.ok(result.pages.length > 3, `${mode}: full document spans multiple pages`)
    assert.match(result.text, /Printed document/)
    assert.match(result.text, /Paragraph-60/)
    assert.match(result.text, /Last table row/)
    assert.match(result.text, /END-OF-DOCUMENT/)
    assert.match(result.pages.at(-1), /UNSAVED-LAST-PARAGRAPH/)
    assert.equal((result.text.match(/Paragraph-1 begins/g) || []).length, 1)
    console.log(`PASS ${mode}: ${result.pages.length} pages, final unsaved paragraph included (${result.path})`)
  }
  assert.equal(await fs.readFile(path.join(workspace, 'long.md'), 'utf8'), md, 'printing does not save or alter the file')

  await open('other.md')
  const other = await print(true)
  assert.match(other.text, /OTHER-DOCUMENT-ONLY/)
  assert.doesNotMatch(other.text, /Printed document|Paragraph-60/)
  console.log('PASS switching files: only the current document prints')

  // Files keeps the Stage editor mounted, even for this same path. Its older
  // buffer must not intercept the visible Files pane's native Print action.
  await win.getByRole('button', { name: 'Files', exact: true }).click()
  await win.getByText('other.md', { exact: true }).filter({ visible: true }).first().click()
  const filesEditor = win.locator('.monaco-editor:visible textarea').first()
  await filesEditor.focus()
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await win.keyboard.type('\n\nVISIBLE-FILES-BUFFER')
  const filesPrint = await print(true)
  assert.match(filesPrint.text, /VISIBLE-FILES-BUFFER/)
  assert.equal((filesPrint.text.match(/OTHER-DOCUMENT-ONLY/g) || []).length, 1)
  console.log('PASS hidden panes: the visible buffer owns native Print')

  await open('source.txt')
  const text = await print()
  assert.ok(text.pages.length > 1)
  assert.match(text.text, /Literal\s+<script>source<\/script>/)
  assert.match(text.text, /END-OF-TEXT/)
  console.log('PASS text: literal markup and final line survive pagination')

  await open('page.html')
  const html = await print()
  assert.ok(html.pages.length > 1)
  assert.match(html.text, /END-OF-HTML/)
  console.log('PASS HTML: complete document, no application controls')
  console.log(`Print regression artifacts: ${dir}`)
} finally {
  await app?.close()
}
