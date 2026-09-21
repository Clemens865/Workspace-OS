import { BrowserWindow, type IpcMain } from 'electron'
import { ipcHandle } from './ipc-registry'
import { IpcValidationError } from './ipc-validator'

const PRINT_CSS = `
  @page { margin: 16mm; }
  html, body { height: auto; min-height: 0; max-height: none; overflow: visible; }
  body { margin: 0; color: #222; background: #fff; font: 11pt/1.55 -apple-system, system-ui, sans-serif; overflow-wrap: anywhere; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; line-height: 1.25; }
  h1 { font-size: 21pt; } h2 { font-size: 16pt; } h3 { font-size: 13pt; }
  p, li { orphans: 3; widows: 3; }
  a { color: #245ab0; }
  img, svg { max-width: 100%; height: auto; break-inside: avoid; }
  pre, code { font: 9pt/1.5 'SF Mono', Consolas, monospace; background: #f4f4f5; }
  pre { padding: 10px; white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
  pre code { background: none; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; } tfoot { display: table-footer-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; overflow-wrap: anywhere; }
  blockquote { margin-left: 0; padding-left: 14px; border-left: 3px solid #ccc; color: #555; }
`

/** The print window contains only this document. Keep untrusted file HTML out
 * of the privileged app DOM, with the same isolation as our preview surfaces. */
export function printDocumentHtml(title: string, html: string): string {
  const safeTitle = title.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
  const csp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none';"
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${safeTitle}</title><style>${PRINT_CSS}</style></head><body>${html}</body></html>`
}

export async function printDocument(title: string, html: string): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    title,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  try {
    // loadURL resolves after the document and its embedded images have loaded.
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printDocumentHtml(title, html))}`)
    await new Promise<void>((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success || /cancel/i.test(reason)) resolve()
        else reject(new Error(reason || 'The printer could not print the document'))
      })
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export function registerPrintHandlers(ipcMain: IpcMain): void {
  const active = new Set<number>()
  ipcHandle(ipcMain, 'print:document', async (event, title, html) => {
    if (typeof title !== 'string' || typeof html !== 'string') {
      throw new IpcValidationError('A document title and HTML content are required')
    }
    if (active.has(event.sender.id)) return
    const id = event.sender.id
    active.add(id)
    try {
      await printDocument(title, html)
    } finally {
      active.delete(id)
    }
  })
}
