import { describe, it, expect, vi } from 'vitest'
import {
  actionsForSurface,
  activeSurface,
  agentActionsHint,
  isOfficeFile,
  DOCUMENT_SURFACE,
  SURFACE_ACTIONS,
  ALL_ACTIONS,
  actionById,
  actionManifest,
  type SurfaceActionContext,
} from './surfaceActions'

const base: SurfaceActionContext = {
  root: '/ws',
  surface: 'files',
  folder: '/ws',
  openFile: null,
}

describe('activeSurface', () => {
  it('is the rail surface when no file is open', () => {
    expect(activeSurface(base)).toBe('files')
    expect(activeSurface({ ...base, surface: 'mail' })).toBe('mail')
  })

  it('becomes the document surface whenever a file is open', () => {
    expect(activeSurface({ ...base, openFile: '/ws/a.docx' })).toBe(DOCUMENT_SURFACE)
    // Even if the rail says "mail", an open file wins.
    expect(activeSurface({ ...base, surface: 'mail', openFile: '/ws/a.docx' })).toBe(DOCUMENT_SURFACE)
  })
})

describe('isOfficeFile', () => {
  it('is true only for engine office types', () => {
    expect(isOfficeFile('/ws/report.docx')).toBe(true)
    expect(isOfficeFile('/ws/budget.xlsx')).toBe(true)
    expect(isOfficeFile('/ws/deck.pptx')).toBe(true)
    expect(isOfficeFile('/ws/notes.md')).toBe(false)
    expect(isOfficeFile('/ws/photo.png')).toBe(false)
    expect(isOfficeFile(null)).toBe(false)
  })
})

describe('actionsForSurface — Files', () => {
  it('exposes new-document (primary), new-folder, search, reveal', () => {
    const ids = actionsForSurface(base).map((a) => a.id)
    expect(ids).toEqual([
      'files.new-document',
      'files.new-folder',
      'files.search',
      'files.reveal-folder',
    ])
  })

  it('marks exactly one primary action', () => {
    const primaries = actionsForSurface(base).filter((a) => a.primary)
    expect(primaries).toHaveLength(1)
    expect(primaries[0].id).toBe('files.new-document')
  })

  it('drops reveal-folder when there is no folder or root', () => {
    const ids = actionsForSurface({ ...base, folder: null, root: null }).map((a) => a.id)
    expect(ids).not.toContain('files.reveal-folder')
  })
})

describe('actionsForSurface — Document (office-only gating)', () => {
  it('offers export PDF/Word + duplicate + reveal + backlinks for an office file', () => {
    const ids = actionsForSurface({ ...base, openFile: '/ws/a.docx' }).map((a) => a.id)
    expect(ids).toEqual([
      'document.export-pdf',
      'document.export-word',
      'document.duplicate',
      'document.reveal',
      'document.backlinks',
    ])
  })

  it('hides the engine export actions for a non-office file', () => {
    const ids = actionsForSurface({ ...base, openFile: '/ws/notes.md' }).map((a) => a.id)
    expect(ids).not.toContain('document.export-pdf')
    expect(ids).not.toContain('document.export-word')
    // but generic file actions remain
    expect(ids).toContain('document.duplicate')
    expect(ids).toContain('document.reveal')
    // backlinks is offered for any open file (not office-gated)
    expect(ids).toContain('document.backlinks')
  })

  it('has exactly one primary (Export as PDF) for office docs', () => {
    const primaries = actionsForSurface({ ...base, openFile: '/ws/a.docx' }).filter((a) => a.primary)
    expect(primaries.map((a) => a.id)).toEqual(['document.export-pdf'])
  })
})

