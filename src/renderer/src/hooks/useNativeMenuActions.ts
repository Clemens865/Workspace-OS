import { useEffect, useRef, type RefObject } from 'react'
import { actionsFor, type ActionContext } from '../lib/fileActions'

/**
 * Mirrors the per-file action registry into the native menu bar. When the
 * active file (or its star/dirty state) changes, the applicable actions are
 * pushed to the main process, which rebuilds the File menu. Menu clicks come
 * back as action ids and run against the current context — so the menu bar and
 * the in-canvas action menu always stay in lockstep from one registry.
 */
export function useNativeMenuActions(filePath: string | null, ctx: ActionContext | null, surface?: RefObject<HTMLElement>): void {
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // Push applicable action labels whenever the file or its state changes.
  useEffect(() => {
    if (!filePath || !ctxRef.current) {
      window.workspace.menu.setActions([])
      return
    }
    const items = actionsFor(filePath, ctxRef.current).map(({ action, ctx: c }) => ({
      id: action.id,
      label: action.label(c),
    }))
    window.workspace.menu.setActions(items)
  }, [filePath, ctx?.isStarred, ctx?.isDirty])

  // Run the chosen action against the freshest context.
  useEffect(() => {
    return window.workspace.menu.onRunAction((id) => {
      const c = ctxRef.current
      if (!filePath || !c) return
      if (id === 'print' && surface && !surface.current?.getClientRects().length) return
      const match = actionsFor(filePath, c).find(({ action }) => action.id === id)
      if (match) match.action.run(match.ctx)
    })
  }, [filePath, surface])
}
