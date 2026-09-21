import { createContext, useContext, useEffect, useRef, type RefObject } from 'react'
import { isPrintRequestFor } from '../lib/printDocument'

export const PrintSurfaceContext = createContext<RefObject<HTMLElement> | null>(null)

/** Only the renderer for the requested file may print. There is deliberately
 * no window.print fallback: an unavailable document must never print the shell. */
export function useFilePrint(filePath: string, print: (() => Promise<unknown>) | null): void {
  const surface = useContext(PrintSurfaceContext)
  const latest = useRef(print)
  latest.current = print
  const busy = useRef(false)
  useEffect(() => {
    const onPrint = async (event: Event): Promise<void> => {
      if (!isPrintRequestFor(event, filePath) || !latest.current || busy.current) return
      // Home/Files/Stage keep their editors mounted when hidden. Even the same
      // path can have a different unsaved buffer in those other surfaces.
      if (surface && !surface.current?.getClientRects().length) return
      busy.current = true
      try {
        await latest.current()
      } catch (error) {
        window.alert(`Could not print this document: ${(error as Error).message}`)
      } finally {
        busy.current = false
      }
    }
    window.addEventListener('wos:print', onPrint)
    return () => window.removeEventListener('wos:print', onPrint)
  }, [filePath, surface])
}