describe('actionsForSurface — Mail (non-destructive)', () => {
  const mail: SurfaceActionContext = { ...base, surface: 'mail' }

  it('exposes compose (primary), reply, search, refresh', () => {
    const ids = actionsForSurface(mail).map((a) => a.id)
    expect(ids).toEqual(['mail.compose', 'mail.reply', 'mail.search', 'mail.refresh'])
  })

  it('marks exactly one primary (Compose)', () => {
    const primaries = actionsForSurface(mail).filter((a) => a.primary)
    expect(primaries.map((a) => a.id)).toEqual(['mail.compose'])
  })

  it('has no "send" action and no hint promises to send', () => {
    const actions = actionsForSurface(mail)
    expect(actions.map((a) => a.id)).not.toContain('mail.send')
    for (const a of actions) {
      expect(a.id).not.toMatch(/send/i)
      // The label never invites a one-click send.
      expect(a.label.toLowerCase()).not.toContain('send')
    }
  })

  it('no mail action calls window.workspace.mail.send when run', async () => {
    const send = vi.fn()
    const dispatch = vi.fn()
    const g = globalThis as Record<string, unknown>
    const prevWindow = g.window
    const prevCE = g.CustomEvent
    // Minimal shims so the pure registry can run in the node test env.
    g.CustomEvent = class {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
    g.window = { workspace: { mail: { send } }, dispatchEvent: dispatch }
    try {
      for (const a of actionsForSurface(mail)) await a.run(mail)
    } finally {
      g.window = prevWindow
      g.CustomEvent = prevCE
    }
    expect(send).not.toHaveBeenCalled()
    // every mail action dispatches a renderer CustomEvent (no IPC, no send)
    expect(dispatch).toHaveBeenCalled()
  })
})

describe('actionsForSurface — Knowledge', () => {
  const kn: SurfaceActionContext = { ...base, surface: 'knowledge' }

  it('exposes search (primary) + new-note', () => {
    const ids = actionsForSurface(kn).map((a) => a.id)
    expect(ids).toEqual(['knowledge.search', 'knowledge.new-note'])
  })

  it('marks exactly one primary (Search knowledge)', () => {
    const primaries = actionsForSurface(kn).filter((a) => a.primary)
    expect(primaries.map((a) => a.id)).toEqual(['knowledge.search'])
  })

  it('gates the file-specific backlinks action on an open file (Document surface)', () => {
    // No file open → no backlinks anywhere.
    expect(actionsForSurface(kn).map((a) => a.id)).not.toContain('document.backlinks')
    // File open → the active surface is Document, which carries backlinks.
    const withFile = actionsForSurface({ ...kn, openFile: '/ws/note.md' }).map((a) => a.id)
    expect(withFile).toContain('document.backlinks')
  })
})

describe('SURFACE_ACTIONS integrity', () => {
  it('every action belongs to its registry key and carries an agentHint', () => {
    for (const [surface, list] of Object.entries(SURFACE_ACTIONS)) {
      for (const a of list) {
        expect(a.surface).toBe(surface)
        expect(a.agentHint.length).toBeGreaterThan(0)
        expect(a.id.startsWith(surface === DOCUMENT_SURFACE ? 'document.' : `${surface}.`)).toBe(true)
      }
    }
  })
})

describe('ALL_ACTIONS + actionById (agent→action bridge allow-set)', () => {
  it('flattens every surface and resolves an id back to its action', () => {
    expect(ALL_ACTIONS.length).toBe(Object.values(SURFACE_ACTIONS).flat().length)
    expect(actionById('files.new-folder')?.surface).toBe('files')
    expect(actionById('document.export-pdf')?.surface).toBe(DOCUMENT_SURFACE)
  })

  it('returns undefined for an unregistered id (nothing to invoke)', () => {
    expect(actionById('mail.send')).toBeUndefined()
    expect(actionById('files.delete')).toBeUndefined()
  })

  it('exposes NO destructive/send/delete action in the whole allow-set', () => {
    for (const a of ALL_ACTIONS) {
      expect(a.id).not.toMatch(/send|delete|remove|destroy|trash/i)
    }
  })

  it('actionManifest carries {id, agentHint} for the live surface', () => {
    const manifest = actionManifest(base)
    expect(manifest.every((m) => typeof m.id === 'string' && typeof m.agentHint === 'string')).toBe(true)
    expect(manifest.map((m) => m.id)).toContain('files.new-folder')
  })
})

describe('agentActionsHint', () => {
  it('enumerates the Files capabilities', () => {
    const hint = agentActionsHint(base)
    expect(hint).toContain('Available actions here:')
    expect(hint).toContain('create a new document')
    expect(hint).toContain('search the whole workspace')
  })

  it('enumerates office document capabilities with the file name', () => {
    const hint = agentActionsHint({ ...base, openFile: '/ws/report.docx' })
    expect(hint).toContain('report.docx')
    expect(hint).toContain('export this document to PDF')
    expect(hint).toContain('export this document to Word')
  })

  it('always offers the ambient browser-drive actions (agent can research anywhere)', () => {
    // Browser-drive is ambient: even on a surface with no own actions the agent
    // can navigate → screenshot → extract, so the hint is never empty.
    const hint = agentActionsHint({ ...base, surface: 'nowhere', openFile: null })
    expect(hint).toContain('open a web page in the in-app browser')
  })

  it('enumerates the browser-drive capabilities on the Browser surface', () => {
    const hint = agentActionsHint({ ...base, surface: 'browser', openFile: null })
    expect(hint).toContain('open a web page in the in-app browser')
    expect(hint).toContain('screenshot a browser page')
    expect(hint).toContain('extract data from a browser page')
    // Tab-management actions are enumerated for parallel research.
    expect(hint).toContain('open a NEW browser tab')
  })

  it('appends ambient browser-drive actions to a non-browser surface manifest', () => {
    const ids = actionManifest({ ...base, surface: 'files', openFile: null }).map((m) => m.id)
    expect(ids).toContain('files.new-folder')
    expect(ids).toEqual(expect.arrayContaining(['browser.navigate', 'browser.screenshot', 'browser.extract']))
  })

  it('enumerates the Mail capabilities without promising to send', () => {
    const hint = agentActionsHint({ ...base, surface: 'mail' })
    expect(hint).toContain('open a new email draft')
    expect(hint).not.toMatch(/\bsend the email\b/i)
  })
})

// ── Tab-scoped drive (Stage 2) ───────────────────────────────────────────────
describe('browser drive — tab param passthrough', () => {
  const brCtx: SurfaceActionContext = { ...base, surface: 'browser', openFile: null }

  async function withWindow<T>(browser: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const g = globalThis as Record<string, unknown>
    const prevWindow = g.window
    const prevCE = g.CustomEvent
    g.CustomEvent = class {
      type: string; detail: unknown
      constructor(type: string, init?: { detail?: unknown }) { this.type = type; this.detail = init?.detail }
    }
    g.window = { workspace: { browser }, dispatchEvent: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }
    try { return await fn() } finally { g.window = prevWindow; g.CustomEvent = prevCE }
  }

  it('threads {tab} to window.workspace.browser.navigate', async () => {
    const navigate = vi.fn(async () => ({ ok: true }))
    await withWindow({ navigate }, async () => {
      await actionById('browser.navigate')!.run(brCtx, { url: 'https://x.test/', tab: 'tab-b' })
    })
    // navigate(url, tab) — the tab id is forwarded as the 2nd arg.
    expect(navigate).toHaveBeenCalledWith('https://x.test/', 'tab-b')
  })

  it('threads {tab} to deepRead/extract/click', async () => {
    const deepRead = vi.fn(async () => ({ ok: true }))
    const extract = vi.fn(async () => ({ ok: true }))
    const click = vi.fn(async () => ({ ok: true }))
    await withWindow({ deepRead, extract, click }, async () => {
      await actionById('browser.deepRead')!.run(brCtx, { url: 'https://x.test/', tab: 't1' })
      await actionById('browser.extract')!.run(brCtx, { mode: 'text', tab: 't2' })
      await actionById('browser.click')!.run(brCtx, { text: 'More', tab: 't3' })
    })
    expect(deepRead).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://x.test/', tab: 't1' }))
    expect(extract).toHaveBeenCalledWith('text', 't2')
    expect(click).toHaveBeenCalledWith(expect.objectContaining({ tab: 't3' }))
  })

  it('omitting {tab} keeps the active-tab call (backward-compatible)', async () => {
    const navigate = vi.fn(async () => ({ ok: true }))
    await withWindow({ navigate }, async () => {
      await actionById('browser.navigate')!.run(brCtx, { url: 'https://x.test/' })
    })
    expect(navigate).toHaveBeenCalledWith('https://x.test/', undefined)
  })
})
