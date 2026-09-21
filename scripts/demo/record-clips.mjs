/**
 * Records the clip library.
 *
 *   node scripts/demo/record-clips.mjs              # everything
 *   node scripts/demo/record-clips.mjs mail office  # named sessions
 *
 * Output: build/demo/clips/<id>.mp4 + docs/DEMO-CLIPS.md
 *
 * Clips are deliberately CLEAN — no music, no burned-in subtitles, no zoom or
 * crop. Music baked into a clip cannot be cut against the next clip, and a
 * burned-in subtitle cannot be re-timed. Both ship alongside instead.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { session, manifest, sleep, WS, OUT } from './clip-kit.mjs'
import { seedKnowledge, seedRootFiles, startIcsServer } from './mock-data.mjs'
import { show, hideCursor, cursorTo, dropCurtain, installStagecraft } from './stagecraft.mjs'

/**
 * Reload, keeping the curtain down and the overlay installed.
 *
 * Several surfaces read their data once at mount, so anything seeded after the
 * app has started is only visible after a reload.
 */
async function reload(win) {
  // The curtain is re-armed by an init script, so the reload never flashes the
  // app into the recording.
  await win.reload()
  await win.waitForSelector('#root', { timeout: 30000 })
  await dropCurtain(win)
  await installStagecraft(win)
  await sleep(1400)
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const only = process.argv.slice(2)
const wanted = (n) => only.length === 0 || only.includes(n)

/**
 * One ICS server for the WHOLE run, and every session re-points the calendar
 * source at it.
 *
 * The calendar source persists in the profile while the server gets a new port
 * each run, so any session that merely passes THROUGH the calendar — the rail
 * tour does — filmed a red "could not fetch that calendar feed" banner over an
 * empty week. The clip looked fine in isolation and wrong in the film.
 */
let ICS = null

async function refreshCalendarSource(win) {
  if (!ICS) return
  await win
    .evaluate(async (url) => {
      const sources = await window.workspace.calendar.sources()
      for (const s of sources ?? []) await window.workspace.calendar.remove(s.id)
      await window.workspace.calendar.add({ kind: 'ics', url, displayName: 'Harbour Terminal' })
    }, ICS.url)
    .catch(() => {})
}

/**
 * The page the browser clips are filmed on.
 *
 * Left to itself the browser opens its default home, and DuckDuckGo serves it
 * localised — every browser clip in the first cut was a GERMAN search-engine ad
 * page, about twenty seconds of an English film. A search homepage was also the
 * wrong thing to show under "the assistant reads the page you are on", having
 * nothing on it to read. This article is English, dense with text, and matches
 * the harbour-terminal fiction the rest of the workspace is seeded with.
 */
const DEMO_PAGE = 'https://en.wikipedia.org/wiki/Port_of_Rotterdam'

/** Drive the omnibox the way a person would, then wait for the page to settle. */
async function browseTo(win, url) {
  const bar = win.locator('input[aria-label="Address bar"]').first()
  await bar.click()
  await bar.fill(url)
  await bar.press('Enter')
  await sleep(5200)
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

/**
 * Click a rail item by label, with the drawn cursor moving there first.
 *
 * Scoped to `nav[aria-label="Primary"]` deliberately. Every surface stays
 * MOUNTED when hidden, so a document-wide search for a button labelled "Mail"
 * can match something inside a hidden panel — whose bounding box is empty and
 * whose click does nothing. That filmed an entire Mail session sitting on the
 * Home surface.
 */
async function rail(win, label) {
  const at = await win.evaluate((l) => {
    const el = [...document.querySelectorAll('nav[aria-label="Primary"] button')].find(
      (e) => (e.textContent || '').trim().toLowerCase() === l.toLowerCase(),
    )
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width === 0) return null
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, label)
  if (!at) {
    console.log(`    ! rail "${label}" not found`)
    return false
  }
  await win.evaluate(
    ([x, y]) => {
      const c = document.getElementById('wos-demo-cursor')
      if (c) {
        c.classList.add('on')
        c.style.transform = `translate(${x}px, ${y}px)`
      }
    },
    [at.x, at.y],
  )
  await sleep(520)
  // A DOM click, not a coordinate click: the latter does not land while the
  // black curtain covers the window, and most navigation happens during setup.
  await win.evaluate((l) => {
    const el = [...document.querySelectorAll('nav[aria-label="Primary"] button')].find(
      (e) => (e.textContent || '').trim().toLowerCase() === l.toLowerCase(),
    )
    el?.click()
  }, label)
  await sleep(1500)
  // Checked AFTER the wait: React has not re-rendered at the moment the click
  // returns, so reading aria-current synchronously always reports a failure.
  const ok = await win.evaluate(
    (l) =>
      [...document.querySelectorAll('nav[aria-label="Primary"] button')].some(
        (e) =>
          (e.textContent || '').trim().toLowerCase() === l.toLowerCase() &&
          e.getAttribute('aria-current') === 'page',
      ),
    label,
  )
  if (!ok) console.log(`    ! rail "${label}" did not become active`)
  return ok
}

/** Dispatch a keyboard shortcut at the window level. */
const key = async (win, k, opts = {}) => {
  await win.evaluate(
    ([kk, o]) => window.dispatchEvent(new KeyboardEvent('keydown', { key: kk, bubbles: true, ...o })),
    [k, opts],
  )
  await sleep(1100)
}

/** Put the caret in the office document so typing reaches the engine. */
async function focusDocument(win) {
  for (let i = 0; i < 12; i++) {
    const ok = await win
      .evaluate(() => {
        const d = document.querySelector('[class*=docWrap]')
        if (!d) return false
        d.focus()
        return document.activeElement === d
      })
      .catch(() => false)
    if (ok) return true
    await sleep(400)
  }
  return false
}

/* ── sessions ────────────────────────────────────────────────────────────── */

async function sesOverview() {
  await session('overview', async ({ win, clip }) => {
    // The rail tour passes through Calendar, so it needs a live feed too.
    await refreshCalendarSource(win)
    await reload(win)
    await clip(
      'overview-rail',
      'The rail — every surface in one window',
      'Starts on Home. The cursor moves down the left rail, opening Files, Mail, Calendar and Browser in turn. Each surface stays loaded; nothing reloads when you switch back.',
      async () => {
        for (const s of ['Files', 'Mail', 'Calendar', 'Browser', 'Home']) {
          await rail(win, s)
        }
        await hideCursor(win)
      },
    )
  })
}

async function sesMail() {
  await session('mail', async ({ win, clip }) => {
    // The app's OWN demo mailbox — in-memory, no credentials, no network.
    // Same reason as the calendar: the profile persists between runs, so a
    // second demo mailbox would appear beside the first.
    const acct = await win
      .evaluate(async () => {
        const existing = await window.workspace.mail.accounts.list()
        const demo = (existing ?? []).find((a) => a.authKind === 'demo')
        if (demo) return demo
        return window.workspace.mail.accounts.addDemo()
      })
      .catch((e) => ({ err: String(e) }))
    if (acct?.err) console.log(`    ! demo mailbox: ${acct.err}`)

    /**
     * Metrics for the rich composer's live-data picker to offer.
     *
     * Without them the picker renders "No metrics in this workspace yet." —
     * a correct empty state, and the worst possible frame to put under a
     * caption about live numbers. Seeded by name so a re-run tops up rather
     * than stacking duplicates, since the profile survives between runs.
     */
    await win
      .evaluate(async () => {
        const want = [
          ['Berth capacity', 5150],
          ['Annual throughput', 8420],
          ['Contract rate', 47],
        ]
        const have = (await window.workspace.metrics.list()) ?? []
        for (const [name, value] of want) {
          if (!have.some((m) => m.name === name)) await window.workspace.metrics.create(name, value)
        }
      })
      .catch((e) => console.log(`    ! metrics: ${e}`))

    await reload(win)
    await rail(win, 'Mail')
    await sleep(2500)

    await clip(
      'mail-inbox',
      'Inbox — reading a message',
      'The inbox list with unread messages. The cursor opens one and the reading pane fills, showing sender, subject and body.',
      async () => {
        await sleep(1200)
        /**
         * Scoped to the mail surface. A document-wide `[class*=item]` matches
         * the RAIL buttons too — their class is `_ritem_…` — so the first match
         * was the Home rail button, and this clip clicked itself back to Home
         * immediately after the rail had correctly switched to Mail.
         */
        const row = win.locator('[class*=mail] [class*=row], [class*=list] [class*=row]').first()
        await row.click({ timeout: 4000 }).catch(() => {})
        await sleep(2600)
        await hideCursor(win)
      },
    )

    await clip(
      'mail-compose',
      'Composing a message',
      'A new message is opened and text typed into the body. Shows the composer, the send affordance, and that the app writes mail as well as reads it.',
      async () => {
        const ok = await show(win, 'button:has-text("New message")', { settle: 1600 })
        if (ok) {
          await win.locator('textarea').first().click({ timeout: 3000 }).catch(() => {})
          await win.keyboard.type('Sending the quarterly review across now — the figures are pulled live from the cost model.', {
            delay: 26,
          })
        }
        await sleep(1800)
        await hideCursor(win)
      },
    )

    /**
     * The rich composer, filmed on the composer mail-compose left open.
     *
     * Deliberately NOT touching the Assist chips: those call the writing
     * assistant through the Claude CLI, which is slow, non-deterministic and
     * needs auth under the redirected HOME — three ways for a take to fail
     * that have nothing to do with what the shot is about. Design and live
     * data are local, instant and repeatable, and the live metric is the more
     * distinctive thing anyway: a figure that stays attached to its source
     * after it lands in the mail.
     */
    await clip(
      'mail-rich',
      'Mail — the rich composer and a live number',
      'Switching the composer to Rich: design themes restyle the message, and Insert → Live metric drops in a figure that stays linked to the workspace value behind it rather than being retyped.',
      async () => {
        await show(win, 'button:has-text("Rich")', { settle: 1500 })
        await show(win, 'button:has-text("Editorial")', { settle: 1600 })
        await show(win, 'button:has-text("Live metric")', { settle: 1300 })
        // The picker lists the seeded metrics; take the first row.
        await show(win, '[class*=pickerRow]', { settle: 2400 })
        await hideCursor(win)
      },
    )
  })
}

async function sesCalendar() {
  await session('calendar', async ({ win, clip }) => {
      // Added, THEN reloaded: the calendar panel reads its sources once when it
      // mounts, so a source added afterwards is invisible until the next load —
      // which filmed as "No calendars yet" over a feed that had parsed fine.
    await refreshCalendarSource(win)
    await reload(win)
    await rail(win, 'Calendar')
    await sleep(3000)

    await clip(
      'calendar-week',
      'Calendar — a working week',
      'The week view populated with real events parsed from a live feed: site walks, contract calls, a board review. Shows the calendar is a real client, not a placeholder.',
      async () => {
        await sleep(3200)
        await hideCursor(win)
      },
    )
  })
}

async function sesFiles() {
  await session('files', async ({ win, clip }) => {
    await rail(win, 'Files')
    await sleep(1500)
    const B = '[data-testid="file-browser"]'

    await clip(
      'files-sort-filter',
      'Files — sorting and filtering',
      'The folder listed with Name / Kind / Date modified / Size columns. Sorting by size then by date reorders on real file metadata, and a kind filter narrows to spreadsheets while keeping the folders that lead somewhere.',
      async () => {
        await show(win, `${B} button[aria-label="Sort by size"]`, { settle: 1300 })
        await show(win, `${B} button[aria-label="Sort by date modified"]`, { settle: 1300 })
        await show(win, `${B} button:has-text("Spreadsheet")`, { settle: 1600 })
        await show(win, `${B} button[aria-label="Clear filters"]`, { settle: 1100 })
        await hideCursor(win)
      },
    )

    await clip(
      'files-views',
      'Files — four ways to look at a folder',
      'Switches list to icons (real image thumbnails), to gallery (one large preview with a filmstrip), and to columns (Miller columns, where the whole path stays on screen while drilling down two levels).',
      async () => {
        await show(win, `${B} [class*=nameText]:has-text("Photos")`, { settle: 1200 })
        await show(win, `${B} button[aria-label="Icons view"]`, { settle: 1600 })
        await show(win, `${B} button[aria-label="Gallery view"]`, { settle: 1600 })
        await show(win, `${B} [class*=stripItem]`, { nth: 2, settle: 1400 })
        await show(win, `${B} button[aria-label="Columns view"]`, { settle: 1200 })
        await show(win, `${B} nav[aria-label="Breadcrumb"] button`, { settle: 1200 })
        await show(win, `${B} [class*=colName]:has-text("Projects")`, { settle: 1300 })
        await show(win, `${B} [class*=colName]:has-text("Harbour Terminal")`, { settle: 1600 })
        await hideCursor(win)
      },
    )
  })
}

async function sesBrowser() {
  await session('browser', async ({ win, clip }) => {
    await rail(win, 'Browser')
    await sleep(1500)
    await browseTo(win, DEMO_PAGE)

    await clip(
      'browser-page',
      'Browser — a real browser inside the workspace',
      'A live page loaded in the in-app browser: tab strip, address bar, and the page itself. Sessions, history and logins are the browser\'s own, not a preview pane.',
      async () => {
        await sleep(2600)
        await hideCursor(win)
      },
    )

    await clip(
      'browser-assistant',
      'Browser — the assistant panel, and reclaiming the width',
      'The right-hand Assistant reads the page you are on and offers what is possible with it. It collapses to give the full width back to the page, and a pinned tab brings it back.',
      async () => {
        await sleep(1400)
        await show(win, 'button[aria-label="Hide the assistant"]', { settle: 1800 })
        await show(win, 'button[aria-label="Show the assistant"]', { settle: 1600 })
        await hideCursor(win)
      },
    )
  })
}

async function sesAgents() {
  await session('agents', async ({ win, clip }) => {
    await rail(win, 'Home')
    await sleep(1800)

    await clip(
      'agents-roster',
      'Agents — the team roster',
      'The specialists available in this workspace, each with what it does and the access it has been granted. Any one can be opened to see how it thinks, or run in a fresh agent tab.',
      async () => {
        await sleep(2800)
        await hideCursor(win)
      },
    )

    await clip(
      'agents-new',
      'Agents — describing a new specialist',
      'The "New specialist" card opens the Foundry: you describe the agent you want in plain language and the app authors the specification. Shows the creation path, not a settings form.',
      async () => {
        await show(win, '[class*=card]:has-text("New specialist"), button:has-text("New specialist")', {
          settle: 1600,
        })
        // Type the description: an empty field shows the dialog exists, whereas
        // watching a job described in plain language shows what it is FOR.
        await win.locator('[role=dialog] textarea, textarea').first().click({ timeout: 3000 }).catch(() => {})
        await win.keyboard.type(
          'Reads the weekly site photos and field notes, and writes the progress report',
          { delay: 34 },
        )
        await sleep(2400)
        await hideCursor(win)
      },
    )
  })
}

async function sesCockpit() {
  await session('cockpit', async ({ win, clip }) => {
    await rail(win, 'Cockpit')
    await sleep(2500)

    await clip(
      'cockpit',
      'Cockpit — the calm overview  [NOT FOR USE]',
      'The cockpit surface. It is deliberately quiet when nothing needs attention — the design hides the healthy and surfaces only what has changed or is waiting on you.',
      async () => {
        await sleep(3000)
        await hideCursor(win)
      },
    )
  })
}

async function sesOffice() {
  await session('office', async ({ win, clip }) => {
    await rail(win, 'Files')
    await sleep(1200)
    const B = '[data-testid="file-browser"]'
    await show(win, `${B} [class*=nameText]:has-text("Reports")`, { settle: 1200 })
    await show(win, `${B} [class*=nameText]:has-text("Quarterly Review")`, { settle: 2500 })

    // The engine cold-boot happens here, behind the curtain.
    const deadline = Date.now() + 150_000
    let ready = false
    while (Date.now() < deadline) {
      const parts = await win.evaluate(() => window.workspace.lok?.parts?.()).catch(() => null)
      if (parts && parts.parts > 0) {
        ready = true
        break
      }
      await sleep(900)
    }
    if (!ready) {
      console.log('    ! engine never opened the document — office clips skipped')
      return
    }
    await sleep(2500)

    await clip(
      'office-editing',
      'Office — editing a real .docx in place',
      'A Word document open in the native LibreOffice engine running locally: the full ribbon, and text typed straight into the page. The file on disk is the document — there is no upload and no round-trip.',
      async () => {
        await focusDocument(win)
        await win.keyboard.type('Berths 4 and 5 returned to service in March, three weeks ahead of programme.', {
          delay: 30,
        })
        await sleep(1800)
        await hideCursor(win)
      },
    )

    await clip(
      'office-liveness',
      'Office — one number, everywhere  [NOT FOR USE]',
      'A figure is defined once and referenced by the document. Changing it at the source updates the open document immediately — the badge reads "live values in this file". Nothing is copied, so nothing can go stale.',
      async () => {
        await focusDocument(win)
        await win.keyboard.press('Enter')
        await win.keyboard.type('Berth capacity is ', { delay: 40 })
        await sleep(900)

        const metricId = await win
          .evaluate(() => window.workspace.metrics.create('Berth capacity', 4200).then((m) => m.id))
          .catch(() => null)
        if (metricId) {
          // Must carry the wos-metric- prefix; the IPC validator rejects anything else.
          const tag = 'wos-metric-clip-' + Date.now()
          const inserted = await win
            .evaluate(
              ({ t, n }) => window.workspace.lok.macro('WosInsertContentControl', t + '|4200|' + n),
              { t: tag, n: 'Berth capacity' },
            )
            .catch(() => false)
          if (inserted) {
            await win.evaluate(
              ({ id, tg }) =>
                window.workspace.transclusions.add({
                  metricId: id,
                  filePath: '/tmp/wos-demo/Reports/Quarterly Review.docx',
                  target: { kind: 'docx-cc', tag: tg },
                  lastValue: 4200,
                }),
              { id: metricId, tg: tag },
            )
            await sleep(2200)
            await win.evaluate((id) => window.workspace.metrics.update(id, { value: 5150 }), metricId)
            await sleep(3200)
          }
          await win.evaluate((id) => window.workspace.metrics.delete(id), metricId).catch(() => {})
        }
        await hideCursor(win)
      },
    )
  })
}

async function sesFeatures() {
  await session('features', async ({ win, clip }) => {
    await rail(win, 'Browser')
    await sleep(2500)

    await clip(
      'feature-fullscreen',
      'Full-window mode',
      'Control-Command-F gives the active surface the whole window: the rail slides out and the tab strip folds away. Escape brings them back. An exit control stays visible throughout, so it is never a trap.',
      async () => {
        await show(win, 'button[aria-label="Fill the window"]', { settle: 2200 })
        await sleep(1200)
        await win.keyboard.press('Escape')
        await sleep(2000)
        await hideCursor(win)
      },
    )

    await clip(
      'feature-terminal',
      'Terminal — open, minimise, restore',
      'Command-J opens the integrated terminal as a dock beneath the surface. Option-Command-J minimises it to a bar; the shell keeps running, so restoring puts you back in the same session rather than a new one.',
      async () => {
        await key(win, 'j', { metaKey: true })
        await sleep(2000)
        await key(win, 'j', { metaKey: true, altKey: true })
        await sleep(2000)
        await show(win, 'button[aria-label="Restore the terminal"]', { settle: 2000 })
        await hideCursor(win)
      },
    )

    await clip(
      'feature-terminal-side',
      'Terminal — docked below or to the side',
      'The same terminal moved from the bottom strip to a right-hand column. Placement is a preference, not a mode: the running session is unaffected.',
      async () => {
        await sleep(900)
        await show(win, 'button:has-text("Right")', { settle: 2400 })
        await show(win, 'button:has-text("Bottom")', { settle: 2000 })
        await hideCursor(win)
      },
    )

    await clip(
      'feature-new-tabs',
      'Terminal — a new shell, and a new agent',
      'The plus in the dock opens another shell tab, and the same menu starts an agent tab. Both run inside the workspace, so they see the same files you do.',
      async () => {
        await sleep(800)
        await show(win, '[class*=dock] button:has-text("+"), button[aria-label*="New"]', { settle: 2000 })
        await sleep(2000)
        await hideCursor(win)
      },
    )
  })
}

/**
 * The layout flow: one continuous take of the workspace rearranging itself
 * around a single task.
 *
 * Deliberately ONE clip rather than five. Shown separately, each of these reads
 * as a toggle being demonstrated; shown in sequence they read as the window
 * giving you room as the work changes — which is the actual claim.
 */
async function sesLayoutFlow() {
  await session('layout', async ({ win, clip }) => {
    await rail(win, 'Browser')
    await sleep(1500)
    await browseTo(win, DEMO_PAGE)

    await clip(
      'browser-layout-flow',
      'The workspace rearranging around one task',
      'One continuous take. Starts on the browser with the Assistant panel open on the right. A terminal is opened at the bottom (Command-J). The Assistant is collapsed to give the page its width back. The terminal moves from the bottom strip to a right-hand column. Finally the whole surface fills the window — rail and tab strip out of the way, with an "Exit full window · esc" control left visible. NOTE: filling the window currently also hides the terminal, so the dock placed a moment earlier disappears at the end. Worth deciding whether that is right before this clip is used.',
      async () => {
        // 1 — browser with the assistant panel, as it opens
        await sleep(2600)

        // 2 — a terminal at the bottom
        await key(win, 'j', { metaKey: true })
        await sleep(2800)

        // 3 — collapse the assistant, giving the page its width back
        await show(win, 'button[aria-label="Hide the assistant"]', { settle: 2800 })

        // 4 — move the terminal to the side
        await show(win, 'button:has-text("Right")', { settle: 3000 })

        // 5 — and give the whole thing the window
        await show(win, 'button[aria-label="Fill the window"]', { settle: 3400 })
        await hideCursor(win)
        await sleep(600)
      },
    )
  })
}

/**
 * Dragging a file from the tree into the terminal.
 *
 * The gesture is synthesised — dragstart / dragenter / dragover / drop with a
 * real DataTransfer — but everything downstream is the product: the app's own
 * handler reads `application/x-wos-path`, shell-quotes it, and types it through
 * the PTY bridge, so the shell echoes it exactly as if it had been typed. The
 * drag-over highlight is the app's, not something drawn for the camera.
 *
 * Playwright's mouse-based dragTo does not reliably drive HTML5 drag-and-drop
 * in Chromium, and a drag that silently does nothing would film as a bug.
 */
async function sesDragDrop() {
  await session('dragdrop', async ({ win, clip }) => {
    await rail(win, 'Files')
    await sleep(1400)
    await key(win, 'j', { metaKey: true }) // terminal at the bottom
    await sleep(2500)

    // Expand a folder so there is a FILE to drag, not just folders.
    await win
      .evaluate(() => {
        const row = [...document.querySelectorAll('[class*=filesTree] [class*=row], [class*=tree] *')].find(
          (e) => (e.textContent || '').trim() === 'Reports',
        )
        row?.click()
      })
      .catch(() => {})
    await sleep(1600)

    await clip(
      'terminal-drag-file',
      'Dragging a file into the terminal',
      'A file is dragged from the file list onto the terminal. The dock highlights as a drop target, and on release the full path is typed into the shell. Note the quoting: the filename contains a space and comes through as \'/tmp/wos-demo/Reports/Quarterly Review.docx\' — ready to use as an argument rather than something you then have to fix. The same gesture works into an agent tab.',
      async () => {
        const src = '[class*=filesTree] [draggable="true"], [draggable="true"]'
        const dst = '[class*=termHost]'

        // Move the drawn cursor to the file, so the viewer sees where this starts.
        await cursorTo(win, src, 0)
        await sleep(700)

        // An EMPTY DataTransfer, dispatched as a real dragstart: the tree's own
        // handler fills it from the node it is bound to, so the path carried
        // across is the app's, not one guessed from an attribute.
        const path = await win.evaluate((sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const dt = new DataTransfer()
          window.__wosDrag = dt
          el.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }))
          return dt.getData('application/x-wos-path') || null
        }, src)
        if (!path) console.log('    ! nothing draggable found in the tree')
        await sleep(400)

        // Travel to the terminal, holding the drag over it so the app's own
        // drop-target highlight is on screen for long enough to read.
        await cursorTo(win, dst, 0)
        await win.evaluate((sel) => {
          const t = document.querySelector(sel)
          const dt = window.__wosDrag
          if (!t || !dt) return
          t.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }))
          t.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }))
        }, dst)
        await sleep(1600)

        // Release.
        await win.evaluate((sel) => {
          const t = document.querySelector(sel)
          const dt = window.__wosDrag
          if (!t || !dt) return
          t.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }))
        }, dst)
        await sleep(2800)
        await hideCursor(win)
      },
    )
  })
}

