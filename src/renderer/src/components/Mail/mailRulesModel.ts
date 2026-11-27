/** The sorting-rule manager's logic, kept out of the dialog so it can be tested. */
import type { MailCategory, MailRule } from '../../types/workspace-api'
import { ipcReason } from '../../lib/ipcError'

export const CATEGORIES: MailCategory[] = ['personal', 'notification', 'newsletter']

/** What a rule matches, in a sentence. A rule needs ALL of its conditions (classify.ts). */
export function describeRule(rule: MailRule): string {
  const parts = [
    rule.from && `sender contains “${rule.from}”`,
    rule.domain && `domain is ${rule.domain}`,
    rule.subject && `subject contains “${rule.subject}”`,
  ].filter(Boolean)
  const text = parts.join(' and ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export interface RuleForm {
  from: string
  domain: string
  subject: string
  category: MailCategory
}

export function formOf(rule: MailRule): RuleForm {
  return { from: rule.from ?? '', domain: rule.domain ?? '', subject: rule.subject ?? '', category: rule.category }
}

/** The update for an edited rule. Every field goes, so main drops the emptied ones. */
export function rulePatch(form: RuleForm): { ok: true; patch: RuleForm } | { ok: false; error: string } {
  const patch = { from: form.from.trim(), domain: form.domain.trim(), subject: form.subject.trim(), category: form.category }
  if (!patch.from && !patch.domain && !patch.subject) {
    return { ok: false, error: 'Give the rule a sender, a domain or a subject.' }
  }
  return { ok: true, patch }
}

/**
 * Runs a change (if any), then reads the rules back: the list always shows what
 * is saved. `rules` is null only when it could not be read.
 */
export async function changeRules(
  api: { list: () => Promise<MailRule[]> },
  change?: () => Promise<unknown>,
): Promise<{ rules: MailRule[] | null; error: string | null }> {
  let error: string | null = null
  try {
    await change?.()
  } catch (e) {
    error = ipcReason(e)
  }
  try {
    return { rules: await api.list(), error }
  } catch (e) {
    return { rules: null, error: error ?? ipcReason(e) }
  }
}
