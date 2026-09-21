/**
 * The interstitial card styles, and a renderer for them.
 *
 * Shared by `style-samples.mjs` (each style alone) and `style-preview.mjs`
 * (each style cut against real footage). The second is the one that decides it:
 * a card is judged by how it meets the shot after it, not in isolation.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

export const CARD_W = 1512
// 944, not 945: H.264 requires even dimensions, and the recorder's own encode
// already rounds the 945-tall window down to 944. Cards must match the footage
// exactly or the concat re-encodes — or fails outright, which is what it did.
export const CARD_H = 944

const COMMON = `
  *{ margin:0; padding:0; box-sizing:border-box; }
  html,body{ width:${CARD_W}px; height:${CARD_H}px; overflow:hidden; }
  .stage{ position:fixed; inset:0; display:flex; flex-direction:column;
          align-items:center; justify-content:center; }
  .kicker,.title,.support{ opacity:0; }
`

export const STYLES = {
  frosted: {
    label: 'A · Frosted & elegant',
    css: `
      body{ background:
        radial-gradient(1100px 700px at 26% 18%, #DCE9FF 0%, transparent 60%),
        radial-gradient(900px 620px at 78% 82%, #FFE6D6 0%, transparent 62%),
        #F4F5F7; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      .card{ padding:64px 92px; border-radius:28px;
             background:rgba(255,255,255,.52);
             backdrop-filter:blur(30px) saturate(180%);
             -webkit-backdrop-filter:blur(30px) saturate(180%);
             border:1px solid rgba(255,255,255,.7);
             box-shadow:0 30px 90px rgba(20,30,60,.10); text-align:center; }
      .kicker{ font-size:15px; font-weight:600; letter-spacing:.20em; color:#5B6472;
               margin-bottom:20px; animation:rise .9s cubic-bezier(.22,.9,.24,1) .15s forwards; }
      .title{ font-size:78px; font-weight:600; letter-spacing:-.03em; color:#0B0D12;
              filter:blur(14px); animation:focus 1.15s cubic-bezier(.22,.9,.24,1) .3s forwards; }
      .support{ font-size:23px; font-weight:400; color:#5B6472; margin-top:18px;
                animation:rise .95s cubic-bezier(.22,.9,.24,1) .62s forwards; }
      @keyframes focus{ to{ opacity:1; filter:blur(0); } }
      @keyframes rise{ from{ transform:translateY(16px); } to{ opacity:1; transform:none; } }
    `,
    body: (k, t, su) =>
      `<div class="stage"><div class="card"><div class="kicker">${k}</div><div class="title">${t}</div>${su ? `<div class="support">${su}</div>` : ''}</div></div>`,
  },

  playful: {
    label: 'B · Colourful & playful',
    css: `
      body{ background:#1B57F0; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      .blob{ position:absolute; border-radius:50%; opacity:.95; }
      .b1{ width:340px; height:340px; background:#FFD166; left:-90px; top:-70px;
           animation:pop .8s cubic-bezier(.2,1.5,.4,1) .05s both; }
      .b2{ width:260px; height:260px; background:#EF6F6C; right:60px; bottom:-70px;
           animation:pop .8s cubic-bezier(.2,1.5,.4,1) .18s both; }
      .b3{ width:150px; height:150px; background:#33D9B2; right:230px; top:70px;
           animation:pop .8s cubic-bezier(.2,1.5,.4,1) .3s both; }
      .kicker{ font-size:16px; font-weight:800; letter-spacing:.16em; color:#FFD166;
               margin-bottom:16px; animation:bounce .75s cubic-bezier(.2,1.6,.4,1) .25s forwards; }
      .title{ font-size:96px; font-weight:800; letter-spacing:-.035em; color:#fff; line-height:1;
              animation:bounce .8s cubic-bezier(.2,1.6,.4,1) .38s forwards; }
      .support{ font-size:24px; font-weight:600; color:rgba(255,255,255,.9); margin-top:20px;
                animation:bounce .8s cubic-bezier(.2,1.6,.4,1) .52s forwards; }
      .stage{ text-align:center; }
      @keyframes pop{ from{ transform:scale(0); } to{ transform:scale(1); } }
      @keyframes bounce{ from{ opacity:0; transform:translateY(34px) scale(.94); } to{ opacity:1; transform:none; } }
    `,
    body: (k, t, su) =>
      `<div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div><div class="stage"><div class="kicker">${k}</div><div class="title">${t}</div>${su ? `<div class="support">${su}</div>` : ''}</div>`,
  },

  /**
   * C — dark & cinematic, with every move locked to the music.
   *
   * The track is 90 BPM, so a beat is 0.667s and a bar is 2.667s. Each element
   * arrives ON a beat rather than at a designer's guess: kicker on 1, title on
   * 2, rule draws across 3, support on 4, and the whole thing settles by the
   * end of bar 2. Animation that drifts off the grid is the thing that makes a
   * cut feel amateur even to someone who cannot say why.
   *
   * The palette is pulled from the chosen intro footage — deep navy with
   * saturated blue/violet/pink — so the card and the film share a language
   * rather than merely both being dark.
   *
   * It ends on a brief wash to light. That is deliberate: the shot after a card
   * is a bright white UI, and cutting from near-black straight to white flashes
   * at every interstitial. Washing out first motivates the cut.
   */
  cinematic: {
    label: 'C · Dark & cinematic (beat-locked)',
    css: `
      body{ background:#07080B; overflow:hidden;
            font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      /* Slow drifting colour, echoing the intro footage. Never still — a dark
         frame with nothing moving in it reads as a freeze. */
      .aura{ position:absolute; inset:-25%; opacity:.55; filter:blur(70px);
             background:
               radial-gradient(38% 45% at 28% 38%, #2F5BFF 0%, transparent 62%),
               radial-gradient(34% 42% at 72% 62%, #A855F7 0%, transparent 62%),
               radial-gradient(30% 38% at 55% 22%, #FF6B9D 0%, transparent 60%);
             animation:drift 13.334s ease-in-out infinite alternate; }
      .vig{ position:absolute; inset:0;
            background:radial-gradient(70% 60% at 50% 50%, transparent 40%, rgba(0,0,0,.72) 100%); }
      .stage{ text-align:center; z-index:2; }

      /* beat 1 — 0.667s */
      .kicker{ font-size:13px; font-weight:600; letter-spacing:.42em; color:#9BA6BC;
               margin-bottom:26px; animation:fade .5s ease .667s forwards; }
      /* beat 2 — 1.333s */
      .title{ font-size:86px; font-weight:300; letter-spacing:-.02em; color:#fff;
              animation:slide .75s cubic-bezier(.22,.9,.24,1) 1.333s forwards; }
      /* beat 3 — 2.0s */
      .rule{ width:0; height:1.5px; margin:30px auto 0;
             background:linear-gradient(90deg,transparent,#2F5BFF,#A855F7,#FF6B9D,transparent);
             animation:draw .667s cubic-bezier(.22,.9,.24,1) 2s forwards; }
      /* beat 4 — 2.667s, the bar line */
      .support{ font-size:21px; font-weight:400; color:#A8B2C4; margin-top:26px;
                animation:fade .6s ease 2.667s forwards; }

      /* The wash out, on the last beat, so the cut to a bright UI is motivated. */
      .wash{ position:absolute; inset:0; background:#fff; opacity:0; z-index:3;
             animation:wash .667s ease var(--wash-at, 4.667s) forwards; }

      @keyframes fade{ to{ opacity:1; } }
      @keyframes slide{ from{ opacity:0; transform:translateY(26px); } to{ opacity:1; transform:none; } }
      @keyframes draw{ to{ width:360px; } }
      @keyframes drift{ from{ transform:translate3d(-2%,-1%,0) scale(1); }
                        to{ transform:translate3d(2%,1%,0) scale(1.08); } }
      @keyframes wash{ from{ opacity:0; } to{ opacity:1; } }
    `,
    body: (k, t, su) =>
      `<div class="aura"></div><div class="vig"></div><div class="stage"><div class="kicker">${k}</div><div class="title">${t}</div><div class="rule"></div>${su ? `<div class="support">${su}</div>` : ''}</div><div class="wash"></div>`,
  },

  editorial: {
    label: 'D · Editorial / Swiss',
    css: `
      body{ background:#fff; font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif; }
      .stage{ align-items:flex-start; justify-content:center; padding-left:112px; }
      .rowline{ position:absolute; left:112px; right:112px; height:1px; background:#111;
                transform:scaleX(0); transform-origin:left;
                animation:wipe .9s cubic-bezier(.22,.9,.24,1) forwards; }
      .l1{ top:238px; animation-delay:.1s; }
      .l2{ bottom:238px; animation-delay:.2s; }
      .kicker{ font-size:14px; font-weight:700; letter-spacing:.20em; color:#111;
               margin-bottom:22px; animation:fade .6s ease .45s forwards; }
      .mask{ overflow:hidden; }
      .title{ font-size:104px; font-weight:700; letter-spacing:-.045em; color:#111; line-height:.96;
              opacity:1; transform:translateY(110%);
              animation:up 1s cubic-bezier(.22,.9,.24,1) .5s forwards; }
      .support{ font-size:22px; font-weight:400; color:#555; margin-top:22px; max-width:640px;
                animation:fade .7s ease .95s forwards; }
      @keyframes wipe{ to{ transform:scaleX(1); } }
      @keyframes up{ to{ transform:none; } }
      @keyframes fade{ to{ opacity:1; } }
    `,
    body: (k, t, su) =>
      `<div class="rowline l1"></div><div class="rowline l2"></div><div class="stage"><div class="kicker">${k}</div><div class="mask"><div class="title">${t}</div></div>${su ? `<div class="support">${su}</div>` : ''}</div>`,
  },
}

