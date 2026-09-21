/**
 * The presentation layer for the demo recording.
 *
 * Two problems a scripted screen recording has that a human demo does not:
 *
 *  1. **Playwright's clicks are invisible.** Nothing moves, then the UI changes.
 *     A viewer cannot tell what was pressed, so the video reads as things
 *     happening by themselves. We draw a cursor and move it to whatever we are
 *     about to click, then pulse it on the click.
 *  2. **There is no narrator.** Caption cards say what each section is for, so
 *     the file needs no editing afterwards to be watchable.
 *
 * All of it is injected INTO the app's own page, so it is captured by the same
 * recording as everything else and stays crisp at any scale. React owns #root
 * and never touches these nodes, so they survive re-renders.
 */

/**
 * A pure-black curtain over the whole window.
 *
 * Everything before a segment's interesting part — launching, settling,
 * waiting ~27s for the office engine — happens behind this. Two jobs: the
 * setup never reaches the video, and the hard black→content edge when it is
 * pulled gives ffmpeg an unambiguous mark to trim at. Wall-clock trimming
 * cannot do that job, because the recorder starts an unknown latency after
 * launch and quietly eats the first seconds of content.
 *
 * PURE black, deliberately: the title cards are nearly black, so `blackdetect`
 * is run at a threshold that separates #000000 from their #0c0e12.
 */
export async function dropCurtain(win) {
  await win.evaluate(() => {
    if (document.getElementById('wos-curtain-css')) return
    const st = document.createElement('style')
    st.id = 'wos-curtain-css'
    // A ::after rule on <html> rather than a div: it can be installed before
    // <body> exists, which is what lets the same curtain be applied by an init
    // script at document-start and survive a reload.
    st.textContent =
      'html::after{content:"";position:fixed;inset:0;background:#000;z-index:2147483646;pointer-events:none}'
    document.documentElement.appendChild(st)
  })
}

/**
 * Keeps the curtain down across reloads.
 *
 * `win.reload()` paints the app for a moment before any script of ours can run
 * again, and that flash is a lit stretch in the recording — which the clip
 * cutter then reads as an extra clip. An init script runs before the page's own
 * scripts, so the curtain is never absent.
 */
export async function armCurtainOnLoad(win) {
  await win.addInitScript(() => {
    const install = () => {
      if (document.getElementById('wos-curtain-css')) return
      const st = document.createElement('style')
      st.id = 'wos-curtain-css'
      st.textContent =
        'html::after{content:"";position:fixed;inset:0;background:#000;z-index:2147483646;pointer-events:none}'
      document.documentElement.appendChild(st)
    }
    install()
    document.addEventListener('DOMContentLoaded', install)
  })
}

export async function raiseCurtain(win) {
  // Removed outright rather than faded — the trim wants a hard edge.
  await win.evaluate(() => {
    document.getElementById('wos-curtain-css')?.remove()
    document.getElementById('wos-curtain')?.remove()
  })
  await sleep(120)
}

