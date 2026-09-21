import { parentPort } from 'worker_threads'
import { extractText } from './extract'

/**
 * Search-index extraction worker. Runs the CPU-heavy parsing (PDF/docx/xlsx and
 * large text reads) off the Electron main process so it never stalls the UI.
 * One request at a time per worker; the pool (extract-pool.ts) handles fan-out.
 */
parentPort?.on('message', async (msg: { id: number; filePath: string }) => {
  let content: string | null = null
  try {
    content = await extractText(msg.filePath)
  } catch {
    content = null
  }
  parentPort?.postMessage({ id: msg.id, content })
})
