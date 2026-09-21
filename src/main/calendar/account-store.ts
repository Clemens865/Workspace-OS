import fs from 'fs/promises'
import path from 'path'
import crypto from 'crypto'
import type { SecretStore } from '../mail/account-store'

/**
 * Persistent store for calendar sources (CalDAV accounts and .ics feeds).
 *
 * SECURITY — the same invariant the mail store exists to protect, and the
 * SecretStore interface is reused rather than re-declared so both surfaces are
 * provably using one keychain path:
 *   The record persisted to userData JSON holds ONLY non-secret connection
 *   metadata (url, username, kind, display name, per-calendar selection). The
 *   app password is NEVER written into it. Secrets go to the injected
 *   {@link SecretStore} (Electron `safeStorage` in the app) in a SEPARATE file as
 *   opaque ciphertext keyed by source id, so record and secret can only be
 *   correlated through that id and the plaintext exists on disk in no form.
 *
 * An `ics` source has no secret at all — a subscription URL is public by
 * construction — so it never touches the secret file.
 *
 * Takes its userData dir and secret backend by injection, so it is pure-testable
 * against a temp dir with a mocked SecretStore and no Electron.
 */

/**
 * How a source is reached.
 *   `caldav`    — secret is the app password.
 *   `ics`       — no secret; a subscription URL is public by construction.
 *   `google`    — Google Calendar API; secret is the OAuth REFRESH token.
 *   `microsoft` — Microsoft Graph; secret is the OAuth refresh token.
 *
 * The cloud kinds store a refresh token in exactly the same keychain-backed slot
 * the CalDAV password uses, so there is one secret path to audit rather than two.
 */
export type CalendarSourceKind = 'caldav' | 'ics' | 'google' | 'microsoft'

/** Kinds whose secret is an OAuth refresh token rather than a password. */
export function isOAuthKind(kind: CalendarSourceKind): boolean {
  return kind === 'google' || kind === 'microsoft'
}

/**
 * A non-secret calendar-source record — EXACTLY what is persisted. The absence
 * of any password field is deliberate; adding one is the bug this design exists
 * to prevent.
 */
export interface CalendarSource {
  id: string
  kind: CalendarSourceKind
  displayName: string
  /** CalDAV server/collection URL, or the .ics feed URL. */
  url: string
  /** CalDAV login. Not itself a secret, but never logged. */
  username?: string
  /**
   * Collection URLs the user chose to show, for a CalDAV source with several.
   * Empty/absent = every discovered calendar (the sane default before the user
   * has expressed a preference).
   */
  enabledCalendars?: string[]
  createdAt: number
  updatedAt: number
}

export interface CalendarSourceInput {
  kind: CalendarSourceKind
  displayName: string
  url: string
  username?: string
  /** Plaintext app password for a caldav source; ignored for ics. */
  password?: string
  enabledCalendars?: string[]
}

const SOURCES_FILE = 'calendar-sources.json'
const PREFS_FILE = 'calendar-prefs.json'
const SECRETS_FILE = 'calendar-secrets.json'

export class CalendarSourceStore {
  constructor(
    private readonly userDataDir: string,
    private readonly secrets: SecretStore,
  ) {}

  private get sourcesPath(): string { return path.join(this.userDataDir, SOURCES_FILE) }
  private get secretsPath(): string { return path.join(this.userDataDir, SECRETS_FILE) }
  private get prefsPath(): string { return path.join(this.userDataDir, PREFS_FILE) }

  /**
   * The calendar new events go to, once the person has said which.
   *
   * Kept apart from the sources file because it is an answer ABOUT the
   * sources, not one of them — and because it must survive a source being
   * edited without being rewritten by that path.
   */
  async getDefaultTarget(): Promise<string | null> {
    const p = await this.readJson<{ defaultTarget?: string }>(this.prefsPath, {})
    return p.defaultTarget ?? null
  }

