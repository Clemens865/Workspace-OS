import { useState, useMemo, useCallback } from 'react'
import { Sparkles, Loader2, AlertCircle, Plus, Trash2, BarChart3, Table2, Link2, FileSpreadsheet, GripVertical, Pencil, Check, Type, Heading as HeadingIcon, Image as ImageIcon, Minus } from 'lucide-react'
import type { EmailBlock, EmailThemeId, EmailAssistAction, MailLiveData } from '../../types/workspace-api'
import { blockLabel, ctaBlock, editableKind, type RichComposeState } from './richComposeModel'
import styles from './MailCompose.module.css'

/** The design themes offered in the picker (labels mirror themes.ts). */
const THEMES: { id: EmailThemeId; label: string }[] = [
  { id: 'clean', label: 'Clean' },
  { id: 'editorial', label: 'Editorial' },
  { id: 'compact', label: 'Compact' },
]

/** The assist actions offered in compose (mirrors assist-drafter.ts). */
const ASSIST: { action: EmailAssistAction; label: string }[] = [
  { action: 'draft', label: 'Draft from notes' },
  { action: 'tighten', label: 'Tighten' },
  { action: 'clearer', label: 'Make clearer' },
  { action: 'warmer', label: 'Make warmer' },
  { action: 'add-numbers', label: 'Add live numbers' },
]

/** What the agent can be asked to make of a spreadsheet. Mirrors INTENTS in main. */
const FROM_FILE_INTENTS: { id: 'summary' | 'executive' | 'visualize' | 'digest'; label: string }[] = [
  { id: 'summary', label: 'Summarize' },
  { id: 'executive', label: 'Executive summary' },
  { id: 'visualize', label: 'Visualize' },
  { id: 'digest', label: 'Table digest' },
]

interface Props {
  state: RichComposeState
  onThemeChange: (id: EmailThemeId) => void
  onBodyChange: (body: string) => void
  onAddExtra: (block: EmailBlock) => void
  onRemoveExtra: (index: number) => void
  /** Reorder an inserted block (drag-and-drop or the arrow fallback). */
  onMoveExtra: (from: number, to: number) => void
  /** Replace an inserted block after inline editing. */
  onUpdateExtra: (index: number, block: EmailBlock) => void
  /** The compiled preview HTML (from richBuild). Empty until first build. */
  previewHtml: string
  /** Unresolved live tokens reported by the last build (visible placeholders). */
  unresolved: { id: string }[]
  /**
   * False when the compose window is expanded and the preview lives in its own
   * column beside the editor instead of stacked underneath it.
   */
  showPreview?: boolean
}

/**
 * The rich-compose panel: a design theme picker, an agent-assist toolbar, an
 * insert-live-data / structured-block toolbar, the added-blocks chips, and a
 * live sandboxed preview — the everyday email made richer than a plain box.
 *
 * The preview reuses MailReader's sandboxed-iframe + CSP pattern verbatim: no
 * scripts, no network (remote images blocked), inline styles only.
 */
