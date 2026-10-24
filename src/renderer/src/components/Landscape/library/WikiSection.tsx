import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Plus, Search, Undo2 } from 'lucide-react'
import type { WikiChange, WikiCheck, WikiStatus } from '../../../types/workspace-api'
import { relPath } from './libraryModel'
import styles from './WikiSection.module.css'
import { basename as pathBase, segments, joinPath } from '../../../lib/paths'

/** Files with text worth a page; mirrors the main side's READABLE. */
const READABLE = /\.(md|markdown|txt|docx|xlsx|pptx|pdf|csv|html?)$/i
const own = (rel: string, wiki: string): boolean => rel.startsWith(wiki) || rel.startsWith('.workspace-os') || segments(rel).some((s) => s.startsWith('.'))

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** "From Offer.docx: new Northwind, Anna Berg · updated Contoso" */
function changeLine(c: WikiChange): string {
  const parts = [c.created.length && `new ${c.created.join(', ')}`, c.updated.length && `updated ${c.updated.join(', ')}`].filter(Boolean)
  return `From ${pathBase(c.source)}: ${parts.join(' · ') || 'nothing changed'}`
}

/**
 * The wiki that keeps itself (Library → Notes): add files, watch them being
 * read, see what each one changed and undo it, and read again what changed.
 */
/** `wiki`: the Wiki folder's workspace-relative prefix, 'Wiki/' unless a content root is set. */
export function WikiSection({ root, wiki = 'Wiki/', pages }: { root: string; wiki?: string; pages: number }): JSX.Element {
  const [status, setStatus] = useState<WikiStatus | null>(null)
  const [recent, setRecent] = useState<WikiChange[]>([])
  const [health, setHealth] = useState<WikiCheck | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const w = window.workspace.wiki
    const [s, c, h, src] = await Promise.all([w.status(), w.changes(5), w.check(), w.sources()]).catch(() => [null, [], null, []] as const)
    setStatus(s)
    setRecent([...c])
    setHealth(h)
    setAdded(new Set(src))
  }, [])

  useEffect(() => {
    void load()
    return window.workspace.wiki.onChanged(() => void load())
  }, [load, root])

  // While files are being read, the line under the title follows them.
  useEffect(() => {
    if (!status?.busy && !status?.queued) return
    const t = window.setInterval(() => void load(), 2000)
    return () => window.clearInterval(t)
  }, [status?.busy, status?.queued, load])

  useEffect(() => {
    if (!picking) return
    let live = true
    void window.workspace.fs
      .listFiles()
      .then((l) => live && setFiles(l.filter((p) => READABLE.test(p) && !own(relPath(p, root), wiki))))
      .catch(() => live && setFiles([]))
    return () => {
      live = false
    }
  }, [picking, root])

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return files.filter((p) => !needle || relPath(p, root).toLowerCase().includes(needle))
  }, [files, q, root])
  const shown = matches.slice(0, 30)

  const add = async (paths: string[], again = false): Promise<void> => {
    try {
      const r = await window.workspace.wiki.add(paths, { again })
      const parts = [r.queued && `${plural(r.queued, 'file')} to read`, r.unchanged && `${plural(r.unchanged, 'file')} already in, unchanged`, r.left && `${r.left} more next time`].filter(Boolean)
      setNote(parts.join(' · ') || 'Nothing to read there.')
    } catch (e) {
      setNote(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not add that.')
    }
    void load()
  }

  const undo = async (id: string): Promise<void> => {
    const r = await window.workspace.wiki.undo(id)
    setNote(r.left.length ? `Undone, except ${r.left.join(', ')}: changed since, so left as it is.` : 'Undone.')
    void load()
  }

  const busy = !!status && (status.busy || status.queued > 0)
  return (
    <section className={styles.wiki} data-testid="wiki">
      <div className={styles.head}>
        <BookOpen size={16} />
        <span className={styles.title}>Wiki</span>
        <span className={styles.sub} data-testid="wiki-line">
          {busy
            ? `Reading ${(status?.current ? pathBase(status?.current) : undefined) ?? 'the next file'}…${status && status.queued ? ` ${status.queued} more waiting.` : ''}`
            : pages
              ? `${plural(pages, 'page')} kept from ${plural(added.size, 'file')}. Edit any page; the next update builds on it.`
              : 'Add files and the agent writes a page for each person, organization, project and topic in them, linked to each other.'}
        </span>
        <button type="button" className={styles.btn} onClick={() => setPicking((v) => !v)} data-testid="wiki-add">
          <Plus size={14} /> Add files…
        </button>
      </div>

      {note && <p className={styles.note} data-testid="wiki-note">{note}</p>}
      {!!status?.failed.length && !busy && (
        <p className={styles.note} data-testid="wiki-failed">
          Could not read {status.failed.map((f) => `${pathBase(f.source)} (${f.error})`).join(', ')}.
        </p>
      )}

      {picking && (
        <div className={styles.picker}>
          <label className={styles.search}>
            <Search size={14} />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find files, or type a folder like Work/" aria-label="Find files to add" data-testid="wiki-find" />
          </label>
          <ul className={styles.files}>
            {shown.map((p) => {
              const rel = relPath(p, root)
              const isIn = added.has(rel)
              return (
                <li key={p}>
                  <button type="button" className={styles.file} onClick={() => void add([p])} data-wiki-file={rel}>
                    <span className={styles.fileName}>{rel}</span>
                    <span className={styles.tag}>{isIn ? 'in the wiki' : 'add'}</span>
                  </button>
                </li>
              )
            })}
            {!shown.length && <li className={styles.quiet}>No documents match.</li>}
          </ul>
          {q.trim() && matches.length > 1 && (
            <button type="button" className={styles.btn} onClick={() => void add(matches)} data-testid="wiki-add-all">
              Add all {matches.length}
            </button>
          )}
        </div>
      )}

      {!!health?.changed.length && (
        <p className={styles.row} data-testid="wiki-changed">
          {plural(health.changed.length, 'file')} changed since added: {health.changed.map((c) => pathBase(c)).join(', ')}.
          <button type="button" className={styles.link} onClick={() => void add(health.changed.map((c) => joinPath(root, c)), true)} data-testid="wiki-reread">
            Read again
          </button>
        </p>
      )}
      {!!health?.missing.length && (
        <p className={styles.row}>
          {plural(health.missing.length, 'source')} no longer there: {health.missing.map((c) => pathBase(c)).join(', ')}. Their pages stay.
        </p>
      )}

      {recent.length > 0 && (
        <ul className={styles.changes} data-testid="wiki-changes">
          {recent.map((c) => (
            <li key={c.id} className={styles.change}>
              <span className={styles.changeText}>
                {changeLine(c)}
                {c.kept.length > 0 && <span className={styles.kept}> · left {c.kept.map((k) => `${k.title} (${k.why})`).join(', ')}</span>}
              </span>
              <button type="button" className={styles.link} onClick={() => void undo(c.id)} title="Put these pages back as they were" data-testid="wiki-undo">
                <Undo2 size={12} /> Undo
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
