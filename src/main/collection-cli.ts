/*
 * wos-collection — Workspace OS Collections CLI (backs agent-driven collections).
 *
 * A standalone `node` CLI (no electron runtime) that reads/creates/refreshes and
 * syncs the SAME live collections the app uses. It REUSES the app's engine-free
 * stores + writers/readers (collections.ts, collectionLinks.ts, xlsx-range-*,
 * docx/pptx table writers) — it only constructs its own store instances pointed
 * at the same userData JSON files (resolved without electron). Mirrors
 * metric-cli.ts exactly (arg parsing, `--json`, `fail()`, exit codes).
 *
 * A Collection is a set of TYPED RECORDS (row 0 = field names). A live VIEW
 * (filter/sort/limit) turns a bound block into a query. On sync the viewed
 * records are projected through a column mapping into a grid and stamped into
 * every CLOSED linked file via the engine-free writers.
 *
 * Commands:
 *   wos-collection list [--json]
 *   wos-collection get <name> [--json]
 *   wos-collection records <name> [--json]
 *   wos-collection create <name> --source <file.xlsx!Sheet!A1:C20> [--json]
 *   wos-collection refresh <name> [--json] / refresh-all [--json]
 *   wos-collection view <name> [--filter "field op value"]... [--sort "field:desc"]... [--limit N] [--json]
 *   wos-collection link <name> --file <doc> --target <anchorTag|xlsx:Sheet!A1>
 *                        --columns "field:Header,field2:Header2" [--filter ...] [--sort ...] [--limit N] [--json]
 *   wos-collection links [<name>] [--file <doc>] [--json]
 *   wos-collection sync <name> [--json] / sync-all [--json]
 *
 * HONEST LIMITATION: the writers UPDATE an EXISTING anchored table/range. For a
 * docx/pptx the app must have first inserted a `wos-collection-<tag>` anchor;
 * xlsx can write a fresh range at any ref. The CLI does NOT insert a new table
 * into a closed docx/pptx (that needs the LOK engine) — see `--help`.
 *
 * Fail-safe: a missing/locked/formula file is skip-and-reported (never corrupts);
 * an unknown collection or bad view/arg is a clear error with a non-zero exit.
 */
import {
  CollectionStore,
  isSourcedCollection,
  planCollectionRefresh,
  gridToRecords,
  recordCell,
  type Collection,
  type CollectionRecord,
} from './collections'
import {
  CollectionLinkStore,
  applyView,
  planCollectionSyncAll,
  type ViewFilter,
  type ViewSort,
  type CollectionLink,
  type CollectionLinkTarget,
} from './collectionLinks'
import { readRange } from './xlsx-range-reader'
import { setRangeValues } from './xlsx-range-writer'
import { setDocTableCells } from './docx-table-writer'
import { setSlideTableCells } from './pptx-table-writer'
import type { RangeGrid } from './ranges'
import { userDataFile } from './userdata-path'
import {
  parseArgs,
  parseSourceSpec,
  parseFilter,
  parseSort,
  parseColumns,
  parseTarget,
  buildView,
} from './collection-cli-args'

// Stores bound to the app's real userData JSON files (same files the app uses).
const collections = new CollectionStore(() => userDataFile('collections.json'))
const collectionLinks = new CollectionLinkStore(() => userDataFile('collection-links.json'))

// ---- small output helpers (mirrors metric-cli) ---------------------------

interface Out {
  json: boolean
  lines: string[]
  data: Record<string, unknown>
}
function say(o: Out, line: string): void {
  o.lines.push(line)
}
function emit(o: Out, code: number): never {
  if (o.json) process.stdout.write(JSON.stringify({ ok: code === 0, ...o.data }, null, 2) + '\n')
  else if (o.lines.length) process.stdout.write(o.lines.join('\n') + '\n')
  process.exit(code)
}
function fail(json: boolean, msg: string, extra: Record<string, unknown> = {}): never {
  if (json) process.stdout.write(JSON.stringify({ ok: false, error: msg, ...extra }, null, 2) + '\n')
  else process.stderr.write(`error: ${msg}\n`)
  process.exit(1)
}

