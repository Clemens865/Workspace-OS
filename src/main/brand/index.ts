import { userDataDir } from '../userdata-path'
import { BrandStore } from './brand-store'

/**
 * The app-wide BrandStore singleton, backed by the real userData dir. Shared by
 * the brand IPC handlers AND the mail handlers (which read the current brand to
 * theme + brief agent output), so there is one source of truth for the brand.
 */
let store: BrandStore | null = null

export function brandStore(): BrandStore {
  if (!store) store = new BrandStore(userDataDir())
  return store
}
