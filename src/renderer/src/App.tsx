import { CodexRequests } from './components/AgentTerminal/CodexRequests'
import { useEffect, useState } from 'react'
import { WorkspaceLayout } from './components/Layout/WorkspaceLayout'
import { WorkspaceShell } from './components/Shell/WorkspaceShell'
import { CalmCockpit } from './components/CalmCockpit/CalmCockpit'
import { BugReporter } from './components/BugReport/BugReporter'
import { Splash } from './components/Splash/Splash'
import { useSettings } from './hooks/useSettings'
import { useBackgroundRuns } from './components/Review/backgroundRuns'
import { useBindWorkspaceScope } from './hooks/useWorkspaceScope'
import { editCommandFor, resolveEditTarget, runOnTextEntry, runOnWebview, UNO_FOR } from './lib/editRouter'

/**
 * Standalone preview escape hatch for the Calm Cockpit design prototype.
 * Gated + trivially removable — does NOT touch normal startup. Trigger with
 * `?cockpit=field` in the URL, or localStorage['wos:cockpit-preview'] === 'field'.
 * Evaluated BEFORE any hook so the prototype renders fullscreen and nothing else.
 */
function cockpitPreviewEnabled(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('cockpit') === 'field') return true
    return localStorage.getItem('wos:cockpit-preview') === 'field'
  } catch {
    return false
  }
}

/**
 * Top-level switch — the reversibility guarantee for the redesign.
 *
 * `newShell` defaults to ON (see useSettings) since v0.1.117: the office
 * parity suite runs green on WorkspaceShell. Settings → Design → Classic
 * renders the previous WorkspaceLayout, kept UNCHANGED as the fallback.
 */
export function App(): JSX.Element {
  // Design-prototype preview — checked before any hook, so it can't disturb
  // normal startup. Remove this block and the two imports above to excise it.
  if (cockpitPreviewEnabled()) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'var(--wos-bg)' }}>
        <CalmCockpit />
      </div>
    )
  }

  const { newShell } = useSettings()
  const bugOpen = useBugReporterShortcut()
  useEditRouter()
  // Agent tabs and the review feed belong to the open workspace, as cases do.
  // Bound here, above the shell switch, before anything reads those stores.
  useBindWorkspaceScope()
  // Background runs (main-owned) mirror into the review store from here, above
  // the shell switch, so they show in either UI whether or not a tab exists.
  useBackgroundRuns()
  // A clicked notification lands on the rail the thing lives on.
  useEffect(
    () =>
      window.workspace.notify?.onOpen((t) => {
        window.dispatchEvent(new CustomEvent('wos:open-rail', { detail: { rail: t.rail } }))
      }),
    [],
  )
  // Startup splash — the shell mounts and loads BENEATH it, so dismissing it
  // lands in an app that is already alive rather than starting to load.
  const [splash, setSplash] = useState(true)

  // Mounted at the ROOT, above the shell switch, so ⌘⇧B reports a bug from
  // anywhere in either UI. A reporter you can only reach from one shell is one
  // you won't reach at the moment you actually need it.
  return (
    <>
      {newShell ? <WorkspaceShell /> : <WorkspaceLayout />}
      <CodexRequests />
      {bugOpen.open && <BugReporter onClose={bugOpen.close} surface={null} openFile={null} />}
      {splash && <Splash onDone={() => setSplash(false)} />}
    </>
  )
}

/** ⌘⇧B / Ctrl+Shift+B — global, and deliberately not bound to any surface. */
function useBugReporterShortcut(): { open: boolean; close: () => void } {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return { open, close: () => setOpen(false) }
}

/**
 * WOS-006: route ⌘X/⌘C/⌘V/⌘A to whatever actually has focus.
 *
 * The office Edit menu registers these on the APPLICATION menu, so they fire
 * app-wide. Mounted at the root, above the shell switch, because the bug shows
 * up in the browser and mail — surfaces that have nothing to do with the office
 * canvas that owns the accelerator.
 */
function useEditRouter(): void {
  useEffect(() => {
    return window.workspace.menu.onRunAction((actionId) => {
      const cmd = editCommandFor(actionId)
      if (!cmd) return
      const el = document.activeElement as HTMLElement | null
      const target = resolveEditTarget(el)
      if (target === 'input' && el) {
        // WOS-008: this return value used to be discarded, so a failed paste
        // was indistinguishable from an empty clipboard — the defect took a
        // bug report to find because nothing anywhere said it had failed.
        void runOnTextEntry(el, cmd).then((ok) => {
          if (!ok) console.warn(`[edit] ${cmd} failed on the focused ${el.tagName.toLowerCase()}`)
        })
      } else if (target === 'webview' && el) {
        // The accelerator that brought us here already CONSUMED the keystroke —
        // a menu item with a click handler eats the key before the guest sees
        // it. "Leave it alone" therefore made ⌘V in a browser field a no-op.
        if (!runOnWebview(el, cmd)) console.warn(`[edit] ${cmd} not available on the focused webview`)
      } else if (target === 'canvas') {
        // Unchanged office behaviour: hand it to the LOK canvas.
        window.dispatchEvent(new CustomEvent('wos:run-action', { detail: { id: 'office.uno:' + UNO_FOR[cmd] } }))
      }
    })
  }, [])
}
