// Make a figure: the person's idea becomes a new Hairline figure, written to
// the rules of hairline's hairline-create skill (MIT, Lucas Marques) on its
// engine. The AI writes only the figure; the checks (validate.js) run before
// it is shown, and what they find goes back once to be fixed. A figure runs
// in a frame of its own inside this app: scripts, no origin, no way to wos.
window.hairlineMaker = (function () {
  const $ = (id) => document.getElementById(id)
  const text = (id) => document.getElementById(id).textContent.trim()
  const kernel = () => text('hl-kernel')
  // The engine's index: the comment at the top of kernel.js, down to `var HL`.
  const index = () => kernel().split(/\n\s*var HL\b/)[0]

  const brief = () =>
    [
      'You make ONE new figure in the Hairline style: an isometric line drawing, built from rounded solids in a single stroke, that answers the pointer. You write only the figure: the engine (HL) and the page around it are fixed and given.',
      'THE FILE: plain JavaScript, at most 200 lines, in the shape of the two examples: take what you need from HL (`const { … } = HL`), define `mount({ stage, svg, read }, value)` returning `{ set, destroy }`, and end with `hairline({ name, means, rules, range, mount })` as the last statement. name: lowercase, one word or hyphenated. means: one sentence, at most 140 characters, saying what the figure shows. rules: the numbers of the rules it leans on most. range: the one number the slider drives, at intensity 0, 0.5 and 1, moving one way; mount\'s value and set(value) get that number. No imports, no comments needed beyond a short header.',
      'Pick the concept with the strongest rest pose; give the object the features that make it what it is (CONCEPTS). One figure, one idea.',
      'Answer with the figure\'s JavaScript only: no code fences, no explanation.',
      '',
      'THE TEN RULES (a figure that breaks one is not finished):',
      text('hl-rules'),
      '',
      'CONCEPTS:',
      text('hl-concepts'),
      '',
      'THE ENGINE (everything a figure may call; do not call anything else):',
      index(),
      '',
      'EXAMPLE, a continuous field (terrain.js):',
      text('hl-example-terrain'),
      '',
      'EXAMPLE, discrete items (riffle.js):',
      text('hl-example-riffle'),
    ].join('\n')

  const strip = (reply) => String(reply).replace(/^\s*```(?:js|javascript)?\s*\n/i, '').replace(/\n```\s*$/, '').trim()

  // The page a figure runs on: the engine, a small bench, the figure. Colours from the kit, so it sits in Workspace OS.
  function page(code, intensity, standalone) {
    const css = getComputedStyle(document.documentElement)
    const t = (n) => css.getPropertyValue(n).trim()
    const esc = (s) => s.replace(/<\/script/gi, '<\\/script')
    return `<!doctype html><html><head><meta charset="utf-8"><title>Hairline</title><style>
html,body{margin:0;background:${t('--paper')}}${standalone ? 'body{min-height:100vh;display:grid;place-items:center}#stage{width:min(720px,90vw)}' : '#stage{width:100%}'}
#stage{--hairline-plate:${t('--paper')};--hairline-hi:${t('--ink')};--hairline-edge:${t('--ink-2')};--hairline-mid:${t('--muted')};--hairline-lo:${t('--faint')}}
</style></head><body><div id="stage"></div>
<script>${esc(kernel())}</script>
<script>
(function(){
  var post=function(m){m.__hlfig=1;try{parent.postMessage(m,'*')}catch(e){}};
  addEventListener('error',function(e){post({type:'error',message:String((e.error&&e.error.message)||e.message)})});
  var handle=null,at=null;
  window.hairline=function(figure){
    var stage=document.getElementById('stage'),r=figure.range;
    at=function(i){return Math.round((i<=0.5?r[0]+(i/0.5)*(r[1]-r[0]):r[1]+((i-0.5)/0.5)*(r[2]-r[1]))*1000)/1000};
    HL.inject(document);
    stage.setAttribute('data-hairline',figure.name);stage.setAttribute('role','img');stage.setAttribute('aria-label',figure.means);
    var svg=HL.mk('svg',{viewBox:'0 0 400 320','aria-hidden':'true'},stage),txt=null;
    var read={get textContent(){return txt},set textContent(v){txt=v==null?'':String(v);post({type:'read',text:txt})}};
    handle=figure.mount({stage:stage,svg:svg,read:read},at(${Number(intensity) || 0.5}));
    if(txt===null)read.textContent='rest';
    post({type:'ready',name:figure.name,means:figure.means,rules:figure.rules,svg:svg.childNodes.length});
  };
  addEventListener('message',function(e){if(e.source===parent&&e.data&&e.data.type==='intensity'&&handle)handle.set(at(e.data.value))});
})();
</script>
<script type="module">
${esc(code)}
</script></body></html>`
  }

  // Run a figure in a frame of its own; resolves with what it says when it is up, or rejects with its error.
  function run(host, code, intensity, onRead, thumbnail = false) {
    host.innerHTML = ''
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts')
    frame.className = thumbnail ? 'mini' : 'live'
    frame.srcdoc = page(code, intensity, false)
    host.appendChild(frame)
    return new Promise((ok, fail) => {
      const done = setTimeout(() => {
        cleanup()
        fail(new Error('The figure did not draw (it never called hairline(), or it stopped before).'))
      }, 6000)
      const onMsg = (e) => {
        if (e.source !== frame.contentWindow || !e.data || e.data.__hlfig !== 1) return
        if (e.data.type === 'read') onRead?.(e.data.text)
        if (e.data.type === 'error') { cleanup(); fail(new Error(e.data.message)) }
        if (e.data.type === 'ready') { clearTimeout(done); ok({ ...e.data, frame }) }
      }
      const cleanup = () => { clearTimeout(done); removeEventListener('message', onMsg) }
      addEventListener('message', onMsg)
      frame._cleanup = () => removeEventListener('message', onMsg)
    })
  }

  let current = null // { id?, idea, code, name, means, frame }

  const busy = (on, status) => {
    $('make-busy').hidden = !on
    if (status) $('make-status').textContent = status
    $('make-go').disabled = on
  }
  const problems = (list) => {
    $('make-problems').hidden = !list.length
    $('make-problems').innerHTML = list.length ? '<strong>Not finished yet:</strong><br>' + list.map((p) => '• ' + p.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])).join('<br>') : ''
  }

  async function ask(prompt) {
    return strip(await wos.ai.complete(prompt, { system: brief() }))
  }

  // Draw (or change), check, fix once, show.
  async function draw(prompt) {
    problems([])
    busy(true, 'Drawing… (this takes a minute)')
    try {
      let code = await ask(prompt)
      let found = hairlineValidate(code)
      if (found.length) {
        busy(true, 'Checking it against the rules, and fixing…')
        code = await ask(`Here is the figure:\n${code}\n\nThe checks found:\n${found.map((f) => '- ' + f).join('\n')}\n\nFix every one, changing nothing else. Answer with the whole figure only.`)
        found = hairlineValidate(code)
      }
      if (found.length) {
        current = { ...(current || {}), code }
        problems(found)
        return
      }
      let shown
      try {
        shown = await run($('make-stage'), code, $('make-intensity').value, (t) => ($('make-readout').textContent = t))
      } catch (e) {
        busy(true, 'It stopped while drawing; fixing…')
        code = await ask(`Here is the figure:\n${code}\n\nIt passes the checks but stops when it runs, with: ${e.message}\n\nFix it, changing nothing else. Answer with the whole figure only.`)
        const again = hairlineValidate(code)
        if (again.length) return problems(again)
        shown = await run($('make-stage'), code, $('make-intensity').value, (t) => ($('make-readout').textContent = t))
      }
      current = { ...(current || {}), code, name: shown.name, means: shown.means, frame: shown.frame }
      $('make-empty').hidden = true
      $('make-stage').hidden = false
      $('make-result').hidden = false
      $('make-name').textContent = shown.name
      $('make-means').textContent = shown.means
      $('idea-box').hidden = true
      $('change-box').hidden = false
      $('make-new').hidden = false
      $('make-go').textContent = 'Change it'
    } catch (e) {
      problems([e.message])
    } finally {
      busy(false)
    }
  }

  async function figures() {
    return (await wos.storage.get('figures')) || []
  }

  function reset() {
    current = null
    $('make-stage').innerHTML = ''
    $('make-stage').hidden = true
    $('make-empty').hidden = false
    $('make-result').hidden = true
    $('make-readout').textContent = ''
    $('idea-box').hidden = false
    $('change-box').hidden = true
    $('make-new').hidden = true
    $('make-delete').hidden = true
    $('make-go').textContent = 'Draw it'
    $('idea').value = ''
    $('change').value = ''
    problems([])
  }

  $('make-go').onclick = () => {
    if (current?.code && !$('change-box').hidden) {
      const change = $('change').value.trim()
      if (!change) return $('change').focus()
      $('change').value = ''
      return draw(`Here is the figure:\n${current.code}\n\nChange: ${change}\n\nKeep everything else, and every rule. Answer with the whole figure only.`)
    }
    const idea = $('idea').value.trim()
    if (!idea) return $('idea').focus()
    current = { idea }
    draw(`The idea: ${idea}`)
  }
  $('make-new').onclick = reset
  $('make-intensity').oninput = (e) => current?.frame?.contentWindow?.postMessage({ type: 'intensity', value: Number(e.target.value) }, '*')
  $('make-keep').onclick = async () => {
    if (!current?.code) return
    const list = await figures()
    const item = { id: current.id || 'f' + Date.now().toString(36), idea: current.idea || '', code: current.code, name: current.name, means: current.means, at: Date.now() }
    current.id = item.id
    await wos.storage.set('figures', [item, ...list.filter((f) => f.id !== item.id)])
    $('make-delete').hidden = false
    $('make-keep').textContent = 'Kept'
    setTimeout(() => ($('make-keep').textContent = 'Keep it'), 1400)
  }
  $('make-delete').onclick = async () => {
    if (!current?.id) return
    await wos.storage.set('figures', (await figures()).filter((f) => f.id !== current.id))
    reset()
  }
  $('make-page').onclick = () => current?.code && wos.files.save(`hairline-${current.name || 'figure'}.html`, page(current.code, $('make-intensity').value, true))

  // The person's figures, at the top of the gallery.
  async function renderMine() {
    const list = await figures()
    $('mine-section').hidden = !list.length
    $('mine').innerHTML = ''
    for (const f of list) {
      const card = document.createElement('button')
      card.className = 'figure'
      card.dataset.mine = f.name
      card.innerHTML = '<div class="art"></div><strong></strong><span></span>'
      card.querySelector('strong').textContent = f.name
      card.querySelector('span').textContent = f.means
      card.onclick = () => open(f)
      $('mine').appendChild(card)
      run(card.querySelector('.art'), f.code, 0.5, null, true).catch(() => (card.querySelector('.art').textContent = 'This figure no longer draws.'))
    }
  }
  async function open(f) {
    window.hairlineApp.tab('make')
    reset()
    current = { ...f }
    $('make-delete').hidden = false
    busy(true, 'Opening…')
    try {
      const shown = await run($('make-stage'), f.code, $('make-intensity').value, (t) => ($('make-readout').textContent = t))
      current.frame = shown.frame
      $('make-empty').hidden = true
      $('make-stage').hidden = false
      $('make-result').hidden = false
      $('make-name').textContent = f.name
      $('make-means').textContent = f.means
      $('idea-box').hidden = true
      $('change-box').hidden = false
      $('make-new').hidden = false
      $('make-go').textContent = 'Change it'
    } catch (e) {
      problems([e.message])
    } finally {
      busy(false)
    }
  }
  renderMine()
  return { renderMine, validate: hairlineValidate, run }
})()
