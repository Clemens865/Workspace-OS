#!/usr/bin/env node
'use strict'

/**
 * wos-action — the AGENT→ACTION CLI.
 *
 * Lets the in-app `claude -p` agent EXECUTE Workspace-OS per-surface actions by
 * reaching the running app over a LOCAL unix-domain socket (the same registry a
 * dock chip runs — so the agent drives the live UI). Pure Node: no Electron, no
 * app stores, no shell. The socket path arrives via the WOS_AGENT_SOCK env var
 * that the app sets into the agent's environment at spawn.
 *
 * Subcommands:
 *   wos-action list                 — actions available here + all ids (JSON)
 *   wos-action context              — the live harness (root/surface/openFile)
 *   wos-action run <id> [jsonArgs]  — run an action; prints {ok,result?|error?}
 *
 * Every action the app exposes is non-destructive (new doc/folder, export,
 * duplicate, reveal, search, compose a DRAFT). This CLI can never send or delete.
 * Prints a JSON line to stdout; exits non-zero on failure.
 */

const net = require('net')

const SOCK = process.env.WOS_AGENT_SOCK
// The run's identity: the app mints it per run; main refuses actions outside
// the run's grant. Forwarded verbatim, never printed.
const TOKEN = process.env.WOS_AGENT_TOKEN

function die(msg) {
  process.stdout.write(JSON.stringify({ ok: false, error: msg }) + '\n')
  process.exit(1)
}

function usage() {
  die('usage: wos-action <list|context|run> [actionId] [jsonArgs]')
}

function parseArgs(argv) {
  const [cmd, actionId, rawArgs] = argv
  if (!cmd) usage()
  if (cmd !== 'list' && cmd !== 'context' && cmd !== 'run') {
    die(`unknown command: ${cmd} (expected list|context|run)`)
  }
  const req = { cmd }
  if (TOKEN) req.token = TOKEN
  if (cmd === 'run') {
    if (!actionId) die('run requires an action id: wos-action run <id> [jsonArgs]')
    req.actionId = actionId
    if (rawArgs !== undefined) {
      try {
        req.args = JSON.parse(rawArgs)
      } catch {
        die('jsonArgs must be valid JSON')
      }
    }
  }
  return req
}

function send(req) {
  if (!SOCK) die('WOS_AGENT_SOCK is not set — is Workspace-OS running?')
  const sock = net.createConnection(SOCK)
  let buf = ''
  let settled = false
  const finish = (fn) => {
    if (settled) return
    settled = true
    fn()
  }
  const timer = setTimeout(() => {
    finish(() => {
      try { sock.destroy() } catch { /* ignore */ }
      die('timed out waiting for Workspace-OS')
    })
  }, 35000)

  sock.setEncoding('utf-8')
  sock.on('connect', () => {
    sock.write(JSON.stringify(req) + '\n')
  })
  sock.on('data', (chunk) => {
    buf += chunk
    const nl = buf.indexOf('\n')
    if (nl === -1) return
    clearTimeout(timer)
    const line = buf.slice(0, nl)
    finish(() => {
      process.stdout.write(line + '\n')
      let ok = false
      try { ok = JSON.parse(line).ok === true } catch { ok = false }
      try { sock.end() } catch { /* ignore */ }
      process.exit(ok ? 0 : 1)
    })
  })
  sock.on('error', (err) => {
    clearTimeout(timer)
    finish(() => die(`could not reach Workspace-OS: ${err.message}`))
  })
  sock.on('close', () => {
    clearTimeout(timer)
    finish(() => die('connection closed before a reply'))
  })
}

send(parseArgs(process.argv.slice(2)))
