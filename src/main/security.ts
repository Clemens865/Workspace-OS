import { app, session, shell, WebContents, BrowserWindow } from 'electron'
import { captureBrowserGuest } from './browser/browserControl'
import { log } from './crash-reporter'

/**
 * Central security hardening, applied in addition to the per-window
 * webPreferences (contextIsolation, sandbox, nodeIntegration=false).
 *
 * Two layers:
 *  - session: CSP enforced via response headers (not just the meta tag, which
 *    a renderer compromise could strip), and a deny-by-default permission
 *    handler.
 *  - per-webContents: block navigation away from the app, deny new windows,
 *    and forbid <webview> embedding.
 */

const DEV_CONNECT = 'ws://localhost:* http://localhost:* http://127.0.0.1:*'

/** The in-app Browser's session partition (must match BrowserSurface's PARTITION). */
export const BROWSER_PARTITION = 'persist:wos-browser'

/**
 * A real desktop-Chrome User-Agent for the in-app Browser. Electron's default UA
 * advertises "Electron/<ver> workspace-os", which sites like LinkedIn, Google and
 * banks treat as an unknown/embedded browser — serving a hardened challenge flow
 * that invalidates the session right after login ("auth_context_expired"). We
 * pin a normal Chrome UA (version derived from the real Chromium we ship, so
 * feature-detection stays consistent) on the browser session + every guest.
 */
/** Reads a numeric feature from a window.open() feature string, with a bound. */
export function sizeFrom(features: string, key: 'width' | 'height', fallback: number): number {
  const m = new RegExp(`${key}\\s*=\\s*(\\d{2,4})`).exec(features || '')
  const n = m ? Number(m[1]) : NaN
  if (!Number.isFinite(n)) return fallback
  // Sites ask for absurd sizes; keep it a usable dialog either way.
  return Math.max(320, Math.min(1200, n))
}

/**
 * Builds a `sec-ch-ua` header from the brands Chromium actually reports.
 *
 * Chromium's real brand list for a given major version is
 * `"Not/A)Brand";v="99"` plus `"Chromium";v="<major>"`. Emitting exactly that
 * keeps the header identical to `navigator.userAgentData.brands`, which is the
 * only property that matters: consistency, not which brand is claimed.
 *
 * Deliberately does NOT claim "Google Chrome". We are Chromium, the page can
 * see we are Chromium, and saying otherwise is the lie that gets a session
 * refused.
 */
export function clientHintsHeader(chromeVersion = process.versions.chrome || '124'): string {
  return brandsToHeader(brandList(chromeVersion))
}

/**
 * The brand list — the ONE place the browser's identity is defined.
 *
 * It stays honest. Claiming Google Chrome was built, measured working (headers
 * and `navigator.userAgentData` both, via a CDP user-agent override) and then
 * REMOVED, because Google documents the rule it would be evading: sign-in is
 * refused for browsers "in eine andere Anwendung eingebettet" and for those
 * "durch Software-Automatisierung ... gesteuert", and their instruction to app
 * developers is to move to browser-based OAuth rather than to look like Chrome.
 *
 * So the workaround had an expiry date set by somebody else, and a feature
 * built on it would break on their schedule. The app's own Google and Microsoft
 * integrations already do the sanctioned thing — a PKCE loopback flow in the
 * system browser. What remains is third-party sites offering only "Sign in with
 * Google", and those the browser now EXPLAINS rather than silently failing at:
 * see detectSignInBlock.
 *
 * The harnesses that measured all this are kept: e2e/browser/identity-providers,
 * fingerprint, brand-headers.
 */
export function brandList(chromeVersion = process.versions.chrome || '124'): { brand: string; version: string }[] {
  const major = chromeVersion.split('.')[0]
  return [
    { brand: 'Not/A)Brand', version: '99' },
    { brand: 'Chromium', version: major },
  ]
}

/**
 * The `sec-ch-ua` header, built from the brand list.
 *
 * We have to send it ourselves: measured on httpbin, Chromium's own client-hint
 * header never reaches the wire through Electron's webRequest hook, so with the
 * CDP override alone the header vanished entirely while the page still claimed
 * Chrome. Deriving both from `brandList` is what makes "one story" structural
 * rather than a thing to remember.
 */
export function brandsToHeader(brands: { brand: string; version: string }[]): string {
  return brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ')
}


