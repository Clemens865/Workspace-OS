import { useEffect } from 'react'

interface ShortcutHandlers {
  onCommandPalette: () => void
  onQuickOpen: () => void
  onSearchPanel: () => void
  onToggleSidebar: () => void
  onToggleTerminal: () => void
  onAgentFocus: () => void
  onCloseTab: () => void
  onNextTab: () => void
  onPrevTab: () => void
  /** WOS-011: expand the active surface to fill the window, and back. */
  onToggleExpand?: () => void
  /** Minimise the terminal dock to its title bar, or restore it (⌥⌘J). */
  onToggleMinimizeTerminal?: () => void
  /** WOS-011: Esc leaves the expanded surface (only bound while expanded). */
  onEscape?: () => void
}

/**
 * Window-level keyboard shortcuts. Several of these also exist as native menu
 * accelerators (⌘P/⌘B/⌘J/⇧⌘F…) — on macOS the menu consumes the real keypress
 * first, so these handlers double as the path for synthetic events (e2e) and
 * as a fallback when no menu item claims the key.
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // ⌘K opens the content-search/command palette.
      if (mod && e.key === 'k' && !e.shiftKey) {
        e.preventDefault()
        handlers.onCommandPalette()
        return
      }

      // ⌘P is quick-open (Go to File) — Print moved to ⌥⌘P in the File menu.
      if (mod && e.key === 'p' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        handlers.onQuickOpen()
        return
      }

      // ⇧⌘F opens the sidebar Search panel (find in files).
      if (mod && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        handlers.onSearchPanel()
        return
      }

      // ⌘B toggles the file panel (office docs claim ⌘B for Bold via the menu).
      if (mod && e.key === 'b' && !e.shiftKey) {
        e.preventDefault()
        handlers.onToggleSidebar()
        return
      }

      // ⌥⌘J minimises the dock to its title bar / restores it. Checked BEFORE
      // plain ⌘J, which would otherwise swallow it and hide the dock instead.
      if (mod && e.altKey && (e.key === 'j' || e.key === '∆' || e.code === 'KeyJ')) {
        e.preventDefault()
        handlers.onToggleMinimizeTerminal?.()
        return
      }

      // ⌘J toggles the terminal strip.
      if (mod && e.key === 'j' && !e.shiftKey) {
        e.preventDefault()
        handlers.onToggleTerminal()
        return
      }

      if (mod && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        handlers.onAgentFocus()
        return
      }

      if (mod && e.key === 'w') {
        e.preventDefault()
        handlers.onCloseTab()
        return
      }

      // Cmd+Shift+] / Cmd+Shift+[ for next/prev tab (matches browser + VS Code convention)
      if (mod && e.shiftKey && e.key === ']') {
        e.preventDefault()
        handlers.onNextTab()
        return
      }

      if (mod && e.shiftKey && e.key === '[') {
        e.preventDefault()
        handlers.onPrevTab()
        return
      }

      // WOS-011: ⌃⌘F expands the active surface to fill the window.
      //
      // Deliberately NOT ⌘⏎ or ⇧⌘F — the first is "send" in the mail composer
      // and "file" in the bug reporter, the second is already find-in-files
      // above. ⌃⌘F is also macOS's own full-screen chord, which is the closest
      // thing to a convention for this gesture.
      if (e.metaKey && e.ctrlKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault()
        handlers.onToggleExpand?.()
        return
      }

      // Esc leaves an expanded surface. Only acts when the handler is bound
      // (the shell binds it only while expanded), so Esc keeps its normal
      // meaning — closing a dialog, dismissing a menu — everywhere else.
      if (e.key === 'Escape' && handlers.onEscape) {
        handlers.onEscape()
        return
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handlers])
}