/* ── run ─────────────────────────────────────────────────────────────────── */

fs.mkdirSync(WS, { recursive: true })
seedKnowledge(WS)
seedRootFiles(WS)
ICS = await startIcsServer()

const SESSIONS = [
  ['overview', sesOverview],
  ['files', sesFiles],
  ['mail', sesMail],
  ['calendar', sesCalendar],
  ['browser', sesBrowser],
  ['agents', sesAgents],
  ['cockpit', sesCockpit],
  ['office', sesOffice],
  ['features', sesFeatures],
  ['layout', sesLayoutFlow],
  ['dragdrop', sesDragDrop],
]

for (const [name, fn] of SESSIONS) {
  if (!wanted(name)) continue
  console.log(`\n▸ ${name}`)
  try {
    await fn()
  } catch (err) {
    console.error(`  ✗ ${name} — ${err.message}`)
  }
}

/* ── manifest ────────────────────────────────────────────────────────────── */

/**
 * Merged with what previous runs recorded.
 *
 * `manifest` only holds THIS process's clips, so re-recording one session used
 * to rewrite the document as if the library were four clips long. The sidecar
 * keeps the rest, and a re-recorded clip replaces its old entry by id.
 */
const SIDECAR = path.join(ROOT, 'build/demo/clips/manifest.json')
let merged = []
try {
  merged = JSON.parse(fs.readFileSync(SIDECAR, 'utf8'))
} catch {
  /* first run */
}
for (const c of manifest) {
  const i = merged.findIndex((m) => m.id === c.id)
  if (i >= 0) merged[i] = c
  else merged.push(c)
}
// Only clips whose file still exists, in session order.
merged = merged.filter((c) => fs.existsSync(path.join(ROOT, c.file)))
fs.writeFileSync(SIDECAR, JSON.stringify(merged, null, 2))

