/**
 * Mock data for the recording workspace.
 *
 * Half the surfaces on the shot list — Mail, Calendar, Knowledge — show nothing
 * at all against an empty workspace, and a feature filmed against an empty
 * state demonstrates nothing. Each is populated the way the app itself would
 * be, never by faking the UI:
 *
 *   Mail      → the app's OWN built-in demo account (`authKind: 'demo'`), an
 *               in-memory mailbox with no credentials and no network.
 *   Calendar  → a real `ics` source, served from a throwaway HTTP server here.
 *               The app fetches and parses it exactly as it would a live feed.
 *   Knowledge → markdown notes with `[[wiki-links]]`, which is what the
 *               backlink graph is built from.
 *
 * Everything is invented but plausible: a harbour-terminal project, because
 * generic "Lorem" content makes a product look like a toy.
 */
import fs from 'fs'
import path from 'path'
import http from 'http'

/* ── Knowledge: linked notes ─────────────────────────────────────────────── */

const NOTES = {
  'Harbour Terminal.md': `# Harbour Terminal

The berth reconstruction programme, running to Q4. Owner: [[Site Report]].

Berths 4 and 5 returned to service in March, three weeks ahead of programme.
Throughput has held above plan every month since — see [[Quarterly Review]].

Open questions sit in [[Dredging]]. Commercial terms in [[Northwind MSA]].
`,
  'Quarterly Review.md': `# Quarterly Review

Prepared for the board. Pulls its figures from the cost model rather than
restating them, so the numbers cannot drift — see [[Live Numbers]].

Covers [[Harbour Terminal]] and the [[Dredging]] programme.
`,
  'Dredging.md': `# Dredging

Complete to design depth across the approach channel. The pilotage trial closed
without exception.

Residual risk is siltation over winter; survey cadence agreed monthly.
Feeds [[Quarterly Review]].
`,
  'Northwind MSA.md': `# Northwind MSA

Master services agreement, signed. Rates schedule is the authority for
[[Cost Model]] — any line that disagrees is a defect, not a negotiation.

Renewal falls due with the [[Quarterly Review]].
`,
  'Cost Model.md': `# Cost Model

Rates come from [[Northwind MSA]]. Quantities from site.

Every figure quoted elsewhere is a live reference to this sheet — see
[[Live Numbers]].
`,
  'Live Numbers.md': `# Live Numbers

A figure lives in ONE place and flows into every document that quotes it.

Berth capacity, throughput and the contract rates are all defined once and
referenced from [[Quarterly Review]] and [[Cost Model]]. Change the source and
the documents follow.
`,
  'Site Report.md': `# Site Report

Weekly. Photographs grouped by area, paired with the field notes.

Feeds [[Harbour Terminal]].
`,
}

export function seedKnowledge(ws) {
  const dir = path.join(ws, 'Notes')
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, body] of Object.entries(NOTES)) {
    fs.writeFileSync(path.join(dir, name), body)
  }
  return Object.keys(NOTES).length
}

/* ── Files at the workspace root ─────────────────────────────────────────── */

/**
 * Loose files beside the folders, with genuinely different sizes, kinds and
 * dates.
 *
 * The root held nothing but folders, so the Files clip ran under "sort on real
 * file data — size, kind, date" over a list whose SIZE column was five em-dashes
 * and whose KIND column said "Folder" five times. Sorting visibly did nothing.
 * The sizes below are far enough apart to be obvious at a glance, and the dates
 * are spread over weeks so a date sort reorders the list rather than shuffling
 * within one day.
 *
 * No image here on purpose: Photos/ already carries real ones, and a padded
 * .png would draw a broken thumbnail the moment the clip switched to icon or
 * gallery view. No .docx named "Quarterly Review" either — the office and
 * drag-drop clips open the real one in Reports/, and two files of that name in
 * the same film would read as a mistake.
 *
 * `days` is days before now; `kb` the size to pad the file out to.
 */
const ROOT_FILES = [
  { name: 'Berth Schedule.xlsx', days: 1, kb: 148 },
  { name: 'Cost Model.xlsx', days: 3, kb: 92 },
  { name: 'Berth Survey.pdf', days: 9, kb: 2410 },
  { name: 'Contract — Northbank.docx', days: 16, kb: 61 },
  { name: 'Tender Pack.pdf', days: 28, kb: 1180 },
  { name: 'Handover.md', days: 40, kb: 4 },
]

/**
 * Real bytes, not sparse files: the Files view reads size from stat, but a
 * thumbnailer or a preview that opens one would choke on a hole-punched file,
 * and the whole set is under 4 MB.
 */
export function seedRootFiles(ws) {
  fs.mkdirSync(ws, { recursive: true })
  for (const f of ROOT_FILES) {
    const p = path.join(ws, f.name)
    fs.writeFileSync(p, Buffer.alloc(f.kb * 1024, 0x20))
    const t = new Date(Date.now() - f.days * 86400_000)
    fs.utimesSync(p, t, t)
  }
  return ROOT_FILES.length
}

/* ── Calendar: a real ICS feed over a throwaway server ───────────────────── */

const pad = (n) => String(n).padStart(2, '0')

/** ICS wants UTC basic format: 20260812T090000Z */
function icsTime(d) {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`
  )
}

/**
 * A working week around `now` — deliberately built RELATIVE to the recording
 * date, so the calendar is never filmed showing an empty week or a month in
 * the past.
 */
export function buildIcs(now = new Date()) {
  const day = (offset, h, m = 0) => {
    const d = new Date(now)
    d.setDate(d.getDate() + offset)
    d.setHours(h, m, 0, 0)
    return d
  }

  const events = [
    ['Site walk — Berths 4 & 5', day(0, 8, 30), day(0, 10), 'Harbour Terminal'],
    ['Cost model review', day(0, 11), day(0, 12), 'Meeting room 2'],
    ['Northwind — contract call', day(0, 14), day(0, 15), 'Call'],
    ['Dredging survey debrief', day(1, 9), day(1, 10, 30), 'Site office'],
    ['Board pack due', day(1, 16), day(1, 17), ''],
    ['Pilotage trial — observation', day(2, 7, 30), day(2, 11), 'Approach channel'],
    ['Quarterly review — board', day(3, 10), day(3, 12), 'Head office'],
    ['Programme stand-up', day(4, 9), day(4, 9, 30), 'Site office'],
    ['Meridian proposal — walkthrough', day(4, 13, 30), day(4, 15), 'Call'],
    ['Weekly site report', day(-1, 15), day(-1, 16), 'Site office'],
    ['Berth 6 scoping', day(-2, 10), day(-2, 11, 30), 'Meeting room 1'],
  ]

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Workspace OS//Demo//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Harbour Terminal',
  ]
  for (const [i, [title, start, end, location]] of events.entries()) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:wos-demo-${i}@workspace-os.local`,
      `DTSTAMP:${icsTime(now)}`,
      `DTSTART:${icsTime(start)}`,
      `DTEND:${icsTime(end)}`,
      `SUMMARY:${title}`,
      ...(location ? [`LOCATION:${location}`] : []),
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n')
}

/**
 * Serves the ICS on localhost. Returns the url and a close(); the caller must
 * close it, or the recording process will not exit.
 */
export async function startIcsServer(now = new Date()) {
  const body = buildIcs(now)
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' })
    res.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    url: `http://127.0.0.1:${port}/harbour.ics`,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}
