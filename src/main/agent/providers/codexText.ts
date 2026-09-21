import { spawn } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { codexArgs, resolveCodexBinary } from './codex'
import { CodexRpc } from './codexRpc'
import type { ClaudeRunResult } from '../claudeRun'

export interface CodexTextOptions {
  prompt: string
  model?: string
  systemPrompt?: string
  cwd?: string
  timeoutMs?: number
  allowRead?: boolean
}

/** Text jobs have no workspace grants, connectors, or cross-provider retry. */
export async function runCodexText(opts: CodexTextOptions): Promise<ClaudeRunResult> {
  // Read just the configured model before isolating internal jobs from user tools/hooks.
  let model = opts.model
  if (!model) {
    const rpc = new CodexRpc({ cwd: opts.cwd })
    try {
      await rpc.initialize()
      const { config } = await rpc.request('config/read', { cwd: opts.cwd ?? null, includeLayers: false })
      model = typeof config?.model === 'string' ? config.model : undefined
    } finally { rpc.close() }
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wos-codex-text-'))
  const output = path.join(dir, 'answer.txt')
  const args = codexArgs({ cwd: opts.cwd ?? dir, safeMode: true, model, systemPrompt: opts.systemPrompt ?? 'Return only the requested answer. Do not use tools.' })
  args.splice(args.length - 1, 0, '--ephemeral', '--ignore-user-config', '--ignore-rules', '-o', output,
    '-c', 'web_search="disabled"', '-c', 'features.apps=false', '-c', 'features.hooks=false',
    ...(!opts.allowRead ? ['-c', 'features.shell_tool=false'] : []))
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    const env = { ...process.env }
    delete env.WOS_AGENT_TOKEN
    delete env.WOS_AGENT_SOCK
    try { child = spawn(resolveCodexBinary(), args, { cwd: opts.cwd ?? dir, env, stdio: ['pipe', 'ignore', 'pipe'] }) }
    catch (err) { fs.rmSync(dir, { recursive: true, force: true }); reject(err); return }
    let timedOut = false
    let failure: Error | undefined
    // Drain diagnostics without mixing them into structured mail/Foundry output.
    child.stderr?.on('data', () => {})
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); escalation = setTimeout(() => child.kill('SIGKILL'), 2000); escalation.unref() }, opts.timeoutMs ?? 60000)
    let escalation: ReturnType<typeof setTimeout> | undefined
    timer.unref()
    child.on('error', (err) => { failure = err })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (escalation) clearTimeout(escalation)
      let text = ''
      try { text = fs.readFileSync(output, 'utf8') } catch { /* no final answer */ }
      fs.rmSync(dir, { recursive: true, force: true })
      if (failure) reject(failure)
      else resolve({ text, code: code ?? 130, timedOut })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(opts.prompt)
  })
}
