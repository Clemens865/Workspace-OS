/**
 * Conservative, DOM-free HTML sanitizer for the markdown preview surface.
 *
 * This MIRRORS `sanitizeHtml` in src/main/mail/message-parser.ts verbatim (same
 * passes, same guarantees). The mail copy lives in the main bundle (alongside
 * mailparser); this copy lives in the renderer so the preview does NOT drag the
 * whole main/mail module (and mailparser) into the web bundle. Both are pure
 * string passes with zero dependencies, so they cannot behave differently — the
 * preview test asserts the same security behaviour as the mail test.
 *
 * The result is additionally rendered inside a sandboxed, CSP-locked iframe, so
 * this is defence-in-depth, not the sole barrier.
 *
 * Removes: <script>/<style>/<iframe>/<object>/<embed>/<link>/<meta>/<base>,
 * on* event-handler attributes, javascript:/vbscript: URLs, and neutralises
 * remote resource loads (src/srcset/background/poster/url()) so nothing is
 * fetched from the network when the content is displayed.
 */
export function sanitizeHtml(input: string): { html: string; hadRemote: boolean } {
  let hadRemote = false
  let html = input

  // 1. Drop entire dangerous elements (open→close, and self-closed/void forms).
  const dropTags = ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'noscript', 'template', 'frame', 'frameset']
  for (const tag of dropTags) {
    html = html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), '')
    html = html.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '')
  }
  // Head-only elements that can leak or redirect: <link>, <meta http-equiv>, <base>.
  html = html.replace(/<(?:link|meta|base)\b[^>]*>/gi, '')

  // 2. Strip on* event-handler attributes (onclick, onload, onerror, …).
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')

  // 3. Neutralise javascript:/vbscript: URLs anywhere in an attribute value.
  html = html.replace(/(href|src|action|formaction)\s*=\s*("|')\s*(?:javascript|vbscript):[^"']*\2/gi, '$1=$2#$2')

  // 4. Block remote resource loads. Rewrite remote src/srcset/background/poster
  //    to a blocked placeholder so the browser never issues the request.
  const remoteAttr = /\s(src|srcset|background|poster)\s*=\s*("|')(https?:\/\/|\/\/)[^"']*\2/gi
  html = html.replace(remoteAttr, (_m, attr) => {
    hadRemote = true
    return ` data-blocked-${String(attr).toLowerCase()}="1"`
  })
  // CSS url(...) references to remote content inside style="" attributes.
  const remoteUrl = /url\(\s*['"]?(https?:\/\/|\/\/)[^)'"]*['"]?\s*\)/gi
  if (remoteUrl.test(html)) {
    hadRemote = true
    html = html.replace(remoteUrl, "url('')")
  }

  return { html, hadRemote }
}