export function MailComposeRich({
  state,
  onThemeChange,
  onBodyChange,
  onAddExtra,
  onRemoveExtra,
  onMoveExtra,
  onUpdateExtra,
  previewHtml,
  unresolved,
  showPreview = true,
}: Props): JSX.Element {
  const [assisting, setAssisting] = useState<EmailAssistAction | null>(null)
  const [assistErr, setAssistErr] = useState<string | null>(null)
  const [picker, setPicker] = useState<null | 'metric' | 'range' | 'cta'>(null)

  // ── Build from a spreadsheet ────────────────────────────────────────────────
  const [sourceFile, setSourceFile] = useState<string | null>(null)
  const [building, setBuilding] = useState<string | null>(null)
  const [buildNote, setBuildNote] = useState<string | null>(null)

  const pickWorkbook = useCallback(async () => {
    setBuildNote(null)
    const res = await window.workspace.mail.pickWorkbook()
    if (res.ok && res.value) setSourceFile(res.value)
  }, [])

  /**
   * Asks the agent to turn the chosen sheet into blocks and appends them.
   *
   * Appends rather than replaces: the sender may already have typed something,
   * and silently discarding their words to make room for generated ones is the
   * kind of "helpful" that loses work.
   */
  const buildFromFile = useCallback(
    async (intent: string) => {
      if (!sourceFile) return
      setBuilding(intent)
      setBuildNote(null)
      try {
        const res = await window.workspace.mail.draftFromFile({
          filePath: sourceFile,
          intent: intent as 'summary',
        })
        if (!res.ok) {
          setBuildNote(res.error.message)
          return
        }
        for (const block of res.value.blocks) onAddExtra(block)
        const sheets = res.value.sheetNames.join(', ')
        setBuildNote(
          res.value.truncated
            ? `Added ${res.value.blocks.length} blocks from ${sheets} — the sheet was long, so only the first rows were read.`
            : `Added ${res.value.blocks.length} blocks from ${sheets}.`,
        )
      } catch {
        setBuildNote('The assistant could not be reached.')
      } finally {
        setBuilding(null)
      }
    },
    [sourceFile, onAddExtra],
  )

  // ── Inline image insertion ─────────────────────────────────────────────────
  const [imageNote, setImageNote] = useState<string | null>(null)

  /**
   * Read a picked image into an inline-image block.
   *
   * Bounded at 1.5MB of file: an email that quietly grows past what SMTP
   * servers accept bounces AFTER the person believes it was sent, which is the
   * worst possible moment to learn about a limit. Saying no at insert is the
   * honest version.
   */
  const addImage = useCallback(async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    setImageNote(null)
    if (file.size > 1.5 * 1024 * 1024) {
      setImageNote(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)}MB — inline images are capped at 1.5MB so the message stays sendable. Resize it, or attach it as a file instead.`)
      return
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    const chunk = 0x8000
    for (let i = 0; i < buf.length; i += chunk) binary += String.fromCharCode(...buf.subarray(i, i + chunk))
    onAddExtra({
      kind: 'image',
      cid: `img-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      alt: file.name.replace(/\.[a-z0-9]+$/i, ''),
      data: btoa(binary),
      contentType: file.type || 'image/png',
    })
  }, [onAddExtra])

  const runAssist = useCallback(
    async (action: EmailAssistAction) => {
      setAssisting(action)
      setAssistErr(null)
      try {
        const res = await window.workspace.mail.richAssist({ action, draft: state.body })
        if (res.ok) onBodyChange(res.value.body)
        else setAssistErr(res.error.message)
      } catch {
        setAssistErr('The writing assistant failed unexpectedly.')
      } finally {
        setAssisting(null)
      }
    },
    [state.body, onBodyChange],
  )

  return (
    <div className={styles.rich}>
      <div className={styles.richBar}>
        <span className={styles.richBarKey}>Design</span>
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.themeChip} ${state.themeId === t.id ? styles.themeChipActive : ''}`}
            onClick={() => onThemeChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.richBar}>
        <span className={styles.richBarKey}><Sparkles size={12} /> Assist</span>
        {ASSIST.map((a) => (
          <button
            key={a.action}
            type="button"
            className={styles.assistChip}
            disabled={assisting !== null}
            onClick={() => void runAssist(a.action)}
          >
            {assisting === a.action ? <Loader2 size={11} className={styles.spin} /> : null} {a.label}
          </button>
        ))}
      </div>
      {assistErr && <div className={styles.errorMsg}><AlertCircle size={13} /> {assistErr}</div>}

      <div className={styles.richBar}>
        <span className={styles.richBarKey}><FileSpreadsheet size={12} /> From a file</span>
        <button type="button" className={styles.assistChip} onClick={() => void pickWorkbook()}>
          {sourceFile ? sourceFile.split('/').pop() : 'Choose a spreadsheet…'}
        </button>
        {sourceFile &&
          FROM_FILE_INTENTS.map((it) => (
            <button
              key={it.id}
              type="button"
              className={styles.assistChip}
              disabled={building !== null}
              onClick={() => void buildFromFile(it.id)}
            >
              {building === it.id ? <Loader2 size={11} className={styles.spin} /> : null} {it.label}
            </button>
          ))}
      </div>
      {buildNote && <div className={styles.status}>{buildNote}</div>}

      <div className={styles.richBar}>
        <span className={styles.richBarKey}>Insert</span>
        {/* The standard editor pieces first — what anyone expects of a
            newsletter editor — then the live-data ones this app adds. */}
        <button type="button" className={styles.assistChip} onClick={() => onAddExtra({ kind: 'text', text: 'Write here…' })}><Type size={12} /> Text</button>
        <button type="button" className={styles.assistChip} onClick={() => onAddExtra({ kind: 'heading', text: 'Section title' })}><HeadingIcon size={12} /> Heading</button>
        <label className={styles.assistChip} title="Inline image — embedded so the recipient sees it without loading remote content">
          <ImageIcon size={12} /> Image
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => { void addImage(e.target.files); e.target.value = '' }}
          />
        </label>
        <button type="button" className={styles.assistChip} onClick={() => onAddExtra({ kind: 'divider' })}><Minus size={12} /> Divider</button>
        <button type="button" className={styles.assistChip} onClick={() => setPicker('metric')}><BarChart3 size={12} /> Live metric</button>
        <button type="button" className={styles.assistChip} onClick={() => setPicker('range')}><Table2 size={12} /> Live table</button>
        <button type="button" className={styles.assistChip} onClick={() => setPicker('cta')}><Link2 size={12} /> Button</button>
      </div>
      {imageNote && <div className={styles.warnMsg}><AlertCircle size={13} /> {imageNote}</div>}

      {picker && (
        <InsertPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onInsert={(block) => { onAddExtra(block); setPicker(null) }}
        />
      )}

      {state.extras.length > 0 && (
        <BlockList
          extras={state.extras}
          onMove={onMoveExtra}
          onRemove={onRemoveExtra}
          onUpdate={onUpdateExtra}
        />
      )}

      {unresolved.length > 0 && (
        <div className={styles.warnMsg}>
          <AlertCircle size={13} /> Unresolved live values: {unresolved.map((t) => t.id).join(', ')} (shown as visible placeholders)
        </div>
      )}

      {showPreview && <RichPreview html={previewHtml} />}
    </div>
  )
}

/**
 * The compiled message, in a sandboxed iframe (MailReader's CSP pattern: no
 * scripts, no network, inline styles only). Exported so the expanded compose
 * window can put it in its own column beside the editor.
 */
export function RichPreview({ html, tall = false }: { html: string; tall?: boolean }): JSX.Element | null {
  const srcDoc = useMemo(() => {
    if (!html) return ''
    const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:;"
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body style="margin:0">${html}</body></html>`
  }, [html])
  if (!html) return null
  return (
    <>
      <div className={styles.previewLabel}>Preview</div>
      <iframe
        className={tall ? styles.previewTall : styles.preview}
        title="Message preview"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
      />
    </>
  )
}

