/**
 * Meaning vectors for memories: the one place the embedding model is touched.
 *
 * multilingual-e5-small (MIT, 384 dimensions, English and German in one space)
 * is the model TerminalOS's pilot measured; it finds "barrierefrei" for "easy to
 * use for people with disabilities", which no word search can. It runs locally:
 * downloaded once into the app's own folder, then nothing leaves the machine.
 *
 * Used directly by tests and from the embed worker by the app, so the app and
 * the measurement run the same code.
 */

export const MODEL_ID = 'Xenova/multilingual-e5-small'
export const DIM = 384
/** int8 weights: ~120 MB instead of ~470 MB. Chosen by the recall measurement, not by size alone. */
export const DTYPE = 'q8' as const
/** Stored with every vector, so changing the model re-embeds instead of mixing spaces. */
export const MODEL_KEY = `${MODEL_ID}@${DTYPE}`

export type EmbedKind = 'query' | 'passage'

type Extractor = (texts: string[], o: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>

const loaded = new Map<string, Promise<Extractor>>()

/** Load (and on first use download) the model into `cacheDir`. */
export function loadExtractor(cacheDir: string, dtype: string = DTYPE): Promise<Extractor> {
  const key = `${cacheDir}|${dtype}`
  let p = loaded.get(key)
  if (!p) {
    p = (async () => {
      const t = await import('@huggingface/transformers')
      t.env.cacheDir = cacheDir
      t.env.allowLocalModels = false
      return (await t.pipeline('feature-extraction', MODEL_ID, { dtype: dtype as 'q8' })) as unknown as Extractor
    })()
    p.catch(() => loaded.delete(key))
    loaded.set(key, p)
  }
  return p
}

/**
 * Embed texts as questions or as stored passages (e5 is trained with these
 * prefixes and is measurably worse without them). Vectors come back
 * normalised, so a dot product is the cosine.
 */
export async function embedWith(x: Extractor, texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
  if (texts.length === 0) return []
  const out = await x(texts.map((t) => `${kind}: ${t.slice(0, 2000)}`), { pooling: 'mean', normalize: true })
  const dim = out.dims[out.dims.length - 1]
  return texts.map((_, i) => out.data.slice(i * dim, (i + 1) * dim))
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}
