import { DialogOverlay } from './DialogOverlay'
import { InsertTableDialog } from './InsertTableDialog'
import { FormatCellsDialog, type NumberFormatSpec } from './FormatCellsDialog'
import { SpecialCharDialog } from './SpecialCharDialog'
import { HyperlinkDialog } from './HyperlinkDialog'
import { BordersDialog, type BorderSpec } from './BordersDialog'
import { CondFormatDialog, type CondFormatSpec } from './CondFormatDialog'
import { DataValidationDialog, type DataValidationSpec } from './DataValidationDialog'
import { MarginsDialog, type MarginSpec } from './MarginsDialog'
import styles from './LokRenderer.module.css'

interface LokDialogsProps {
  /** A native LibreOffice dialog surfaced as an overlay (CB_WINDOW). */
  dialog: { id: number; title: string; w: number; h: number } | null
  onDialogClose: () => void
  showInsertTable: boolean
  onInsertTableCancel: () => void
  onInsertTableConfirm: (cols: number, rows: number) => void
  showFormatCells: boolean
  onFormatCellsCancel: () => void
  onFormatCellsConfirm: (spec: NumberFormatSpec) => void
  showSpecialChar: boolean
  onSpecialCharInsert: (ch: string) => void
  onSpecialCharClose: () => void
  showHyperlink: boolean
  onHyperlinkCancel: () => void
  onHyperlinkConfirm: (text: string, url: string) => void
  showBorders: boolean
  onBordersCancel: () => void
  onBordersApply: (spec: BorderSpec) => void
  showCondFormat: boolean
  onCondFormatCancel: () => void
  onCondFormatApply: (spec: CondFormatSpec) => void
  onCondFormatClear: () => void
  showDataValidation: boolean
  onDataValidationCancel: () => void
  onDataValidationApply: (spec: DataValidationSpec) => void
  onDataValidationClear: () => void
  showMargins: boolean
  onMarginsCancel: () => void
  onMarginsApply: (spec: MarginSpec) => void
  // Document-properties modal.
  showProps: boolean
  onPropsClose: () => void
  props: { name: string; bytes: number; modified: number } | null
  fileName?: string
  /** Doc type (0=Writer, 1=Calc, 2=Impress, 3=Draw). */
  docType: number
  /** Number of parts (sheets/slides). */
  partCount: number
  /** Document size in twips (Writer page-size row), or null. */
  docSizeTw: { w: number; h: number } | null
}

/**
 * All modal/dialog chrome for the LOK renderer: the native-dialog overlay, the
 * insert-table / format-cells / special-char / hyperlink / borders dialogs and
 * the document-properties modal. Not memoized — several handlers are inline
 * closures in the parent (intentionally, matching pre-extraction behavior).
 */
export function LokDialogs({
  dialog,
  onDialogClose,
  showInsertTable,
  onInsertTableCancel,
  onInsertTableConfirm,
  showFormatCells,
  onFormatCellsCancel,
  onFormatCellsConfirm,
  showSpecialChar,
  onSpecialCharInsert,
  onSpecialCharClose,
  showHyperlink,
  onHyperlinkCancel,
  onHyperlinkConfirm,
  showBorders,
  onBordersCancel,
  onBordersApply,
  showCondFormat,
  onCondFormatCancel,
  onCondFormatApply,
  onCondFormatClear,
  showDataValidation,
  onDataValidationCancel,
  onDataValidationApply,
  onDataValidationClear,
  showMargins,
  onMarginsCancel,
  onMarginsApply,
  showProps,
  onPropsClose,
  props,
  fileName,
  docType,
  partCount,
  docSizeTw,
}: LokDialogsProps): JSX.Element {
  return (
    <>
      {dialog && (
        <DialogOverlay
          id={dialog.id}
          title={dialog.title}
          w={dialog.w}
          h={dialog.h}
          onClose={onDialogClose}
        />
      )}
      {showInsertTable && (
        <InsertTableDialog
          onCancel={onInsertTableCancel}
          onConfirm={onInsertTableConfirm}
        />
      )}
      {showFormatCells && (
        <FormatCellsDialog
          onCancel={onFormatCellsCancel}
          onConfirm={onFormatCellsConfirm}
        />
      )}
      {showSpecialChar && (
        <SpecialCharDialog
          onInsert={onSpecialCharInsert}
          onClose={onSpecialCharClose}
        />
      )}
      {showHyperlink && (
        <HyperlinkDialog
          onCancel={onHyperlinkCancel}
          onConfirm={onHyperlinkConfirm}
        />
      )}
      {showBorders && (
        <BordersDialog
          onCancel={onBordersCancel}
          onApply={onBordersApply}
        />
      )}
      {showCondFormat && (
        <CondFormatDialog
          onApply={onCondFormatApply}
          onClear={onCondFormatClear}
          onCancel={onCondFormatCancel}
        />
      )}
      {showDataValidation && (
        <DataValidationDialog
          onApply={onDataValidationApply}
          onClear={onDataValidationClear}
          onCancel={onDataValidationCancel}
        />
      )}
      {showMargins && (
        <MarginsDialog
          onCancel={onMarginsCancel}
          onApply={onMarginsApply}
        />
      )}
      {showProps && (
        <div className={styles.propsBackdrop} onClick={onPropsClose}>
          <div className={styles.propsModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.propsTitle}>Document properties</div>
            <dl className={styles.propsList}>
              <dt>Name</dt><dd>{props?.name ?? fileName}</dd>
              <dt>Type</dt><dd>{['Text document', 'Spreadsheet', 'Presentation', 'Drawing'][docType] ?? 'Document'}</dd>
              <dt>{docType === 1 ? 'Sheets' : docType === 2 ? 'Slides' : 'Page size'}</dt>
              <dd>{docType === 0 && docSizeTw ? `${(docSizeTw.w / 1440).toFixed(1)} × ${(docSizeTw.h / 1440).toFixed(1)} in` : partCount}</dd>
              <dt>Size on disk</dt><dd>{props ? `${(props.bytes / 1024).toFixed(1)} KB` : '—'}</dd>
              <dt>Modified</dt><dd>{props ? new Date(props.modified).toLocaleString() : '—'}</dd>
            </dl>
            <button className={styles.propsClose} onClick={onPropsClose}>Close</button>
          </div>
        </div>
      )}
    </>
  )
}
