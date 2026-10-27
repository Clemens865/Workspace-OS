/**
 * The harness around the app builder: what makes a rough idea a good app.
 *
 *   brief   — before the first build, the idea becomes a product brief
 *             (Apps/<slug>/BRIEF.md): jobs, screens, data, AI, design, and
 *             acceptance checks the build is held to.
 *   review  — after a turn, the running app (a screenshot) and its files are
 *             checked against the brief; what is missing goes back once as a
 *             fix, and three next steps are offered to the person.
 *   tests   — between the two, the app's own end-to-end tests run in the
 *             live preview (app-tests.ts writes them, app-driver.ts runs them).
 *   seeing  — AI answers that look at images (an app's own render, the
 *             screenshot): the CLI reads them from a scratch folder it alone
 *             may read.
 *
 * Every model call here runs without the person's settings files and with no
 * tool but reading its own scratch folder.
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { runProviderJson } from '../agent/providerText'
import type { ClaudeRunResult } from '../agent/claudeRun'
import { appDir, readManifest } from './apps-store'

export const BRIEF_FILE = 'BRIEF.md'
export const IMAGE_LIMITS = { count: 4, bytes: 6 * 1024 * 1024 }

export interface SeenImage {
  data: Buffer
  ext: 'png' | 'jpg' | 'webp'
}

/** A data: URL an app sends (PNG, JPEG or WebP), as bytes; throws on anything else. */
export function imageFromDataUrl(s: unknown): SeenImage {
  const m = typeof s === 'string' ? /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\s]+)$/.exec(s) : null
  if (!m) throw new Error('Images must be PNG, JPEG or WebP data: URLs')
  const data = Buffer.from(m[2], 'base64')
  if (!data.length) throw new Error('An image is empty')
  if (data.length > IMAGE_LIMITS.bytes) throw new Error('An image is larger than 6 MB')
  return { data, ext: m[1] === 'png' ? 'png' : m[1] === 'webp' ? 'webp' : 'jpg' }
}

/**
 * One model answer, optionally looking at images first. The images go into a
 * fresh scratch folder that is the run's working directory and the only thing
 * it may read; the folder is removed afterwards.
 */
