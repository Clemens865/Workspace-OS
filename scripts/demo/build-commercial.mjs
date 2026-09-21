/**
 * Cuts the recorded segments into a 4:5 commercial, on the music's bar grid.
 *
 *   node scripts/demo/build-commercial.mjs
 *
 * Input:  build/demo/raw/part-*.mp4   (trimmed segments from record-demo.mjs)
 *         the Suno track
 * Output: build/demo/workspace-os-commercial.mp4
 *
 * TWO THINGS DRIVE EVERY DECISION HERE.
 *
 * 1. **The bar grid.** The track is 90 BPM with its first beat at 0.418s, so a
 *    bar is 2.667s. Every cut lands on a bar line — not near one. A cut that
 *    misses by two frames reads as a mistake even to someone who could not name
 *    what was wrong.
 *
 * 2. **1080 wide cannot show a desktop UI.** Shrinking the whole window into a
 *    vertical frame makes every label unreadable on a phone, which is the
 *    failure mode of most vertical product video. So each shot declares a CROP
 *    of the 1512x945 source — the region that matters — and that region is
 *    scaled to fill. The rail, the browser assistant and the document page each
 *    get framed as their own subject.
 */
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(ROOT, 'build/demo/raw')
const OUT = path.join(ROOT, 'build/demo')
const WORK = path.join(OUT, 'commercial')
const TRACK = process.argv[2] || process.env.WOS_DEMO_TRACK || ''
if (!TRACK) { console.error('usage: pass the music track as the first argument or set WOS_DEMO_TRACK'); process.exit(2) }

const W = 1080
const H = 1350
const FPS = 30

// Measured by scripts/demo/analyze-track.mjs.
const BPM = 90
const FIRST_BEAT = 0.418
const BAR = (60 / BPM) * 4 // 2.667s

/** Time of bar n, in seconds. */
const bar = (n) => FIRST_BEAT + n * BAR

const SRC = (i) => path.join(RAW, `part-0${i}.mp4`)

/**
 * The shot list. `bars` is the length in bars, so the whole film stays on grid
 * by construction rather than by arithmetic done per shot.
 *
 * `crop` is x/y/w/h in the 1512x945 source. Where it is omitted the shot uses
 * a centred 4:5 slice of the full frame.
 */
/**
 * The shot list.
 *
 * `mode`:
 *   'fill' — crop a true 4:5 slice and fill the frame. The source is 945 tall,
 *            so such a slice is at most 756 wide; anything wider would have to
 *            be stretched, which is what the first attempt did by accident.
 *   'fit'  — the whole window, scaled to the frame width and floated on a
 *            near-white ground. Used to ESTABLISH, then we punch in.
 *
 * `x`/`y` place a 'fill' crop; `w` defaults to the full-height 756.
 * `bars` keeps the film on grid by construction.
 */
const SRC_W = 1512
const SRC_H = 945

const SHOTS = [
  // ── Establish. 'fit' is used ONLY here and at the close: it leaves half the
  //    frame empty, which is right for a title beat and wrong for everything
  //    else. Every other shot punches in.
  { src: 0, in: 4.4, bars: 1.5, mode: 'fit', label: 'one window' },

  // ── Files. x is chosen so the crop starts at a panel EDGE — landing it
  //    mid-column clips labels in half and reads as a mistake.
  { src: 1, in: 6.4, bars: 1, x: 756, label: 'sort' },
  { src: 1, in: 12.6, bars: 1, x: 756, label: 'filter' },
  { src: 1, in: 20.4, bars: 1, x: 600, label: 'icons' },
  { src: 1, in: 27.0, bars: 1, x: 600, label: 'gallery' },
  { src: 1, in: 33.0, bars: 1, x: 380, label: 'columns' },

  // ── Office. Tight on the TEXT: w=460 makes the typed line fill the width,
  //    and y crops away the empty page that dominated the first attempt.
  { src: 2, in: 6.0, bars: 1, x: 600, y: 130, w: 460, label: 'typing' },
  { src: 2, in: 12.5, bars: 1, x: 600, y: 130, w: 460 },
  { src: 2, in: 17.0, bars: 1.5, x: 600, y: 130, w: 460, label: 'the number changes' },

  // ── Browser: the page, then the assistant panel as its own subject.
  { src: 3, in: 2.0, bars: 1, x: 200, label: 'browser' },
  { src: 3, in: 7.4, bars: 1, x: 756, label: 'assistant' },

  // ── Room. The rail leaving and the dock arriving are both left-anchored,
  //    so these frame the left two-thirds rather than the centre.
  { src: 4, in: 2.4, bars: 1, x: 0, label: 'fill the window' },
  { src: 4, in: 9.4, bars: 1, x: 0 },
  { src: 4, in: 15.4, bars: 1, x: 0, y: 189, label: 'terminal' },
  { src: 4, in: 21.0, bars: 1, x: 0, y: 189, label: 'minimise' },

  // ── Close
  { src: 5, in: 1.2, bars: 1.5, mode: 'fit' },
]