  async setDefaultTarget(id: string | null): Promise<void> {
    const p = await this.readJson<Record<string, unknown>>(this.prefsPath, {})
    if (id) p.defaultTarget = id
    else delete p.defaultTarget
    await this.writeJson(this.prefsPath, p)
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, 'utf-8')) as T
    } catch {
      // Missing (first run) or corrupt — start clean rather than blocking the
      // surface. A corrupt file is overwritten on the next successful write.
      return fallback
    }
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf-8')
  }

  async list(): Promise<CalendarSource[]> {
    const all = await this.readJson<CalendarSource[]>(this.sourcesPath, [])
    return Array.isArray(all) ? all : []
  }

  async get(id: string): Promise<CalendarSource | null> {
    return (await this.list()).find((s) => s.id === id) ?? null
  }

  /**
   * Add a source. A caldav source without a password is rejected: storing an
   * unusable account would show the user a broken calendar and a 401 later,
   * instead of the real problem now.
   */
  async add(input: CalendarSourceInput): Promise<CalendarSource> {
    const url = input.url.trim()
    if (!url) throw new Error('A calendar address is required')
    if (input.kind === 'caldav' && !input.password) {
      throw new Error('A CalDAV calendar needs an app password')
    }
    if (isOAuthKind(input.kind) && !input.password) {
      // For an OAuth source the "password" slot carries the refresh token; a
      // source without one can never mint an access token, so refuse it now
      // rather than showing a calendar that silently never loads.
      throw new Error('This account did not return a refresh token — try connecting again')
    }
    const now = Date.now()
    const source: CalendarSource = {
      id: crypto.randomUUID(),
      kind: input.kind,
      displayName: input.displayName.trim() || (input.kind === 'ics' ? 'Subscribed calendar' : 'Calendar'),
      url,
      ...(input.username ? { username: input.username.trim() } : {}),
      ...(input.enabledCalendars?.length ? { enabledCalendars: input.enabledCalendars } : {}),
      createdAt: now,
      updatedAt: now,
    }
    const all = await this.list()
    all.push(source)
    await this.writeJson(this.sourcesPath, all)
    if (input.password && input.kind !== 'ics') await this.setSecret(source.id, input.password)
    return source
  }

  /** Update non-secret fields (rename, change the enabled set). */
  async update(id: string, patch: Partial<Pick<CalendarSource, 'displayName' | 'enabledCalendars' | 'url' | 'username'>>): Promise<CalendarSource | null> {
    const all = await this.list()
    const i = all.findIndex((s) => s.id === id)
    if (i === -1) return null
    all[i] = { ...all[i], ...patch, updatedAt: Date.now() }
    await this.writeJson(this.sourcesPath, all)
    return all[i]
  }

  /** Remove a source AND its secret — a deleted account must leave nothing behind. */
  async remove(id: string): Promise<void> {
    await this.writeJson(this.sourcesPath, (await this.list()).filter((s) => s.id !== id))
    const secrets = await this.readJson<Record<string, string>>(this.secretsPath, {})
    if (secrets[id] !== undefined) {
      delete secrets[id]
      await this.writeJson(this.secretsPath, secrets)
    }
  }

  async setSecret(id: string, plaintext: string): Promise<void> {
    if (!this.secrets.isAvailable()) {
      throw new Error('The OS keychain is unavailable, so the password cannot be stored safely')
    }
    const secrets = await this.readJson<Record<string, string>>(this.secretsPath, {})
    secrets[id] = this.secrets.encrypt(plaintext).toString('base64')
    await this.writeJson(this.secretsPath, secrets)
  }

  /** The plaintext secret, or null when absent/undecryptable. */
  async getSecret(id: string): Promise<string | null> {
    const secrets = await this.readJson<Record<string, string>>(this.secretsPath, {})
    const b64 = secrets[id]
    if (typeof b64 !== 'string') return null
    try {
      return this.secrets.decrypt(Buffer.from(b64, 'base64'))
    } catch {
      // Wrong machine/user, or a rotated keychain key — treat as "no secret" so
      // the caller re-prompts instead of crashing the surface.
      return null
    }
  }
}