const held = merged.filter((c) => /NOT FOR USE/.test(c.title))
const usable = merged.filter((c) => !/NOT FOR USE/.test(c.title))

if (merged.length > 0) {
  const doc = [
    '# Demo clips',
    '',
    'Recorded by `node scripts/demo/record-clips.mjs`. Each clip is a clean',
    'full-frame 1512x945 screen recording — **no music, no subtitles, no zoom or',
    'crop**, so it can be cut, re-timed and scored freely. The soundtrack and the',
    'subtitle text live alongside rather than inside them.',
    '',
    'Mock data is real: Mail uses the app\'s own built-in demo mailbox (in-memory,',
    'no network), Calendar a real ICS feed served locally, and the workspace is a',
    'seeded harbour-terminal project. The app runs against an isolated profile, so',
    'nothing personal appears.',
    '',
    `**${usable.length} clips, ${usable.reduce((a, c) => a + c.seconds, 0).toFixed(0)}s of usable footage.**`,
    '',
    '| Clip | Seconds | What it shows |',
    '|---|---|---|',
    ...usable.map((c) => `| \`${c.id}\` | ${c.seconds} | ${c.title} |`),
    '',
    ...(held.length
      ? [
          '### Recorded, but not for use yet',
          '',
          '| Clip | Why it is held back |',
          '|---|---|',
          '| `office-liveness` | The metric value does not land in the document, so the number is never seen changing. Deliberately not fixed — it is one feature, and it is not what defines the product. |',
          '| `cockpit` | Films honestly as "All calm — no agents running", which is the design working. Held back because how the cockpit should look and behave is still being decided. |',
          '',
        ]
      : []),
    '---',
    '',
    ...merged.flatMap((c) => [
      `## ${c.id}`,
      '',
      `**${c.title}** · ${c.seconds}s · \`${c.file}\``,
      '',
      c.description,
      '',
    ]),
  ].join('\n')
  fs.writeFileSync(path.join(ROOT, 'docs/DEMO-CLIPS.md'), doc)
  console.log(`\n✓ ${manifest.length} recorded this run · ${merged.length} in the library → ${OUT}`)
  console.log(`✓ docs/DEMO-CLIPS.md\n`)
}
