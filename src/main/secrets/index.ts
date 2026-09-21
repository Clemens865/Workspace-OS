import { app } from 'electron'
import { Vault } from './vault'
import { safeSecretStore } from './secret-store'
import { ConnectorState } from '../mcp/connector-state'

/**
 * App-wide singletons for the secret vault + connector-enable state, both
 * rooted at the Electron userData dir. Lazily created so importing this module
 * doesn't require an initialized `app` (keeps tests importing vault/connectors
 * directly without touching Electron).
 */
let vault: Vault | null = null
let connectorState: ConnectorState | null = null

export function getVault(): Vault {
  if (!vault) vault = new Vault(app.getPath('userData'), safeSecretStore)
  return vault
}

export function getConnectorState(): ConnectorState {
  if (!connectorState) connectorState = new ConnectorState(app.getPath('userData'))
  return connectorState
}
