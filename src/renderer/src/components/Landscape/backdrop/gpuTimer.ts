/**
 * GPU time per drawn frame, from EXT_disjoint_timer_query_webgl2 (available in
 * Electron's Chromium on macOS). Results arrive a few frames late; they are
 * collected when ready and averaged over a sliding window. Without the
 * extension, `supported` is false and the numbers stay empty: the perf test
 * then reports that rather than inventing a figure.
 */
interface TimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

export class GpuTimer {
  readonly supported: boolean
  private ext: TimerExt | null
  private pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null
  private samples: number[] = []

  constructor(private gl: WebGL2RenderingContext) {
    this.ext = (gl.getExtension?.('EXT_disjoint_timer_query_webgl2') as TimerExt | null) ?? null
    this.supported = !!this.ext && typeof gl.createQuery === 'function'
  }

  begin(): void {
    if (!this.supported || this.active || this.pending.length > 6) return
    const q = this.gl.createQuery()
    if (!q) return
    this.gl.beginQuery(this.ext!.TIME_ELAPSED_EXT, q)
    this.active = q
  }

  end(): void {
    if (!this.active) return
    this.gl.endQuery(this.ext!.TIME_ELAPSED_EXT)
    this.pending.push(this.active)
    this.active = null
    this.collect()
  }

  /** Average GPU ms over the last frames measured (null when none). */
  avgMs(): number | null {
    this.collect()
    if (!this.samples.length) return null
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length
  }

  maxMs(): number | null {
    this.collect()
    return this.samples.length ? Math.max(...this.samples) : null
  }

  reset(): void {
    this.samples = []
  }

  dispose(): void {
    this.pending.forEach((q) => this.gl.deleteQuery(q))
    this.pending = []
  }

  private collect(): void {
    if (!this.supported) return
    const gl = this.gl
    const disjoint = gl.getParameter(this.ext!.GPU_DISJOINT_EXT)
    while (this.pending.length) {
      const q = this.pending[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
      if (!disjoint) this.samples.push(ns / 1e6)
      gl.deleteQuery(q)
      this.pending.shift()
    }
    if (this.samples.length > 120) this.samples.splice(0, this.samples.length - 120)
  }
}
