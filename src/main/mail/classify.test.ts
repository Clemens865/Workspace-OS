import { describe, it, expect } from 'vitest'
import { classify, matchRule, domainMatches, hasUnsubscribeLink, type MailRule, type ClassifiableMessage } from './classify'

/**
 * The two mistakes that motivated this, tested as the two mistakes.
 *
 * "Bulk or not" read off List-Unsubscribe got GitHub wrong in one direction and
 * marketing mail wrong in the other, so the fixtures here are deliberately the
 * awkward ones rather than an obvious newsletter and an obvious friend.
 */

const msg = (over: Partial<ClassifiableMessage>): ClassifiableMessage => ({
  subject: '',
  from: [{ name: '', address: 'someone@example.com' }],
  ...over,
})

describe('classify', () => {
  it('reads a plain human mail as personal', () => {
    const m = msg({
      subject: 'Re: Thursday',
      from: [{ name: 'Anna Weber', address: 'anna@miele.de' }],
      text: 'Does 14:00 still work for you?',
    })
    expect(classify(m).category).toBe('personal')
  })

  it('reads marketing mail with a body unsubscribe link as a newsletter', () => {
    const m = msg({
      subject: 'Your weekly digest is here',
      from: [{ name: 'Substack', address: 'hello@substack.com' }],
      html: '<p>Lots of news</p><a href="https://substack.com/unsubscribe?id=9">Unsubscribe</a>',
    })
    expect(classify(m).category).toBe('newsletter')
  })

  /** The header alone said newsletter. It is a reply on your own issue. */
  it('does not call a GitHub notification a newsletter', () => {
    const m = msg({
      subject: '[Clemens865/Workspace-OS] Fix the calendar (#42)',
      from: [{ name: 'Alex Example', address: 'notifications@github.com' }],
      headers: {
        'list-unsubscribe': '<https://github.com/notifications/unsubscribe/ABC>',
        'list-id': 'Clemens865/Workspace-OS <workspace-os.github.com>',
      },
      text: 'clemens commented on this issue.',
    })
    expect(classify(m).category).toBe('notification')
  })

  it('still catches a campaign that carries list headers', () => {
    const m = msg({
      subject: 'This week in AI · issue #12',
      from: [{ name: 'TLDR', address: 'dan@tldrnewsletter.com' }],
      headers: { 'list-unsubscribe': '<mailto:x@y.z>' },
    })
    expect(classify(m).category).toBe('newsletter')
  })

  it('reads a receipt from a no-reply address as a notification', () => {
    const m = msg({
      subject: 'Your invoice from Anthropic',
      from: [{ name: 'Anthropic', address: 'no-reply@anthropic.com' }],
      text: 'Thanks for your payment.',
    })
    expect(classify(m).category).toBe('notification')
  })

  it('reads an out-of-office as a notification, never as a reply owed', () => {
    const m = msg({
      subject: 'Automatic reply: Re: Thursday',
      from: [{ name: 'Anna Weber', address: 'anna@miele.de' }],
      headers: { 'auto-submitted': 'auto-replied' },
    })
    expect(classify(m).category).toBe('notification')
  })

  it('says why, in words the person can disagree with', () => {
    const m = msg({ html: '<a href="https://x.com/unsubscribe">stop</a>' })
    expect(classify(m).reason).toBe('has an unsubscribe link')
  })
})

/**
 * The person's rules. Their example, verbatim: do not treat GitHub mail as a
 * newsletter.
 */
