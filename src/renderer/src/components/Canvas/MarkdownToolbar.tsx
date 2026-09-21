import { Bold, Italic, Heading1, Heading2, List, ListOrdered, Quote, Code, Link, Pencil, Columns2, Eye } from 'lucide-react'
import type { CodeEditor } from './renderers/MonacoRenderer'
import styles from './MarkdownToolbar.module.css'

/** Which surface the markdown canvas shows: editor, side-by-side, or preview. */
export type MdViewMode = 'edit' | 'split' | 'preview'

interface MarkdownToolbarProps {
  /** The Monaco editor — absent when the preview owns the whole surface. */
  editor: CodeEditor | null
  mode: MdViewMode
  onModeChange: (mode: MdViewMode) => void
}

/**
 * A real formatting toolbar for Markdown, driving the Monaco editor directly —
 * wrapping the selection or prefixing lines, then restoring focus. (Office docs
 * keep OnlyOffice's own in-editor toolbar; its formatting isn't drivable from
 * outside the editor iframe.)
 */
export function MarkdownToolbar({ editor, mode, onModeChange }: MarkdownToolbarProps): JSX.Element {
  // Formatting buttons drive the editor; disabled when the editor isn't mounted
  // (pure-preview mode), so they never dereference a null editor.
  const canEdit = !!editor && mode !== 'preview'

  const wrap = (before: string, after = before): void => {
    if (!editor) return
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (!sel || !model) return
    const text = model.getValueInRange(sel)
    editor.executeEdits('md-toolbar', [{ range: sel, text: `${before}${text}${after}`, forceMoveMarkers: true }])
    editor.focus()
  }

  const prefixLine = (prefix: string): void => {
    if (!editor) return
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (!sel || !model) return
    const line = sel.startLineNumber
    const content = model.getLineContent(line)
    editor.executeEdits('md-toolbar', [{
      range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: content.length + 1 },
      text: `${prefix}${content.replace(/^(#{1,6}\s|>\s|[-*]\s|\d+\.\s)/, '')}`,
    }])
    editor.focus()
  }

  return (
    <div className={styles.bar}>
      <button className={styles.btn} title="Bold" disabled={!canEdit} onClick={() => wrap('**')}><Bold size={16} strokeWidth={2.2} /></button>
      <button className={styles.btn} title="Italic" disabled={!canEdit} onClick={() => wrap('_')}><Italic size={16} strokeWidth={2} /></button>
      <button className={styles.btn} title="Inline code" disabled={!canEdit} onClick={() => wrap('`')}><Code size={16} strokeWidth={2} /></button>
      <button className={styles.btn} title="Link" disabled={!canEdit} onClick={() => wrap('[', '](url)')}><Link size={16} strokeWidth={2} /></button>
      <div className={styles.divider} />
      <button className={styles.btn} title="Heading 1" disabled={!canEdit} onClick={() => prefixLine('# ')}><Heading1 size={17} strokeWidth={2} /></button>
      <button className={styles.btn} title="Heading 2" disabled={!canEdit} onClick={() => prefixLine('## ')}><Heading2 size={17} strokeWidth={2} /></button>
      <div className={styles.divider} />
      <button className={styles.btn} title="Bullet list" disabled={!canEdit} onClick={() => prefixLine('- ')}><List size={16} strokeWidth={2} /></button>
      <button className={styles.btn} title="Numbered list" disabled={!canEdit} onClick={() => prefixLine('1. ')}><ListOrdered size={16} strokeWidth={2} /></button>
      <button className={styles.btn} title="Quote" disabled={!canEdit} onClick={() => prefixLine('> ')}><Quote size={16} strokeWidth={2} /></button>

      <div className={styles.spacer} />

      {/* Edit | Split | Preview — the live-transclusion preview toggle. */}
      <div className={styles.segmented} role="group" aria-label="View mode">
        <button
          className={mode === 'edit' ? styles.segActive : styles.seg}
          title="Edit"
          onClick={() => onModeChange('edit')}
        ><Pencil size={14} strokeWidth={2} /> Edit</button>
        <button
          className={mode === 'split' ? styles.segActive : styles.seg}
          title="Split (editor + preview)"
          onClick={() => onModeChange('split')}
        ><Columns2 size={14} strokeWidth={2} /> Split</button>
        <button
          className={mode === 'preview' ? styles.segActive : styles.seg}
          title="Preview (live values)"
          onClick={() => onModeChange('preview')}
        ><Eye size={14} strokeWidth={2} /> Preview</button>
      </div>
    </div>
  )
}
