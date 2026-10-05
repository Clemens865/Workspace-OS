/**
 * One wiki page: a markdown file in the workspace's `Wiki/` folder.
 *
 * Plain files on purpose. The person can read, edit, move or delete them like
 * any note; the search index finds them, agents search them first, and their
 * [[links]] are what the Notes graph draws. The small header (YAML front
 * matter, readable by Obsidian too) holds what the app needs to keep the page
 * up to date: what kind of thing it is about, a one-line summary for the index,
 * and the files it was written from.
 */

export const WIKI_DIR = 'Wiki'
export const INDEX_TITLE = 'Index'
export const PAGE_TYPES = ['person', 'organization', 'project', 'topic'] as const
export type PageType = (typeof PAGE_TYPES)[number]

export interface WikiPage {
  title: string
  type: PageType
  summary: string
  /** Day of the last change, YYYY-MM-DD. */
  updated: string
  /** Workspace-relative paths of the files the page was written from. */
  sources: string[]
  /** The page text below its heading. */
  body: string
}

/** The page's key: titles match case-insensitively, as [[links]] resolve. */
export const keyOf = (title: string): string => title.trim().toLowerCase()

/**
 * A title that is also a safe file name: it becomes `Wiki/<title>.md`, and a
 * [[link]] resolves by that name. No path separators, no characters a file
 * system or a [[link]] cannot hold, no leading dots.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .slice(0, 80)
    .trim()
}

export const fileNameOf = (title: string): string => `${cleanTitle(title)}.md`

const q = (s: string): string => JSON.stringify(s)
function unq(raw: string): string {
  const v = raw.trim()
  if (v.startsWith('"')) {
    try {
      return String(JSON.parse(v))
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

/** A markdown link target that survives spaces and brackets in a path. */
export function linkTo(sourceRel: string): string {
  const target = `../${sourceRel}`.replace(/[<>]/g, '')
  const name = sourceRel.split('/').pop() ?? sourceRel
  return `[${name.replace(/[[\]]/g, '')}](<${target}>)`
}

export function renderPage(p: WikiPage): string {
  const head = [
    '---',
    `title: ${q(p.title)}`,
    `type: ${p.type}`,
    `summary: ${q(p.summary)}`,
    `updated: ${p.updated}`,
    'sources:',
    ...p.sources.map((s) => `  - ${q(s)}`),
    '---',
  ]
  const sources = p.sources.length ? ['', '## Sources', '', ...p.sources.map((s) => `- ${linkTo(s)}`)] : []
  return [...head, '', `# ${p.title}`, '', p.body.trim(), ...sources, ''].join('\n')
}

/**
 * Read a page back. A page the person wrote or edited by hand still parses:
 * a missing header falls back to the file name, a missing type to topic.
 */
export function parsePage(text: string, fileTitle: string): WikiPage {
  let rest = text.replace(/\r\n/g, '\n')
  const meta: Record<string, string> = {}
  const sources: string[] = []
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(rest)
  if (fm) {
    let inSources = false
    for (const line of fm[1].split('\n')) {
      const item = /^\s+-\s+(.*)$/.exec(line)
      if (inSources && item) {
        sources.push(unq(item[1]))
        continue
      }
      const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line)
      if (!kv) continue
      inSources = kv[1] === 'sources'
      if (!inSources) meta[kv[1]] = unq(kv[2])
    }
    rest = rest.slice(fm[0].length)
  }
  const title = cleanTitle(meta.title ?? '') || fileTitle
  // The heading and the Sources list are the app's; the body is what lies between.
  rest = rest.replace(/^\s*#\s+[^\n]*\n/, '')
  const at = rest.search(/\n## Sources\s*\n/)
  const body = (at >= 0 ? rest.slice(0, at) : rest).trim()
  const type = PAGE_TYPES.includes(meta.type as PageType) ? (meta.type as PageType) : 'topic'
  return { title, type, summary: meta.summary ?? '', updated: meta.updated ?? '', sources, body }
}

/** Every [[link]] target on a page, by key. */
export function linksOf(body: string): string[] {
  const out = new Set<string>()
  for (const m of body.matchAll(/\[\[([^\][|#\n]+?)(?:#[^\][|\n]*)?(?:\|[^\][\n]*)?\]\]/g)) out.add(keyOf(m[1]))
  return [...out]
}

const GROUP: Record<PageType, string> = { person: 'People', organization: 'Organizations', project: 'Projects', topic: 'Topics' }

/** The wiki's front page: every page by kind, each with its one-line summary. */
export function renderIndex(pages: readonly WikiPage[], today: string): string {
  const lines = [
    '---',
    `title: ${q(INDEX_TITLE)}`,
    'type: index',
    `updated: ${today}`,
    '---',
    '',
    `# ${INDEX_TITLE}`,
    '',
    'Pages kept from the files added to this wiki: who and what matters in this workspace, and where each thing stands. Every page names the files it was written from. Edit any page; the next update builds on your text.',
  ]
  for (const type of PAGE_TYPES) {
    const group = pages.filter((p) => p.type === type).sort((a, b) => a.title.localeCompare(b.title))
    if (!group.length) continue
    lines.push('', `## ${GROUP[type]}`, '')
    for (const p of group) lines.push(`- [[${p.title}]]${p.summary ? ` — ${p.summary}` : ''}`)
  }
  return `${lines.join('\n')}\n`
}
