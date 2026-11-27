import { useState, useEffect, useMemo } from 'react'
import { pickableFiles } from './workspaceAttachModel'
import styles from './MailCompose.module.css'

/** A search-and-pick list of the open workspace's files, inside the compose window. */
export function WorkspaceFilePicker({
  disabled,
  onPick,
  onClose,
}: {
  disabled: boolean
  onPick: (path: string) => void
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [listing, setListing] = useState<{ root: string; files: string[] } | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([window.workspace.fs.getWorkspaceRoot(), window.workspace.fs.listFiles()])
      .then(([root, files]) => { if (live) setListing({ root: root ?? '', files }) })
      .catch(() => { if (live) setListing({ root: '', files: [] }) })
    return () => { live = false }
  }, [])

  const results = useMemo(
    () => (listing ? pickableFiles(listing.files, listing.root, query) : []),
    [listing, query],
  )

  return (
    <div className={styles.picker}>
      <input
        autoFocus
        className={styles.pickerInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}
        placeholder="Find a workspace file to attach…"
        spellCheck={false}
      />
      <div className={styles.pickerList}>
        {results.map((f) => (
          <button key={f.path} type="button" className={styles.suggestion} disabled={disabled} onClick={() => onPick(f.path)}>
            <span className={styles.suggestName}>{f.rel}</span>
          </button>
        ))}
        {listing && results.length === 0 && <div className={styles.pickerEmpty}>No matching file.</div>}
      </div>
    </div>
  )
}
