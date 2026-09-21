/**
 * Grades the generated logo reveal into the film's format.
 *
 *   node scripts/demo/grade-intro.mjs
 *
 * Output: build/demo/story/cards/00-logo.mp4
 *
 * The raw generation is 1920x1080 at 24fps with an audio track; the film is
 * 1512x944 at 30fps, silent until the music is laid over the whole thing. The
 * concat demuxer joins with `-c copy`, so anything that does not match those
 * parameters EXACTLY either fails to join or joins and plays wrong.
 *
 * It runs 8.04s, and three bars at 90 BPM is 8.00s — near enough that trimming
 * the tail 40ms costs nothing, since the last second is a held wordmark.
 */
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { CARD_W, CARD_H } from './card-styles.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const RAW = path.join(ROOT, 'build/demo/story/raw/hf_20260813_114313_7e2718a7-e3c4-42da-8bb5-ba5e8c64659f.mp4')
const OUT = path.join(ROOT, 'build/demo/story/cards/00-logo.mp4')
const BARS = 3
const BAR = (60 / 90) * 4

if (!fs.existsSync(RAW)) {
  console.error(`\n✗ raw footage missing: ${path.relative(ROOT, RAW)}\n`)
  process.exit(1)
}

/**
 * 16:9 into 1.601 — crop the sides rather than stretch or pillarbox.
 *
 * Taking it off the width keeps the full height, and everything that matters
 * (the ribbons converging, the mark, the wordmark) is centred, so the ~95px
 * lost from each edge carries nothing.
 */
const cropW = Math.round(1080 * (CARD_W / CARD_H))

execFileSync(
  'ffmpeg',
  [
    '-y', '-loglevel', 'error',
    '-t', (BARS * BAR).toFixed(3), '-i', RAW,
    '-vf', `crop=${cropW}:1080,scale=${CARD_W}:${CARD_H},fps=30,setsar=1`,
    // -an: the generation carries its own audio, and the film is scored as a
    // whole. Left in, it would fight the track under the opening eight seconds.
    '-an',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p',
    OUT,
  ],
  { stdio: 'inherit' },
)

const dur = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', OUT], {
    encoding: 'utf8',
  }).trim(),
)
console.log(`\n✓ ${path.relative(ROOT, OUT)} — ${dur.toFixed(2)}s (${BARS} bars), ${CARD_W}x${CARD_H} @30fps, silent\n`)
