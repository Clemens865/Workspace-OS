// The static checks a new figure must pass before it is shown. Ported from
// hairline's skills/hairline-create/validate.mjs (MIT, Lucas Marques): the same
// rules and messages, read in the browser instead of by Node. What it cannot
// check here (the kernel's hash, the bench) is not ours to change anyway: the
// app owns both. The look (look.md) still wants a person's eye.
// wos-design-check: names storage (the forbidden list below names it; nothing here uses it)
window.hairlineValidate = (function () {
  const LIMIT = 200
  // A figure's source without its comments (and, with words false, its strings), read the way JavaScript reads it.
  function bare(src, words = true) {
    let out = '', i = 0, prev = '', depth = 0
    const open = []
    const quoted = (q) => {
      const from = i
      while (i < src.length && src[i] !== q && (q === '`' ? !(src[i] === '$' && src[i + 1] === '{') : src[i] !== '\n')) i += src[i] === '\\' ? 2 : 1
      if (words) out += src.slice(from, i)
      if (q === '`' && src[i] === '$') { out += '${'; i += 2; open.push(depth++); prev = '{'; return }
      out += src[i] ?? ''; i++; prev = q
    }
    while (i < src.length) {
      const c = src[i], d = src[i + 1]
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') i++ }
      else if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; out += ' ' }
      else if (c === '/' && /^(?:|[(,=:[!&|?{};+\-*%<>~^])$/.test(prev)) {
        let j = i + 1, cls = false
        for (; j < src.length && src[j] !== '\n'; j++) {
          if (src[j] === '\\') j++
          else if (src[j] === '[') cls = true
          else if (src[j] === ']') cls = false
          else if (src[j] === '/' && !cls) break
        }
        out += src.slice(i, j + 1); i = j + 1; prev = ')'
      } else if (c === '"' || c === "'" || c === '`') { out += c; i++; quoted(c) }
      else if (c === '}' && open.length && depth - 1 === open[open.length - 1]) { depth--; open.pop(); out += c; i++; quoted('`') }
      else { if (c === '{') depth++; else if (c === '}') depth--; out += c; i++; if (!/\s/.test(c)) prev = c }
    }
    return out
  }
  const BAD = [
    ['text', /<\s*(?:text|tspan|textPath|foreignObject)\b|["'`](?:text|tspan|textPath|foreignObject)["'`]|\b(?:innerHTML|outerHTML|insertAdjacentHTML|innerText)\b/, 'rule 10. No words inside the figure, and no markup written as a string. Say it with geometry (a punch, a dot code, a bright edge); names go to read.textContent.'],
    ['paint', /stroke-width|strokeWidth|stroke-dasharray|-opacity|(?:fill|stroke)Opacity|["'`](?:fill|stroke|filter|style|color|stop-color|opacity)["'`]|\b(?:fill|stroke|filter|style|opacity)\s*:|\.style\b|(["'`])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\1|\b(?:rgba?|hsla?|oklch|oklab|color-mix)\(|drop-shadow|box-shadow|feDropShadow|feGaussianBlur|[Ll]inearGradient|[Rr]adialGradient|(?:linear|radial|conic)-gradient/, "rule 04. The figure sets a stroke width, colour, fill, opacity, filter, gradient or shadow of its own. Use the kernel's classes and nothing else: sil, hi, lo, nf, fo, dash, dot, dot m, dot off."],
    ['outside', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|https?:\/\/|\burl\(|<\/?script|<(?:link|img|iframe|style)\b|new\s+Image\b|createElement|\beval\s*\(|new\s+Function\b|localStorage|sessionStorage|\.cookie\b/, 'the figure reaches outside the file or makes nodes by hand. One self-contained file: no fetch, import, URL, script tag or storage, and every node comes from HL.mk.', /\bimport(?:\s*["'`({*]|\s+[\w$]+\s*(?:,|from\b))/],
    ['clock', /\bsetInterval\b|\bsetTimeout\b|\brequestAnimationFrame\b|\.animate\s*\(|<animate|["'`]animate(?:Transform|Motion)?["'`]|IntersectionObserver|\bmatchMedia\b/, 'rule 07. The figure runs a clock of its own. Move inside HL.register(stage, tick), with springs (stepS) or tweens (tset, tval); a delay is a tween\'s delay.'],
    ['hit', /getBoundingClientRect|elementFromPoint|elementsFromPoint|:hover|(?:addEventListener|\.on)\s*\(\s*(?:\w+\s*,\s*)?["'`](?:mouse|pointer|touch|click)|\bon(?:mouse|pointer|touch|click)\w*\s*=/, 'rule 01. The figure listens to the pointer itself or measures what is on screen. Take the pointer from HL.pointer(stage, { move, leave }) and test it against the rest or target pose, in world units.'],
  ]
  const NEED = [
    ['clock', /\bregister\s*\(/, "rule 07. The figure never joins the kernel's loop. Draw inside HL.register(stage, tick), and give its unregister to destroy."],
    ['hit', /\bpointer\s*\(/, 'the figure never listens to the pointer. Call HL.pointer(stage, { move, leave }) and answer it.'],
    ['readout', /\bread\.textContent\s*=/, 'the figure never writes the read-out. Set read.textContent to what is under the pointer, and to "rest" when nothing is.'],
    ['handle', /(?<![.\w$])set\s*[:(,}]/, 'mount must return { set(value), destroy() }, and set is missing. It takes the slider\'s number.'],
    ['handle', /(?<![.\w$])destroy\s*[:(,}]/, 'mount must return { set(value), destroy() }, and destroy is missing. It undoes everything mount did: bag.dispose.'],
  ]
  function tweens(shape) {
    const out = []
    for (const m of shape.matchAll(/(?<![\w$])tset\s*\(/g)) {
      let i = m.index + m[0].length, depth = 1, given = 1
      for (; i < shape.length && depth; i++) {
        const c = shape[i]
        if ('([{'.includes(c)) depth++
        else if (')]}'.includes(c)) depth--
        else if (c === ',' && depth === 1) given++
      }
      const call = shape.slice(m.index, i).replace(/\s+/g, ' ')
      if (given < 4 && !call.includes('...')) out.push(`tween: \`${call}\` is given ${given} of tset's four values: tset(tw, to, now, delay). Without the delay the tween's value is NaN and nothing is drawn. Give it 0 to start at once.`)
    }
    return out
  }
  function declared(code) {
    const say = (what) => `declare: the file must end with hairline({ name, means, rules, range, mount }). ${what}`
    const m = /\bhairline\s*\(\s*\{([\s\S]*?)\}\s*\)\s*;?\s*$/.exec(code.trimEnd())
    if (!m) return [say('That call is missing, or is not the last statement.')]
    const d = m[1], wrong = []
    const list = (key) => {
      const a = new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`).exec(d)
      return a ? a[1].split(',').map((s) => s.trim()).filter(Boolean).map(Number) : null
    }
    if (!/\bname:\s*(["'`])[a-z][a-z0-9-]{1,30}\1/.test(d)) wrong.push('name (lowercase letters, digits and hyphens)')
    if (!/\bmeans:\s*(["'`])(?:(?!\1).){1,140}\1/.test(d)) wrong.push('means (one sentence, at most 140 characters)')
    const rules = list('rules'), range = list('range')
    if (!rules || !rules.length || rules.some((r) => !Number.isInteger(r) || r < 1 || r > 10)) wrong.push('rules (the numbers, 1 to 10, of the rules it leans on)')
    const oneWay = range && range.length === 3 && range.every(Number.isFinite) && range[0] !== range[2] && (range[1] - range[0]) * (range[2] - range[1]) >= 0
    if (!oneWay) wrong.push("range (three numbers that move one way: the figure's value at intensity 0, 0.5 and 1)")
    if (!/\bmount\b/.test(d)) wrong.push('mount')
    return wrong.length ? [say(`Wrong or missing: ${wrong.join('; ')}.`)] : []
  }
  // The browser's own parser: a syntax error stops the figure before it draws. Compiled, never run.
  function parse(src) {
    try {
      new Function('HL', 'hairline', src)
      return []
    } catch (e) {
      return [`parse: the figure does not load: ${e.message}. Fix it in the figure.`]
    }
  }
  return function validate(src) {
    const code = bare(src), shape = bare(src, false), out = []
    out.push(...parse(src))
    for (const [id, re, say, empty] of BAD) if (re.test(code) || (empty && empty.test(shape))) out.push(`${id}: ${say}`)
    for (const [id, re, say] of NEED) if (!re.test(code)) out.push(`${id}: ${say}`)
    out.push(...tweens(shape))
    out.push(...declared(code))
    const lines = src.split('\n').length
    if (lines > LIMIT) out.push(`length: the figure is ${lines} lines and the limit is ${LIMIT}. A figure this long is usually two ideas: cut the concept down to one.`)
    return out
  }
})()