/** Injects the overlay stylesheet + helpers. Call once per launched window. */
export async function installStagecraft(win) {
  await win.evaluate(() => {
    if (document.getElementById('wos-demo-style')) return

    const style = document.createElement('style')
    style.id = 'wos-demo-style'
    style.textContent = `
      #wos-demo-layer, #wos-demo-cursor {
        position: fixed; z-index: 2147483647; pointer-events: none;
      }
      #wos-demo-layer { inset: 0; display: grid; place-items: center; }

      .wos-card {
        position: absolute; inset: 0;
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; text-align: center;
        background: radial-gradient(ellipse at 50% 45%, rgba(12,14,18,0.94), rgba(8,9,12,0.985));
        opacity: 0; transition: opacity 620ms cubic-bezier(.32,.72,0,1);
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .wos-card.on { opacity: 1; }
      .wos-card h1 {
        margin: 0; color: #fff; font-size: 58px; font-weight: 600; letter-spacing: -0.028em;
        transform: translateY(14px); opacity: 0;
        transition: transform 760ms cubic-bezier(.32,.72,0,1), opacity 760ms ease;
      }
      .wos-card p {
        margin: 0; color: rgba(255,255,255,.66); font-size: 21px; font-weight: 400;
        letter-spacing: -0.01em; max-width: 780px; line-height: 1.45;
        transform: translateY(14px); opacity: 0;
        transition: transform 760ms cubic-bezier(.32,.72,0,1) 90ms, opacity 760ms ease 90ms;
      }
      .wos-card.on h1, .wos-card.on p { transform: translateY(0); opacity: 1; }

      /* Lower third — used while the UI is doing something, so it must never
         cover the thing it is describing. */
      .wos-lower {
        /* Clears the gallery filmstrip and the status bar beneath it. At 46px
           the pill sat ON the thumbnails it was describing. */
        position: absolute; left: 50%; bottom: 132px; transform: translate(-50%, 16px);
        padding: 11px 22px; border-radius: 999px;
        background: rgba(16,18,22,.9);
        -webkit-backdrop-filter: saturate(180%) blur(24px);
        box-shadow: 0 10px 40px rgba(0,0,0,.34);
        color: #fff; font-size: 17px; font-weight: 500; letter-spacing: -0.006em;
        font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
        white-space: nowrap; opacity: 0;
        transition: opacity 420ms ease, transform 520ms cubic-bezier(.32,.72,0,1);
      }
      .wos-lower.on { opacity: 1; transform: translate(-50%, 0); }

      #wos-demo-cursor {
        left: 0; top: 0; width: 22px; height: 22px; margin: -11px 0 0 -11px;
        border-radius: 50%;
        background: rgba(255,255,255,.28);
        border: 1.5px solid rgba(255,255,255,.85);
        box-shadow: 0 2px 10px rgba(0,0,0,.35);
        opacity: 0;
        transition: transform 620ms cubic-bezier(.32,.72,0,1), opacity 300ms ease;
      }
      #wos-demo-cursor.on { opacity: 1; }
      #wos-demo-cursor.tap { animation: wosTap 460ms ease; }
      @keyframes wosTap {
        0%   { box-shadow: 0 0 0 0 rgba(255,255,255,.55); }
        70%  { box-shadow: 0 0 0 22px rgba(255,255,255,0); }
        100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
      }
    `
    document.head.appendChild(style)

    const layer = document.createElement('div')
    layer.id = 'wos-demo-layer'
    document.body.appendChild(layer)

    const cursor = document.createElement('div')
    cursor.id = 'wos-demo-cursor'
    document.body.appendChild(cursor)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Full-screen title card. Holds, then clears. */
export async function titleCard(win, heading, sub = '', holdMs = 2100) {
  await win.evaluate(
    ([h, s]) => {
      const card = document.createElement('div')
      card.className = 'wos-card'
      card.innerHTML = `<h1></h1>${s ? '<p></p>' : ''}`
      card.querySelector('h1').textContent = h
      if (s) card.querySelector('p').textContent = s
      document.getElementById('wos-demo-layer').appendChild(card)
      requestAnimationFrame(() => card.classList.add('on'))
      window.__wosCard = card
    },
    [heading, sub],
  )
  await sleep(holdMs)
  await win.evaluate(() => {
    const c = window.__wosCard
    if (!c) return
    c.classList.remove('on')
    setTimeout(() => c.remove(), 700)
  })
  await sleep(700)
}

/** Lower-third caption. Stays up until `clearCaption`. */
export async function caption(win, text) {
  await win.evaluate((t) => {
    let el = document.getElementById('wos-lower')
    if (!el) {
      el = document.createElement('div')
      el.id = 'wos-lower'
      el.className = 'wos-lower'
      document.getElementById('wos-demo-layer').appendChild(el)
    }
    // Swap the text while faded out, so captions cross-fade instead of snapping.
    el.classList.remove('on')
    setTimeout(() => {
      el.textContent = t
      el.classList.add('on')
    }, 220)
  }, text)
  await sleep(620)
}

export async function clearCaption(win) {
  await win.evaluate(() => document.getElementById('wos-lower')?.classList.remove('on'))
  await sleep(420)
}

/**
 * Moves the drawn cursor over an element's centre.
 *
 * Resolved through a Playwright LOCATOR rather than `querySelectorAll` in the
 * page: the tour leans on `:has-text(…)` to find things by their label, and
 * that is a Playwright selector which the DOM rejects as invalid CSS.
 * Returns null when nothing matches, so a segment can carry on without the
 * whole recording failing over one moved button.
 */
export async function cursorTo(win, selector, nth = 0) {
  const box = await win
    .locator(selector)
    .nth(nth)
    .boundingBox({ timeout: 4000 })
    .catch(() => null)
  if (!box) return null
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await win.evaluate(
    ([x, y]) => {
      const c = document.getElementById('wos-demo-cursor')
      c.classList.add('on')
      c.style.transform = `translate(${x}px, ${y}px)`
    },
    [at.x, at.y],
  )
  await sleep(640)
  return at
}

/** Move the cursor to a target, pulse it, then really click it. */
export async function show(win, selector, { nth = 0, settle = 700, required = false } = {}) {
  const at = await cursorTo(win, selector, nth)
  if (!at) {
    // One missing control should cost its own beat, not the whole recording.
    if (required) throw new Error(`demo: nothing matched ${selector}`)
    console.log(`      (skipped — no match for ${selector})`)
    return false
  }
  await win.evaluate(() => {
    const c = document.getElementById('wos-demo-cursor')
    c.classList.remove('tap')
    void c.offsetWidth // restart the animation
    c.classList.add('tap')
  })
  await sleep(180)
  await win.mouse.click(at.x, at.y)
  await sleep(settle)
  return true
}

export async function hideCursor(win) {
  await win.evaluate(() => document.getElementById('wos-demo-cursor')?.classList.remove('on'))
  await sleep(300)
}

export { sleep }
