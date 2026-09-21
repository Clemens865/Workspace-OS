import { PdfAnnotator } from './PdfAnnotator'

interface PdfRendererProps {
  filePath: string
}

/**
 * A real .pdf file in the workspace opens in the ANNOTATOR — highlight, note,
 * draw, page ops — rather than the plain viewer. PdfView is still used for
 * byte-source previews (e.g. a LibreOffice conversion), where there is no file
 * on disk to annotate.
 */
export function PdfRenderer({ filePath }: PdfRendererProps): JSX.Element {
  return <PdfAnnotator filePath={filePath} />
}
