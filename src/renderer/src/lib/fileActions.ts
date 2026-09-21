import {
  Copy, FolderOpen, CopyPlus, Printer, Star, Trash2, Pencil, FileDown,
  type LucideIcon,
} from 'lucide-react'
import { categoryOf, EDITABLE, PRINTABLE, OFFICE, type FileCategory } from './fileCategory'

/** Everything an action needs to run, supplied by the surface invoking it. */
export interface ActionContext {
  filePath: string
  category: FileCategory
  isDirty: boolean
  isStarred: boolean
  /** Re-read the workspace tree after a filesystem change. */
  refresh: () => void
  /** Close the tab for a path (used after trashing). */
  closeFile: (path: string) => void
  toggleStar: () => void
}

export type ActionGroup = 'file' | 'edit' | 'export' | 'danger'

export interface FileAction {
  id: string
  label: (ctx: ActionContext) => string
  icon: LucideIcon
  group: ActionGroup
  danger?: boolean
  appliesTo: (ctx: ActionContext) => boolean
  run: (ctx: ActionContext) => void | Promise<void>
}

const basename = (p: string): string => p.split('/').pop() ?? p

/**
 * The single source of truth for per-file actions. Surfaces (canvas toolbar,
 * context menu, menu bar) read from `actionsFor` — adding an action or a type
 * is data here, not new plumbing in each surface.
 */
export const FILE_ACTIONS: FileAction[] = [
  {
    id: 'star',
    label: (ctx) => (ctx.isStarred ? 'Unstar' : 'Star'),
    icon: Star,
    group: 'file',
    appliesTo: () => true,
    run: (ctx) => ctx.toggleStar(),
  },
  {
    id: 'copy-path',
    label: () => 'Copy path',
    icon: Copy,
    group: 'file',
    appliesTo: () => true,
    run: (ctx) => navigator.clipboard.writeText(ctx.filePath),
  },
  {
    id: 'reveal',
    label: () => 'Reveal in Finder',
    icon: FolderOpen,
    group: 'file',
    appliesTo: () => true,
    run: (ctx) => window.workspace.fs.reveal(ctx.filePath),
  },
  {
    id: 'export-pdf',
    label: () => 'Export as PDF…',
    icon: FileDown,
    group: 'export',
    appliesTo: (ctx) => OFFICE.has(ctx.category),
    run: async (ctx) => {
      // Docker-free export via the bundled LibreOffice engine.
      const saved = await window.workspace.office.exportPdf(ctx.filePath)
      if (saved) ctx.refresh()
    },
  },
  {
    id: 'duplicate',
    label: () => 'Save a copy…',
    icon: CopyPlus,
    group: 'export',
    appliesTo: () => true,
    run: async (ctx) => {
      const saved = await window.workspace.fs.saveCopyDialog(ctx.filePath)
      if (saved) ctx.refresh()
    },
  },
  {
    id: 'print',
    label: () => 'Print…',
    icon: Printer,
    group: 'export',
    appliesTo: (ctx) => PRINTABLE.has(ctx.category),
    // The requested file's renderer supplies its complete document content.
    run: (ctx) => { window.dispatchEvent(new CustomEvent('wos:print', { detail: { filePath: ctx.filePath } })) },
  },
  {
    id: 'rename',
    label: () => 'Rename…',
    icon: Pencil,
    group: 'edit',
    appliesTo: (ctx) => EDITABLE.has(ctx.category) || true,
    run: async (ctx) => {
      const next = window.prompt('Rename to:', basename(ctx.filePath))
      if (!next?.trim() || next === basename(ctx.filePath)) return
      await window.workspace.fs.rename(ctx.filePath, next.trim())
      ctx.refresh()
    },
  },
  {
    id: 'trash',
    label: () => 'Move to Trash',
    icon: Trash2,
    group: 'danger',
    danger: true,
    appliesTo: () => true,
    run: async (ctx) => {
      if (!window.confirm(`Move "${basename(ctx.filePath)}" to trash?`)) return
      await window.workspace.fs.delete(ctx.filePath)
      ctx.closeFile(ctx.filePath)
      ctx.refresh()
    },
  },
]

/** Actions applicable to a file, in registry order. */
export function actionsFor(filePath: string, ctx: Omit<ActionContext, 'category'>): { action: FileAction; ctx: ActionContext }[] {
  const full: ActionContext = { ...ctx, category: categoryOf(filePath) }
  return FILE_ACTIONS.filter((a) => a.appliesTo(full)).map((action) => ({ action, ctx: full }))
}