describe('rules', () => {
  const GITHUB: MailRule = { id: 'r1', domain: 'github.com', category: 'notification' }

  it('lets a rule override what the signals concluded', () => {
    const m = msg({
      subject: 'Weekly digest of your repositories',
      from: [{ name: '', address: 'notifications@github.com' }],
      html: '<a href="https://github.com/unsubscribe">Unsubscribe</a>',
    })
    expect(classify(m).category).toBe('newsletter')
    const ruled = classify(m, [GITHUB])
    expect(ruled.category).toBe('notification')
    expect(ruled.ruleId).toBe('r1')
    expect(ruled.reason).toBe('your rule: from github.com → notification')
  })

  it('covers subdomains, because services send from them', () => {
    const m = msg({ from: [{ name: '', address: 'noreply@mail.github.com' }] })
    expect(classify(m, [GITHUB]).ruleId).toBe('r1')
    expect(domainMatches('mail.github.com', 'github.com')).toBe(true)
  })

  /** notgithub.com is not github.com — suffix matching without the dot is a hole. */
  it('does not match a domain that merely ends the same way', () => {
    expect(domainMatches('notgithub.com', 'github.com')).toBe(false)
    const m = msg({ from: [{ name: '', address: 'x@notgithub.com' }] })
    expect(classify(m, [GITHUB]).ruleId).toBeUndefined()
  })

  it('matches on the sender name as well as the address', () => {
    const rule: MailRule = { id: 'r2', from: 'Anna', category: 'personal' }
    const m = msg({ from: [{ name: 'Anna Weber', address: 'a@b.c' }], headers: { 'list-id': 'x' } })
    expect(classify(m, [rule]).category).toBe('personal')
  })

  it('matches on the subject', () => {
    const rule: MailRule = { id: 'r3', subject: 'invoice', category: 'notification' }
    expect(matchRule(msg({ subject: 'Your Invoice #4' }), [rule])?.id).toBe('r3')
  })

  it('takes the first matching rule, so order is the person’s', () => {
    const a: MailRule = { id: 'a', domain: 'github.com', category: 'notification' }
    const b: MailRule = { id: 'b', domain: 'github.com', category: 'newsletter' }
    expect(matchRule(msg({ from: [{ name: '', address: 'x@github.com' }] }), [a, b])?.id).toBe('a')
  })

  it('ignores a disabled rule', () => {
    expect(matchRule(msg({ from: [{ name: '', address: 'x@github.com' }] }), [{ ...GITHUB, enabled: false }])).toBeNull()
  })

  /** A rule with nothing to match on would silently reclassify the whole inbox. */
  it('ignores a rule with no conditions', () => {
    expect(matchRule(msg({ subject: 'anything' }), [{ id: 'empty', category: 'newsletter' }])).toBeNull()
  })
})

describe('hasUnsubscribeLink', () => {
  it('finds it in an href', () => {
    expect(hasUnsubscribeLink({ subject: '', from: [], html: '<a href="/u/unsubscribe/9">x</a>' })).toBe(true)
  })

  it('finds it as a bare url', () => {
    expect(hasUnsubscribeLink({ subject: '', from: [], text: 'stop: https://a.b/unsubscribe?x=1' })).toBe(true)
  })

  it('finds the German one', () => {
    expect(hasUnsubscribeLink({ subject: '', from: [], text: 'Abmelden können Sie sich hier https://a.b/x' })).toBe(true)
  })

  /**
   * The word alone is not the signal. Mail ABOUT a subscription says
   * "unsubscribe" without offering to.
   */
  it('is not fooled by the word on its own', () => {
    expect(
      hasUnsubscribeLink({ subject: '', from: [], text: 'You asked how to unsubscribe from our service.' }),
    ).toBe(false)
  })
})

/**
 * The inbox lives in DACH. A campaign detector that only speaks English waved
 * "Sonderangebot – nur heute 20% Rabatt" into the needs-a-reply pile, which is
 * what filled the cockpit with offers. German marketing stems match as
 * substrings because German compounds ("Frühbucherrabatt") defeat \b.
 */
describe('classify · German campaigns', () => {
  it('reads a German offer with a list header as a newsletter', () => {
    const m = msg({
      subject: 'Sonderangebot – nur heute 20% Rabatt',
      from: [{ name: 'Zalando', address: 'style@mail.zalando.de' }],
      headers: { 'list-unsubscribe': '<mailto:leave@mail.zalando.de>' },
    })
    expect(classify(m).category).toBe('newsletter')
  })

  it('catches a compound word the ASCII word boundary would miss', () => {
    const m = msg({
      subject: 'Frühbucherrabatt sichern!',
      from: [{ name: 'TUI', address: 'reisen@news.tui.at' }],
      html: '<a href="https://news.tui.at/abmelden">Hier abmelden</a>',
    })
    expect(classify(m).category).toBe('newsletter')
  })

  it('does not read "Transaktion" as a campaign — a bank notice stays a notification', () => {
    const m = msg({
      subject: 'Ihre Transaktion war erfolgreich',
      from: [{ name: 'N26', address: 'no-reply@n26.com' }],
      headers: { 'list-unsubscribe': '<mailto:x@n26.com>' },
    })
    expect(classify(m).category).toBe('notification')
  })

  it('a person writing about an Angebot, with no bulk signals, stays personal', () => {
    const m = msg({
      subject: 'Angebot für das Kamera-Projekt',
      from: [{ name: 'Anna Weber', address: 'anna@miele.de' }],
      text: 'Anbei unser Angebot — passt der Preis für Sie?',
    })
    expect(classify(m).category).toBe('personal')
  })
})
