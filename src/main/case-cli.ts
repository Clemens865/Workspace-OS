/*
 * wos-case — Workspace OS case CLI.
 *
 * Create and update the durable "cases" a workspace holds, straight from the
 * terminal — so an agent's terminal work (research, screenshots, generated
 * CSVs) lands in a case with its timeline, artifacts and declared view, instead
 * of scattering into loose files. Sibling of wos-metric / wos-collection.
 *
 * Cases are plain markdown under `$WOS_WORKSPACE/Cases/`, so this writes files
 * directly — no running app, no bridge, fail-safe by construction. It REUSES
 * the app's own serialize/parse (cases.ts) so a CLI-written case is byte-for-
 * byte what the app writes, and the app reads it back unchanged. serializeCase
 * preserves a case's `## View` block, so `note`/`status`/`attach` never wipe a
 * curated view an agent wrote earlier.
 *
 * Commands:
 *   wos-case new "<title>" [--type task] [--desc "..."] [--subject "..."] [--status <s>] [--attach <file>]...
 *   wos-case ls [--json]
 *   wos-case get <id> [--json]
 *   wos-case note <id> "<text>" [--author agent|you|system]
 *   wos-case attach <id> <file>...
 *   wos-case status <id> <status>
 *   wos-case view <id> <spec.json|->     # set the curated view block (Layer 2)
 */
import fs from 'fs'
import path from 'path'
import { serializeCase, parseCase, slugify, statusesFor, type WorkCase, type CaseAuthor } from './cases'

const DIR = 'Cases'

function workspaceRoot(): string {
  const r = process.env['WOS_WORKSPACE']
  if (!r) fail('no workspace open (WOS_WORKSPACE unset) — open a workspace in Workspace OS first.')
  return r as string
}
const casesDir = (): string => path.join(workspaceRoot(), DIR)
const casePath = (id: string): string => path.join(casesDir(), id + '.md')
const nowIso = (): string => new Date().toISOString()

function loadCase(id: string): WorkCase | null {
  try {
    return parseCase(id, fs.readFileSync(casePath(id), 'utf8'))
  } catch {
    return null
  }
}
function writeCase(c: WorkCase): void {
  fs.mkdirSync(casesDir(), { recursive: true })
  fs.writeFileSync(casePath(c.id), serializeCase(c), 'utf8')
}
/** Store artifacts workspace-relative when they live under it — how the app does. */
function relToWorkspace(p: string): string {
  const abs = path.resolve(p)
  const root = path.resolve(workspaceRoot())
  return abs === root || abs.startsWith(root + path.sep) ? path.relative(root, abs) : p
}

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string[]> } {
  const positional: string[] = []
  const flags: Record<string, string[]> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const k = a.slice(2)
      const next = argv[i + 1]
      const v = next && !next.startsWith('--') ? argv[++i] : 'true'
      ;(flags[k] ||= []).push(v)
    } else positional.push(a)
  }
  return { positional, flags }
}

function fail(msg: string): never {
  console.error('wos-case: ' + msg)
  process.exit(1)
}
function need(id: string | undefined): WorkCase {
  if (!id) fail('missing <id>')
  const c = loadCase(id as string)
  if (!c) fail(`no such case "${id}"`)
  return c as WorkCase
}
function done(json: boolean, obj: unknown, human: string): void {
  console.log(json ? JSON.stringify(obj, null, 2) : human)
}

function main(): void {
  const [cmd, ...rest] = process.argv.slice(2)
  const { positional, flags } = parseArgs(rest)
  const json = 'json' in flags
  const f1 = (k: string): string | undefined => flags[k]?.[0]

  switch (cmd) {
    case 'new': {
      const title = positional[0]
      if (!title) fail('usage: wos-case new "<title>" [--type task] [--desc ...] [--attach file]...')
      const type = f1('type') || 'task'
      const id = slugify(title)
      if (loadCase(id)) fail(`case "${id}" already exists (use: wos-case note/attach/status ${id})`)
      const c: WorkCase = {
        id,
        type,
        title,
        description: f1('desc') || f1('description') || '',
        subject: f1('subject') || '',
        status: f1('status') || statusesFor(type)[0] || 'open',
        artifacts: (flags['attach'] || []).map(relToWorkspace),
        acted: [],
        notes: [],
        created: nowIso(),
        updated: nowIso(),
      }
      writeCase(c)
      done(json, { id, path: casePath(id) }, `created case "${id}" → ${path.relative(workspaceRoot(), casePath(id))}`)
      break
    }
    case 'ls': {
      const dir = casesDir()
      const ids = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith('.md')).map((n) => n.replace(/\.md$/, '')) : []
      const cases = ids.map(loadCase).filter((c): c is WorkCase => !!c)
      if (json) return void console.log(JSON.stringify(cases.map((c) => ({ id: c.id, status: c.status, type: c.type, title: c.title, artifacts: c.artifacts.length, notes: c.notes.length })), null, 2))
      if (!cases.length) return void console.log('(no cases)')
      for (const c of cases) console.log(`${c.id.padEnd(28)} ${c.status.padEnd(12)} ${c.title}`)
      break
    }
    case 'get': {
      const c = need(positional[0])
      console.log(json ? JSON.stringify(c, null, 2) : serializeCase(c))
      break
    }
    case 'note': {
      const c = need(positional[0])
      const text = positional[1]
      if (!text) fail('usage: wos-case note <id> "<text>" [--author agent|you|system]')
      const author = (f1('author') || 'agent') as CaseAuthor
      c.notes.push({ at: nowIso(), author, text })
      c.updated = nowIso()
      writeCase(c)
      done(json, { id: c.id, notes: c.notes.length }, `noted on "${c.id}"`)
      break
    }
    case 'attach': {
      const c = need(positional[0])
      const files = positional.slice(1)
      if (!files.length) fail('usage: wos-case attach <id> <file>...')
      for (const f of files) {
        const rel = relToWorkspace(f)
        if (!c.artifacts.includes(rel)) c.artifacts.push(rel)
      }
      c.updated = nowIso()
      writeCase(c)
      done(json, { id: c.id, artifacts: c.artifacts }, `attached ${files.length} file(s) to "${c.id}"`)
      break
    }
    case 'status': {
      const c = need(positional[0])
      const s = positional[1]
      if (!s) fail('usage: wos-case status <id> <status>')
      const allowed = statusesFor(c.type)
      if (!allowed.includes(s)) fail(`invalid status "${s}" for type ${c.type}. allowed: ${allowed.join(', ')}`)
      c.notes.push({ at: nowIso(), author: 'system', text: `Status → ${s}` })
      c.status = s
      c.updated = nowIso()
      writeCase(c)
      done(json, { id: c.id, status: s }, `"${c.id}" → ${s}`)
      break
    }
    case 'view': {
      const c = need(positional[0])
      const src = positional[1]
      if (!src) fail('usage: wos-case view <id> <spec.json|->  (- reads stdin)')
      const raw = (src === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(src, 'utf8')).trim()
      try {
        JSON.parse(raw)
      } catch {
        fail('view spec is not valid JSON')
      }
      c.viewBlock = raw
      c.updated = nowIso()
      writeCase(c)
      done(json, { id: c.id }, `view set on "${c.id}"`)
      break
    }
    default:
      console.error('wos-case — commands: new, ls, get, note, attach, status, view')
      process.exit(cmd ? 1 : 0)
  }
}

main()
