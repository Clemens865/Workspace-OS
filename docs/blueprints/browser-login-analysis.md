# Why sign-in failed in the in-app browser — and what it actually was

**Status:** RESOLVED 2026-08-08 in v0.1.30. LinkedIn sign-in confirmed working.

> ## The answer, up front
>
> **We navigated every page twice.**
>
> `BrowserSurface` rendered `<webview src={tab.url}>` where `tab.url` is React
> state written on every `did-navigate` / `did-navigate-in-page`. When the PAGE
> navigated, we stored the new url, React re-rendered, saw `src` had changed,
> and wrote it — and writing `src` on a `<webview>` starts a navigation. Every
> navigation the page made, we made again.
>
> For a sign-in, that re-issues the redirect chain from a one-time code the
> provider has already consumed. It refuses, and returns you to the form:
> `auth_context_expired`. For a SPA, the second load discards in-page state —
> click a project in Asana, land back where you started. One cause, both
> symptoms. Fixed by setting `src` once at mount.
>
> Proof, not argument: one `history.pushState` — which must cause zero loads in
> any browser — produced **two** real page loads before the fix and **zero**
> after. Guarded by `e2e/browser/double-load.mjs` (`npm run e2e:browser`).
>
> **Everything below this box was written before that was known, and its
> conclusion is wrong.** It is kept because the research is sound and the
> reasoning failure is worth being able to re-read: every hypothesis in it
> concerns how we IDENTIFY ourselves to a provider, and the fault was in how we
> NAVIGATE. No header could have fixed it. The decisive clue had already
> appeared and been discarded — `loadURL` rejecting with `ERR_ABORTED (-3)`,
> which means exactly "a second navigation superseded this one". It was worked
> around to keep a test running instead of read.
>
> The one thing here that did hold up: **run the cheap experiment that
> discriminates before committing to the expensive theory.** Two user
> observations — that Asana signed in fine with Microsoft, and that a click
> merely reloaded the same page — overturned the whole analysis in a sentence
> each.

---

**Original analysis (superseded) · researched across Electron, Google, and vendor documentation after six failed fixes**

---

## The symptom

Signing in to LinkedIn (and Microsoft, and others) inside the in-app browser
loops: credentials accepted, 2FA genuinely completes, then the page reloads
signed-out at `?errorKey=auth_context_expired`. No client-side error. No failed
request. Nothing in the log.

## What was ruled out, by measurement

Six fixes shipped. Four were real bugs worth fixing. **None was the cause.**

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Cookies not persisting | **No** | 8 LinkedIn cookies on disk; `Cookies` DB 262 KB, written today |
| Session cookies dropped | **No** | Set/read round-trip passes; `session=true` retained |
| Cache broken | **No** | `Cache/`, `Code Cache/`, `IndexedDB/`, `Local Storage/` all present and current |
| Client-hint mismatch (`sec-ch-ua` vs `userAgentData`) | Real bug, **not the cause** | Fixed and verified consistent; loop persists |
| Popup denied → no `window.opener` | Real bug, **not the cause** | Fixed; loop persists |
| `Accept-Language` vs `navigator.languages` | Real bug, **not the cause** | Fixed and verified; loop persists |
| Guest `setUserAgent` dropping languages | Real bug, **not the cause** | Fixed; loop persists |
| Third-party cookies blocked | **No** — probably never blocked | Real cross-site `Set-Cookie` over HTTP is **accepted** |

**A methodological note that matters more than any single item above.** Five of
those investigations measured the *instrument* rather than the system:

1. A `webRequest.onBeforeSendHeaders` listener in the probe **replaced** the
   app's own (Electron allows one per session), then reported the app's headers
   missing.
2. Probing a `data:` URL reported `navigator.userAgentData` absent — it is
   exposed only in **secure contexts**.
3. `navigator.webdriver: true` came from Playwright's launch flags, not the app.
4. A `BrowserWindow` stood in for a `<webview>` guest — **different browsing
   contexts**, and the difference turned out to be the whole question.
5. `session.cookies.set()` **bypasses** the third-party cookie policy, so it
   "verified" a fix for a policy it never exercised.

Each looked like a finding and was reported with more confidence than the
evidence carried.

---

## What the research actually says

### 1. Embedded webviews are blocked by POLICY, not by accident

