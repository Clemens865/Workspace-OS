import { describe, it, expect, vi } from 'vitest'
import {
  listFolder,
  searchFiles,
  getFile,
  downloadFile,
  updateFile,
  localNameFor,
  isGoogleDoc,
  DriveError,
  DRIVE_SCOPES,
} from './drive-client'

/**
 * The things that actually go wrong with Drive, rather than "does a GET work".
 *
 * A Google Doc has no bytes; trashed files come back unless excluded; a 403
 * means three different things; and writing a .docx over a Doc destroys the
 * document. Each of those is a real failure this codebase would otherwise meet
 * for the first time in front of a user.
 */

/** Typing the parameters is what makes `mock.calls` typed at all. */
type FetchInit = { method?: string; body?: unknown; headers?: Record<string, string> }

const okJson = (body: unknown) =>
  vi.fn(async (_url: unknown, _init: FetchInit) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))

const DOC = {
  id: 'd1',
  name: 'Quarterly report',
  mimeType: 'application/vnd.google-apps.document',
  modifiedTime: '2026-08-18T09:00:00Z',
}
const PDF = { id: 'p1', name: 'contract.pdf', mimeType: 'application/pdf', size: '4096', modifiedTime: '2026-08-17T09:00:00Z' }
const FOLDER = { id: 'f1', name: 'Reports', mimeType: 'application/vnd.google-apps.folder', modifiedTime: '2026-08-01T09:00:00Z' }

