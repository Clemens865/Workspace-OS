import { userDataDir } from '../userdata-path'
import { AccountsStore } from './accounts-store'

/**
 * The app-wide AccountsStore singleton, backed by the real userData dir. Holds
 * the non-secret connected-account entries (domain/label/addedAt) — the browser
 * SESSION itself lives in Electron's encrypted persistent partition, never here.
 */
let store: AccountsStore | null = null

export function accountsStore(): AccountsStore {
  if (!store) store = new AccountsStore(userDataDir())
  return store
}