export async function runSeeing(o: { prompt: string; systemPrompt?: string; images?: SeenImage[]; allowedTools?: string[] }): Promise<ClaudeRunResult> {
  const images = (o.images ?? []).slice(0, IMAGE_LIMITS.count)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-see-'))
  try {
    const names = images.map((im, i) => {
      const name = `image-${i + 1}.${im.ext}`
      fs.writeFileSync(path.join(dir, name), im.data)
      return `./${name}`
    })
    const prompt = names.length ? `${o.prompt}\n\nBefore you answer, look at ${names.length === 1 ? 'this image' : 'these images'} with the Read tool: ${names.join(', ')}` : o.prompt
    const tools = [...(o.allowedTools ?? []), ...(names.length ? ['Read(./**)'] : [])]
    return await runProviderJson({ prompt, systemPrompt: o.systemPrompt, cwd: dir, allowedTools: tools, isolated: true })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const PLATFORM = `The platform, so the brief only asks for what can be built: a single-page app (HTML, CSS, plain JavaScript) in a sandbox with no network; it saves its data with wos.storage; it may ask an AI model (text, JSON, optionally web lookup, and it can show the model images, e.g. its own rendered output, for a self-review); files go in and out through save/open dialogs. It always looks like Workspace OS: its design kit (calm, spacious, serif headings, hairline borders, the kit's tokens and six swatch colours, line icons) is fixed, so "design direction" means hierarchy, layout, density and the one moment of delight within that kit. Content the app generates (drawings, documents, diagrams) is not bound to the kit and should be of professional quality.`

const BRIEF_SYSTEM = [
  'You are the product lead of a small, excellent software studio. Someone describes, often roughly, an app they want inside their workspace. You write the product brief the builder will build from: specific, opinionated, buildable, and ambitious about quality. You decide what a great version of this app is, filling the gaps the person left with the choices a thoughtful designer would make; you never ask questions back.',
  PLATFORM,
  'Write Markdown with exactly these sections, in this order:',
  '# <App name, two or three words>',
  '<one sentence: what it does for the person>',
  '## Who and when — who opens it, in what moment, what they want to walk away with.',
  '## Core jobs — 3 to 5 bullets, each a verb-first job the app does end to end.',
  '## Screens and layout — each view, what is where (sidebar, main area, toolbar, cards), what the empty state says.',
  '## Interactions — pointer and keyboard, undo/redo where it edits, how errors show, what happens on reload.',
  '## What it remembers — the wos.storage keys and the shape of what each holds.',
  '## AI — only if AI makes the app better: each moment it asks, the exact system prompt it sends (an expert, demanding brief, never "keep it simple"; for generated visuals: palette, composition, hierarchy, detail, and a second pass where the model looks at the rendered result and improves it), and whether the answer is text or JSON. Write "None." if it needs none.',
  '## Design direction — within the kit: hierarchy, density, typography moments, the one detail that makes it feel crafted.',
  '## Acceptance checks — 8 to 12 lines "- [ ] …", each something a reviewer can see in the running app or its files (no vague "feels good").',
  '## Later — 3 to 5 lines "- …", each a next improvement phrased as the request the person would type.',
  'Answer with the brief only: no preamble, no code fences around it.',
].join('\n')

/** The checks of a brief ("- [ ] …" under "## Acceptance checks"). */
export function briefChecks(brief: string): string[] {
  const at = brief.search(/^##\s+Acceptance checks/im)
  if (at < 0) return []
  const rest = brief.slice(at).split(/\n(?=##\s)/)[0]
  return [...rest.matchAll(/^\s*-\s*\[[ xX]?\]\s*(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean)
}

/** Writes Apps/<slug>/BRIEF.md from the person's idea. Returns the brief, or throws when no usable brief came back. */
export async function writeBrief(root: string, slug: string, idea: string): Promise<{ brief: string; checks: number }> {
  const r = await runSeeing({ prompt: `The idea, in the person's words:\n\n${idea.trim()}`, systemPrompt: BRIEF_SYSTEM })
  const brief = r.text.trim().replace(/^```(?:markdown|md)?\s*|\s*```$/g, '')
  const checks = briefChecks(brief)
  if (!/^#\s+\S/m.test(brief) || checks.length < 3) throw new Error('No usable brief came back')
  fs.writeFileSync(path.join(appDir(root, slug), BRIEF_FILE), brief.endsWith('\n') ? brief : brief + '\n')
  return { brief, checks: checks.length }
}

export interface Review {
  checks: { check: string; met: boolean; note: string }[]
  looks: string[]
  next: string[]
}

const clip = (v: unknown, n: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '')

/** A review answer, defensively: anything malformed is dropped, never thrown. */
export function parseReview(text: string): Review | null {
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  let raw: unknown
  try {
    raw = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
  const checks = list(o.checks)
    .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>) : {}))
    .map((c) => ({ check: clip(c.check, 300), met: c.met === true, note: clip(c.note, 300) }))
    .filter((c) => c.check)
    .slice(0, 20)
  const looks = list(o.looks).map((l) => clip(l, 300)).filter(Boolean).slice(0, 6)
  const next = list(o.next).map((l) => clip(l, 240)).filter(Boolean).slice(0, 3)
  return { checks, looks, next }
}

const REVIEW_SYSTEM = [
  'You are a demanding QA lead and product designer reviewing ONE small app built inside Workspace OS, after the builder\'s latest turn. You get its product brief (if it has one), its files, and a screenshot of it running (if one could be taken).',
  PLATFORM,
  'Judge what is really there, not what the code intends: a button that is wired but shows nothing, an empty state that never appears, text cut off, things overlapping, a control that does not fit the kit, an AI prompt in the code that will give mediocre results.',
  'Answer with JSON only, no fences: {"checks": [{"check": "<the acceptance check, as written>", "met": true|false, "note": "<why not, briefly; empty when met>"}], "looks": ["<a visible problem in the screenshot, concrete>"], "next": ["<a next step the person could ask for, as the request they would type>", …3 items]}.',
  'With no brief, "checks" is []. "looks" holds only real problems (it may be empty). "next" are the three most valuable next steps, specific to this app, not generic polish.',
].join('\n')

/** The app's own text files for a review, capped so a big app still fits. */
export function appSources(root: string, slug: string): string {
  const dir = appDir(root, slug)
  const parts: string[] = []
  let total = 0
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => /\.(html?|m?js|css|json)$/i.test(f)).sort()
  } catch {
    return ''
  }
  for (const f of files) {
    if (total > 160_000) break
    let text = ''
    try {
      text = fs.readFileSync(path.join(dir, f), 'utf8').slice(0, 60_000)
    } catch {
      continue
    }
    total += text.length
    parts.push(`--- ${f} ---\n${text}`)
  }
  return parts.join('\n\n')
}

/** Reviews the app as it is now. Null when the review gave nothing usable. */
export async function reviewApp(root: string, slug: string, shot: Buffer | null, tests = ''): Promise<Review | null> {
  let brief = ''
  try {
    brief = fs.readFileSync(path.join(appDir(root, slug), BRIEF_FILE), 'utf8')
  } catch {
    /* an app from before the harness, or the gallery */
  }
  const name = readManifest(root, slug)?.name ?? slug
  const prompt = [
    `The app: ${name} (Apps/${slug}/).`,
    brief ? `Its product brief:\n\n${brief}` : 'It has no product brief.',
    `Its files:\n\n${appSources(root, slug)}`,
    tests ? `Its end-to-end tests, just run in the live app with real clicks: ${tests}` : '',
    shot ? 'The image is a screenshot of it running now.' : 'No screenshot could be taken this time.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await runSeeing({ prompt, systemPrompt: REVIEW_SYSTEM, images: shot ? [{ data: shot, ext: 'png' }] : [] })
  return parseReview(r.text)
}
