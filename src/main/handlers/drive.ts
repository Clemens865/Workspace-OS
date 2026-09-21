import { IpcMain, app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { getWorkspaceRoot } from '../workspace-root'
import { safeSecretStore } from '../mail/safe-secret-store'
import { resolveGoogleClientId } from '../mail/oauth/client-config'
import { runGoogleOAuthFlow } from '../mail/oauth/oauth-flow'
import { refreshAccessToken, EMAIL_SCOPE } from '../mail/oauth/google-oauth'
import { DriveAccountStore, canWrite, type DriveConnection } from '../drive/drive-account'
import {
  DRIVE_SCOPES,
  listFolder,
  searchFiles,
  getFile,
  downloadFile,
  updateFile,
  localNameFor,
  DriveError,
  type DriveAccess,
} from '../drive/drive-client'

/**
 * Google Drive, connected the way Google asks for it.
 *
 * The in-app browser cannot sign into Google — their policy for browsers
 * embedded in an app, documented and enforced. This uses the installed-app
 * loopback flow instead: the system browser opens, the person consents there,
 * and a refresh token comes back. That flow already existed for mail and
 * calendar; nothing here re-implements it.
 *
 * Everything reads through the local workspace: a Drive file is FETCHED INTO
 * the workspace and opened from there, rather than edited over the wire. That
 * keeps one rule true — what the app edits is a file on this disk — and it
 * means the office engine, the agent and the canvas need to know nothing about
 * Drive at all.
 */

let store: DriveAccountStore | null = null
function accounts(): DriveAccountStore {
  if (!store) store = new DriveAccountStore(app.getPath('userData'), safeSecretStore)
  return store
}

const nodeFetch: typeof fetch = (...args) => fetch(...args)

/** The drive account store, for the Connectors page (get + disconnect; never a secret). */
export function driveAccountStore(): DriveAccountStore {
  return accounts()
}

/** Can the connected Drive still get an access token? For the Connectors page. */
export async function probeDrive(): Promise<'ok' | 'fail' | 'unconfigured' | 'skip'> {
  if (!(await accounts().get())) return 'skip'
  if (!resolveGoogleClientId(app.getPath('userData'))) return 'unconfigured'
  try {
    await accessToken()
    return 'ok'
  } catch {
    return 'fail'
  }
}

/**
 * A live access token, from the stored refresh token.
 *
 * Never cached on disk: access tokens last an hour, and one written down is a
 * credential sitting in a file for the fifty-nine minutes after it stopped
 * being useful.
 */
async function accessToken(): Promise<string> {
  const refresh = await accounts().refreshToken()
  if (!refresh) throw new IpcValidationError('No Google Drive is connected.')
  const clientId = resolveGoogleClientId(app.getPath('userData'))
  if (!clientId) throw new IpcValidationError('No Google client id is configured.')
  const res = await refreshAccessToken({ refreshToken: refresh, clientId }, nodeFetch)
  if (!res.ok) {
    throw new IpcValidationError(
      'Google would not renew this connection. Reconnect your Drive in Settings.',
    )
  }
  return res.value.accessToken
}

/**
 * Which account this is, for the card.
 *
 * The flow returns tokens and nothing else, so the address is read from the
 * userinfo endpoint with the access token we just got. Failure is not fatal: a
 * connection that works but cannot name itself is still a working connection,
 * and refusing to connect over a cosmetic label would be absurd.
 */
async function accountEmail(accessToken: string): Promise<string> {
  try {
    const res = await nodeFetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return ''
    const json = (await res.json()) as { email?: string }
    return typeof json.email === 'string' ? json.email : ''
  } catch {
    return ''
  }
}

/** Where fetched Drive files land. One folder, so they are findable later. */
const DRIVE_DIR = 'Drive'

function asString(v: unknown, max = 512): string {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) throw new IpcValidationError('A value is required.')
  return s.slice(0, max)
}

/** Turns a DriveError into the shape every other surface here returns. */
async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }> {
  try {
    return { ok: true as const, value: await fn() }
  } catch (e) {
    if (e instanceof DriveError || e instanceof IpcValidationError) {
      return { ok: false as const, error: { message: e.message } }
    }
    throw e
  }
}

