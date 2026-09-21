import { useState, useCallback, useEffect } from 'react'
import { PdfView } from './PdfView'
import { LokRenderer } from './LokRenderer'
import { useFilePrint } from '../../../hooks/useFilePrint'

interface OfficeRendererProps {
  filePath: string
}

/**
 * Office view — fully native and Docker-free. When the bundled LibreOfficeKit
 * engine is available, render and edit live tiles directly from the engine
 * (Phase 3a). Otherwise fall back to a read-only LibreOffice→PDF view (cached)
 * via PDF.js — e.g. on a platform where the engine isn't bundled.
 */
export function OfficeRenderer({ filePath }: OfficeRendererProps): JSX.Element {
  // undefined = checking, true/false = native engine present.
  const [live, setLive] = useState<boolean | undefined>(undefined)
  // Set when the native engine can't load THIS file (it hangs on some files
  // that full LibreOffice still renders) — fall back to read-only PDF so the
  // user can at least view it instead of getting an error.
  const [nativeFailed, setNativeFailed] = useState(false)

  useFilePrint(filePath, live === false || nativeFailed ? () => window.workspace.office.print(filePath) : null)

  useEffect(() => {
    let active = true
    window.workspace.lok
      .available()
      .then((v) => active && setLive(v))
      .catch(() => active && setLive(false))
    return () => {
      active = false
    }
  }, [])

  // Reset the fallback when switching files — a new file gets a fresh native try.
  useEffect(() => setNativeFailed(false), [filePath])

  const loadPdf = useCallback(() => window.workspace.office.toPdf(filePath), [filePath])

  if (live && !nativeFailed) {
    return <LokRenderer filePath={filePath} onNativeFail={() => setNativeFailed(true)} />
  }

  return (
    <PdfView
      reloadKey={filePath}
      load={loadPdf}
      loadingLabel={nativeFailed ? 'Opening read-only (native editor couldn’t load this file)…' : 'Rendering document…'}
    />
  )
}
