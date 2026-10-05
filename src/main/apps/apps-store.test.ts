import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { APP_CSP, composeApp, copyApp, freeSlug, isSlug, lintApp, listApps, loadKit, readManifest, slugify, storage, type Kit } from './apps-store'

let root: string
const kit: Kit = { css: '.wos-btn{}', bridge: 'window.wos={}' }
const write = (rel: string, text: string): void => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-apps-'))
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('an app as one sandboxed page', () => {
  it('puts the CSP, the kit and the bridge first, and inlines the app’s own files', () => {
    write('Apps/svg/app.json', JSON.stringify({ name: 'SVG', permissions: ['ai'] }))
    write('Apps/svg/index.html', '<!doctype html><html><head><title>x</title><link rel="stylesheet" href="style.css"></head><body><script src="app.js"></script></body></html>')
    write('Apps/svg/app.js', 'console.log("</script>")')
    write('Apps/svg/style.css', 'body{color:red}')
    const { html, manifest } = composeApp(root, 'svg', kit, 'dark')
    expect(manifest).toMatchObject({ name: 'SVG', permissions: ['ai'], entry: 'index.html' })
    const head = html.indexOf('<head>')
    expect(html.indexOf(`content="${APP_CSP}"`)).toBeGreaterThan(head)
    expect(html.indexOf('.wos-btn{}')).toBeLessThan(html.indexOf('body{color:red}')) // the app can refine the kit
    expect(html).toContain('window.__WOS_APP__={"slug":"svg","name":"SVG","theme":"dark"}')
    expect(html).toContain('console.log("<\\/script>")') // inlined code cannot close its tag
    expect(html).not.toMatch(/src="app\.js"|href="style\.css"/)
  })

  it('never inlines anything outside the app’s folder, and drops remote scripts', () => {
    write('secret.txt', 'TOP SECRET')
    write('Apps/a/index.html', '<html><head></head><body><script src="../../secret.txt"></script><script src="/etc/hosts"></script><script src="https://evil.example/x.js"></script><link rel="stylesheet" href="../../secret.txt"></body></html>')
    const { html } = composeApp(root, 'a', kit, 'light')
    expect(html).not.toContain('TOP SECRET')
    expect(html).not.toContain('evil.example')
  })

  it('loads nothing from the network: the CSP says so', () => {
    expect(APP_CSP).toContain("default-src 'none'")
    expect(APP_CSP).toContain("connect-src 'none'")
    expect(APP_CSP).not.toMatch(/https?:/)
  })

  it('embeds the kit’s fonts', () => {
    const dir = path.join(root, 'kit')
    fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'kit.css'), "@font-face{src:url('fonts/a.woff2')}")
    fs.writeFileSync(path.join(dir, 'fonts', 'a.woff2'), 'FONT')
    fs.writeFileSync(path.join(dir, 'bridge.js'), '')
    expect(loadKit(dir).css).toContain(`url('data:font/woff2;base64,${Buffer.from('FONT').toString('base64')}')`)
  })
})

describe('the gallery', () => {
  it('reads manifests defensively and lists apps newest first', () => {
    write('Apps/old/app.json', JSON.stringify({ name: 'Old', permissions: ['ai', 'mail.send'], entry: '../x.html' }))
    write('Apps/old/index.html', 'x')
    write('Apps/plain/index.html', 'x')
    write('Apps/Not An App/index.html', 'x')
    fs.utimesSync(path.join(root, 'Apps/old/app.json'), new Date(1000), new Date(1000))
    fs.utimesSync(path.join(root, 'Apps/old/index.html'), new Date(1000), new Date(1000))
    expect(readManifest(root, 'old')).toMatchObject({ permissions: ['ai'], entry: 'index.html' }) // unknown permission and odd entry dropped
    expect(readManifest(root, 'plain')).toMatchObject({ name: 'plain', permissions: [] })
    expect(listApps(root).map((a) => a.slug)).toEqual(['plain', 'old'])
  })

  it('names, copies and de-duplicates app folders', () => {
    expect(slugify('Miro light — Board!')).toBe('miro-light-board')
    expect(isSlug('../x')).toBe(false)
    write('Apps/board/index.html', 'x')
    write('Apps/board/data/store.json', '{"a":1}')
    expect(freeSlug(root, 'board')).toBe('board-2')
    copyApp(path.join(root, 'Apps/board'), path.join(root, 'Apps/board-2'))
    expect(fs.existsSync(path.join(root, 'Apps/board-2/index.html'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'Apps/board-2/data'))).toBe(false) // data stays with the original
  })
})

describe('an app’s own storage', () => {
  it('keeps values per app, and refuses bad keys and too much', () => {
    write('Apps/a/index.html', 'x')
    write('Apps/b/index.html', 'x')
    storage(root, 'a', 'set', 'board', { notes: [1, 2] })
    expect(storage(root, 'a', 'get', 'board')).toEqual({ notes: [1, 2] })
    expect(storage(root, 'b', 'get', 'board')).toBeNull()
    expect(storage(root, 'a', 'keys')).toEqual(['board'])
    storage(root, 'a', 'remove', 'board')
    expect(storage(root, 'a', 'keys')).toEqual([])
    expect(() => storage(root, 'a', 'set', '', 1)).toThrow()
    expect(() => storage(root, 'a', 'set', 'big', 'x'.repeat(6 * 1024 * 1024))).toThrow(/5 MB/)
  })
})

describe('the design check', () => {
  it('passes an app built from the kit', () => {
    write('Apps/ok/index.html', '<div class="wos-app"><button class="wos-btn ghost small" id="add-note">+</button><p>&#039;quoted&#039;</p></div><script src="app.js"></script>')
    write('Apps/ok/app.js', "const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink'); wos.storage.set('a', 1); const ns = 'http://www.w3.org/2000/svg'")
    write('Apps/ok/style.css', '#add-note { color: var(--ink); font-family: var(--sans); background: rgba(var(--ink-rgb), 0.05) } /* was #ff0000 */')
    expect(lintApp(root, 'ok')).toEqual([])
  })

  it('finds what breaks the look or the sandbox', () => {
    write('Apps/bad/index.html', '<div class="wos-ghost"><link href="https://fonts.googleapis.com/css2?family=Roboto"></div>')
    write('Apps/bad/style.css', '.note { background: #fff9e6; border: 1px solid #999; color: rgb(10, 20, 30); font-family: Roboto, sans-serif }')
    write('Apps/bad/app.js', "localStorage.setItem('x', 1)")
    const rules = lintApp(root, 'bad').map((f) => f.rule).sort()
    expect(rules).toEqual(['class', 'colour', 'colour', 'font', 'network', 'storage'])
    expect(lintApp(root, 'bad').find((f) => f.rule === 'colour')?.detail).toContain('#fff9e6 #999')
  })
})

describe('the built-in apps', () => {
  it('pass the design check themselves', () => {
    const dir = path.join(__dirname, '..', '..', '..', 'resources', 'apps')
    const ids = fs.readdirSync(dir)
    expect(ids.length).toBeGreaterThanOrEqual(3)
    for (const id of ids) {
      copyApp(path.join(dir, id), path.join(root, 'Apps', id))
      expect([id, lintApp(root, id)]).toEqual([id, []])
      expect(readManifest(root, id)?.permissions.length).toBeGreaterThan(0)
    }
  })
})
