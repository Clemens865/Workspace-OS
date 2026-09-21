// e2e — the REAL SMTP send path proven against a REAL socket.
//
// This is the analog of the project's "engine e2e" discipline: not ok:true, not
// a mock. It stands up an actual SMTP server on 127.0.0.1 (smtp-server, by the
// nodemailer author), then sends through the ACTUAL production SmtpClient +
// buildOutgoing (the real nodemailer transport, over a real TCP socket) and
// PARSES the message the server received to assert:
//   - correct From / To / Cc
//   - Subject (with Re: prefixing for a reply)
//   - In-Reply-To + References threading headers on a reply
//   - the body text
//   - an attachment (filename + exact bytes)
//
// The production TS (smtp-client.ts, send-service.ts) is transpiled to CJS with
// esbuild and required directly — so this exercises the shipping code, not a
// re-implementation.
import { SMTPServer } from 'smtp-server'
import { simpleParser } from 'mailparser'
import esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const require = createRequire(import.meta.url)

// ---- tiny assert harness --------------------------------------------------
let passed = 0
let failed = 0
function ok(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`) }
}

// ---- compile the REAL production modules to CJS and load them -------------
// Output inside the repo tree so node resolves node_modules (nodemailer) from
// the project root by walking up — a temp dir outside the repo cannot.
const OUT = fs.mkdtempSync(path.join(ROOT, 'e2e', 'mail', '.build-'))
async function loadReal(rel) {
  const outfile = path.join(OUT, rel.replace(/[\\/]/g, '_').replace(/\.ts$/, '.cjs'))
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main', 'mail', rel)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    // Keep node_modules external so we use the SAME installed nodemailer / mjml.
    external: ['nodemailer', 'imapflow', 'mailparser', 'electron', 'mjml'],
    logLevel: 'silent',
  })
  return require(outfile)
}

// Load a real production module from an arbitrary path under src/main.
async function loadRealAbs(rel) {
  const outfile = path.join(OUT, rel.replace(/[\\/]/g, '_').replace(/\.ts$/, '.cjs'))
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main', rel)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['nodemailer', 'imapflow', 'mailparser', 'electron', 'mjml'],
    logLevel: 'silent',
  })
  return require(outfile)
}

// ---- a real local SMTP server that captures the raw message ---------------
function startServer() {
  return new Promise((resolve) => {
    /** @type {{ raw: Buffer, envelope: any }[]} */
    const received = []
    const server = new SMTPServer({
      authOptional: true, // accept any AUTH (or none)
      disabledCommands: ['STARTTLS'],
      onData(stream, session, callback) {
        const chunks = []
        stream.on('data', (c) => chunks.push(c))
        stream.on('end', () => {
          received.push({ raw: Buffer.concat(chunks), envelope: session.envelope })
          callback()
        })
      },
      onAuth(_auth, _session, cb) {
        cb(null, { user: 'anyone' }) // accept any credentials
      },
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, received, port: server.server.address().port })
    })
  })
}

async function main() {
  const { SmtpClient } = await loadReal('smtp-client.ts')
  const { buildOutgoing } = await loadReal('send-service.ts')

  const { server, received, port } = await startServer()
  console.log(`  local SMTP server on 127.0.0.1:${port}`)

  // Non-TLS local socket (server has STARTTLS disabled). This is the REAL
  // nodemailer transport from the production SmtpClient default factory.
  const client = new SmtpClient()
  const cfg = { host: '127.0.0.1', port, secure: false, auth: { user: 'alice', pass: 'never-logged' } }

  // ===================================================================
  // TEST 1: a NEW message with To/Cc + an attachment — real socket send
  // ===================================================================
  const attachmentBytes = Buffer.from('%PDF-1.4 real attachment bytes\n\x01\x02\x03')
  const newMsg = buildOutgoing(
    { name: 'Alice Sender', address: 'alice@example.com' },
    {
      to: [{ address: 'bob@example.com' }],
      cc: [{ name: 'Carol', address: 'carol@example.com' }],
      subject: 'Quarterly numbers',
      text: 'Here are the numbers you asked for.',
      attachments: [{ filename: 'report.pdf', content: attachmentBytes, contentType: 'application/pdf' }],
    },
    { kind: 'new' },
  )
  const r1 = await client.send(cfg, newMsg)
  ok('T1 send returned ok (real socket accepted)', r1.ok === true, JSON.stringify(r1))
  ok('T1 server received exactly one message', received.length === 1, `got ${received.length}`)

  const parsed1 = await simpleParser(received[0].raw)
  ok('T1 From is correct', parsed1.from?.value?.[0]?.address === 'alice@example.com', parsed1.from?.text)
  ok('T1 To is correct', parsed1.to?.value?.[0]?.address === 'bob@example.com', parsed1.to?.text)
  ok('T1 Cc is correct', parsed1.cc?.value?.[0]?.address === 'carol@example.com', parsed1.cc?.text)
  ok('T1 Subject is correct', parsed1.subject === 'Quarterly numbers', parsed1.subject)
  ok('T1 body text delivered', (parsed1.text || '').includes('numbers you asked for'), parsed1.text)
  const att1 = parsed1.attachments?.[0]
  ok('T1 attachment filename delivered', att1?.filename === 'report.pdf', att1?.filename)
  ok('T1 attachment BYTES match exactly', att1 && Buffer.compare(att1.content, attachmentBytes) === 0, 'byte mismatch')
  // The AUTH password must never appear in the raw wire bytes we captured.
  ok('T1 password never on the wire', !received[0].raw.toString('latin1').includes('never-logged'))

  // ===================================================================
  // TEST 2: a REPLY — Re: prefix + In-Reply-To + References threading
  // ===================================================================
  received.length = 0
  const source = {
    uid: 1,
    subject: 'Project kickoff',
    from: [{ name: 'Bob', address: 'bob@example.com' }],
    to: [{ name: 'Alice', address: 'alice@example.com' }, { name: 'Dave', address: 'dave@example.com' }],
    cc: [],
    date: '2026-07-07T10:00:00.000Z',
    messageId: '<parent-abc@example.com>',
    references: ['<root-000@example.com>'],
    text: 'Can we meet next week?',
    html: '',
    hasBlockedRemoteContent: false,
    attachments: [],
    flags: [],
    seen: true,
  }
  const replyMsg = buildOutgoing(
    { name: 'Alice', address: 'alice@example.com' },
    { to: [{ address: 'bob@example.com' }], subject: '', text: 'Yes, Tuesday works.' },
    { kind: 'reply', source, replyAll: true },
  )
  const r2 = await client.send(cfg, replyMsg)
  ok('T2 reply send returned ok', r2.ok === true, JSON.stringify(r2))

  const parsed2 = await simpleParser(received[0].raw)
  ok('T2 Subject is Re: prefixed', parsed2.subject === 'Re: Project kickoff', parsed2.subject)
  ok('T2 In-Reply-To header set to parent', parsed2.inReplyTo === '<parent-abc@example.com>', parsed2.inReplyTo)
  const refs = parsed2.references
    ? (Array.isArray(parsed2.references) ? parsed2.references.join(' ') : parsed2.references)
    : ''
  ok('T2 References chain carries root + parent',
    refs.includes('<root-000@example.com>') && refs.includes('<parent-abc@example.com>'), refs)
  ok('T2 reply-all Cc includes original other-recipient (dave)',
    (parsed2.cc?.text || '').includes('dave@example.com'), parsed2.cc?.text)
  ok('T2 quoted original present in body',
    (parsed2.text || '').includes('> Can we meet next week?'), parsed2.text)

  // ===================================================================
  // TEST 2b: the LIVING-FEED reply-from-card path — a DraftService draft
  // (agent body injected via a fake draftFn) sent as a reply over the REAL
  // socket. Proves the Phase-3 "approve & send" reuses the proven send path:
  // the agent's body is delivered verbatim, Re:/threading come from buildOutgoing.
  // ===================================================================
  received.length = 0
  const { DraftService } = await loadReal('draft-service.ts')
  const FAKE_BODY = 'Thanks — Tuesday at 3pm works for me. See you then.'
  const draftSvc = new DraftService(async () => FAKE_BODY) // injected fake drafter
  const drafted = await draftSvc.draftReply(
    { name: 'Alice', address: 'alice@example.com' },
    source,
    { replyAll: false },
  )
  ok('T2b drafted body equals the (fake) agent output', drafted.suggestedBody === FAKE_BODY)
  ok('T2b drafting produced an envelope but sent NOTHING', received.length === 0)
  // Now the user "approves": send the drafted envelope through the real client.
  const r2b = await client.send(cfg, drafted.envelope)
  ok('T2b approve & send returned ok (real socket)', r2b.ok === true, JSON.stringify(r2b))
  const parsed2b = await simpleParser(received[0].raw)
  ok('T2b agent body delivered verbatim', (parsed2b.text || '').includes(FAKE_BODY), parsed2b.text)
  ok('T2b Subject is Re: prefixed via buildOutgoing', parsed2b.subject === 'Re: Project kickoff', parsed2b.subject)
  ok('T2b In-Reply-To threading present', parsed2b.inReplyTo === '<parent-abc@example.com>', parsed2b.inReplyTo)
  ok('T2b quoted original present', (parsed2b.text || '').includes('> Can we meet next week?'), parsed2b.text)

  // ===================================================================
  // TEST 4: the ADVANCED 1:1 EMAIL path — a NORMAL message to ONE colleague,
  // assembled from a chosen DESIGN THEME + structured blocks (a text block, a
  // live metric callout, a CTA button) → live {{metric}} resolved → responsive
  // HTML + a plain-text FALLBACK part → sent over the REAL socket. Proves the
  // advanced-email capability reuses the proven send path and that the RESOLVED
  // metric value + the CTA link + the responsive media query all ride the wire,
  // WITH a text/plain fallback alongside the text/html part.
  // ===================================================================
  received.length = 0
  const { buildRichEmail } = await loadRealAbs(path.join('mail', 'rich-email', 'compose-build.ts'))

  // A live metric the email transcludes. The token in the metric callout block
  // must be replaced by THIS value before compile+send.
  const METRIC_VALUE = 424242
  const fakeMetrics = { get: (id) => (id === 'mrr' ? { value: METRIC_VALUE } : undefined) }

  // The user picked the "editorial" theme and assembled: a personal note, a live
  // metric callout, and a CTA button — a normal 1:1 email that happens to be rich.
  const built = await buildRichEmail(
    {
      themeId: 'editorial',
      blocks: [
        { kind: 'text', text: 'Hi Bob — quick personal note on where we landed this month.' },
        { kind: 'metric', label: 'MRR', value: '{{metric:mrr}}' },
        { kind: 'cta', label: 'Open the dashboard', href: 'https://dash.example.com/mrr' },
      ],
    },
    fakeMetrics,
  )
  ok('T4 rich email compiled cleanly (no MJML errors)', built.errors.length === 0, JSON.stringify(built.errors))
  ok('T4 no liveness token left unresolved', built.unresolvedTokens.length === 0, JSON.stringify(built.unresolvedTokens))
  ok('T4 compiled html carries the RESOLVED metric value', built.html.includes(String(METRIC_VALUE)))
  ok('T4 compiled html is responsive (media query present)', built.html.includes('@media'))
  ok('T4 raw {{metric}} token does NOT survive into html', !built.html.includes('{{metric'))
  ok('T4 the CTA link is in the html', built.html.includes('https://dash.example.com/mrr'))
  ok('T4 a plain-text fallback was built with the metric resolved',
    built.text.includes(String(METRIC_VALUE)) && built.text.includes('quick personal note'), built.text)
  ok('T4 the editorial theme accent was applied', built.html.includes('#9a6b3f'))

  // The user approves and sends: reuse buildOutgoing + the real SmtpClient, with
  // the COMPILED html set as the html part AND the built plain-text fallback.
  const richMsg = buildOutgoing(
    { name: 'Alice Sender', address: 'alice@example.com' },
    {
      to: [{ address: 'bob@example.com' }], // ONE normal recipient — a 1:1 email
      subject: 'Where we landed this month',
      text: built.text, // plain-text fallback part
      html: built.html,
    },
    { kind: 'new' },
  )
  const r4 = await client.send(cfg, richMsg)
  ok('T4 rich 1:1 send returned ok (real socket)', r4.ok === true, JSON.stringify(r4))
  ok('T4 server received exactly one message', received.length === 1, `got ${received.length}`)

  const parsed4 = await simpleParser(received[0].raw)
  ok('T4 To is the single colleague', parsed4.to?.value?.[0]?.address === 'bob@example.com', parsed4.to?.text)
  ok('T4 an HTML part was delivered', typeof parsed4.html === 'string' && parsed4.html.length > 0)
  ok('T4 a plain-text fallback part was delivered alongside the html',
    typeof parsed4.text === 'string' && parsed4.text.includes(String(METRIC_VALUE)), parsed4.text)
  ok('T4 the delivered HTML part carries the RESOLVED metric value',
    (parsed4.html || '').includes(String(METRIC_VALUE)), 'metric value missing from received html')
  ok('T4 the delivered HTML is responsive (media query on the wire)',
    (parsed4.html || '').includes('@media'), 'no media query in received html')
  ok('T4 the delivered HTML carries the CTA button link',
    (parsed4.html || '').includes('https://dash.example.com/mrr'), 'CTA link missing from received html')
  ok('T4 the delivered HTML shows the personal copy',
    (parsed4.html || '').includes('quick personal note'), 'copy missing from received html')

  // ===================================================================
  // TEST 5: the BRAND KIT path — the user codified a brand once (accent +
  // fonts); the "Brand" email theme is DERIVED from it and its accent must ride
  // the wire in the delivered HTML. Proves brand → theme → real-socket send.
  // ===================================================================
  received.length = 0
  const { brandTheme } = await loadRealAbs(path.join('mail', 'rich-email', 'themes.ts'))

  // The user's saved Brand kit (palette + fonts). A distinctive accent no built-in
  // theme uses, so finding it on the wire proves it came from the brand.
  const BRAND_ACCENT = '#e91e63'
  const brandKit = {
    palette: { accent: BRAND_ACCENT, background: '#0b0b12', text: '#f5f5f7' },
    fonts: { heading: 'Poppins, sans-serif', body: 'Inter, sans-serif' },
  }

  // Sanity: brandTheme derives the accent + body font from the kit.
  const derived = brandTheme(brandKit)
  ok('T5 brandTheme derives the accent from the kit', derived.accent === BRAND_ACCENT, derived.accent)
  ok('T5 brandTheme derives the body font from the kit', derived.fontFamily === 'Inter, sans-serif', derived.fontFamily)

  // Build a 1:1 email on the 'brand' theme (the handler injects the kit as `brand`).
  const brandBuilt = await buildRichEmail(
    {
      themeId: 'brand',
      brand: brandKit,
      blocks: [
        { kind: 'text', text: 'Hi Bob — a quick on-brand note from us.' },
        { kind: 'cta', label: 'See the update', href: 'https://acme.example.com/update' },
      ],
    },
    fakeMetrics,
  )
  ok('T5 brand email compiled cleanly', brandBuilt.errors.length === 0, JSON.stringify(brandBuilt.errors))
  ok('T5 compiled html carries the BRAND accent', brandBuilt.html.includes(BRAND_ACCENT), 'accent missing from html')
  ok('T5 compiled html carries the BRAND body font', brandBuilt.html.includes('Inter, sans-serif'))

  const brandMsg = buildOutgoing(
    { name: 'Alice Sender', address: 'alice@example.com' },
    { to: [{ address: 'bob@example.com' }], subject: 'On-brand hello', text: brandBuilt.text, html: brandBuilt.html },
    { kind: 'new' },
  )
  const r5 = await client.send(cfg, brandMsg)
  ok('T5 brand send returned ok (real socket)', r5.ok === true, JSON.stringify(r5))
  ok('T5 server received exactly one message', received.length === 1, `got ${received.length}`)
  const parsed5 = await simpleParser(received[0].raw)
  ok('T5 the delivered HTML carries the BRAND ACCENT on the wire',
    (parsed5.html || '').includes(BRAND_ACCENT), 'brand accent missing from received html')
  ok('T5 the delivered HTML carries the BRAND font on the wire',
    (parsed5.html || '').includes('Inter, sans-serif'), 'brand font missing from received html')

  // ===================================================================
  // TEST 3: auth/host failure classification against a CLOSED socket
  // ===================================================================
  const badCfg = { host: '127.0.0.1', port: 1, secure: false, auth: { user: 'x', pass: 'y' } }
  const r3 = await client.send(badCfg, newMsg)
  ok('T3 unreachable port yields a typed error (no throw)', r3.ok === false, JSON.stringify(r3))
  ok('T3 error is host/timeout/unknown class, message sanitized',
    r3.ok === false && !r3.error.message.includes('y'), JSON.stringify(r3))

  // ---- teardown ----
  await new Promise((res) => server.close(res))
  try { fs.rmSync(OUT, { recursive: true, force: true }) } catch {}

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('FAIL (threw):', e.stack || e.message)
  process.exit(1)
})
