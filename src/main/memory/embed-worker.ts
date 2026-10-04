import { parentPort } from 'worker_threads'
import { loadExtractor, embedWith, type EmbedKind } from './embed-core'

/**
 * Embedding worker: loads the model and turns text into meaning vectors off the
 * main process, so a first-time download or a batch of memories never stalls
 * the app. One request at a time; embedder.ts queues.
 */
parentPort?.on('message', async (msg: { id: number; cacheDir: string; texts: string[]; kind: EmbedKind }) => {
  try {
    const x = await loadExtractor(msg.cacheDir)
    const vecs = await embedWith(x, msg.texts, msg.kind)
    parentPort?.postMessage({ id: msg.id, vecs })
  } catch (e) {
    parentPort?.postMessage({ id: msg.id, error: (e as Error).message })
  }
})
