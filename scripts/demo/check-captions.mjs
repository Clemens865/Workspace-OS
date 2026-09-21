/**
 * Checks every caption in the film actually reached the frame.
 *
 *   node scripts/demo/check-captions.mjs [film.mp4]
 *
 * Writes build/demo/cuts/_check/<t>s.png and a contact sheet, then reports.
 *
 * This exists because the caption overlay failed SILENTLY three times running —
 * a 2x Retina PNG landing off-frame, a one-frame PNG input ending before the
 * fade began, and an overlay that outlived the clip. Every one of those produced
 * a valid film of the right length with no captions in it, and no ffmpeg error.
 *
 * The detector: a caption is a DARK pill on a light UI, so the bottom-left
 * region's mean luma collapses when one is present. Comparing that region
 * against the SAME region one beat earlier (before the caption fades in) is what
 * makes it robust — an absolute threshold gets it wrong on dark footage, which
 * is exactly how the previous check reported three false absences.
 */
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const CUTS = path.join(ROOT, 'build/demo/cuts')
const OUT = path.join(CUTS, '_check')

const film =
  process.argv[2] ||
  fs
    .readdirSync(CUTS)
    .filter((f) => f.endsWith('.mp4'))
    .sort()
    .pop() &&
    path.join(CUTS, fs.readdirSync(CUTS).filter((f) => f.endsWith('.mp4')).sort().pop())

if (!film || !fs.existsSync(film)) {
  console.error('No film found in build/demo/cuts')
  process.exit(1)
}

const BPM = 90
const BAR = (60 / BPM) * 4
const BEAT = 60 / BPM

// The pill sits at left:52 bottom:52 in a 1512x944 frame.
const CROP = '620:110:40:815'

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

/** Mean luma of the caption region at time t. */
function luma(t) {
  const r = spawnSync(
    'ffmpeg',
    ['-ss', t.toFixed(2), '-i', film, '-frames:v', '1', '-vf', `crop=${CROP},signalstats,metadata=print`, '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  const m = /lavfi\.signalstats\.YAVG=([\d.]+)/.exec(`${r.stdout}${r.stderr}`)
  return m ? Number(m[1]) : null
}

/* Rebuild the timeline the same way assemble.mjs does, so the probe times are
   derived rather than hand-typed — hand-typed ones drift the moment the edit
   changes, and a check that probes the wrong second is worse than none. */
const { EDIT } = await import('./edit.mjs').catch(() => ({ EDIT: null }))
if (!EDIT) {
  console.error('Export EDIT from scripts/demo/edit.mjs so the check can derive probe times.')
  process.exit(1)
}

/**
 * Card lengths come from the FILES, not from cards.json.
 *
 * cards.json only lists what render-cards.mjs produced, and the graded logo
 * reveal is not one of those — it is 8s of footage dropped into the same
 * directory. Reading the manifest would have scored it as 0s and shifted every
 * probe after it eight seconds early, reporting missing captions that were
 * present. That is the same class of mistake as the assembler trusting the edit
 * over the clip: believe the file on disk.
 */
const cardSeconds = (id) => {
  const p = path.join(ROOT, 'build/demo/story/cards', `${id}.mp4`)
  if (!fs.existsSync(p)) {
    console.error(`\n✗ card ${id} is in the edit but not on disk\n`)
    process.exit(1)
  }
  return Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', p], {
      encoding: 'utf8',
    }).trim(),
  )
}

let t = 0
const probes = []
for (const step of EDIT) {
  if (step.card) {
    t += cardSeconds(step.card)
    continue
  }
  const dur = step.bars * BAR
  if (step.caption) {
    // Mid-caption, and one beat before it fades in.
    probes.push({ at: t + dur / 2, base: t + BEAT * 0.4, clip: step.clip, caption: step.caption })
  }
  t += dur
}

console.log(`\n${path.basename(film)} — ${t.toFixed(1)}s, ${probes.length} captions\n`)

const bad = []
for (const p of probes) {
  const a = luma(p.at)
  const b = luma(p.base)
  const drop = b != null && a != null ? b - a : null
  // A pill covering ~40% of the crop at ~0.85 opacity over light UI drops the
  // mean by 50+. Anything under 12 means nothing arrived.
  const ok = drop != null && drop > 12
  const png = path.join(OUT, `${p.at.toFixed(1)}s.png`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', p.at.toFixed(2), '-i', film, '-frames:v', '1', png])
  console.log(
    `  ${ok ? '✓' : '✗'} ${String(p.at.toFixed(1)).padStart(6)}s  ${p.clip.padEnd(22)} ` +
      `Δluma ${drop == null ? '  ?' : drop.toFixed(1).padStart(6)}   “${p.caption}”`,
  )
  if (!ok) bad.push(p)
}

console.log(`\nFrames in ${path.relative(ROOT, OUT)} — LOOK at them, the number is only a tripwire.`)
if (bad.length) {
  console.log(`\n✗ ${bad.length}/${probes.length} captions did not reach the frame\n`)
  process.exit(1)
}
console.log(`\n✓ all ${probes.length} captions present\n`)