/* ── render ──────────────────────────────────────────────────────────────── */

fs.rmSync(WORK, { recursive: true, force: true })
fs.mkdirSync(WORK, { recursive: true })

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })

console.log(`\nbar = ${BAR.toFixed(3)}s · ${SHOTS.length} shots`)

const pieces = []
let total = 0
for (const [i, s] of SHOTS.entries()) {
  const src = SRC(s.src)
  if (!fs.existsSync(src)) {
    console.log(`  ! missing ${path.basename(src)} — shot ${i} skipped`)
    continue
  }
  const dur = s.bars * BAR
  const out = path.join(WORK, `shot-${String(i).padStart(2, '0')}.mp4`)

  let vf
  if (s.mode === 'fit') {
    // Whole window on a near-white ground, with the weight slightly high in
    // frame so the lower third stays free for a caption later.
    vf =
      `scale=${W}:-2,pad=${W}:${H}:0:(oh-ih)/2:color=0xF5F5F7,` +
      `zoompan=z='min(1.03,1+0.03*on/${Math.round(dur * FPS)})':d=1:s=${W}x${H}:fps=${FPS},setsar=1`
  } else {
    // A TRUE 4:5 slice — h is derived from w, never chosen independently, so
    // nothing is ever stretched to fit the frame.
    const cw = Math.min(s.w ?? 756, Math.floor(SRC_H / 1.25))
    const ch = Math.round(cw * 1.25)
    const cx = Math.max(0, Math.min(s.x ?? Math.round((SRC_W - cw) / 2), SRC_W - cw))
    const cy = Math.max(0, Math.min(s.y ?? Math.round((SRC_H - ch) / 2), SRC_H - ch))
    vf =
      `crop=${cw}:${ch}:${cx}:${cy},scale=${W}:${H},` +
      `zoompan=z='min(1.04,1+0.04*on/${Math.round(dur * FPS)})':d=1:s=${W}x${H}:fps=${FPS},setsar=1`
  }

  ff([
    '-ss', s.in.toFixed(3),
    '-t', dur.toFixed(3),
    '-i', src,
    '-vf', vf,
    '-an',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p',
    out,
  ])
  pieces.push(out)
  total += dur
  console.log(`  shot ${String(i).padStart(2)} · ${s.bars} bars · ${dur.toFixed(2)}s${s.label ? ` · ${s.label}` : ''}`)
}

console.log(`\ntotal ${total.toFixed(2)}s (${(total / BAR).toFixed(1)} bars)`)

/* ── join, then lay the music over it ────────────────────────────────────── */

const list = path.join(WORK, 'concat.txt')
fs.writeFileSync(list, pieces.map((p) => `file '${p}'`).join('\n'))
const silent = path.join(WORK, 'silent.mp4')
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent])

const final = path.join(OUT, 'workspace-os-commercial.mp4')
ff([
  '-i', silent,
  '-i', TRACK,
  '-filter_complex',
  // Fade the picture up from black and out at the end; fade the music out over
  // the last two bars so it resolves rather than being chopped.
  `[0:v]fade=t=in:st=0:d=0.5,fade=t=out:st=${(total - 0.8).toFixed(2)}:d=0.8[v];` +
    `[1:a]atrim=0:${total.toFixed(3)},afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 2 * BAR).toFixed(2)}:d=${(2 * BAR).toFixed(2)}[a]`,
  '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '192k',
  '-movflags', '+faststart',
  final,
])

const probe = spawnSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,size', '-of', 'default=nw=1', final,
], { encoding: 'utf8' })
console.log(`\n✓ ${final}\n${probe.stdout.trim()}\n`)
