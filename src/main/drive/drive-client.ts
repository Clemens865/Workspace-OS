/**
 * Google Drive, over the API rather than the website.
 *
 * The in-app browser cannot sign into Google — that is Google's documented
 * policy for browsers embedded in another app, and it is not going to be argued
 * with. This is the path they DO sanction: an installed-app OAuth token
 * obtained through the system browser (see mail/oauth/oauth-flow.ts, which
 * already does exactly that for mail), then REST calls with that token.
 *
 * It is also simply the better route. An agent driving drive.google.com is
 * scraping a page that Google reskins whenever it likes; an agent calling the
 * API gets structured answers and a document export that is actually a .docx.
 *
 * PURE and Electron-free: every function takes its `fetch` so the whole surface
 * is testable without a network or a token. The I/O wrapper lives above.
 */

/* ── scopes ──────────────────────────────────────────────────────────────── */

/**
 * The scope decides what the feature can BE, so it is a parameter and not a
 * constant buried in a call.
 *
 * `drive.file` sounds like the safe default and is a trap for this product: it
 * grants access only to files this app itself created, or ones handed over by
 * Google's Picker — and the Picker needs a signed-in Google session in a
 * browser, which is the thing that does not work here. Choosing it means the
 * Files panel can never show anything the user already has.
 *
 * `drive.readonly` is what "connect my Drive and let me open my documents"
 * actually requires. It is a SENSITIVE scope: fine for your own account with an
 * unverified app, but until the app passes Google's review the refresh token
 * expires about weekly and the connection has to be made again. That is a real
 * cost and it belongs in front of the person choosing, not in a comment nobody
 * reads.
 */
export const DRIVE_SCOPES = {
  /** Only files this app created. No browsing. No verification needed. */
  appFiles: 'https://www.googleapis.com/auth/drive.file',
  /** Read everything in the Drive. Sensitive: unverified tokens expire weekly. */
  readOnly: 'https://www.googleapis.com/auth/drive.readonly',
  /** Read and write everything. Sensitive, and the one Google reviews hardest. */
  full: 'https://www.googleapis.com/auth/drive',
} as const

export type DriveAccess = keyof typeof DRIVE_SCOPES

/* ── shapes ──────────────────────────────────────────────────────────────── */

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  /** Absent for folders and Google-native documents. */
  size?: number
  modifiedAt: string
  /** True for a folder — the only distinction the file tree needs. */
  isFolder: boolean
  /**
   * True for Docs/Sheets/Slides, which have no bytes of their own and must be
   * EXPORTED to a real format. Downloading one gives an error, not a file.
   */
  isGoogleDoc: boolean
  /** Parent folder ids, when asked for. */
  parents?: string[]
}

export interface DrivePage {
  files: DriveFile[]
  /** Pass back as `pageToken` for the next page; absent when the list ended. */
  nextPageToken?: string
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'DriveError'
  }
}

type Fetcher = typeof fetch

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

/** The fields worth asking for. Drive returns almost nothing unless asked. */
const FILE_FIELDS = 'id,name,mimeType,size,modifiedTime,parents'

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/**
 * What a Google-native document should be exported AS.
 *
 * Chosen to match what this app can already open and edit, so a Doc arrives as
 * something the office engine understands rather than as a PDF the user can
 * only look at.
 */
export const EXPORT_AS: Record<string, { mimeType: string; extension: string }> = {
  'application/vnd.google-apps.document': {
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '.docx',
  },
  'application/vnd.google-apps.spreadsheet': {
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: '.xlsx',
  },
  'application/vnd.google-apps.presentation': {
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx',
  },
  'application/vnd.google-apps.drawing': { mimeType: 'image/png', extension: '.png' },
}

export function isGoogleDoc(mimeType: string): boolean {
  return String(mimeType).startsWith('application/vnd.google-apps.')
}

/** The name a Drive file should be saved under locally, extension included. */
export function localNameFor(file: Pick<DriveFile, 'name' | 'mimeType'>): string {
  const exp = EXPORT_AS[file.mimeType]
  if (!exp) return file.name
  // A Doc called "Report" becomes "Report.docx"; one already called
  // "Report.docx" is left alone rather than becoming "Report.docx.docx".
  return file.name.toLowerCase().endsWith(exp.extension) ? file.name : `${file.name}${exp.extension}`
}

function toFile(raw: Record<string, unknown>): DriveFile {
  const mimeType = String(raw.mimeType ?? '')
  const size = raw.size === undefined || raw.size === null ? undefined : Number(raw.size)
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? '(untitled)'),
    mimeType,
    ...(Number.isFinite(size) ? { size: size as number } : {}),
    modifiedAt: String(raw.modifiedTime ?? ''),
    isFolder: mimeType === FOLDER_MIME,
    isGoogleDoc: isGoogleDoc(mimeType),
    ...(Array.isArray(raw.parents) ? { parents: raw.parents.map(String) } : {}),
  }
}

/**
 * One request, with the error handling that makes a failure legible.
 *
 * Drive answers 401 for an expired token and 403 for both "you did not ask for
 * this scope" and "you are over quota" — three very different problems that all
 * arrive as a number, and each needs a different thing FROM THE USER. Telling
 * them apart here is the difference between "reconnect your Drive" and a
 * support thread.
 */
