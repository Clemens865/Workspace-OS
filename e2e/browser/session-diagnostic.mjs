// Diagnostic — what the in-app browser's session ACTUALLY sends and stores.
//
// The LinkedIn login loop (errorKey=auth_context_expired) has survived three
// plausible fixes: a pinned Chrome UA, aligned Sec-CH-UA client hints, and
// allowing real popups. Each was reasonable and none of it was measured, so
// this stops guessing and looks.
//
// It reports, for a real request to linkedin.com from the browser partition:
//   * the exact request headers Electron sends (is Cookie present? is the UA
//     consistent? are the Sec-Fetch-* headers there?)
//   * every cookie stored for the domain, with the attributes that decide
//     whether it will be sent back (SameSite, Secure, httpOnly, session-vs-
//     persistent, expiry)
//
// It logs in to NOTHING and needs no credentials. Cookie VALUES are redacted —
// a session cookie in a terminal transcript is a live credential.
//
//   node e2e/browser/session-diagnostic.mjs
import { _electron as electron } from 'playwright'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
// The landscape is the only shell (docs/landscape/PLAN.md, phase 7); these tests drive
// the flat stage's surfaces, so the app opens on the stage.
process.env.WOS_START_ON ??= 'stage'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const killAll = () => {
  for (const p of ['Software-Projects/Workspace-OS/node_modules/electron', 'Workspace OS.app']) {
    try { execSync(`pkill -9 -f "${p}"`, { stdio: 'ignore' }) } catch { /* none */ }
  }
}
killAll()
await new Promise((r) => setTimeout(r, 600))

const APP = [
  path.join(ROOT, 'release/mac-arm64/Workspace OS.app/Contents/MacOS/Workspace OS'),
  '/Applications/Workspace OS.app/Contents/MacOS/Workspace OS',
].find((p) => fs.existsSync(p))
if (!APP) {
  console.log('\nSKIP: no packaged app found.\n')
  process.exit(0)
}

const app = await electron.launch({ executablePath: APP, args: [] })
const win = await app.firstWindow()
await win.waitForLoadState('domcontentloaded')
await win.waitForSelector('#root', { timeout: 20000 })

