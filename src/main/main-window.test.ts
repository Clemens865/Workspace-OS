import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Regression cover for "TypeError: Object has been destroyed".
 *
 * Handlers used to capture the BrowserWindow they were registered with and send
 * to it forever. On macOS, closing the window and reopening from the dock builds
 * a NEW window (app.on('activate') → createWindow) while the handlers still held
 * the old one — so the next send threw, and an agent run just failed with an
 * error that named nothing useful.
 */
const windows: FakeWin[] = []

class FakeWin {
  destroyed = false
  sent: [string, unknown[]][] = []
  webContents = { send: (channel: string, ...args: unknown[]) => {
    if (this.destroyed) throw new TypeError('Object has been destroyed')
    this.sent.push([channel, args])
  } }
  isDestroyed(): boolean { return this.destroyed }
  constructor() { windows.push(this) }
}

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => windows },
}))

const { setMainWindow, mainWindow, sendToWindow } = await import('./main-window')

describe('live main window', () => {
  beforeEach(() => { windows.length = 0 })

  it('sends to the window it was given', () => {
    const w = new FakeWin()
    setMainWindow(w as never)
    sendToWindow('agent:output', 'run-1', 'hello')
    expect(w.sent).toEqual([['agent:output', ['run-1', 'hello']]])
  })

  it('sends to the NEW window after the tracked one is destroyed', () => {
    const old = new FakeWin()
    setMainWindow(old as never)
    old.destroyed = true
    const fresh = new FakeWin() // what app.on('activate') creates

    sendToWindow('agent:output', 'run-2', 'still works')

    expect(fresh.sent).toHaveLength(1)
    expect(old.sent).toHaveLength(0)
  })

  it('never returns a destroyed window', () => {
    const w = new FakeWin()
    setMainWindow(w as never)
    w.destroyed = true
    expect(mainWindow()).toBeNull()
  })

  it('is a NO-OP when every window is gone (a late result is not an error)', () => {
    const w = new FakeWin()
    setMainWindow(w as never)
    w.destroyed = true
    expect(() => sendToWindow('agent:output', 'run-3', 'late')).not.toThrow()
  })

  it('swallows a window destroyed BETWEEN the liveness check and the send', () => {
    const w = new FakeWin()
    setMainWindow(w as never)
    // isDestroyed() lies for one call — the teardown race the try/catch covers.
    w.isDestroyed = () => false
    w.destroyed = true
    expect(() => sendToWindow('agent:output', 'run-4', 'racy')).not.toThrow()
  })
})
