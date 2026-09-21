import fs from 'fs'
import path from 'path'
import { parseSchedule } from './schedule'
import { validCapabilities } from '../agent/capabilityCatalog'

/**
 * ROUTINES — agents on a clock.
 *
 * A routine is a prompt, the agent that runs it, a schedule, and exactly the
 * capabilities it may reach. It lives in userData/routines.json. Three
 * templates are seeded once, OFF: a routine that runs before the person has
 * read what it does is a bill they did not sign.
 *
 * Pure of Electron: the file path is injected, so it is unit-tested against
 * a temp dir.
 */

export interface Routine {
  id: string
  name: string
  agentName: string | null
  prompt: string
  /** Canonical schedule string (see ./schedule.ts). */
  schedule: string
  enabled: boolean
  /** Capability ids the run may reach through wos-action. */
  capabilities: string[]
  lastRunAt: number | null
  nextRunAt: number | null
  lastJobId: string | null
  createdAt: number
  updatedAt: number
}

export interface RoutineInput {
  id?: string
  name: string
  agentName?: string | null
  prompt: string
  schedule: string
  enabled?: boolean
  capabilities?: string[]
}

export class RoutineValidationError extends Error {}

const NAME_MAX = 80
const PROMPT_MAX = 20_000

/** The three that ship. Off until the person turns them on. */
export const TEMPLATES: Omit<RoutineInput, 'id'>[] = [
  {
    name: 'Morning sift',
    schedule: 'weekdays@07:00',
    capabilities: ['mail'],
    prompt:
      'Sift the inbox. Read the unread mail from the last 24 hours (`wos-action run mail.search` and `mail.read`), sort it into four groups — needs a reply, waiting on someone else, worth knowing, noise — and write one short plain-language summary with the three things that most need the person. Draft nothing, send nothing, move nothing.',
  },
  {
    name: 'Weekly case report',
    schedule: 'weekly@mon 08:00',
    capabilities: ['cases', 'documents'],
    prompt:
      'For every open case (`wos-action run cases.list`, then `cases.get` for each), write one page in Cases/reports/<case-id>-<YYYY-MM-DD>.md: where it stands, what happened since last week from its notes, and what needs the person next. Attach each report to its case with `cases.attach`. If nothing changed on a case, say so in one line.',
  },
  {
    name: 'Stale case check',
    schedule: 'daily@09:00',
    capabilities: ['cases'],
    prompt:
      'List the cases (`wos-action run cases.list`). For each open case not updated in the last 10 days, add one note with `cases.note`: "Quiet for N days — still relevant?" Do nothing else. If no case is stale, reply with exactly: nothing stale.',
  },
]

interface FileShape {
  version: 1
  seeded: boolean
  routines: Routine[]
}

export class RoutineStore {
  private data: FileShape = { version: 1, seeded: false, routines: [] }

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {
    this.load()
    if (!this.data.seeded) {
      for (const t of TEMPLATES) this.upsert({ ...t, enabled: false })
      this.data.seeded = true
      this.write()
    }
  }

  private load(): void {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<FileShape>
      if (parsed && Array.isArray(parsed.routines)) {
        this.data = {
          version: 1,
          seeded: parsed.seeded === true,
          routines: parsed.routines.filter((r): r is Routine => typeof r?.id === 'string' && typeof r?.prompt === 'string' && !!parseSchedule(r.schedule)),
        }
      }
    } catch {
      /* first run, or unreadable — start empty and seed */
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { encoding: 'utf-8', mode: 0o600 })
  }

  list(): Routine[] {
    return this.data.routines.slice()
  }

  get(id: string): Routine | undefined {
    return this.data.routines.find((r) => r.id === id)
  }

  /** Create or update. Validates at the boundary; throws RoutineValidationError. */
  upsert(input: RoutineInput): Routine {
    const name = String(input.name ?? '').trim()
    if (!name || name.length > NAME_MAX) throw new RoutineValidationError('Give the routine a name (up to 80 characters).')
    const prompt = String(input.prompt ?? '').trim()
    if (!prompt || prompt.length > PROMPT_MAX) throw new RoutineValidationError('The routine needs a prompt.')
    if (!parseSchedule(input.schedule)) throw new RoutineValidationError('That schedule is not one the app understands.')
    const agentName = typeof input.agentName === 'string' && input.agentName.trim() ? input.agentName.trim().slice(0, 80) : null
    const capabilities = validCapabilities(input.capabilities ?? [])
    const t = this.now()
    const existing = input.id ? this.get(input.id) : undefined
    const routine: Routine = existing
      ? {
          ...existing,
          name,
          agentName,
          prompt,
          schedule: input.schedule.trim().toLowerCase(),
          enabled: input.enabled ?? existing.enabled,
          capabilities,
          // A changed schedule must be recomputed by the scheduler.
          nextRunAt: existing.schedule === input.schedule.trim().toLowerCase() ? existing.nextRunAt : null,
          updatedAt: t,
        }
      : {
          id: `rt-${t.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
          name,
          agentName,
          prompt,
          schedule: input.schedule.trim().toLowerCase(),
          enabled: input.enabled ?? false,
          capabilities,
          lastRunAt: null,
          nextRunAt: null,
          lastJobId: null,
          createdAt: t,
          updatedAt: t,
        }
    this.data.routines = existing ? this.data.routines.map((r) => (r.id === routine.id ? routine : r)) : [...this.data.routines, routine]
    this.write()
    return routine
  }

  /** Scheduler bookkeeping — no validation, no updatedAt bump. */
  mark(id: string, patch: Partial<Pick<Routine, 'lastRunAt' | 'nextRunAt' | 'lastJobId'>>): Routine | undefined {
    let out: Routine | undefined
    this.data.routines = this.data.routines.map((r) => {
      if (r.id !== id) return r
      out = { ...r, ...patch }
      return out
    })
    if (out) this.write()
    return out
  }

  delete(id: string): boolean {
    const before = this.data.routines.length
    this.data.routines = this.data.routines.filter((r) => r.id !== id)
    if (this.data.routines.length === before) return false
    this.write()
    return true
  }
}
