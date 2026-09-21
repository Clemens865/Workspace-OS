import { IpcMain, session } from 'electron'
import { IPC } from '../ipc-channels'
import { ipcHandle } from '../ipc-registry'
import { IpcValidationError } from '../ipc-validator'
import { assertMainFrame } from '../security'
import { accountsStore } from '../accounts'
import { normalizeDomain, type ConnectedAccount } from '../accounts/accounts-store'

/**
 * IPC surface for Connected Accounts.
 *
 * The user signs into a website ONCE by hand in the in-app browser (on the
 * `persist:wos-browser` partition); the session persists as cookies in Electron's
 * encrypted store. We manage only that SESSION lifecycle + a tiny non-secret
 * record per site.
 *
 * SECURITY (non-negotiable): no password/credential ever touches this code, disk,
 * or logs. We never intercept, store, or autofill a login. `accounts:add` records
 * intent only (domain/label/addedAt). `accounts:signout` clears that site's
 * session data from the partition. `hasSession` is a presence heuristic — it reads
 * whether cookies EXIST for the domain, never their contents (no value crosses IPC).
 */

/** The in-app browser's persistent session partition (see BrowserSurface). */
const PARTITION = 'persist:wos-browser'

/** The Electron session backing the in-app browser. */
function browserSession(): Electron.Session {
  return session.fromPartition(PARTITION)
}

/**
 * Presence heuristic: does this domain have any cookies on the browser session?
 * Non-empty ⇒ treat as an active signed-in session. We query by domain (which
 * matches host + any leading-dot cookie domains) and return only a boolean — the
 * cookie names/values never leave main.
 */
async function hasSession(domain: string): Promise<boolean> {
  try {
    const cookies = await browserSession().cookies.get({ domain })
    const now = Date.now() / 1000
    // A cookie that has already expired is not a session. Session cookies
    // carry no expiry and count.
    return cookies.some((c) => c.expirationDate === undefined || c.expirationDate > now)
  } catch {
    return false
  }
}

/** Shared with the Connectors page: does this site hold a live session? Boolean only. */
export function siteHasSession(domain: string): Promise<boolean> {
  return hasSession(domain)
}

/**
 * Clear a site's session data from the browser partition and drop the record.
 * Shared with the Connectors page.
 */
export async function signOutSite(domainInput: unknown): Promise<void> {
  const domain = normalizeDomain(domainInput)
  if (!domain) throw new IpcValidationError('Invalid domain')
  const s = browserSession()
  // Clear storage for both the bare and www origins over http+https — the login
  // may have set cookies on any of them. clearStorageData scopes by origin.
  const origins = [`https://${domain}`, `https://www.${domain}`, `http://${domain}`, `http://www.${domain}`]
  for (const origin of origins) {
    try {
      await s.clearStorageData({ origin })
    } catch {
      /* best-effort per origin */
    }
  }
  // Belt-and-braces: remove any cookies still matching the domain (covers
  // leading-dot cookie domains clearStorageData's origin filter can miss).
  try {
    const cookies = await s.cookies.get({ domain })
    for (const c of cookies) {
      const host = c.domain?.replace(/^\./, '') ?? domain
      const scheme = c.secure ? 'https' : 'http'
      try {
        await s.cookies.remove(`${scheme}://${host}${c.path || '/'}`, c.name)
      } catch {
        /* best-effort per cookie */
      }
    }
  } catch {
    /* ignore */
  }
  accountsStore().remove(domain)
}

/** Shape returned to the UI: the entry plus its live liveness flag. */
export interface AccountView extends ConnectedAccount {
  hasSession: boolean
}

export function registerAccountsHandlers(ipcMain: IpcMain): void {
  const store = (): ReturnType<typeof accountsStore> => accountsStore()

  /**
   * List every recorded account with a live `hasSession` flag (queried from the
   * partition's cookies per domain). No secret ever crosses this boundary.
   */
  ipcHandle(ipcMain, IPC.ACCOUNTS_LIST, async (event) => {
    assertMainFrame(event)
    const entries = store().list()
    const views: AccountView[] = await Promise.all(
      entries.map(async (e) => ({ ...e, hasSession: await hasSession(e.domain) })),
    )
    return views
  })

  /**
   * Record intent to connect a site. Does NOT log in — the user does that on the
   * real site. Returns the stored entry (with hasSession, usually false until the
   * user completes the login).
   */
  ipcHandle(ipcMain, IPC.ACCOUNTS_ADD, async (event, url: unknown) => {
    assertMainFrame(event)
    const entry = store().add(url)
    if (!entry) throw new IpcValidationError('Enter a valid website (e.g. linkedin.com)')
    return { ...entry, hasSession: await hasSession(entry.domain) } satisfies AccountView
  })

  /**
   * Sign out of a site: clear its session data (cookies + storage) from the
   * browser partition, and drop the recorded entry. After this the agent no longer
   * inherits an authenticated session for that site.
   */
  ipcHandle(ipcMain, IPC.ACCOUNTS_SIGNOUT, async (event, domainInput: unknown) => {
    assertMainFrame(event)
    await signOutSite(domainInput)
    return { ok: true as const }
  })
}