/**
 * The message's inserted blocks as an arrangeable list — the newsletter-editor
 * moment. Each row IS a block in the outgoing email, in order; drag a row (or
 * use the arrows) to reorder, pencil to edit the words, trash to remove. The
 * preview follows every change because the block list is the message.
 *
 * Plain HTML5 drag-and-drop rather than a library: six rows of chips do not
 * need physics, and the arrows keep reordering possible without a mouse.
 */
function BlockList({
  extras,
  onMove,
  onRemove,
  onUpdate,
}: {
  extras: EmailBlock[]
  onMove: (from: number, to: number) => void
  onRemove: (index: number) => void
  onUpdate: (index: number, block: EmailBlock) => void
}): JSX.Element {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | null>(null)

  // Rows are keyed by index, so an open editor's index goes stale the moment
  // anything moves — close it rather than let it write into the wrong block.
  const move = (from: number, to: number): void => { setEditing(null); onMove(from, to) }

  return (
    <div className={styles.blockList}>
      <div className={styles.previewLabel}>Blocks — drag to arrange</div>
      {extras.map((b, i) => (
        <div
          key={i}
          className={`${styles.blockCard} ${dragOver === i && dragFrom !== i ? styles.blockCardOver : ''}`}
          draggable={editing === null}
          onDragStart={(e) => {
            setDragFrom(i)
            e.dataTransfer.effectAllowed = 'move'
            // Some engines need data set for a drag to start at all.
            e.dataTransfer.setData('text/plain', String(i))
          }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(i) }}
          onDragLeave={() => setDragOver((cur) => (cur === i ? null : cur))}
          onDrop={(e) => {
            e.preventDefault()
            if (dragFrom !== null) move(dragFrom, i)
            setDragFrom(null)
            setDragOver(null)
          }}
          onDragEnd={() => { setDragFrom(null); setDragOver(null) }}
        >
          <div className={styles.blockRow}>
            <span className={styles.blockGrip} title="Drag to move"><GripVertical size={13} /></span>
            <span className={styles.blockName}>{blockLabel(b)}</span>
            <span className={styles.blockTools}>
              <button type="button" className={styles.blockBtn} disabled={i === 0} onClick={() => move(i, i - 1)} title="Move up">↑</button>
              <button type="button" className={styles.blockBtn} disabled={i === extras.length - 1} onClick={() => move(i, i + 1)} title="Move down">↓</button>
              {editableKind(b) && (
                <button
                  type="button"
                  className={`${styles.blockBtn} ${editing === i ? styles.blockBtnActive : ''}`}
                  onClick={() => setEditing(editing === i ? null : i)}
                  title="Edit this block"
                >
                  <Pencil size={11} />
                </button>
              )}
              <button type="button" className={styles.blockBtn} onClick={() => { onRemove(i); setEditing(null) }} title="Remove block">
                <Trash2 size={11} />
              </button>
            </span>
          </div>
          {editing === i && (
            <BlockEditor block={b} onSave={(next) => { onUpdate(i, next); setEditing(null) }} />
          )}
        </div>
      ))}
    </div>
  )
}

