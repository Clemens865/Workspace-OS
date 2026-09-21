// Dogfood harness — exercises the REAL wired mail feature paths engine-free:
// the demo mailbox → triage (needs-a-reply) → a REAL `claude -p` agent draft
// → the brand + live-data rich-email compile. Prints what actually happened,
// including the actual agent-drafted reply text (the one quality signal no unit
// test can assert). No electron, no LibreOffice, no network, no credentials.
import { spawn } from 'child_process'
import { DemoBackend } from '../../src/main/mail/demo/demo-backend'
import { DEMO_USER } from '../../src/main/mail/demo/demo-store'
import { toTriageMessage, triageMessages } from '../../src/main/mail/triage'
import { DraftService, type DraftFn } from '../../src/main/mail/draft-service'
import { buildRichEmail } from '../../src/main/mail/rich-email/compose-build'
import { stripAgentTelemetry } from '../../src/main/mail/agent-output'

const CLAUDE = process.env.WOS_CLAUDE || 'claude'

function claudeDraft(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, ['-p'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`))))
    child.stdin.write(prompt)
    child.stdin.end()
  })
}

function replyPrompt(source: { subject: string; from: { name?: string; address: string }[]; text: string }): string {
  const sender = source.from[0]?.name || source.from[0]?.address || 'the sender'
  return [
    'You are drafting a concise, professional reply to the email below, on behalf of the recipient.',
    'Write ONLY the reply body (no subject, no salutation boilerplate beyond a normal greeting, no quoted original).',
    'Be warm, specific, and to the point.',
    '',
    `From: ${sender}`,
    `Subject: ${source.subject}`,
    '',
    source.text,
  ].join('\n')
}

const line = (s = '') => process.stdout.write(s + '\n')

async function main(): Promise<void> {
  const backend = new DemoBackend()

  line('=== DEMO MAILBOX ===')
  const folders = backend.listFolders()
  line(`folders: ${folders.map((f) => f.name).join(' · ')}`)
  const inbox = folders.find((f) => f.specialUse === '\\Inbox' || /inbox/i.test(f.path))?.path ?? 'INBOX'
  const summaries = backend.listMessages(inbox, { limit: 50 })
  line(`inbox messages: ${summaries.length} (${summaries.filter((s) => !s.seen).length} unread)`)
  const fulls = summaries.map((s) => backend.fetchMessage(inbox, s.uid)).filter(Boolean) as NonNullable<ReturnType<DemoBackend['fetchMessage']>>[]
  const htmlMsg = fulls.find((f) => f.html)
  line(`html/reader check: a message with sanitized HTML ${htmlMsg ? `exists (uid ${htmlMsg.uid}), remote-content-blocked=${htmlMsg.hasBlockedRemoteContent}` : 'not found'}`)

  line('')
  line('=== TRIAGE (needs a reply) ===')
  const tmsgs = fulls.map((f) => toTriageMessage(f as never, inbox))
  const needs = triageMessages(tmsgs, DEMO_USER)
  line(`triage flagged ${needs.length} of ${fulls.length}:`)
  for (const n of needs) {
    const m = fulls.find((f) => f.uid === n.uid)!
    line(`  • "${m.subject}" — from ${m.from[0]?.name || m.from[0]?.address} — reason: ${n.reason}`)
  }

  line('')
  line('=== REAL AGENT DRAFT (claude -p on the top needs-a-reply message) ===')
  const top = fulls.find((f) => f.uid === needs[0]?.uid)
  if (!top) {
    line('no needs-a-reply message to draft against')
  } else {
    line(`source: "${top.subject}" from ${top.from[0]?.name || top.from[0]?.address}`)
    line(`their message: ${JSON.stringify(top.text.slice(0, 220))}`)
    const draftFn: DraftFn = async ({ source }) => stripAgentTelemetry(await claudeDraft(replyPrompt(source)))
    const svc = new DraftService(draftFn)
    const drafted = await svc.draftReply({ name: 'You', address: DEMO_USER }, top)
    line(`envelope → to: ${drafted.envelope.to.map((a) => a.address).join(', ')} | subject: "${drafted.envelope.subject}"`)
    line('--- AGENT-DRAFTED REPLY BODY ---')
    line(drafted.suggestedBody)
    line('--- end draft ---')
  }

  line('')
  line('=== BRAND + LIVE-DATA RICH EMAIL COMPILE ===')
  const brand = { palette: { accent: '#e91e63', background: '#ffffff', text: '#1f2733' }, fonts: { heading: 'Georgia, serif', body: 'Helvetica, Arial, sans-serif' } }
  const built = await buildRichEmail(
    { themeId: 'brand', brand: brand as never, blocks: [{ kind: 'text', text: 'Hi Sam — quick update: our MRR is now {{metric:mrr}} this quarter. More soon.' }] },
    { get: (id: string) => (id === 'mrr' ? { value: 21900, name: 'MRR' } : undefined) } as never,
  )
  const html = built.html
  line(`compile errors: ${built.errors.length} | unresolved tokens: ${built.unresolvedTokens.length}`)
  line(`brand accent (#e91e63) in html: ${html.includes('#e91e63')}`)
  line(`live metric resolved (21900) in html: ${html.includes('21900')}`)
  line(`raw {{metric}} leaked: ${html.includes('{{metric')}`)
  line(`responsive (@media) present: ${html.includes('@media')}`)

  line('')
  line('=== DOGFOOD SUMMARY ===')
  line(`demo inbox: ${summaries.length} msgs, triage flagged ${needs.length}; agent draft produced: ${top ? 'YES' : 'no'}; brand+live compile: ${built.errors.length === 0 && html.includes('#e91e63') && html.includes('21900') ? 'CLEAN' : 'CHECK'}`)
}

main().catch((e) => {
  line('DOGFOOD ERROR: ' + (e?.stack || e?.message || String(e)))
  process.exit(1)
})