/**
 * A document-start script that makes the PAGE agree with the headers.
 *
 * `navigator.userAgentData.brands` is generated inside Chromium and nothing at
 * the header layer can change it, which is exactly why the previous attempt at
 * this failed: every request claimed Google Chrome while the page still
 * reported Chromium, and a browser whose headers and JavaScript disagree about
 * its own identity is a louder signal than honestly being Chromium.
 *
 * So if the brand is claimed at all, it has to be claimed in both places.
 */


/**
 * The language list Chromium should advertise, derived from the system.
 *
 * Passed to `setUserAgent(ua, acceptLanguages)` rather than stamped onto the
 * header by hand. Chromium then generates BOTH the weighted
 * `Accept-Language` header and `navigator.languages` from this one value, so
 * they cannot disagree — the same failure that made `sec-ch-ua` claim Google
 * Chrome while the page reported Chromium.
 *
 * Overriding the header directly would reintroduce exactly that bug: the page
 * would still report the old list, and a browser whose headers and JavaScript
 * disagree is one that looks like it is lying.
 */
export function acceptLanguageList(preferred: readonly string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of preferred) {
    const tag = (raw || '').trim()
    if (!tag) continue
    // BASE FIRST, then the regional tag — this is the order Chromium itself
    // reports in navigator.languages ("de,de-AT"), verified with
    // e2e/browser/session-diagnostic.mjs. Emitting the regional tag first is
    // the more intuitive reading of Accept-Language semantics and produced a
    // header that disagreed with the page: the same class of inconsistency
    // this whole change exists to remove. Match Chromium, not intuition.
    const base = tag.split('-')[0]
    for (const candidate of base && base !== tag ? [base, tag] : [tag]) {
      const key = candidate.toLowerCase()
      if (candidate && !seen.has(key)) {
        seen.add(key)
        out.push(candidate)
      }
    }
  }
  if (out.length === 0) out.push('en-US', 'en')
  // Cap it: a very long list is itself unusual.
  return out.slice(0, 6).join(',')
}

export function browserUserAgent(): string {
  const chrome = process.versions.chrome || '124.0.0.0'
  return `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`
}

// localhost/127.0.0.1 are allowed only for the OnlyOffice Document Server.
function csp(isDev: boolean): string {
  const scriptExtra = isDev ? "'unsafe-eval'" : '' // Vite HMR needs eval in dev only
  return [
    "default-src 'self'",
    `script-src 'self' http://localhost:* http://127.0.0.1:* ${scriptExtra}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${DEV_CONNECT}`,
    "frame-src 'self' http://localhost:* http://127.0.0.1:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'",
  ].join('; ')
}

export function applySessionSecurity(isDev: boolean): void {
  const policy = csp(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Only enforce OUR CSP on our own app documents. The OnlyOffice editor is
    // served from the local document server (localhost / 127.0.0.1) and relies
    // on its own inline scripts — forcing our CSP onto it breaks the editor.
    const url = details.url
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })

  // Deny every permission request by default — the app needs none of them.
  // ONE exception: 'fullscreen'. A <webview> video's HTML fullscreen delegates
  // through the EMBEDDER (this session), so the browser surface legitimately
  // needs it. (Ruled OUT as the cause of the LinkedIn feed's fullscreen bounce
  // — that turned out to be LinkedIn's own feed tearing down inline players —
  // but a browser that can't fullscreen a video at all is simply wrong.)
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen')
  })

  // The in-app Browser identifies as normal desktop Chrome (see browserUserAgent).
  // Set on the SESSION so every request — the initial GET, the auth POST, and all
  // subresources — carries a consistent UA; otherwise LinkedIn & co. reject the
  // post-login session as an unrecognised embedded browser.
  const browserSession = session.fromPartition(BROWSER_PARTITION)
  // The partition had NO permission handler — Electron then GRANTS requests by
  // default, quietly wider than the deny-by-default above. Close that: deny
  // everything except 'fullscreen' (needed for video fullscreen in the guest).
  browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen')
  })
  const ua = browserUserAgent()
  // Give Chromium the language list too, so it generates the weighted
  // Accept-Language header AND navigator.languages from the same source. The
  // header previously went out as a bare "de" while the page reported
  // "de,de-AT" — the same header-vs-JS inconsistency that got sessions refused.
  const languages = acceptLanguageList(app.getPreferredSystemLanguages())
  browserSession.setUserAgent(ua, languages)

  // The client hints must match what the PAGE reports about itself.
  //
  // This previously added a `"Google Chrome"` brand to the sec-ch-ua header. It
  // was meant to look more like Chrome and did the opposite: Chromium generates
  // `navigator.userAgentData.brands` internally and nothing at the header layer
  // can change it, so the page reported only `Chromium` while every request
  // claimed `Google Chrome`.
  //
  // A browser whose headers and JavaScript disagree about its own identity is a
  // browser that is lying, and that is a far stronger bot signal than honestly
  // being Chromium — which is a perfectly normal browser engine. The
  // inconsistency our own anti-detection measure created is what triggered the
  // detection: LinkedIn accepted the password, ran 2FA, then refused to issue a
  // session and redirected to `auth_context_expired`.
  //
  // So the header is BUILT FROM the real brand list rather than invented, and
  // the two cannot drift apart again.
  const chUa = clientHintsHeader()

  browserSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: browserRequestHeaders(details.requestHeaders, ua, chUa) })
  })
}