export function cardHtml(styleName, kicker, title, support) {
  const s = STYLES[styleName]
  return `<!doctype html><html><head><meta charset="utf-8"><style>${COMMON}${s.css}</style></head><body>${s.body(kicker, title, support)}</body></html>`
}

/**
 * Renders a card to mp4 by stepping frames.
 *
 * Frame-stepped rather than recorded: exact duration, and immune to a dropped
 * frame landing in the middle of a title animation.
 */
export async function renderCard(win, { style, kicker, title, support, seconds, out, tmp, wash = true }) {
  const file = path.join(tmp, `card-${style}-${Date.now()}.html`)
  /**
   * The wash-to-white starts one beat before the card ends, whatever its
   * length. A card with no bright shot after it — the outro — must not wash,
   * or the film ends on a white flash; pushing the delay past the end is the
   * simplest way to disable it without a second stylesheet.
   */
  const washAt = wash ? Math.max(0, seconds - 0.667) : seconds + 10
  const html = cardHtml(style, kicker, title, support).replace(
    '<body>',
    `<body style="--wash-at:${washAt.toFixed(3)}s">`,
  )
  fs.writeFileSync(file, html)
  await win.goto(`file://${file}`)
  await win.waitForTimeout(350)

  const frames = path.join(tmp, `frames-${path.basename(out, '.mp4')}`)
  fs.rmSync(frames, { recursive: true, force: true })
  fs.mkdirSync(frames, { recursive: true })
  const n = Math.round(seconds * 30)

  /**
   * Each frame is SOUGHT, not waited for.
   *
   * Screenshotting in a loop takes ~100ms of wall clock per frame, and CSS
   * animations run on the wall clock — so stepping 160 frames played ~16
   * seconds of animation into what is labelled 5.3 seconds of video. Every
   * card rendered that way was badly mistimed, and none of them could ever
   * have matched the music.
   *
   * The Web Animations API gives every running CSS animation a currentTime, so
   * the whole page can be paused and moved to an exact position per frame.
   */
  for (let i = 0; i < n; i++) {
    await win.evaluate((ms) => {
      for (const a of document.getAnimations()) {
        a.pause()
        a.currentTime = ms
      }
    }, (i / 30) * 1000)
    await win.screenshot({ path: path.join(frames, `f${String(i).padStart(4, '0')}.png`) })
  }

  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', '30', '-i', path.join(frames, 'f%04d.png'),
    '-vf', `scale=${CARD_W}:${CARD_H},setsar=1`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    out,
  ])
  fs.rmSync(frames, { recursive: true, force: true })
  fs.rmSync(file, { force: true })
  return out
}