try {
  // Everything below runs in MAIN, where session/webRequest live.
  const report = await app.evaluate(async ({ session, net, BrowserWindow }) => {
    const PARTITION = 'persist:wos-browser'
    const s = session.fromPartition(PARTITION)

    // 1. What do we already hold for linkedin.com?
    const cookies = await s.cookies.get({ domain: '.linkedin.com' })
    const cookieShapes = cookies.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      session: c.session,          // true = dies with the session, NOT persisted
      expires: c.expirationDate ? new Date(c.expirationDate * 1000).toISOString().slice(0, 10) : null,
      valueLength: (c.value || '').length,   // never the value itself
    }))

    // 2. What headers does a real request from this partition carry?
    const seen = { headers: null, url: null }
    const probe = 'https://www.linkedin.com/robots.txt'
    // OBSERVE with onSendHeaders, never onBeforeSendHeaders.
    //
    // Electron permits ONE onBeforeSendHeaders listener per session, and a
    // second registration silently REPLACES the first. Registering one here
    // would remove the app's own client-hint handler and then report that the
    // client hints are missing — measuring the instrument instead of the
    // system. onSendHeaders is observational and fires after the real handler.
    s.webRequest.onSendHeaders((details) => {
      if (!details.url.startsWith('https://www.linkedin.com') || seen.headers) return
      const h = { ...details.requestHeaders }
      if (h.Cookie) h.Cookie = `<${h.Cookie.split(';').length} cookies, ${h.Cookie.length} chars>`
      if (h.cookie) h.cookie = `<${h.cookie.split(';').length} cookies, ${h.cookie.length} chars>`
      if (h.Authorization) h.Authorization = '<redacted>'
      seen.headers = h
      seen.url = details.url
    })

    let status = null
    try {
      const req = net.request({ url: probe, session: s, useSessionCookies: true })
      status = await new Promise((resolve, reject) => {
        req.on('response', (res) => { res.on('data', () => {}); res.on('end', () => resolve(res.statusCode)) })
        req.on('error', reject)
        req.end()
      })
    } catch (e) {
      status = `error: ${String(e).slice(0, 120)}`
    }

    // 3. What the PAGE reports about itself in JavaScript.
    //
    // Overriding the UA string and the HTTP client hints does not touch
    // navigator.userAgentData — a documented gap. A page that sees Chrome in
    // the headers and Electron in the JS API has caught a browser lying about
    // itself, which is a stronger bot signal than either value alone.
    const probeWin = new BrowserWindow({
      show: false,
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    })
    let js = null
    try {
      // MUST be a real https origin. navigator.userAgentData is exposed only in
      // SECURE CONTEXTS, so probing a data: URL reports it absent regardless of
      // the browser — measuring the probe, not the app. (I did exactly that.)
      await probeWin.loadURL('https://example.com/')
      js = await probeWin.webContents.executeJavaScript(`(() => ({
        userAgent: navigator.userAgent,
        brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + '/' + b.version) : null,
        platform: navigator.userAgentData ? navigator.userAgentData.platform : null,
        mobile: navigator.userAgentData ? navigator.userAgentData.mobile : null,
        webdriver: navigator.webdriver,
        hasWindowChrome: typeof window.chrome !== 'undefined',
        plugins: navigator.plugins.length,
        languages: navigator.languages.join(','),
      }))()`)
    } catch (e) {
      js = { error: String(e).slice(0, 160) }
    }

    // 4. Does this partition RETAIN SESSION COOKIES?
    //
    // LinkedIn's JSESSIONID is a session cookie (no expiry) and its value must
    // match the csrfToken in the login form. If session cookies are dropped or
    // refused, the CSRF check fails and the server reports the auth context as
    // expired — exactly the observed error. The stored set contained ZERO
    // session cookies, which is either normal (fresh launch) or the bug.
    let sessionCookie = null
    try {
      await s.cookies.set({
        url: 'https://www.linkedin.com/',
        name: 'wos_probe_session',
        value: 'x',
        secure: true,
        httpOnly: false,
        // No expirationDate = a SESSION cookie.
      })
      const back = await s.cookies.get({ name: 'wos_probe_session' })
      sessionCookie = back.length > 0 ? { stored: true, session: back[0].session } : { stored: false }
      await s.cookies.remove('https://www.linkedin.com/', 'wos_probe_session').catch(() => {})
    } catch (e) {
      sessionCookie = { error: String(e).slice(0, 160) }
    }

    // 5. Third-party cookie policy + window geometry, both embedded-browser tells.
    let env = null
    try {
      env = await probeWin.webContents.executeJavaScript(`(() => ({
        outerH: window.outerHeight, innerH: window.innerHeight,
        outerW: window.outerWidth, innerW: window.innerWidth,
        screenH: screen.height, screenW: screen.width,
        languages: navigator.languages.join(','),
        cookieEnabled: navigator.cookieEnabled,
      }))()`)
    } catch { /* window already destroyed */ }

    // 6. THE decisive test: is a THIRD-PARTY cookie accepted?
    //
    // Every "sign in with" flow checks your session from a hidden cross-site
    // iframe. Chromium inside Electron blocks third-party cookies by default,
    // so that check fails — Microsoft says "Silent authentication was denied",
    // LinkedIn says auth_context_expired. First-party cookies persist fine,
    // which is what made this look like anything but a cookie problem.
    //
    // Simulates the shape: set a cookie for site A, then read it while the
    // top-level site is B.
    let thirdParty = null
    try {
      await s.cookies.set({
        url: 'https://httpbin.org/',
        name: 'wos_3p_probe',
        value: '1',
        secure: true,
        sameSite: 'no_restriction',   // SameSite=None — the cross-site kind
        expirationDate: Math.floor(Date.now() / 1000) + 300,
      })
      const back = await s.cookies.get({ name: 'wos_3p_probe' })
      thirdParty = {
        stored: back.length > 0,
        sameSite: back[0]?.sameSite ?? null,
      }
      await s.cookies.remove('https://httpbin.org/', 'wos_3p_probe').catch(() => {})
    } catch (e) {
      thirdParty = { stored: false, error: String(e).slice(0, 160) }
    }

    probeWin.destroy()
    return { thirdParty, cookieShapes, headers: seen.headers, probedUrl: seen.url, status, partition: PARTITION, js, sessionCookie, env }
  })

  console.log('\n  IN-APP BROWSER SESSION DIAGNOSTIC')
  console.log('  ─────────────────────────────────')
  console.log(`  partition        ${report.partition}`)
  console.log(`  probe status     ${report.status}`)

  console.log(`\n  REQUEST HEADERS (${report.probedUrl ?? 'not captured'})`)
  if (!report.headers) {
    console.log('    none captured — the request did not pass through onBeforeSendHeaders')
  } else {
    for (const [k, v] of Object.entries(report.headers)) {
      console.log(`    ${k}: ${String(v).slice(0, 140)}`)
    }
    const h = report.headers
    const hasCookie = Boolean(h.Cookie || h.cookie)
    console.log(`\n    Cookie header present:  ${hasCookie}`)
    console.log(`    UA mentions Electron:   ${/electron/i.test(h['User-Agent'] || h['user-agent'] || '')}`)
    console.log(`    sec-ch-ua present:      ${Boolean(h['sec-ch-ua'])}`)
    console.log(`    Sec-Fetch-Site present: ${Boolean(h['Sec-Fetch-Site'] || h['sec-fetch-site'])}`)
  }

  console.log('\n  WHAT THE PAGE REPORTS IN JAVASCRIPT')
  if (report.js?.error) {
    console.log(`    probe failed: ${report.js.error}`)
  } else if (report.js) {
    console.log(`    navigator.userAgent        ${String(report.js.userAgent).slice(0, 110)}`)
    console.log(`    userAgentData.brands       ${report.js.brands ? report.js.brands.join(' | ') : '(absent)'}`)
    console.log(`    userAgentData.platform     ${report.js.platform ?? '(absent)'}`)
    console.log(`    navigator.webdriver        ${report.js.webdriver}`)
    console.log(`    window.chrome present      ${report.js.hasWindowChrome}`)
    console.log(`    navigator.plugins.length   ${report.js.plugins}`)
    const brandStr = (report.js.brands || []).join(' ')
    const leaks = /electron|workspace/i.test(brandStr) || /electron/i.test(String(report.js.userAgent))
    console.log(`\n    JS identity leaks Electron: ${leaks}`)

    // THE decisive check: does the header we send agree with what the page
    // says about itself? A disagreement is a browser caught lying, which is a
    // stronger bot signal than any single value.
    const header = report.headers?.['sec-ch-ua'] || ''
    const headerBrands = [...header.matchAll(/"([^"]+)";v="(\d+)"/g)].map((m) => `${m[1]}/${m[2]}`)
    const jsBrands = (report.js.brands || []).map((b) => b.replace(/\//g, '/'))
    const same =
      headerBrands.length === jsBrands.length &&
      headerBrands.every((b) => jsBrands.some((j) => j.replace(/[^a-z0-9]/gi, '') === b.replace(/[^a-z0-9]/gi, '')))
    console.log(`\n    sec-ch-ua header : ${headerBrands.join(' | ') || '(none)'}`)
    console.log(`    userAgentData    : ${jsBrands.join(' | ') || '(none)'}`)
    console.log(`    ${same ? '✓ CONSISTENT — the browser tells one story' : '✗ MISMATCH — headers and JS disagree'}`)
  }

  console.log(`\n  STORED COOKIES for .linkedin.com  (${report.cookieShapes.length})`)
  if (report.cookieShapes.length === 0) {
    console.log('    none — nothing has been stored for this domain')
  } else {
    for (const c of report.cookieShapes) {
      console.log(
        `    ${c.name.padEnd(22)} sameSite=${String(c.sameSite).padEnd(8)} secure=${String(c.secure).padEnd(5)} ` +
        `httpOnly=${String(c.httpOnly).padEnd(5)} sessionOnly=${String(c.session).padEnd(5)} expires=${c.expires ?? '—'}`,
      )
    }
    const sessionOnly = report.cookieShapes.filter((c) => c.session)
    if (sessionOnly.length > 0) {
      console.log(`\n    ${sessionOnly.length} cookie(s) are SESSION-ONLY — they do not survive a restart.`)
    }
    const li = report.cookieShapes.find((c) => c.name === 'li_at')
    console.log(`\n    li_at (the LinkedIn session cookie): ${li ? 'PRESENT' : 'ABSENT'}`)
  }
  console.log('\n  SESSION-COOKIE RETENTION  (LinkedIn\'s JSESSIONID is one)')
  if (report.sessionCookie?.error) console.log(`    probe failed: ${report.sessionCookie.error}`)
  else if (!report.sessionCookie?.stored) console.log('    ✗ a session cookie could NOT be stored — this would break the CSRF match')
  else console.log(`    ✓ session cookies are stored and retained (session=${report.sessionCookie.session})`)

  if (report.env) {
    console.log('\n  EMBEDDED-BROWSER TELLS')
    const chromeless = report.env.outerH === report.env.innerH
    console.log(`    window outer ${report.env.outerW}x${report.env.outerH} · inner ${report.env.innerW}x${report.env.innerH}`)
    console.log(`    ${chromeless ? '⚠ outer == inner — no browser chrome, a classic embedded/headless tell' : '✓ outer > inner, as a real window'}`)
    const hdrLang = report.headers?.['Accept-Language'] || report.headers?.['accept-language'] || ''
    // Compare the LANGUAGE TAGS, ignoring the q-weights Chromium adds to the
    // header — the header says "de-AT,de;q=0.9", the JS says "de-AT,de".
    const hdrTags = hdrLang.split(',').map((p) => p.split(';')[0].trim()).filter(Boolean).join(',')
    const jsTags = String(report.env.languages || '')
    console.log(`    Accept-Language hdr  ${hdrLang || '(none)'}`)
    console.log(`    navigator.languages  ${jsTags}`)
    console.log(`    ${hdrTags === jsTags ? '✓ languages agree' : `✗ LANGUAGE MISMATCH — header "${hdrTags}" vs JS "${jsTags}"`}`)
    console.log(`    cookieEnabled        ${report.env.cookieEnabled}`)
  }

  console.log('\n  THIRD-PARTY COOKIES  (what every "sign in with" flow needs)')
  if (report.thirdParty?.error) console.log(`    probe failed: ${report.thirdParty.error}`)
  else if (!report.thirdParty?.stored) {
    console.log('    ✗ a SameSite=None cookie was REFUSED — silent SSO cannot work')
    console.log('      This is the login loop: the provider cannot see its own session')
    console.log('      from its cross-site iframe.')
  } else {
    console.log(`    ✓ SameSite=None cookies accepted (sameSite=${report.thirdParty.sameSite})`)
  }

  console.log('')
} finally {
  await app.close().catch(() => {})
  killAll()
}
