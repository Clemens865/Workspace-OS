import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * Workspace memory — surfaces prior cross-project insights from the local
 * claude-pulse activity DB (`~/.claude-pulse/tracker.db`) inside the app.
 *
 * The Pulse DB is the user's own compounding memory: typed insights
 * (decisions, progress, blockers, patterns) extracted from Claude Code sessions
 * across every project. This module is a **strictly read-only** window onto it —
 * it NEVER writes to, migrates, or takes a write lock on the user's DB.
 *
 * Safety & robustness:
 *  - Opened `{ readonly: true, fileMustExist: true }`; no PRAGMA/journal writes.
 *  - Graceful no-op when the DB is absent or unreadable (returns empty results,
 *    `available()` is false) — the feature simply disappears, never crashes.
 *  - Schema-drift tolerant: columns are feature-detected via `PRAGMA table_info`
 *    so a newer/older Pulse schema keeps working (missing optionals → null).
 */

/** Insight categories as stored by claude-pulse (schema `CHECK(type IN …)`). */
export type PulseInsightType =
  | 'progress'
  | 'decision'
  | 'pattern'
  | 'fix'
  | 'context'
  | 'blocked'

/** A single typed insight, normalized for the renderer. */
export interface PulseInsight {
  id: number
  type: PulseInsightType
  /** The insight body (Pulse column `content`). */
  text: string
  /** Owning project name (Pulse column `project`). */
  project: string
  /** ISO-8601 creation time (Pulse column `created_at`); '' if unavailable. */
  timestamp: string
  /** Optional rationale captured alongside the insight. */
  reasoning: string | null
}

export interface MemoryQuery {
  /** Workspace root path or bare project name — matched against `project`. */
  project: string
  /** Restrict to these categories (defaults to all). */
  types?: PulseInsightType[]
  /** Case-insensitive substring filter over the insight text. */
  search?: string
  /** Max rows (clamped 1..500, default 50). */
  limit?: number
}

export type MemoryStatus = 'available' | 'absent' | 'incompatible' | 'error'

/** Default location of the user's Pulse tracker DB. */
export const DEFAULT_PULSE_DB = path.join(os.homedir(), '.claude-pulse', 'tracker.db')

/**
 * Derives the project name Pulse keys by from a workspace root. Pulse stores the
 * directory basename (e.g. `/…/Software-Projects/Workspace-OS` → `Workspace-OS`).
 * A bare name is returned unchanged.
 */
export function deriveProjectName(rootOrName: string): string {
  const trimmed = (rootOrName ?? '').trim().replace(/[/\\]+$/, '')
  if (!trimmed) return ''
  if (trimmed.includes('/') || trimmed.includes('\\')) return path.basename(trimmed)
  return trimmed
}

const ALL_TYPES: readonly PulseInsightType[] = [
  'progress',
  'decision',
  'pattern',
  'fix',
  'context',
  'blocked',
]

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50
  return Math.max(1, Math.min(500, Math.floor(limit as number)))
}

export class PulseMemory {
  private readonly dbPath: string
  private db: Database.Database | null = null
  private opened = false
  private cols: Set<string> = new Set()
  private _status: MemoryStatus = 'absent'

  constructor(dbPath: string = DEFAULT_PULSE_DB) {
    this.dbPath = dbPath
  }

  /** Opens the DB read-only on first use; safe to call repeatedly. */
  private ensureOpen(): Database.Database | null {
    if (this.opened) return this.db
    this.opened = true
    try {
      if (!fs.existsSync(this.dbPath)) {
        this._status = 'absent'
        return null
      }
      // readonly + fileMustExist guarantees we never create or write the DB.
      this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true })
      const info = this.db.prepare('PRAGMA table_info(insights)').all() as Array<{ name: string }>
      this.cols = new Set(info.map((c) => c.name))
      // Minimum columns we need to produce a meaningful insight.
      if (!this.cols.has('project') || !this.cols.has('type') || !this.cols.has('content')) {
        this._status = 'incompatible'
        return this.db
      }
      this._status = 'available'
      return this.db
    } catch (err) {
      console.error('[memory] failed to open Pulse DB read-only:', err)
      this._status = 'error'
      this.db = null
      return null
    }
  }

  /** Current connection status (opens lazily on first check). */
  status(): MemoryStatus {
    this.ensureOpen()
    return this._status
  }

  /** True when the Pulse DB is present, readable, and schema-compatible. */
  available(): boolean {
    return this.status() === 'available'
  }

  /**
   * Returns insights for a project, most-recent-first. Empty array whenever the
   * DB is missing/unreadable/incompatible or the project has no insights.
   */
  query(opts: MemoryQuery): PulseInsight[] {
    const db = this.ensureOpen()
    if (!db || this._status !== 'available') return []

    const project = deriveProjectName(opts.project)
    if (!project) return []

    const hasCreated = this.cols.has('created_at')
    const hasId = this.cols.has('id')
    const hasReasoning = this.cols.has('reasoning')

    // Build a SELECT that only references columns that actually exist, so an
    // older/newer Pulse schema can't break the query.
    const select = [
      hasId ? 'id' : '0 AS id',
      'type',
      'content',
      'project',
      hasCreated ? 'created_at' : "'' AS created_at",
      hasReasoning ? 'reasoning' : 'NULL AS reasoning',
    ].join(', ')

    const where: string[] = ['LOWER(project) = LOWER(?)']
    const params: unknown[] = [project]

    const types = (opts.types ?? []).filter((t) => ALL_TYPES.includes(t))
    if (types.length > 0) {
      where.push(`type IN (${types.map(() => '?').join(', ')})`)
      params.push(...types)
    }

    const search = (opts.search ?? '').trim()
    if (search) {
      where.push('content LIKE ? ESCAPE ' + "'\\'")
      params.push(`%${search.replace(/[%_\\]/g, '\\$&')}%`)
    }

    const orderCol = hasCreated ? 'created_at' : hasId ? 'id' : 'rowid'
    const limit = clampLimit(opts.limit)
    params.push(limit)

    try {
      const rows = db
        .prepare(
          `SELECT ${select} FROM insights
           WHERE ${where.join(' AND ')}
           ORDER BY ${orderCol} DESC
           LIMIT ?`
        )
        .all(...params) as Array<{
        id: number
        type: string
        content: string
        project: string
        created_at: string
        reasoning: string | null
      }>

      return rows.map((r) => ({
        id: Number(r.id) || 0,
        type: r.type as PulseInsightType,
        text: r.content ?? '',
        project: r.project ?? project,
        timestamp: r.created_at ?? '',
        reasoning: r.reasoning ?? null,
      }))
    } catch (err) {
      console.error('[memory] query failed:', err)
      return []
    }
  }

  /** Convenience: the N most recent insights for a project across all types. */
  recent(project: string, limit = 50): PulseInsight[] {
    return this.query({ project, limit })
  }

  close(): void {
    try {
      this.db?.close()
    } catch {
      // Best-effort; a read-only handle rarely fails to close.
    }
    this.db = null
    this.opened = false
  }
}
