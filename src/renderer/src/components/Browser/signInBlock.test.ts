import { describe, it, expect } from 'vitest'
import { detectSignInBlock } from './signInBlock'

/**
 * The risk here is not missing a refusal — it is putting a scary bar over a
 * working page. So most of these are about NOT firing.
 */

// The exact url Clemens landed on, trimmed of its query.
const REAL_GOOGLE_REJECT =
  'https://accounts.google.com/v3/signin/rejected?access_type=offline&app_domain=https%3A%2F%2Fclerk.higgsfield.ai&client_id=565486769470-x.apps.googleusercontent.com&flowName=GeneralOAuthFlow'

describe('detectSignInBlock', () => {
  it('recognises the page Google actually shows', () => {
    const b = detectSignInBlock(REAL_GOOGLE_REJECT)
    expect(b?.provider).toBe('Google')
    expect(b?.message).toContain('inside another app')
  })

  it('recognises the help page reached from that screen', () => {
    expect(detectSignInBlock('https://support.google.com/accounts/answer/7675428?hl=de')?.provider).toBe('Google')
  })

  it('recognises the older rejection path', () => {
    expect(detectSignInBlock('https://accounts.google.com/signin/v2/deniedsigninrejected?x=1')?.provider).toBe('Google')
  })

  it('recognises Microsoft refusing', () => {
    expect(
      detectSignInBlock('https://login.microsoftonline.com/common/oauth2/authorize?error=unsupported_browser')?.provider,
    ).toBe('Microsoft')
  })

  /** The sign-in page itself is not a refusal — this is the common case. */
  it('stays quiet on the normal Google sign-in form', () => {
    expect(detectSignInBlock('https://accounts.google.com/v3/signin/identifier?client_id=x&flowName=GeneralOAuthFlow')).toBeNull()
  })

  it('stays quiet on the consent screen', () => {
    expect(detectSignInBlock('https://accounts.google.com/signin/oauth/consent?authuser=0')).toBeNull()
  })

  it('stays quiet on an ordinary page that merely mentions signin', () => {
    expect(detectSignInBlock('https://example.com/blog/why-signin-rejected-happens')).toBeNull()
  })

  it('stays quiet on a Google search for the phrase', () => {
    expect(detectSignInBlock('https://www.google.com/search?q=signin/rejected')).toBeNull()
  })

  it('stays quiet on nothing at all', () => {
    expect(detectSignInBlock('')).toBeNull()
    expect(detectSignInBlock(undefined as unknown as string)).toBeNull()
  })

  it('says something a person can act on, not an error code', () => {
    const b = detectSignInBlock(REAL_GOOGLE_REJECT)
    expect(b?.message).toMatch(/email or password sign-in/)
    expect(b?.message).not.toMatch(/user.?agent|Chromium|OAuth/i)
  })
})