Google has blocked OAuth authorization requests from embedded webviews since
2017, hardened on **24 July 2023**: sign-in from an embedded webview returns
`disallowed_useragent`. The stated reason is that embedded webview libraries are
highly customisable and can expose the login page to man-in-the-middle attacks —
the host app can read the password field.

This is the decisive framing. **It is not a bug to be fixed, and not something
to spoof around.** A host application cannot prove to an identity provider that
it is not reading the credentials, because it genuinely could. Every hour spent
making our headers look more like Chrome was spent on the wrong problem: the
providers are not mistaking us for a bot, they are correctly identifying us as
an embedded browser and declining.

### 2. LinkedIn specifically misbehaves in an Electron `<webview>`

`electron/electron#41472` — "LinkedIn loaded in WebView prompting users to sign
in with a passkey", a documented sign-in loop where **LinkedIn is the only site
exhibiting the behaviour**. Closed **not planned**, with no root cause and no
workaround from maintainers.

So: known, reproduced by others, unresolved.

### 3. Electron itself says do not use `<webview>`

From Electron's own documentation:

> Electron's `webview` tag is based on Chromium's `webview`, which is undergoing
> dramatic architectural changes. This impacts the stability of webviews,
> including **rendering, navigation, and event routing**. We currently recommend
> not using the webview tag and considering alternatives, like `iframe`, a
> `WebContentsView`, or an architecture that avoids embedded content altogether.

Navigation and event routing are precisely the areas our symptom lives in.

---

## The fix path

### Step 0 — settle whether the guest is the problem (30 minutes)

`e2e/browser/window-vs-webview.mjs` opens LinkedIn in a real `BrowserWindow` on
**the same session partition** the app browses in, and watches for `li_at`.

- **Signs in** → the `<webview>` guest is the problem. Do step 1.
- **Fails too** → not the guest. Skip step 1 entirely; it is policy (step 2).

This exists so a substantial migration is not started on a hunch. Running it
first is the whole lesson of the six fixes above.

### Step 1 — migrate the browser surface to `WebContentsView`

Only if step 0 says the guest is at fault.

- It is Electron's own recommendation, so this is aligning with the supported
  architecture rather than working around it.
- **The agent keeps working.** `WebContentsView` exposes `webContents` the same
  way `BrowserWindow` does, so `browserControl.ts` — navigate, screenshot,
  extract, deep-read — carries over. This is the constraint that rules out
  "just open it in Safari": a page the workspace cannot see is not a feature.
- Views are positioned from the main process rather than laid out in the DOM,
  so the tab strip stays React and the content area becomes a managed view.

### Step 2 — accept the policy, and use the sanctioned path where one exists

For providers that block embedded browsers by policy, no amount of engineering
inside the webview is legitimate. The supported pattern is **system browser +
loopback redirect with PKCE** — and **this app already implements exactly that**
for Gmail and Outlook mail (`src/main/mail/oauth/`). It works, it is allowed,
and the session lands back in the app.

Where that leaves each case:

| Need | Path |
|---|---|
| Mail (Gmail, Outlook) | Already solved — PKCE loopback, working today |
| A provider with a public OAuth API | Same pattern; needs a client id per provider |
| Agent reading a site the user is signed into | Works wherever the site permits an embedded session — most of the web |
| **LinkedIn interactive sign-in** | Blocked by their policy; no legitimate in-webview fix |

### What NOT to do

- **Do not spoof harder.** Every identity signal we now send is consistent, and
  the remaining gap is not something a header can close. Attempting to evade
  detection would also breach these providers' terms.
- **Do not open sign-in in Safari as the general answer.** It defeats the
  product: the agent cannot drive, screenshot or inherit a session it cannot
  see.

---

## The honest bottom line

The four consistency bugs fixed along the way were real and worth having. But
the reason sign-in fails is most likely **not a defect in our code at all** — it
is that major identity providers deliberately refuse embedded browsers, and
Electron's `<webview>` is additionally a known-unstable embedding that LinkedIn
in particular breaks on.

That makes the goal achievable but narrower than "fix the login": know which of
the two it is (step 0), remove the unsupported embedding (step 1), and route the
genuinely-blocked providers through the sanctioned flow the app already has
(step 2).