/** Finds a collection by exact name (case-insensitive), or reports ambiguity. */
function findByName(name: string): { collection?: Collection; error?: string } {
  const all = collections.list()
  const exact = all.filter((c) => c.name === name)
  if (exact.length === 1) return { collection: exact[0] }
  if (exact.length > 1) return { error: `collection name "${name}" is ambiguous (${exact.length} matches)` }
  const ci = all.filter((c) => c.name.toLowerCase() === name.toLowerCase())
  if (ci.length === 1) return { collection: ci[0] }
  if (ci.length > 1) return { error: `collection name "${name}" is ambiguous (${ci.length} matches)` }
  return { error: `no collection named "${name}"` }
}

function sourceLabel(c: Collection): string {
  return isSourcedCollection(c) ? `${c.source.filePath}!${c.source.sheet || '?'}!${c.source.ref}` : 'literal'
}

function targetLabel(t: CollectionLinkTarget): string {
  if (t.kind === 'xlsx-block') return `${t.sheet ? `${t.sheet}!` : ''}${t.cell}`
  if (t.kind === 'pptx-table') return `⟨slide table ${t.tag}⟩`
  return `⟨word table ${t.tag}⟩`
}

/** Writes one closed-file collection link's block to `grid` via the range writers. */
async function writeClosedLink(link: CollectionLink, grid: RangeGrid): Promise<{ ok: boolean; reason?: string }> {
  if (link.target.kind === 'xlsx-block') return setRangeValues(link.filePath, link.target.sheet, link.target.cell, grid)
  if (link.target.kind === 'pptx-table') return setSlideTableCells(link.filePath, link.target.tag, grid)
  return setDocTableCells(link.filePath, link.target.tag, grid)
}

/**
 * Pushes a collection's CURRENT viewed layout into every closed linked file on
 * disk. Mirrors collectionLink:syncAll in handlers/collections.ts: reuse
 * planCollectionSyncAll + the writers, advance lastGrid on success (preserving
 * the view), skip-and-report on any write failure.
 */
async function propagate(
  collection: Collection
): Promise<{ updated: { file: string; label: string }[]; skipped: { file: string; label: string; reason: string }[]; unchanged: number }> {
  const plan = planCollectionSyncAll(collectionLinks.forCollection(collection.id), collection, null)
  const updated: { file: string; label: string }[] = []
  const skipped: { file: string; label: string; reason: string }[] = []
  for (const { link, grid } of plan.toWrite) {
    const label = targetLabel(link.target)
    const res = await writeClosedLink(link, grid)
    if (res.ok) {
      collectionLinks.add({
        collectionId: link.collectionId,
        filePath: link.filePath,
        target: link.target,
        columns: link.columns,
        view: link.view,
        lastGrid: grid,
      })
      updated.push({ file: link.filePath, label })
    } else {
      skipped.push({ file: link.filePath, label, reason: res.reason ?? 'unknown' })
    }
  }
  return { updated, skipped, unchanged: plan.unchanged.length + plan.openSkipped.length }
}

/** Re-reads a sourced collection from its range; if changed, updates the store. */
async function refreshCollection(c: Collection): Promise<{ status: string; collection: Collection }> {
  if (!isSourcedCollection(c)) return { status: 'literal', collection: c }
  const read = await readRange(c.source.filePath, c.source.sheet, c.source.ref)
  const plan = planCollectionRefresh(c, read)
  if (plan.status === 'updated') {
    const updated = collections.update(c.id, { fields: plan.fields, records: plan.records })
    return { status: 'updated', collection: updated ?? c }
  }
  return { status: plan.status, collection: c }
}

// ---- arg parsing lives in collection-cli-args.ts (pure, unit-testable). ----

