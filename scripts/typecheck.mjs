#!/usr/bin/env node
/**
 * Type-check the projects that actually contain code, and fail on REGRESSIONS.
 *
 * `npm run typecheck` used to run `tsc -p tsconfig.json`, and that config has
 * `files: []` with only project references — it checks nothing and exits 0. The
 * command passed on a codebase with 78 type errors in it, and it passed on a
 * handler that called a method which does not exist. A gate that cannot fail is
 * worse than no gate, because it is believed.
 *
 * Pointing it at the real configs alone would swap one useless outcome for
 * another: 78 errors printed on every run is noise, and noise gets ignored just
 * as thoroughly as a green tick that means nothing. So this compares against a
 * committed baseline and fails only on errors that are NEW.
 *
 * The baseline is a ratchet, not a target. It is written by
 * `npm run typecheck -- --accept` and should only ever go down.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'

const PROJECTS = ['tsconfig.node.json', 'src/renderer/tsconfig.json']
const BASELINE = 'scripts/typecheck-baseline.json'

/**
 * The compiler runs through this Node binary, not `npx`: on Windows `npx` is a
 * .cmd file that execFileSync cannot start, and a compiler that never ran must
 * fail the gate rather than count as zero errors.
 */
function compilerPath() {
  try {
    return createRequire(import.meta.url).resolve('typescript/bin/tsc')
  } catch {
    console.error('Typecheck FAILED — TypeScript is not installed. Run `npm ci` first.')
    process.exit(1)
  }
}
const TSC = compilerPath()

/** Every error line for one project, as `file: code` — line numbers shift too easily. */
function errorsIn(project) {
  try {
    execFileSync(process.execPath, [TSC, '--noEmit', '-p', project], {
      encoding: 'utf-8',
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    })
    return []
  } catch (e) {
    const out = `${e.stdout ?? ''}${e.stderr ?? ''}`
    const errors = out
      .split('\n')
      .filter((l) => l.includes('error TS'))
      .map((l) => {
        const file = l.split('(')[0]
        const code = l.match(/error (TS\d+)/)?.[1] ?? 'TS?'
        return `${file}: ${code}`
      })
    if (errors.length > 0) return errors
    console.error(`Typecheck FAILED — the compiler did not complete for ${project}:\n${out || e.message}`)
    process.exit(1)
  }
}

const found = PROJECTS.flatMap(errorsIn)

/** Counted per (file, code) pair so a second identical error in a file is still new. */
function tally(lines) {
  const m = new Map()
  for (const l of lines) m.set(l, (m.get(l) ?? 0) + 1)
  return m
}

const now = tally(found)

if (process.argv.includes('--accept')) {
  writeFileSync(BASELINE, `${JSON.stringify(Object.fromEntries(now), null, 2)}\n`)
  console.log(`Baseline written: ${found.length} known errors.`)
  process.exit(0)
}

const baseline = existsSync(BASELINE) ? tally([]) : tally([])
if (existsSync(BASELINE)) {
  for (const [k, v] of Object.entries(JSON.parse(readFileSync(BASELINE, 'utf-8')))) baseline.set(k, v)
}

const regressions = []
for (const [k, v] of now) {
  const was = baseline.get(k) ?? 0
  if (v > was) regressions.push(`${k} (${v}, was ${was})`)
}

const total = [...baseline.values()].reduce((a, b) => a + b, 0)
if (regressions.length === 0) {
  console.log(`Typecheck clean against the baseline (${found.length} known errors, baseline ${total}).`)
  if (found.length < total) {
    console.log('Fewer errors than the baseline — run `npm run typecheck -- --accept` to tighten it.')
  }
  process.exit(0)
}

console.error(`Typecheck FAILED — ${regressions.length} new error${regressions.length === 1 ? '' : 's'}:\n`)
for (const r of regressions) console.error(`  ${r}`)
console.error('\nFix them, or if they are genuinely acceptable: npm run typecheck -- --accept')
process.exit(1)