/** The inline form for one block's editable words. Local until “Done”. */
function BlockEditor({ block, onSave }: { block: EmailBlock; onSave: (b: EmailBlock) => void }): JSX.Element | null {
  const [draft, setDraft] = useState<EmailBlock>(block)

  if (draft.kind === 'text') {
    return (
      <div className={styles.blockEdit}>
        <textarea
          className={styles.blockEditText}
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
        />
        <button type="button" className={styles.primary} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  if (draft.kind === 'heading') {
    return (
      <div className={styles.blockEdit}>
        <input className={styles.blockEditInput} placeholder="Heading" value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <button type="button" className={styles.primary} disabled={!draft.text.trim()} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  if (draft.kind === 'image') {
    return (
      <div className={styles.blockEdit}>
        <img className={styles.blockEditImg} src={`data:${draft.contentType};base64,${draft.data}`} alt={draft.alt} />
        <input className={styles.blockEditInput} placeholder="Description (alt text)" value={draft.alt} onChange={(e) => setDraft({ ...draft, alt: e.target.value })} />
        <button type="button" className={styles.primary} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  if (draft.kind === 'cta') {
    return (
      <div className={styles.blockEdit}>
        <input className={styles.blockEditInput} placeholder="Button label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <input className={styles.blockEditInput} placeholder="www.example.com" value={draft.href} onChange={(e) => setDraft({ ...draft, href: e.target.value })} />
        <button type="button" className={styles.primary} disabled={!draft.label.trim()} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  if (draft.kind === 'chart') {
    return (
      <div className={styles.blockEdit}>
        <input className={styles.blockEditInput} placeholder="Chart title" value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <button type="button" className={styles.primary} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  if (draft.kind === 'metric') {
    // The label is the human part; the value is a live token and stays live.
    return (
      <div className={styles.blockEdit}>
        <input className={styles.blockEditInput} placeholder="Metric label" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        <button type="button" className={styles.primary} onClick={() => onSave(draft)}><Check size={12} /> Done</button>
      </div>
    )
  }
  return null
}

/**
 * A small picker over the workspace's live metrics/ranges (or a CTA form). Fetches
 * the available live data lazily; inserting a metric/range asks the main process
 * for the exact drop-in block (so the value stays a live {{metric}} token / snapshot).
 */
function InsertPicker({
  kind,
  onInsert,
  onClose,
}: {
  kind: 'metric' | 'range' | 'cta'
  onInsert: (block: EmailBlock) => void
  onClose: () => void
}): JSX.Element {
  const [data, setData] = useState<MailLiveData | null>(null)
  const [ctaLabel, setCtaLabel] = useState('')
  const [ctaHref, setCtaHref] = useState('')

  useMemo(() => {
    if (kind === 'cta') return
    void window.workspace.mail.liveData().then((res) => { if (res.ok) setData(res.value) })
  }, [kind])

  const insertMetric = useCallback(async (id: string) => {
    const res = await window.workspace.mail.liveData({ metricId: id })
    if (res.ok && res.value.block) onInsert(res.value.block)
  }, [onInsert])

  const insertRange = useCallback(async (id: string) => {
    const res = await window.workspace.mail.liveData({ rangeId: id })
    if (res.ok && res.value.block) onInsert(res.value.block)
  }, [onInsert])

  return (
    <div className={styles.pickerCard}>
      <div className={styles.pickerHead}>
        <span>{kind === 'metric' ? 'Insert a live metric' : kind === 'range' ? 'Insert a live table' : 'Add a button'}</span>
        <button type="button" className={styles.close} onClick={onClose}>×</button>
      </div>
      {kind === 'metric' && (
        <div className={styles.pickerList}>
          {(data?.metrics ?? []).map((m) => (
            <button key={m.id} type="button" className={styles.pickerRow} onClick={() => void insertMetric(m.id)}>
              <span>{m.name}</span><span className={styles.pickerVal}>{m.value}</span>
            </button>
          ))}
          {data && (data.metrics ?? []).length === 0 && <div className={styles.status}>No metrics in this workspace yet.</div>}
        </div>
      )}
      {kind === 'range' && (
        <div className={styles.pickerList}>
          {(data?.ranges ?? []).map((r) => (
            <button key={r.id} type="button" className={styles.pickerRow} onClick={() => void insertRange(r.id)}>
              <span>{r.name}</span><span className={styles.pickerVal}>{r.rows}×{r.cols}</span>
            </button>
          ))}
          {data && (data.ranges ?? []).length === 0 && <div className={styles.status}>No live ranges in this workspace yet.</div>}
        </div>
      )}
      {kind === 'cta' && (
        <div className={styles.pickerForm}>
          <input className={styles.input} placeholder="Button label" value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
          {/* The placeholder no longer demands a scheme, because safeHref now
              upgrades a bare host to https. Asking for "https://…" when it is
              not needed just makes people think the plain form will not work. */}
          <input className={styles.input} placeholder="www.example.com" value={ctaHref} onChange={(e) => setCtaHref(e.target.value)} />
          <button
            type="button"
            className={styles.primary}
            disabled={!ctaLabel.trim()}
            onClick={() => { const b = ctaBlock(ctaLabel, ctaHref); if (b) onInsert(b) }}
          >
            <Plus size={12} /> Add button
          </button>
        </div>
      )}
    </div>
  )
}
