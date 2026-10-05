/*
 * window.wos — what an app may ask of Workspace OS.
 *
 * An app runs in a sandboxed frame with no origin and no network; this is its
 * only way out. Every call is a message to the host, which checks it came from
 * this frame and that the app's app.json grants it, and main checks again.
 *
 *   await wos.ai.complete(prompt, { system, json, web, images })   → string (or parsed JSON with json: true);
 *       images: up to 4 PNG/JPEG/WebP data: URLs the model looks at first (e.g. the app's own render, to improve it)
 *   await wos.storage.get(key) / set(key, value) / remove(key) / keys()   → this app's own data
 *   await wos.files.save(name, data, { encoding: 'utf8' | 'base64' })   → the person picks where (null if cancelled)
 *   await wos.files.open({ accept: ['.svg', '.png'], as: 'text' | 'base64' })   → { name, data } or null
 *   wos.theme   → 'light' | 'dark'; wos.onTheme(fn) is told when it changes
 *   wos.app     → { slug, name }
 *
 * Nothing here can send mail, move files the person did not pick, or reach the web on its own.
 */
(function () {
  var seq = 0
  var pending = {}
  var themeFns = []
  var info = window.__WOS_APP__ || { slug: '', name: '', theme: 'light' }
  var theme = info.theme
  document.documentElement.setAttribute('data-theme', theme)

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return
    var m = e.data
    if (!m || m.__wos !== 1) return
    if (m.type === 'reply' && pending[m.id]) {
      var p = pending[m.id]
      delete pending[m.id]
      if (m.ok) p.ok(m.value)
      else p.err(new Error(m.error || 'The request failed'))
    } else if (m.type === 'theme') {
      theme = m.theme
      document.documentElement.setAttribute('data-theme', theme)
      themeFns.forEach(function (fn) { try { fn(m.theme) } catch (_) {} })
    }
  })

  function call(method, args) {
    return new Promise(function (ok, err) {
      var id = ++seq
      pending[id] = { ok: ok, err: err }
      window.parent.postMessage({ __wos: 1, type: 'call', id: id, method: method, args: args || {} }, '*')
    })
  }

  var api = {
    app: { slug: info.slug, name: info.name },
    get theme() { return theme },
    onTheme: function (fn) { themeFns.push(fn) },
    ai: {
      complete: function (prompt, o) {
        o = o || {}
        var images = o.images ? [].concat(o.images).map(String) : undefined
        return call('ai.complete', { prompt: String(prompt), system: o.system, json: !!o.json, web: !!o.web, images: images })
      },
    },
    storage: {
      get: function (key) { return call('storage.get', { key: String(key) }) },
      set: function (key, value) { return call('storage.set', { key: String(key), value: value }) },
      remove: function (key) { return call('storage.remove', { key: String(key) }) },
      keys: function () { return call('storage.keys', {}) },
    },
    files: {
      save: function (name, data, o) {
        o = o || {}
        return call('files.save', { name: String(name), data: String(data), encoding: o.encoding === 'base64' ? 'base64' : 'utf8' })
      },
      open: function (o) {
        o = o || {}
        return call('files.open', { accept: o.accept || [], as: o.as === 'base64' ? 'base64' : 'text' })
      },
    },
  }
  window.wos = Object.freeze(api)
})()
