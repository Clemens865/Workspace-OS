/**
 * Recognising a sign-in that an identity provider will not allow here.
 *
 * Google refuses sign-in from browsers "in eine andere Anwendung eingebettet"
 * and from those "durch Software-Automatisierung ... gesteuert", and tells app
 * developers to move to browser-based OAuth rather than to look more like
 * Chrome. That is their documented policy, not a bug on either side, and it is
 * not going to be argued with.
 *
 * What IS a bug on our side is a dead end that looks like a broken app. The
 * page lands on a refusal, the person tries again, tries a different password,
 * and eventually decides the browser is faulty. So the browser says what
 * happened and what still works — which is nearly always "use the site's own
 * email sign-in", because the Google button is a login METHOD and the session
 * we actually need belongs to the site.
 *
 * Matching is deliberately narrow. A false positive puts a scary bar over a
 * working page, which is worse than the silence it replaced.
 */

export type SignInProvider = 'Google' | 'Microsoft' | 'Apple'

export interface SignInBlock {
  provider: SignInProvider
  /** One line, plain, no jargon — shown as-is. */
  message: string
}

interface Rule {
  provider: SignInProvider
  /** Must match the URL — the reliable half, since providers redirect to a
   *  dedicated path when they refuse. */
  url: RegExp
}

const RULES: Rule[] = [
  // accounts.google.com/v3/signin/rejected — where the "browser may not be
  // secure" page lives. `deniedsigninrejected` is the older form.
  { provider: 'Google', url: /accounts\.google\.com\/.*\b(signin\/rejected|deniedsigninrejected)/i },
  // Google's own help page, reached from that screen's "Weitere Informationen".
  { provider: 'Google', url: /support\.google\.com\/accounts\/answer\/7675428/i },
  { provider: 'Microsoft', url: /login\.(microsoftonline|live)\.com\/.*\berror=.*unsupported_browser/i },
  { provider: 'Apple', url: /appleid\.apple\.com\/.*\bunsupported_browser/i },
]

const ADVICE: Record<SignInProvider, string> = {
  Google:
    'Google does not allow sign-in from a browser inside another app. If this site offers an email or password sign-in, use that — the site session is what matters here, not the Google one.',
  Microsoft:
    'Microsoft refused sign-in from a browser inside another app. If this site offers an email or password sign-in, use that instead.',
  Apple:
    'Apple refused sign-in from a browser inside another app. If this site offers an email or password sign-in, use that instead.',
}

/**
 * The refusal, or null.
 *
 * URL only. The page text was tempting — it says "may not be secure" in the
 * user's language — but it is translated, reworded, and the same phrase appears
 * on ordinary help pages about account security. A url path is stable and does
 * not need the page to have finished loading.
 */
export function detectSignInBlock(url: string): SignInBlock | null {
  const u = String(url ?? '')
  if (!u) return null
  for (const rule of RULES) {
    if (rule.url.test(u)) return { provider: rule.provider, message: ADVICE[rule.provider] }
  }
  return null
}