/**
 * The headers every guest request carries. Pure, so it can be tested.
 *
 * We identify as desktop Chrome consistently — UA and client hints from the
 * same source, because a browser whose headers and JavaScript disagree about
 * its own identity is a stronger bot signal than honestly being Chromium.
 *
 * We do NOT touch `X-Requested-With`, and that is the whole point of this
 * function existing.
 *
 * It used to be deleted here, to "drop the webview-identifying header". That
 * reasoning came from ANDROID WebView, which stamps `X-Requested-With: <app
 * package>` onto every request it makes. Desktop Chromium never sets it at all,
 * so there was nothing to hide — and the only way the header ever appears here
 * is when THE PAGE'S OWN JAVASCRIPT sets it, which is how jQuery and every
 * Rails app mark an XHR so the server can answer `request.xhr?` with JSON
 * instead of a full document.
 *
 * Stripping it therefore hid nothing and broke ordinary AJAX: GitHub's
 * two-factor page polls for the phone confirmation, the server saw a plain
 * request, replied with HTML, and the page waited forever for a JSON response
 * that could never arrive. Measured with a local echo server — the page sent
 * the header, the server received null.
 */
/**
 * What a real browser would put in `Referer` for this hop.
 *
 * Mirrors `strict-origin-when-cross-origin`, Chromium's default: the full url
 * within one origin, the origin alone when leaving it, and nothing at all when
 * downgrading https → http. Returns '' when there is nothing safe to send.
 */
export function referrerFor(fromUrl: string, toUrl: string): string {
  let from: URL
  let to: URL
  try {
    from = new URL(fromUrl)
    to = new URL(toUrl)
  } catch {
    return ''
  }
  if (!/^https?:$/.test(from.protocol)) return ''
  // Never leak an https page's address to a plaintext destination.
  if (from.protocol === 'https:' && to.protocol === 'http:') return ''
  if (from.origin === to.origin) return from.toString()
  return `${from.origin}/`
}

export function browserRequestHeaders(
  requestHeaders: Record<string, string>,
  ua: string,
  chUa: string,
): Record<string, string> {
  return {
    ...requestHeaders,
    'User-Agent': ua,
    'sec-ch-ua': chUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
  }
}

/**
 * The language list the browser advertises, resolved once.
 *
 * Shared so every place that sets the User-Agent sets the SAME languages with
 * it. `setUserAgent(ua)` without the second argument drops the accept-languages
 * that were paired with it at session level — which silently undid the language
 * fix in exactly the place real browsing happens, the <webview> guest.
 */
export function browserLanguages(): string {
  return acceptLanguageList(app.getPreferredSystemLanguages())
}