const HELP = `wos-collection — Workspace OS Collections CLI (live records → office tables)

Commands:
  list                                     list all collections
  get <name>                               show a collection + its links
  records <name>                           print a collection's records
  create <name> --source <file.xlsx!Sheet!A1:C20>
                                           create from a range (row 0 = field names)
  refresh <name> | refresh-all             re-read sourced collections from disk
  view <name> [--filter "field op value"]... [--sort "field:desc"]... [--limit N]
                                           preview a live query's resulting records
  link <name> --file <doc> --target <anchorTag|xlsx:Sheet!A1>
       --columns "field:Header,field2:Header2" [--filter ...] [--sort ...] [--limit N]
                                           bind a collection (with an optional view) to a target block
  links [<name>] [--file <doc>]            list links (optionally by collection/file)
  sync <name> | sync-all                   push viewed records into every CLOSED linked file

Filters:  --filter "revenue > 1000"   ops: = != contains > >= < <=
Sort:     --sort "revenue:desc"       (dir optional; defaults asc)
Add --json to any command for machine-readable output.

LIMITATION: the CLI UPDATES an EXISTING anchored table/range. A docx/pptx target
needs a 'wos-collection-<tag>' table anchor that the app inserted first; an xlsx
target can be any range ref. The CLI CANNOT insert a NEW table into a closed
docx/pptx — that requires the LibreOffice (LOK) engine inside the app.`

// ---- commands -------------------------------------------------------------

function reportPropagation(
  o: Out,
  res: { updated: { file: string; label: string }[]; skipped: { file: string; label: string; reason: string }[]; unchanged: number }
): void {
  o.data['updated'] = res.updated
  o.data['skipped'] = res.skipped
  o.data['unchanged'] = res.unchanged
  say(o, `synced: ${res.updated.length} updated, ${res.skipped.length} skipped, ${res.unchanged} already in sync`)
  for (const u of res.updated) say(o, `  ✓ ${u.file} (${u.label})`)
  for (const s of res.skipped) say(o, `  ✗ ${s.file} (${s.label}) — ${s.reason}`)
}

