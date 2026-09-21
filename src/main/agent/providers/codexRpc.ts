import { spawn, type ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { resolveCodexBinary, isCodexNoise } from './codex'

export type RpcRecord = Record<string, any>
export interface RpcMessage { id?: string | number; method?: string; params?: RpcRecord; result?: any; error?: { message?: string } }
export interface RpcOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  onNotification?: (method: string, params: RpcRecord) => void
  onRequest?: (id: string | number, method: string, params: RpcRecord) => void
  onClose?: (error: Error) => void
  onDiagnostic?: (text: string) => void
  spawnProcess?: typeof spawn
}

/** One owned stdio app-server; no daemon, network listener, or shared thread state. */
export class CodexRpc {
  readonly child: ChildProcess
  private nextId = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
  private closed = false
  private closing = false
  private buffer = ''
  private diagnostic = ''
  private decoder = new StringDecoder('utf8')
  private stderrDecoder = new StringDecoder('utf8')
  constructor(private options: RpcOptions = {}) {
    this.child = (options.spawnProcess ?? spawn)(resolveCodexBinary(), ['app-server', '--stdio'], { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'] })
    this.child.stdin?.on('error', (e) => this.fail(e))
    this.child.stdout?.on('data', (chunk: Buffer) => this.consume(this.decoder.write(chunk)))
    this.child.stderr?.on('data', (chunk: Buffer) => {
      this.diagnostic += this.stderrDecoder.write(chunk)
      let end: number
      while ((end = this.diagnostic.indexOf('\n')) >= 0) {
        const line = this.diagnostic.slice(0, end)
        this.diagnostic = this.diagnostic.slice(end + 1)
        if (!isCodexNoise(line)) options.onDiagnostic?.(line + '\n')
      }
    })
    this.child.on('error', (e) => this.fail(e))
    this.child.on('close', (code, signal) => {
      this.consume(this.decoder.end() + '\n')
      this.diagnostic += this.stderrDecoder.end()
      if (this.diagnostic && !isCodexNoise(this.diagnostic)) options.onDiagnostic?.(this.diagnostic)
      this.fail(new Error(`Codex server exited (${signal ?? code ?? 'unknown'})`))
    })
  }
  async initialize(): Promise<void> {
    await this.request('initialize', { clientInfo: { name: 'workspace_os', title: 'Workspace OS', version: '0.1.121' }, capabilities: { experimentalApi: true } })
    this.send({ method: 'initialized' })
  }
  request<T = any>(method: string, params: RpcRecord = {}, timeoutMs = 30000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Codex server is closed'))
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} timed out`)) }, timeoutMs)
      timer.unref()
      this.pending.set(id, { resolve, reject, timer })
      try { this.send({ id, method, params }) } catch (err) { clearTimeout(timer); this.pending.delete(id); reject(err) }
    })
  }
  respond(id: string | number, result: unknown): void { this.send({ id, result }) }
  reject(id: string | number, message: string): void { this.send({ id, error: { code: -32601, message } }) }
  private send(value: unknown): void {
    if (this.closed) throw new Error('Codex server is closed')
    this.child.stdin?.write(JSON.stringify(value) + '\n')
  }
  private consume(chunk: string): void {
    this.buffer += chunk
    if (this.buffer.length > 16_000_000) { this.fail(new Error('Codex event exceeded the size limit')); this.close(); return }
    let end: number
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end)
      this.buffer = this.buffer.slice(end + 1)
      let m: RpcMessage
      try { m = JSON.parse(line) } catch { continue }
      if (!m || typeof m !== 'object') continue
      if (typeof m.method === 'string') {
        if (this.closed) continue
        if (m.params && (typeof m.params !== 'object' || Array.isArray(m.params))) continue
        if (m.id !== undefined) {
          if (this.options.onRequest) this.options.onRequest(m.id, m.method, m.params ?? {})
          else this.reject(m.id, 'No interactive client is attached')
        } else this.options.onNotification?.(m.method, m.params ?? {})
      } else if (typeof m.id === 'number') {
        const p = this.pending.get(m.id)
        if (!p) continue
        this.pending.delete(m.id); clearTimeout(p.timer)
        if (m.error) p.reject(new Error(m.error.message ?? 'Codex request failed'))
        else p.resolve(m.result)
      }
    }
  }
  private fail(error: Error): void {
    if (this.closed) return
    this.closed = true
    for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error) }
    this.pending.clear()
    this.options.onClose?.(error)
  }
  close(): void {
    if (this.closing) return
    this.closing = true
    this.fail(new Error('Codex session closed'))
    this.child.stdin?.end()
    this.child.kill('SIGTERM')
    const timer = setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL') }, 2000)
    timer.unref()
    this.child.once('close', () => clearTimeout(timer))
  }
}