describe('listFolder', () => {
  it('reads a folder and tells folders from files', async () => {
    const f = okJson({ files: [FOLDER, PDF, DOC] })
    const page = await listFolder('tok', 'root', {}, f as unknown as typeof fetch)
    expect(page.files.map((x) => x.name)).toEqual(['Reports', 'contract.pdf', 'Quarterly report'])
    expect(page.files[0].isFolder).toBe(true)
    expect(page.files[2].isGoogleDoc).toBe(true)
    expect(page.files[1].size).toBe(4096)
  })

  /** A "deleted" file reappearing in a list is unexplainable to the person. */
  it('excludes trashed files', async () => {
    const f = okJson({ files: [] })
    await listFolder('tok', 'root', {}, f as unknown as typeof fetch)
    expect(String(f.mock.calls[0][0])).toContain('trashed+%3D+false')
  })

  it('asks for shared drives, which are invisible otherwise', async () => {
    const f = okJson({ files: [] })
    await listFolder('tok', 'root', {}, f as unknown as typeof fetch)
    const url = String(f.mock.calls[0][0])
    expect(url).toContain('supportsAllDrives=true')
    expect(url).toContain('includeItemsFromAllDrives=true')
  })

  it('carries the page token onward', async () => {
    const f = okJson({ files: [], nextPageToken: 'next-please' })
    expect((await listFolder('tok', 'root', {}, f as unknown as typeof fetch)).nextPageToken).toBe('next-please')
  })

  it('sends the token as a bearer, never in the url', async () => {
    const f = okJson({ files: [] })
    await listFolder('secret-token', 'root', {}, f as unknown as typeof fetch)
    expect(String(f.mock.calls[0][0])).not.toContain('secret-token')
    expect(f.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer secret-token' })
  })
})

describe('searchFiles', () => {
  /** An apostrophe would end the query clause and change what was asked. */
  it('escapes a quote in the query', async () => {
    const f = okJson({ files: [] })
    await searchFiles('tok', "Clemens' notes", {}, f as unknown as typeof fetch)
    // URLSearchParams encodes spaces as '+', which decodeURIComponent leaves alone.
    const q = decodeURIComponent(String(f.mock.calls[0][0])).replace(/\+/g, ' ')
    expect(q).toContain("name contains 'Clemens\\' notes'")
  })
})

describe('downloadFile', () => {
  it('exports a Google Doc as a real .docx', async () => {
    const f = vi.fn(async (_url: unknown, _init: FetchInit) => new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const out = await downloadFile('tok', DOC, f as unknown as typeof fetch)
    const url = String(f.mock.calls[0][0])
    expect(url).toContain('/export?')
    expect(decodeURIComponent(url)).toContain('wordprocessingml.document')
    expect(out.filename).toBe('Quarterly report.docx')
    expect(out.bytes.length).toBe(3)
  })

  it('downloads an ordinary file as-is', async () => {
    const f = vi.fn(async (_url: unknown, _init: FetchInit) => new Response(new Uint8Array([9]), { status: 200 }))
    const out = await downloadFile('tok', PDF, f as unknown as typeof fetch)
    expect(String(f.mock.calls[0][0])).toContain('alt=media')
    expect(out.filename).toBe('contract.pdf')
  })

  /** A Google Form has nothing to hand back; a file full of error text is worse. */
  it('refuses a Google file with no export, saying which', async () => {
    const form = { id: 'x', name: 'Survey', mimeType: 'application/vnd.google-apps.form' }
    const f = vi.fn(async (_url: unknown, _init: FetchInit) => new Response('', { status: 200 }))
    await expect(downloadFile('tok', form, f as unknown as typeof fetch)).rejects.toThrow(/Survey/)
    expect(f).not.toHaveBeenCalled()
  })
})

describe('updateFile', () => {
  it('writes an ordinary file back', async () => {
    const f = okJson(PDF)
    await updateFile('tok', PDF, new Uint8Array([1]), f as unknown as typeof fetch)
    const init = f.mock.calls[0][1]
    expect(init.method).toBe('PATCH')
    expect(String(f.mock.calls[0][0])).toContain('uploadType=media')
  })

  /**
   * The one that would destroy somebody's work: a .docx written over a Doc
   * converts it and loses comments and revision history.
   */
  it('refuses to overwrite a Google document', async () => {
    const f = okJson({})
    await expect(updateFile('tok', DOC, new Uint8Array([1]), f as unknown as typeof fetch)).rejects.toThrow(
      /comments and history/,
    )
    expect(f).not.toHaveBeenCalled()
  })
})

describe('errors a person can act on', () => {
  const failing = (status: number, body = '') =>
    vi.fn(async (_url: unknown, _init: FetchInit) => new Response(body, { status }))

  it('says to reconnect when the token expired', async () => {
    await expect(getFile('tok', 'x', failing(401) as unknown as typeof fetch)).rejects.toThrow(/Reconnect your Drive/)
  })

  it('tells a missing scope apart from a rate limit', async () => {
    const scope = failing(403, '{"error":{"errors":[{"reason":"insufficientPermissions"}],"message":"Insufficient Permission"}}')
    await expect(getFile('t', 'x', scope as unknown as typeof fetch)).rejects.toThrow(/allow the requested access/)

    const rate = failing(403, '{"error":{"errors":[{"reason":"userRateLimitExceeded"}],"message":"Rate Limit"}}')
    await expect(getFile('t', 'x', rate as unknown as typeof fetch)).rejects.toThrow(/rate-limiting/)
  })

  it('says a file is gone rather than printing 404', async () => {
    await expect(getFile('t', 'x', failing(404) as unknown as typeof fetch)).rejects.toThrow(/no longer in the Drive/)
  })

  it('survives the network being down', async () => {
    const dead = vi.fn(async (_url: unknown, _init: FetchInit) => { throw new Error('offline') })
    await expect(getFile('t', 'x', dead as unknown as typeof fetch)).rejects.toThrow(/Could not reach Google Drive/)
  })

  it('is always a DriveError, so callers can tell it from a bug', async () => {
    await expect(getFile('t', 'x', failing(500) as unknown as typeof fetch)).rejects.toBeInstanceOf(DriveError)
  })
})

describe('naming and scopes', () => {
  it('names an exported Doc with its new extension, once', () => {
    expect(localNameFor(DOC)).toBe('Quarterly report.docx')
    expect(localNameFor({ name: 'Report.docx', mimeType: DOC.mimeType })).toBe('Report.docx')
    expect(localNameFor(PDF)).toBe('contract.pdf')
  })

  it('knows a Google-native document from an ordinary one', () => {
    expect(isGoogleDoc(DOC.mimeType)).toBe(true)
    expect(isGoogleDoc(PDF.mimeType)).toBe(false)
  })

  /** drive.file cannot browse — the trap that decides what this feature can be. */
  it('offers the scope as a choice, not a constant', () => {
    expect(DRIVE_SCOPES.appFiles).toMatch(/drive\.file$/)
    expect(DRIVE_SCOPES.readOnly).toMatch(/drive\.readonly$/)
    expect(DRIVE_SCOPES.full).toMatch(/auth\/drive$/)
  })
})