/** Renders records as printable rows keyed by the collection's fields. */
function recordsToJson(fields: string[], records: CollectionRecord[]): Record<string, unknown>[] {
  return records.map((rec) => {
    const row: Record<string, unknown> = {}
    for (const f of fields) row[f] = recordCell(rec, f)
    return row
  })
}
function sayRecords(o: Out, fields: string[], records: CollectionRecord[]): void {
  say(o, fields.join(' | '))
  for (const rec of records) say(o, fields.map((f) => String(recordCell(rec, f) ?? '')).join(' | '))
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const cmd = args._[0]
  const o: Out = { json: args.json, lines: [], data: {} }

  if (args.help || cmd === 'help' || cmd === undefined) {
    if (args.json) { o.data['help'] = HELP; emit(o, 0) }
    process.stdout.write(HELP + '\n')
    process.exit(0)
  }

  switch (cmd) {
    case 'list': {
      const list = collections.list()
      o.data['collections'] = list.map((c) => ({
        name: c.name,
        fields: c.fields,
        records: c.records.length,
        source: sourceLabel(c),
        links: collectionLinks.forCollection(c.id).length,
      }))
      say(o, `${list.length} collection(s):`)
      for (const c of list) {
        say(o, `  ${c.name}  (${c.records.length} record(s), ${c.fields.length} field(s))  [${sourceLabel(c)}]  ${collectionLinks.forCollection(c.id).length} link(s)`)
      }
      emit(o, 0)
      break
    }
    case 'get': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection get <name>')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      const links = collectionLinks.forCollection(collection.id)
      o.data['collection'] = {
        name: collection.name,
        fields: collection.fields,
        records: collection.records.length,
        source: sourceLabel(collection),
        links: links.map((l) => ({ file: l.filePath, target: targetLabel(l.target), columns: l.columns.map((c) => c.field) })),
      }
      say(o, `${collection.name}  (${collection.records.length} record(s))`)
      say(o, `fields: ${collection.fields.join(', ')}`)
      say(o, `source: ${sourceLabel(collection)}`)
      say(o, `${links.length} linked file(s):`)
      for (const l of links) say(o, `  ${l.filePath} (${targetLabel(l.target)}) — cols ${l.columns.map((c) => c.field).join(',')}`)
      emit(o, 0)
      break
    }
    case 'records': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection records <name>')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      o.data['fields'] = collection.fields
      o.data['records'] = recordsToJson(collection.fields, collection.records)
      sayRecords(o, collection.fields, collection.records)
      emit(o, 0)
      break
    }
    case 'create': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection create <name> --source <file.xlsx!Sheet!A1:C20>')
      if (!args.source) fail(args.json, 'create needs --source <file.xlsx!Sheet!A1:C20>')
      const src = parseSourceSpec(args.source)
      if (!src) fail(args.json, `bad --source (want file.xlsx!Sheet!A1:C20): ${args.source}`)
      const read = await readRange(src.filePath, src.sheet, src.ref)
      if (!read.ok || !read.values) fail(args.json, `source range not readable: ${read.reason ?? 'unknown'}`)
      const parsed = gridToRecords(read.values!)
      if (!parsed) fail(args.json, 'source range has no header row')
      const c = collections.create(name, parsed.fields, parsed.records, { kind: 'xlsx-range', ...src })
      o.data['name'] = c.name
      o.data['fields'] = c.fields
      o.data['records'] = c.records.length
      o.data['source'] = sourceLabel(c)
      say(o, `created ${c.name} — ${c.records.length} record(s), fields [${c.fields.join(', ')}]  [${sourceLabel(c)}]`)
      emit(o, 0)
      break
    }
    case 'refresh': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection refresh <name>')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      const r = await refreshCollection(collection)
      o.data['status'] = r.status
      o.data['records'] = r.collection.records.length
      say(o, `refresh ${r.collection.name}: ${r.status} (${r.collection.records.length} record(s))`)
      if (r.status === 'updated') reportPropagation(o, await propagate(r.collection))
      emit(o, 0)
      break
    }
    case 'refresh-all': {
      const sourced = collections.list().filter(isSourcedCollection)
      const results: { name: string; status: string; records: number }[] = []
      let propagatedFiles = 0
      for (const c of sourced) {
        const r = await refreshCollection(c)
        results.push({ name: r.collection.name, status: r.status, records: r.collection.records.length })
        if (r.status === 'updated') {
          const p = await propagate(r.collection)
          propagatedFiles += p.updated.length
          say(o, `updated ${r.collection.name} → ${p.updated.length} file(s)`)
          for (const s of p.skipped) say(o, `  ✗ ${s.file} — ${s.reason}`)
        }
      }
      o.data['results'] = results
      o.data['propagatedFiles'] = propagatedFiles
      say(o, `refresh-all: ${sourced.length} sourced collection(s), ${results.filter((r) => r.status === 'updated').length} changed, ${propagatedFiles} file(s) updated`)
      emit(o, 0)
      break
    }
    case 'view': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection view <name> [--filter ...] [--sort ...] [--limit N]')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      const filters: ViewFilter[] = []
      for (const f of args.filters) {
        const pf = parseFilter(f)
        if (!pf) fail(args.json, `bad --filter (want "field op value"): ${f}`)
        filters.push(pf)
      }
      const sorts: ViewSort[] = []
      for (const s of args.sorts) {
        const ps = parseSort(s)
        if (!ps) fail(args.json, `bad --sort (want "field:desc"): ${s}`)
        sorts.push(ps)
      }
      if (args.limit !== undefined && (!Number.isFinite(args.limit) || args.limit < 0)) {
        fail(args.json, `bad --limit (want a non-negative number): ${args.limit}`)
      }
      const view = buildView(filters, sorts, args.limit)
      const viewed = applyView(collection.records, view)
      o.data['fields'] = collection.fields
      o.data['count'] = viewed.length
      o.data['records'] = recordsToJson(collection.fields, viewed)
      sayRecords(o, collection.fields, viewed)
      emit(o, 0)
      break
    }
    case 'link': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection link <name> --file <doc> --target <...> --columns "f:H,..."')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      if (!args.file) fail(args.json, 'link needs --file <doc>')
      if (!args.target) fail(args.json, 'link needs --target <anchorTag|xlsx:Sheet!A1>')
      if (!args.columns) fail(args.json, 'link needs --columns "field:Header,field2:Header2"')
      let target = parseTarget(args.target)
      if (!target) fail(args.json, `bad --target: ${args.target}`)
      // For a table anchor, pick docx vs pptx by the file extension.
      if (target!.kind === 'docx-table' && /\.pptx$/i.test(args.file)) {
        target = { kind: 'pptx-table', tag: target!.tag }
      }
      const columns = parseColumns(args.columns)
      if (!columns.length) fail(args.json, `bad --columns (want "field:Header,..."): ${args.columns}`)
      const filters: ViewFilter[] = []
      for (const f of args.filters) {
        const pf = parseFilter(f)
        if (!pf) fail(args.json, `bad --filter: ${f}`)
        filters.push(pf)
      }
      const sorts: ViewSort[] = []
      for (const s of args.sorts) {
        const ps = parseSort(s)
        if (!ps) fail(args.json, `bad --sort: ${s}`)
        sorts.push(ps)
      }
      const view = buildView(filters, sorts, args.limit)
      // Seed lastGrid with a header-only BASELINE (not the current rendered grid)
      // so the FIRST `sync` diverges and actually stamps the initial layout into
      // the target file. (The in-app link handler instead receives the already-
      // written grid from the renderer; a CLI-first link has no such pre-write.)
      let link: CollectionLink
      try {
        link = collectionLinks.add({
          collectionId: collection.id,
          filePath: args.file,
          target: { ...target! } as unknown,
          columns,
          view,
          lastGrid: [columns.map((c) => c.header)],
        })
      } catch (e) {
        fail(args.json, e instanceof Error ? e.message : 'invalid collection link')
      }
      o.data['file'] = link!.filePath
      o.data['target'] = targetLabel(link!.target)
      o.data['columns'] = link!.columns.map((c) => `${c.field}:${c.header}`)
      say(o, `linked ${collection.name} → ${link!.filePath} (${targetLabel(link!.target)})`)
      say(o, `  columns: ${link!.columns.map((c) => `${c.field}→${c.header}`).join(', ')}`)
      emit(o, 0)
      break
    }
    case 'links': {
      const name = args._[1]
      let list = collectionLinks.allLinks()
      if (name) {
        const { collection, error } = findByName(name)
        if (!collection) fail(args.json, error!)
        list = list.filter((l) => l.collectionId === collection.id)
      }
      if (args.file) list = list.filter((l) => l.filePath === args.file)
      const byId = new Map(collections.list().map((c) => [c.id, c.name]))
      o.data['links'] = list.map((l) => ({
        collection: byId.get(l.collectionId) ?? l.collectionId,
        file: l.filePath,
        target: targetLabel(l.target),
        columns: l.columns.map((c) => `${c.field}:${c.header}`),
        view: l.view ?? null,
      }))
      say(o, `${list.length} link(s):`)
      for (const l of list) say(o, `  ${byId.get(l.collectionId) ?? l.collectionId} → ${l.filePath} (${targetLabel(l.target)})`)
      emit(o, 0)
      break
    }
    case 'sync': {
      const name = args._[1]
      if (!name) fail(args.json, 'usage: wos-collection sync <name>')
      const { collection, error } = findByName(name)
      if (!collection) fail(args.json, error!)
      reportPropagation(o, await propagate(collection))
      emit(o, 0)
      break
    }
    case 'sync-all': {
      const list = collections.list()
      let totalUpdated = 0
      let totalSkipped = 0
      const perCollection: { name: string; updated: number; skipped: number; unchanged: number }[] = []
      for (const c of list) {
        const res = await propagate(c)
        totalUpdated += res.updated.length
        totalSkipped += res.skipped.length
        if (res.updated.length || res.skipped.length) {
          say(o, `${c.name}: ${res.updated.length} updated, ${res.skipped.length} skipped`)
          for (const s of res.skipped) say(o, `  ✗ ${s.file} (${s.label}) — ${s.reason}`)
        }
        perCollection.push({ name: c.name, updated: res.updated.length, skipped: res.skipped.length, unchanged: res.unchanged })
      }
      o.data['perCollection'] = perCollection
      o.data['totalUpdated'] = totalUpdated
      o.data['totalSkipped'] = totalSkipped
      say(o, `sync-all: ${totalUpdated} file(s) updated, ${totalSkipped} skipped across ${list.length} collection(s)`)
      emit(o, 0)
      break
    }
    default:
      fail(
        args.json,
        `unknown command "${cmd ?? ''}". Commands: list, get, records, create, refresh, refresh-all, view, link, links, sync, sync-all (run wos-collection --help)`
      )
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${(err as Error).message}\n`)
  process.exit(1)
})

export { parseArgs, parseSourceSpec, parseFilter, parseSort, parseColumns, parseTarget, buildView }