export function registerDriveHandlers(ipcMain: IpcMain): void {
  /** The connection, or null. Drives whether the UI offers connect or browse. */
  ipcHandle(ipcMain, 'drive:connection', async () => {
    const c = await accounts().get()
    return { connection: c, canWrite: canWrite(c), clientIdConfigured: Boolean(resolveGoogleClientId(app.getPath('userData'))) }
  })

  /**
   * Connect. Opens the SYSTEM browser — see the module comment.
   *
   * The access level is the person's choice and is stored, because it decides
   * what the UI may offer later. Read-only that shows a Save button is a
   * promise broken at the end of somebody's work rather than the start.
   */
  ipcHandle(ipcMain, 'drive:connect', async (_e, access: unknown) => {
    const level: DriveAccess =
      access === 'full' || access === 'appFiles' || access === 'readOnly' ? access : 'readOnly'
    const clientId = resolveGoogleClientId(app.getPath('userData'))
    if (!clientId) {
      return {
        ok: false as const,
        error: {
          message:
            'No Google client id is configured yet. Add one in Settings — Google requires apps to register before they may ask for access.',
        },
      }
    }

    const flow = await runGoogleOAuthFlow({
      clientId,
      fetchFn: nodeFetch,
      // The identity scope so the card can say WHICH account is connected. A
      // connection labelled "Google" tells nobody which of their accounts it is.
      scopes: [DRIVE_SCOPES[level], EMAIL_SCOPE],
    })
    if (!flow.ok) return { ok: false as const, error: { message: flow.error.message } }
    if (!flow.value.tokens.refreshToken) {
      // Without one, the connection dies in an hour and cannot be renewed.
      return {
        ok: false as const,
        error: { message: 'Google did not return a renewable connection. Disconnect the app at myaccount.google.com and try again.' },
      }
    }

    const connection: DriveConnection = {
      email: (await accountEmail(flow.value.tokens.accessToken)) || '(unknown account)',
      access: level,
      connectedAt: new Date().toISOString(),
    }
    await accounts().save(connection, flow.value.tokens.refreshToken)
    return { ok: true as const, value: { connection, canWrite: canWrite(connection) } }
  })

  ipcHandle(ipcMain, 'drive:disconnect', async () => {
    await accounts().disconnect()
    return { ok: true as const }
  })

  ipcHandle(ipcMain, 'drive:list', (_e, folderId: unknown, pageToken: unknown) =>
    guard(async () =>
      listFolder(
        await accessToken(),
        typeof folderId === 'string' && folderId ? folderId.slice(0, 200) : 'root',
        typeof pageToken === 'string' && pageToken ? { pageToken } : {},
        nodeFetch,
      ),
    ),
  )

  ipcHandle(ipcMain, 'drive:search', (_e, query: unknown) =>
    guard(async () => searchFiles(await accessToken(), asString(query, 200), {}, nodeFetch)),
  )

  /**
   * Fetch a Drive file into the workspace and return its local path.
   *
   * This is the whole integration in one call: everything downstream — the
   * canvas, the office engine, the agent — sees an ordinary file on disk and
   * needs to know nothing about Drive.
   */
  ipcHandle(ipcMain, 'drive:open', (_e, fileId: unknown) =>
    guard(async () => {
      const root = getWorkspaceRoot()
      if (!root) throw new IpcValidationError('No workspace folder is open.')
      const token = await accessToken()
      const meta = await getFile(token, asString(fileId, 200), nodeFetch)
      if (meta.isFolder) throw new IpcValidationError(`“${meta.name}” is a folder.`)

      const { bytes, filename } = await downloadFile(token, meta, nodeFetch)
      const dir = path.join(root, DRIVE_DIR)
      await fs.mkdir(dir, { recursive: true })
      // basename: the name comes from Drive, so it is somebody else's string and
      // must never be able to climb out of the folder it was meant for.
      const target = path.join(dir, path.basename(filename))
      await fs.writeFile(target, bytes)
      return { path: target, name: path.basename(filename), fileId: meta.id, wasExported: meta.isGoogleDoc }
    }),
  )

  /**
   * Push a local file back to the Drive file it came from.
   *
   * Refused for Google-native documents in the client, which is where that rule
   * belongs: writing a .docx over a Doc converts it and loses the comments and
   * revision history. And refused outright on a read-only connection, rather
   * than discovered at the end by a 403.
   */
  ipcHandle(ipcMain, 'drive:save', (_e, fileId: unknown, localPath: unknown) =>
    guard(async () => {
      const connection = await accounts().get()
      // Order matters: without this, "nothing is connected" was reported as
      // "connected read-only", which sends the person to reconnect a Drive
      // they never had.
      if (!connection) throw new IpcValidationError('No Google Drive is connected.')
      if (!canWrite(connection)) {
        throw new IpcValidationError(
          'This Drive is connected read-only. Reconnect with write access to save changes back.',
        )
      }
      const root = getWorkspaceRoot()
      if (!root) throw new IpcValidationError('No workspace folder is open.')
      const abs = path.resolve(root, asString(localPath, 1024))
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        throw new IpcValidationError('That file is outside the workspace.')
      }
      const token = await accessToken()
      const meta = await getFile(token, asString(fileId, 200), nodeFetch)
      const bytes = new Uint8Array(await fs.readFile(abs))
      const saved = await updateFile(token, meta, bytes, nodeFetch)
      return { name: saved.name, modifiedAt: saved.modifiedAt }
    }),
  )

  /** What a Drive file would be called locally — for the UI to show first. */
  ipcHandle(ipcMain, 'drive:local-name', (_e, name: unknown, mimeType: unknown) =>
    localNameFor({ name: asString(name, 300), mimeType: typeof mimeType === 'string' ? mimeType : '' }),
  )
}