export function hardenWebContents(contents: WebContents): void {
  const appOrigins = ['http://localhost:5173', 'file://']

  // Block the main frame from being navigated away from the app.
  contents.on('will-navigate', (event, url) => {
    const allowed = appOrigins.some((o) => url.startsWith(o))
    if (!allowed) {
      event.preventDefault()
      if (url.startsWith('http')) shell.openExternal(url)
    }
  })

  // Deny the real popup window, but route http(s) into the IN-APP browser.
  //
  // This used to call shell.openExternal, which threw the click out to Safari.
  // That is the same mistake WOS-007 fixed for the browser surface: it defeats
  // the point of an integrated workspace — the session, the login and the
  // agent's view of the page are all left behind — and for a link in an EMAIL
  // it also means the message you were reading is now behind another app.
  //
  // A link in the sandboxed mail reader arrives here, because that iframe has
  // allow-popups and no allow-scripts: the only way to reach this line from a
  // message is a real click on a real link.
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) {
      const win = BrowserWindow.fromWebContents(contents)
      if (win && !win.isDestroyed()) win.webContents.send('browser:open-tab', url)
      else shell.openExternal(url) // no host window — better than losing the click
    }
    return { action: 'deny' }
  })

  // Harden every <webview> the app attaches (the in-app Browser surface). We
  // strip any preload and force node integration off, so a hostile guest page
  // gets NO preload bridge and NO Node — it cannot reach Electron or app IPC.
  // The guest keeps its own session partition (set on the tag) and web
  // security; popups from the guest are still funnelled through the deny-and-
  // open-externally handler above.
  contents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.sandbox = true
    // Only permit http(s) guests; refuse file://, chrome://, etc.
    const src = typeof params.src === 'string' ? params.src : ''
    if (src && !/^https?:\/\//i.test(src)) {
      _event.preventDefault()
    }
  })

  // A newly-attached webview is its own WebContents; harden its navigation +
  // window-open behaviour the same way (block popups → open externally).
  contents.on('did-attach-webview', (_e, guest) => {
    // Belt-and-suspenders: also pin the Chrome UA on the guest webContents (the
    // session-level UA is the primary fix; this covers any per-contents override).
    // Pass the languages too. Without them this call resets the guest's
    // accept-languages, so the header and navigator.languages disagree again —
    // the same inconsistency that got sessions refused, reintroduced at the one
    // layer the earlier verification did not cover.
    guest.setUserAgent(browserUserAgent(), browserLanguages())

    // Two very different things arrive here, and treating them identically is
    // what broke every popup-based sign-in (LinkedIn, Microsoft, Google).
    //
    // `disposition` tells them apart:
    //
    //   'foreground-tab' / 'background-tab'
    //       A link with target="_blank". WOS-007: these used to be handed to
    //       the SYSTEM browser, which reads as "the link does nothing" and
    //       leaves the session, the login and the agent's view behind. They
    //       become an in-app tab.
    //
    //   'new-window'
    //       A real `window.open()` — which is how two-factor and OAuth flows
    //       work. The page keeps a REFERENCE to the popup and waits for it to
    //       postMessage back or to close.
    //
    //       Denying it returns null from window.open() and re-opens the url as
    //       an unrelated tab with NO opener. The sign-in then completes for
    //       real — the auth app confirms — but the original page can never be
    //       told, so it reloads, finds no session, and the user is back at the
    //       login form. An endless loop with no error anywhere.
    //
    //       So a popup gets to be a real popup: same persistent partition, so
    //       the cookie it sets is the cookie the opener reads, and the same
    //       hardening as every other guest.
    guest.setWindowOpenHandler(({ url, disposition, features }) => {
      if (!/^https?:\/\//.test(url)) return { action: 'deny' }

      if (disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: sizeFrom(features, 'width', 520),
            height: sizeFrom(features, 'height', 640),
            // A sign-in window is a dialog, not a place to browse.
            minimizable: false,
            fullscreenable: false,
            webPreferences: {
              partition: BROWSER_PARTITION,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webviewTag: false,
            },
          },
        }
      }

      /**
       * Carry the REFERRER across to the new tab.
       *
       * Denying the popup and re-opening the url as a fresh tab loses the
       * opener, and with it the Referer header a real browser would have sent.
       * Measured with a local echo server: a target=_blank click arrived with
       * `referer: null`.
       *
       * Sites that gate outbound links on it then refuse to honour the
       * destination — LinkedIn's /safety/go interstitial drops you on a bare
       * "leaving LinkedIn" page with the target silently discarded, which
       * looks like the link is broken.
       *
       * The value follows Chromium's default policy rather than always sending
       * the full url: same origin gets the whole thing, cross origin gets the
       * origin only. Sending more than the browser would is a privacy
       * regression dressed up as a fix.
       */
      // `guest`, not `contents`: contents is the HOST window, whose url is a
      // file:// — the policy correctly refuses to build a referrer from that,
      // so the first version of this fix silently sent an empty string and
      // changed nothing. The opener is the guest page.
      const referrer = referrerFor(guest.getURL(), url)
      const win = BrowserWindow.fromWebContents(contents)
      if (win && !win.isDestroyed()) win.webContents.send('browser:open-tab', { url, referrer })
      else shell.openExternal(url) // no host window — better than losing the click
      return { action: 'deny' }
    })
    /**
     * The sign-in popup must look like the same browser as the tab that opened
     * it.
     *
     * Electron's default UA advertises an embedded browser, and that is exactly
     * what makes these providers serve the hardened challenge flow that
     * invalidates the session right after login — the failure this whole popup
     * path exists to fix. The tab is already pinned to a real Chrome UA; the
     * popup inherits nothing, so it is pinned here too.
     */
    guest.on('did-create-window', (child) => {
      // The popup we now allow was getting NO hardening: found while chasing
      // the blank challenge page. It shares the partition, so it inherits the
      // session's headers, but nothing stopped it navigating anywhere or
      // spawning further windows.
      hardenPopup(child)
      child.webContents.setUserAgent(browserUserAgent(), browserLanguages())
      // A sign-in popup that spawns further popups is not a flow we support,
      // and it is a plausible way to escape this hardening.
      child.webContents.setWindowOpenHandler(({ url: childUrl }) => {
        if (/^https?:\/\//.test(childUrl)) {
          const win = BrowserWindow.fromWebContents(contents)
          if (win && !win.isDestroyed()) win.webContents.send('browser:open-tab', childUrl)
        }
        return { action: 'deny' }
      })
    })

    /**
     * Record why a page failed, because a blank page tells you nothing.
     *
     * A LinkedIn challenge page rendered empty and there was no trail at all —
     * no console error, no failed request, nothing in the log. Diagnosing it
     * meant launching a second copy of the app, which the single-instance lock
     * refuses while the user has theirs open, so the only evidence available
     * came from guessing.
     *
     * Guest console ERRORS and failed navigations now reach the main log. Only
     * errors: a page's ordinary console chatter is not ours to record, and a
     * log nobody can find a real failure in is the same as no log.
     */
    guest.on('did-fail-load', (_e, code, description, validatedURL, isMainFrame) => {
      if (!isMainFrame || code === -3) return // -3 = aborted, normal on redirects
      log('warn', `[browser] load failed ${code} ${description} — ${String(validatedURL).slice(0, 200)}`)
    })
    guest.on('render-process-gone', (_e, details) => {
      log('error', `[browser] renderer gone: ${details.reason} (exit ${details.exitCode})`)
    })
    guest.on('console-message', (_e, level, message, line, sourceId) => {
      // 3 = error in Chromium's level enum.
      if (level < 3) return
      log('warn', `[browser:page] ${String(message).slice(0, 300)} (${String(sourceId).slice(0, 120)}:${line})`)
    })

    // Hand the guest's webContents to the browser-drive controller so the agent
    // can navigate / screenshot / extract the VISIBLE page. There is one Browser
    // surface; we keep the latest attached guest as the drive target.
    captureBrowserGuest(guest)
  })
}

/**
 * Hardening for a sign-in popup.
 *
 * Deliberately NOT hardenWindow: that blocks navigation away from the app,
 * which is right for the app shell and fatal for an auth flow — a sign-in is a
 * chain of redirects across identity providers, and blocking them is precisely
 * "the page goes blank".
 */
export function hardenPopup(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', (_e, details) => {
    log('error', `[browser:popup] renderer gone: ${details.reason}`)
  })
  win.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    log('warn', `[browser:popup] load failed ${code} ${description} — ${String(url).slice(0, 200)}`)
  })
}

export function hardenWindow(win: BrowserWindow): void {
  hardenWebContents(win.webContents)
}

/**
 * Defense-in-depth for the highest-impact handlers (process spawn). Embedded
 * frames such as the OnlyOffice editor never receive the preload bridge and so
 * cannot reach IPC at all — but for process-spawning channels we additionally
 * reject any call that did not originate from the top frame.
 */
export function assertMainFrame(event: Electron.IpcMainInvokeEvent): void {
  if (event.senderFrame && event.senderFrame.parent !== null) {
    throw new Error('IPC call rejected: not from the main frame')
  }
}
