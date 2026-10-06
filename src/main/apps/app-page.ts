/**
 * What the test driver (app-driver.ts) runs INSIDE an app's page: finding an
 * element the way a person would name it, checking an expectation once, and
 * showing where the pointer is. A string, because it is sent into the page;
 * it reads the page and never changes the app's own state.
 *
 * Called as PAGE(op, arg) and returns plain JSON.
 */
export const PAGE = String.raw`async (op, a) => {
  const say = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  const vis = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) !== 0
  }
  const labels = (el) => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.tagName === 'INPUT' && /button|submit/.test(el.type) ? el.value : ''].filter(Boolean).map(say)
  const name = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')
  const what = (spec) => (spec.target ? '"' + spec.target + '"' : 'the text "' + spec.text + '"')
  const find = (spec) => {
    if (spec.target) {
      try { return { els: [...document.querySelectorAll(spec.target)] } } catch { return { error: 'Not a valid selector: ' + spec.target } }
    }
    const want = spec.text.toLowerCase()
    const all = [...document.querySelectorAll('body *')].filter((el) => !/^(SCRIPT|STYLE|WOS-CURSOR)$/.test(el.tagName))
    let hits = all.filter((el) => labels(el).some((s) => s.toLowerCase() === want))
    if (!hits.length) hits = all.filter((el) => labels(el).some((s) => s.toLowerCase().includes(want)))
    // The innermost match: a card that contains the button is not the button.
    return { els: hits.filter((el) => !hits.some((o) => o !== el && el.contains(o))) }
  }
  const textOf = (el) => say('value' in el && el.tagName !== 'BUTTON' && el.tagName !== 'LI' ? el.value : el.innerText || el.textContent)

  if (op === 'ready') return document.readyState === 'complete' && !window.__wosStale && typeof window.wos === 'object'
  if (op === 'stale') { window.__wosStale = true; return true }
  if (op === 'errors') return (window.__wosErrors || []).slice()
  if (op === 'uncursor') { document.querySelectorAll('wos-cursor').forEach((c) => c.remove()); return true }
  if (op === 'cursor') {
    const c = document.createElement('wos-cursor')
    c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid var(--accent, #d97757);background:rgba(217,119,87,.18);transition:transform .45s ease,opacity .45s ease;left:' + a.x + 'px;top:' + a.y + 'px'
    document.documentElement.appendChild(c)
    requestAnimationFrame(() => { c.style.transform = 'scale(1.8)'; c.style.opacity = '0' })
    setTimeout(() => c.remove(), 500)
    return true
  }
  if (op === 'locate') {
    const f = find(a)
    if (f.error) return { error: f.error }
    const el = f.els.find(vis)
    if (!el) return { missing: f.els.length ? 'Found ' + what(a) + ' but it is not visible' : 'Nothing matches ' + what(a) }
    el.scrollIntoView({ block: 'center', inline: 'center' })
    const r = el.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const hit = document.elementFromPoint(x, y)
    const covered = hit && hit !== el && !el.contains(hit) && !hit.contains(el) ? name(hit) : null
    return { x, y, covered }
  }
  if (op === 'select') {
    const el = document.activeElement
    if (!el || el === document.body) return false
    if (!a.clear) return true
    if (typeof el.select === 'function') el.select()
    else if (el.isContentEditable) { const g = document.createRange(); g.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(g) }
    return true
  }
  if (op === 'expect') {
    const f = find(a)
    if (f.error) return { ok: false, why: f.error }
    const shown = f.els.filter(vis)
    if (typeof a.count === 'number') return shown.length === a.count ? { ok: true } : { ok: false, why: 'Found ' + shown.length + ' of ' + what(a) + ' on screen, expected ' + a.count }
    if (a.visible === false) return shown.length ? { ok: false, why: what(a) + ' is still on screen' } : { ok: true }
    if (!shown.length) return { ok: false, why: f.els.length ? what(a) + ' is there but not visible' : 'Nothing matches ' + what(a) }
    if (typeof a.contains === 'string' && !shown.some((el) => textOf(el).toLowerCase().includes(a.contains.toLowerCase()))) return { ok: false, why: what(a) + ' says "' + textOf(shown[0]).slice(0, 120) + '", expected it to contain "' + a.contains + '"' }
    if (typeof a.equals === 'string' && !shown.some((el) => textOf(el) === say(a.equals))) return { ok: false, why: what(a) + ' is "' + textOf(shown[0]).slice(0, 120) + '", expected "' + a.equals + '"' }
    return { ok: true }
  }
  return null
}`
