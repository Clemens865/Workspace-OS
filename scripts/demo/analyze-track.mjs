/**
 * Measures a music track so the edit can be cut to it rather than by eye.
 *
 *   node scripts/demo/analyze-track.mjs "/path/to/track.mp3"
 *
 * Reports the tempo, where beat one falls, and how loud each second is — the
 * last of which is what actually reveals the arrangement: an acoustic build
 * shows up as a staircase in the envelope, and the near-silent bar before the
 * outro shows up as a trough. Those are the frames the video should cut on.
 *
 * Energy-based rather than spectral: this material is pizzicato, marimba and
 * claps, whose onsets are sharp enough that amplitude alone finds them.
 */
import { spawnSync } from 'child_process'

const file = process.argv[2]
if (!file) {
  console.error('usage: analyze-track.mjs <audio file>')
  process.exit(1)
}

const SR = 22050
const HOP = 256 // 11.6 ms

const pcm = spawnSync(
  'ffmpeg',
  ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
  { maxBuffer: 1 << 30, encoding: 'buffer' },
)
if (pcm.status !== 0) {
  console.error('ffmpeg failed:', String(pcm.stderr))
  process.exit(1)
}
const samples = new Float32Array(
  pcm.stdout.buffer,
  pcm.stdout.byteOffset,
  Math.floor(pcm.stdout.length / 4),
)
const duration = samples.length / SR

/* ── onset envelope ──────────────────────────────────────────────────────── */
const frames = Math.floor(samples.length / HOP)
const energy = new Float32Array(frames)
for (let f = 0; f < frames; f++) {
  let sum = 0
  const start = f * HOP
  for (let i = start; i < start + HOP && i < samples.length; i++) sum += samples[i] * samples[i]
  energy[f] = Math.sqrt(sum / HOP)
}

// Rising edges only: an onset is energy ARRIVING, and decay carries no beat.
const onset = new Float32Array(frames)
for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1])

const mean = onset.reduce((a, b) => a + b, 0) / frames
const centred = Float32Array.from(onset, (v) => v - mean)

/* ── tempo by autocorrelation ────────────────────────────────────────────── */
const fps = SR / HOP
const lagFor = (bpm) => Math.round((60 / bpm) * fps)
let best = { bpm: 0, score: -Infinity }
for (let bpm = 70; bpm <= 160; bpm += 0.25) {
  const lag = lagFor(bpm)
  let score = 0
  for (let f = 0; f + lag * 2 < frames; f++) {
    // Two lags, so a half-time match cannot beat the true tempo.
    score += centred[f] * centred[f + lag] + 0.6 * centred[f] * centred[f + lag * 2]
  }
  if (score > best.score) best = { bpm, score }
}

/* ── where beat one sits ─────────────────────────────────────────────────── */
const beatLag = lagFor(best.bpm)
let bestPhase = { offset: 0, score: -Infinity }
for (let offset = 0; offset < beatLag; offset++) {
  let score = 0
  for (let f = offset; f < frames; f += beatLag) score += onset[f]
  if (score > bestPhase.score) bestPhase = { offset, score }
}
const firstBeat = bestPhase.offset / fps
const beatSec = 60 / best.bpm
const barSec = beatSec * 4

/* ── arrangement: loudness per second ────────────────────────────────────── */
const perSec = []
for (let s = 0; s < Math.floor(duration); s++) {
  let sum = 0
  let n = 0
  for (let f = Math.floor(s * fps); f < Math.floor((s + 1) * fps) && f < frames; f++) {
    sum += energy[f]
    n++
  }
  perSec.push(n ? sum / n : 0)
}
const peak = Math.max(...perSec)

console.log(`\nfile      ${file}`)
console.log(`duration  ${duration.toFixed(2)}s`)
console.log(`tempo     ${best.bpm.toFixed(2)} BPM`)
console.log(`beat      ${beatSec.toFixed(3)}s   bar (4 beats) ${barSec.toFixed(3)}s`)
console.log(`first beat at ${firstBeat.toFixed(3)}s`)
console.log(`\nbar lines (s):`)
const bars = []
for (let t = firstBeat, i = 0; t < duration; t += barSec, i++) bars.push(t)
console.log(bars.map((b, i) => `${i}:${b.toFixed(2)}`).join('  '))

console.log(`\nloudness per second (arrangement):`)
perSec.forEach((v, s) => {
  const n = Math.round((v / peak) * 46)
  console.log(`${String(s).padStart(3)}s ${'█'.repeat(n).padEnd(46)} ${(v / peak).toFixed(2)}`)
})
