import fs from 'fs/promises'
import path from 'path'
import type { MailRule, MailCategory } from './classify'

/**
 * The rules the person wrote, on disk.
 *
 * Plain JSON in userData rather than anything cleverer, for the same reason
 * cases are markdown: a rule that files mail somewhere is exactly the thing
 * you want to be able to read, check and delete by hand when it does something
 * you did not expect.
 *
 * Order is meaningful and is the person's — the first matching rule wins, so
 * moving one up is how you say "this one takes precedence". Sorting them for
 * tidiness would silently change what they do.
 */

const FILE = 'mail-rules.json'

const CATEGORIES: ReadonlySet<string> = new Set<MailCategory>(['personal', 'notification', 'newsletter'])

/** Trims, bounds and drops anything that would match nothing (or everything). */
export function sanitizeRule(input: unknown, id: string): MailRule | null {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const str = (v: unknown, max = 200): string | undefined => {
    const s = typeof v === 'string' ? v.trim().slice(0, max) : ''
    return s ? s : undefined
  }
  const category = typeof o.category === 'string' && CATEGORIES.has(o.category) ? (o.category as MailCategory) : null
  if (!category) return null

  const rule: MailRule = { id, category }
  const from = str(o.from)
  const domain = str(o.domain, 253)
  const subject = str(o.subject)
  if (from) rule.from = from
  // A domain with an @ or a scheme is a paste of a whole address or url; take
  // the host out of it rather than storing something that can never match.
  if (domain) rule.domain = domain.replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (subject) rule.subject = subject
  if (o.enabled === false) rule.enabled = false

  // Nothing to match on: it would apply to every message in the mailbox.
  if (!rule.from && !rule.domain && !rule.subject) return null
  return rule
}

/** An id no existing rule holds. */
function uniqueId(existing: MailRule[]): string {
  const taken = new Set(existing.map((r) => r.id))
  const stamp = Date.now().toString(36)
  for (let n = 0; ; n++) {
    const id = n === 0 ? `rule-${stamp}` : `rule-${stamp}-${n}`
    if (!taken.has(id)) return id
  }
}

export class MailRuleStore {
  constructor(private readonly userDataDir: string) {}

  private get file(): string {
    return path.join(this.userDataDir, FILE)
  }

  async list(): Promise<MailRule[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf-8')) as unknown
      if (!Array.isArray(raw)) return []
      return raw
        .map((r, i) => sanitizeRule(r, typeof (r as { id?: unknown })?.id === 'string' ? String((r as { id: string }).id) : `r${i}`))
        .filter((r): r is MailRule => r !== null)
    } catch {
      // Missing (nothing written yet) or corrupt. An unreadable rules file must
      // not take mail down with it — no rules simply means the signals decide.
      return []
    }
  }

  private async write(rules: MailRule[]): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(rules, null, 2), 'utf-8')
  }

  async add(input: unknown): Promise<MailRule> {
    const rules = await this.list()
    /*
     * A timestamp alone is not unique.
     *
     * Two rules added in the same millisecond got the same id, and then
     * deleting one deleted both — silently, since the survivor and the victim
     * looked identical in a list keyed by id. Caught by a test that added two
     * rules and removed one.
     */
    const rule = sanitizeRule(input, uniqueId(rules))
    if (!rule) throw new Error('A rule needs something to match on and a category.')
    await this.write([...rules, rule])
    return rule
  }

  async update(id: string, patch: unknown): Promise<MailRule | null> {
    const rules = await this.list()
    const i = rules.findIndex((r) => r.id === id)
    if (i < 0) return null
    const merged = sanitizeRule({ ...rules[i], ...(patch as object) }, id)
    if (!merged) throw new Error('That change would leave the rule matching nothing.')
    rules[i] = merged
    await this.write(rules)
    return merged
  }

  async remove(id: string): Promise<void> {
    const rules = await this.list()
    await this.write(rules.filter((r) => r.id !== id))
  }

  /** Moves a rule up or down — the only way to change which one wins. */
  async reorder(id: string, delta: number): Promise<MailRule[]> {
    const rules = await this.list()
    const i = rules.findIndex((r) => r.id === id)
    if (i < 0) return rules
    const j = Math.max(0, Math.min(rules.length - 1, i + delta))
    if (i === j) return rules
    const [moved] = rules.splice(i, 1)
    rules.splice(j, 0, moved)
    await this.write(rules)
    return rules
  }
}