async function call(
  token: string,
  url: string,
  fetcher: Fetcher,
  init: RequestInit = {},
): Promise<Response> {
  let res: Response
  try {
    res = await fetcher(url, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    })
  } catch (e) {
    throw new DriveError(`Could not reach Google Drive: ${(e as Error).message}`)
  }
  if (res.ok) return res

  const body = await res.text().catch(() => '')
  const reason = /"reason"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? ''
  const message = /"message"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? ''

  if (res.status === 401) {
    throw new DriveError('Google signed this connection out. Reconnect your Drive in Settings.', 401)
  }
  if (res.status === 403 && /insufficient|scope/i.test(`${reason} ${message}`)) {
    throw new DriveError(
      'This connection was not granted access to that. Reconnect your Drive and allow the requested access.',
      403,
    )
  }
  if (res.status === 403 && /rateLimit|userRateLimit|quota/i.test(reason)) {
    throw new DriveError('Google is rate-limiting this connection. Try again shortly.', 403)
  }
  if (res.status === 404) throw new DriveError('That file is no longer in the Drive.', 404)
  throw new DriveError(message ? `Google Drive: ${message}` : `Google Drive returned ${res.status}.`, res.status)
}

/* ── reading ─────────────────────────────────────────────────────────────── */

/**
 * One folder's contents, newest first, folders before files.
 *
 * Sorted here rather than by the caller because every surface wants the same
 * order, and Drive's own default (by relevance) is not an order anybody can
 * predict.
 */
export async function listFolder(
  token: string,
  folderId = 'root',
  opts: { pageToken?: string; pageSize?: number } = {},
  fetcher: Fetcher = fetch,
): Promise<DrivePage> {
  const params = new URLSearchParams({
    // Trashed files are still returned unless excluded, which is how a "deleted"
    // document reappears in a file list and nobody can explain why.
    q: `'${folderId}' in parents and trashed = false`,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: String(Math.max(1, Math.min(opts.pageSize ?? 100, 1000))),
    orderBy: 'folder,modifiedTime desc',
    // Shared drives are invisible without both of these.
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    ...(opts.pageToken ? { pageToken: opts.pageToken } : {}),
  })
  const res = await call(token, `${API}/files?${params}`, fetcher)
  const json = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string }
  return {
    files: (json.files ?? []).map(toFile),
    ...(json.nextPageToken ? { nextPageToken: json.nextPageToken } : {}),
  }
}

/** Search by name across the Drive. */
export async function searchFiles(
  token: string,
  query: string,
  opts: { pageSize?: number } = {},
  fetcher: Fetcher = fetch,
): Promise<DrivePage> {
  // A quote in the query would end the clause and change its meaning.
  const safe = String(query).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const params = new URLSearchParams({
    q: `name contains '${safe}' and trashed = false`,
    fields: `nextPageToken,files(${FILE_FIELDS})`,
    pageSize: String(Math.max(1, Math.min(opts.pageSize ?? 50, 1000))),
    orderBy: 'modifiedTime desc',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
  })
  const res = await call(token, `${API}/files?${params}`, fetcher)
  const json = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string }
  return {
    files: (json.files ?? []).map(toFile),
    ...(json.nextPageToken ? { nextPageToken: json.nextPageToken } : {}),
  }
}

export async function getFile(token: string, fileId: string, fetcher: Fetcher = fetch): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: FILE_FIELDS, supportsAllDrives: 'true' })
  const res = await call(token, `${API}/files/${encodeURIComponent(fileId)}?${params}`, fetcher)
  return toFile((await res.json()) as Record<string, unknown>)
}

/**
 * The bytes of a file, ready to write to disk.
 *
 * A Google-native document has no bytes and is EXPORTED instead — asking Drive
 * to download one returns an error, not a file, which is the first thing anyone
 * integrating with Drive gets wrong.
 */
export async function downloadFile(
  token: string,
  file: Pick<DriveFile, 'id' | 'mimeType' | 'name'>,
  fetcher: Fetcher = fetch,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const exp = EXPORT_AS[file.mimeType]
  const url = exp
    ? `${API}/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exp.mimeType)}`
    : `${API}/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`

  if (!exp && isGoogleDoc(file.mimeType)) {
    // A Google form, site or shortcut. There is nothing to hand back, and
    // saying so beats writing a file containing an error message.
    throw new DriveError(`“${file.name}” is a Google ${file.mimeType.split('.').pop()} and cannot be downloaded.`)
  }

  const res = await call(token, url, fetcher)
  return { bytes: new Uint8Array(await res.arrayBuffer()), filename: localNameFor(file) }
}

/* ── writing ─────────────────────────────────────────────────────────────── */

/**
 * Replaces a file's content. Requires the `full` scope.
 *
 * Deliberately not offered for Google-native documents: writing a .docx back
 * over a Doc converts the document and loses its comments, revision history and
 * anything the format cannot express. That is somebody's work, and a sync
 * feature is not permitted to spend it silently.
 */
export async function updateFile(
  token: string,
  file: Pick<DriveFile, 'id' | 'mimeType' | 'name'>,
  bytes: Uint8Array,
  fetcher: Fetcher = fetch,
): Promise<DriveFile> {
  if (isGoogleDoc(file.mimeType)) {
    throw new DriveError(
      `“${file.name}” is a Google document. Writing over it would convert it and lose its comments and history.`,
    )
  }
  const params = new URLSearchParams({ uploadType: 'media', fields: FILE_FIELDS, supportsAllDrives: 'true' })
  const res = await call(token, `${UPLOAD}/files/${encodeURIComponent(file.id)}?${params}`, fetcher, {
    method: 'PATCH',
    body: bytes as unknown as BodyInit,
    headers: { 'Content-Type': file.mimeType || 'application/octet-stream' },
  })
  return toFile((await res.json()) as Record<string, unknown>)
}
