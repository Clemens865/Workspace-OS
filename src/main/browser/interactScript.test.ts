import { describe, it, expect } from 'vitest'
import {
  jsString,
  dismissCookiesScript,
  clickScript,
  scrollScript,
  waitForScript,
  typeScript,
  normalizeTimeout,
  COOKIE_ACCEPT_SELECTORS,
  COOKIE_ACCEPT_TEXTS,
} from './interactScript'

describe('jsString (escaping — proves inputs are DATA, not code)', () => {
  it('wraps a plain value in single quotes', () => {
    expect(jsString('hi')).toBe("'hi'")
  })

  it('escapes a single quote so it cannot close the literal', () => {
    // `'; alert(1); '` must NOT introduce a real quote/newline into the script.
    const out = jsString("'; alert(1); '")
    expect(out.startsWith("'")).toBe(true)
    expect(out.endsWith("'")).toBe(true)
    // The interior quotes are backslash-escaped — no bare `'` breaks out.
    expect(out.slice(1, -1)).not.toMatch(/(?<!\\)'/)
    expect(out).toContain("\\'")
  })

  it('escapes backslashes and newlines', () => {
    expect(jsString('a\\b')).toContain('\\\\')
    expect(jsString('a\nb')).toContain('\\n')
    expect(jsString('a\rb')).toContain('\\r')
  })

  it('caps + coerces non-strings to an empty literal', () => {
    expect(jsString(undefined)).toBe("''")
    expect(jsString(42)).toBe("''")
    expect(jsString({})).toBe("''")
    expect(jsString('x'.repeat(1000)).length).toBeLessThanOrEqual(402)
  })
})

describe('dismissCookiesScript (fixed CMP coverage)', () => {
  const script = dismissCookiesScript()

  it('is a self-contained string that clicks + returns {clicked,label}', () => {
    expect(typeof script).toBe('string')
    expect(script).toContain('.click()')
    expect(script).toContain('clicked')
  })

  it('embeds the known CMP selectors', () => {
    for (const sel of [
      '#onetrust-accept-btn-handler',
      '.cc-allow',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    ]) {
      expect(script).toContain(sel)
    }
    expect(COOKIE_ACCEPT_SELECTORS.length).toBeGreaterThan(8)
  })

  it('embeds EN + DE accept text needles', () => {
    for (const t of ['accept all', 'agree', 'alle akzeptieren', 'zustimmen', 'einverstanden']) {
      expect(script.toLowerCase()).toContain(t)
    }
    expect(COOKIE_ACCEPT_TEXTS).toContain('accept all')
    expect(COOKIE_ACCEPT_TEXTS).toContain('alle akzeptieren')
  })
})

describe('clickScript', () => {
  it('embeds an escaped selector + lowercased text as DATA', () => {
    const s = clickScript('button.buy', 'Products')
    expect(s).toContain("'button.buy'")
    expect(s).toContain("'products'")
    expect(s).toContain('.click()')
  })

  it('neutralises a hostile selector/text', () => {
    const s = clickScript("'); fetch('//evil') //", "');alert(1);('")
    // No raw unescaped quote can terminate the literals.
    expect(s).toContain("\\'")
    expect(s).not.toContain("fetch('//evil')")
  })
})

describe('scrollScript (validated direction/amount)', () => {
  it('handles top/bottom', () => {
    expect(scrollScript('top', undefined)).toContain("dir = 'top'")
    expect(scrollScript('bottom', undefined)).toContain("dir = 'bottom'")
  })

  it('clamps + truncates a numeric `by`, ignoring junk', () => {
    expect(scrollScript(undefined, 500)).toContain('by = 500')
    expect(scrollScript(undefined, 10 ** 9)).toContain('by = 100000')
    expect(scrollScript(undefined, -(10 ** 9))).toContain('by = -100000')
    // Non-numbers become 0 — no injection surface.
    expect(scrollScript(undefined, '900; alert(1)')).toContain('by = 0')
    expect(scrollScript('evil', NaN)).toContain("dir = ''")
  })
})

describe('waitForScript (capped timeout)', () => {
  it('embeds the escaped selector/text and a numeric deadline', () => {
    const s = waitForScript('#main', 'Loaded', 3000)
    expect(s).toContain("'#main'")
    expect(s).toContain("'loaded'")
    expect(s).toContain('Date.now() + 3000')
    expect(s).toContain('Promise')
  })
})

describe('normalizeTimeout', () => {
  it('defaults + caps to sane bounds', () => {
    expect(normalizeTimeout(undefined)).toBe(8000)
    expect(normalizeTimeout(1000)).toBe(1000)
    expect(normalizeTimeout(999999)).toBe(30000)
    expect(normalizeTimeout(-5)).toBe(0)
    expect(normalizeTimeout('evil')).toBe(8000)
  })
})

describe('typeScript (agent text is DATA into .value)', () => {
  it('assigns the escaped value + dispatches input/change', () => {
    const s = typeScript('input[name=q]', 'hello world')
    expect(s).toContain("'input[name=q]'")
    expect(s).toContain("'hello world'")
    expect(s).toContain('el.value = val')
    expect(s).toContain('input')
    expect(s).toContain('change')
  })

  it('cannot inject code through the value', () => {
    const s = typeScript('#x', "'; document.cookie //")
    expect(s).toContain('el.value = val')
    // The hostile quote is backslash-escaped, so `val` stays a single string
    // literal — the `;` and comment never become live statements.
    expect(s).toContain("val = '\\'; document.cookie //'")
    expect(s).toContain("\\'")
  })
})
